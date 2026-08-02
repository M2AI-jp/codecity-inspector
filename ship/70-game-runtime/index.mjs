import {
  DIRECTIONS,
  GUILD_TAB_LABELS,
  LOGICAL_SIZE,
  QUEST_CHOICES,
  createInitialState,
  evidenceSentence,
  gamepadToActions,
  mapGamepadInput,
  readGamepadInput,
  persistenceSnapshot,
  reduceGameState,
  RUNTIME_REPOSITORY_INSPECTION_BINDING,
} from './state.mjs';

export const SCENE_BUNDLE_FORMAT = 'codecity.scene-bundle';
export const SCENE_BUNDLE_SCHEMA_VERSION = 1;
export const PERSISTENCE_LIMIT_BYTES = 64 * 1024;

const HASH_RE = /^[a-f0-9]{64}$/iu;
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
const ASSET_DIRECTIONS = Object.freeze(['north', 'south', 'east', 'west']);
const REWARD_CHANGES = Object.freeze({
  [RUNTIME_REPOSITORY_INSPECTION_BINDING.event]: RUNTIME_REPOSITORY_INSPECTION_BINDING,
});
const REWARD_EFFECTS = new Set(Object.values(REWARD_CHANGES).map(({ effect }) => effect));
const REQUIRED_GAME_KEYS = Object.freeze([
  'logicalSize', 'worldSize', 'spawn', 'player', 'collisions', 'entrances', 'rooms',
  'npcs', 'quests', 'request', 'report', 'guild', 'renderables',
]);
const REQUIRED_SCENE_KEYS = Object.freeze([
  'bindingsVersion', 'world', 'assets', 'layers', 'collisions', 'nav', 'rooms',
  'actors', 'interactions', 'questSites', 'evidence', 'game',
]);
const KEY_ACTIONS = Object.freeze({
  Enter: 'INTERACT', Space: 'INTERACT', KeyE: 'INTERACT', KeyZ: 'INTERACT',
  Escape: 'EXIT', KeyX: 'BACK', KeyM: 'OVERLOOK', Tab: 'OVERLOOK',
  Equal: 'SCALE_UP', NumpadAdd: 'SCALE_UP', Plus: 'SCALE_UP',
  Minus: 'SCALE_DOWN', NumpadSubtract: 'SCALE_DOWN', Underscore: 'SCALE_DOWN',
});

export class GameRuntimeError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'GameRuntimeError';
    this.code = code;
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(path, code, message) { return { path, code, message }; }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }
function integer(value) { return Number.isInteger(value); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function positive(value) { return finite(value) && value > 0; }
function rect(value) { return isRecord(value) && finite(value.x) && finite(value.y) && positive(value.width) && positive(value.height); }
function point(value) { return isRecord(value) && finite(value.x) && finite(value.y); }
function array(value) { return Array.isArray(value); }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function rejectUnknownKeys(value, allowed, path, issues) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue(`${path}.${key}`, 'UNKNOWN_FIELD', 'field is not part of the exact SceneBundle v1 contract'));
}

function validateEvidenceAddresses(value, path, issues) {
  if (!isRecord(value)) { issues.push(issue(path, 'EVIDENCE_ADDRESSES_REQUIRED', 'observed, inferred, and unknown address arrays are required')); return; }
  rejectUnknownKeys(value, EVIDENCE_STATES, path, issues);
  for (const state of EVIDENCE_STATES) {
    if (!array(value[state])) { issues.push(issue(`${path}.${state}`, 'EVIDENCE_ARRAY_REQUIRED', 'evidence addresses must be an array')); continue; }
    value[state].forEach((entry, index) => {
      if (!isRecord(entry) || !nonEmpty(entry.address)) issues.push(issue(`${path}.${state}[${index}]`, 'EVIDENCE_ADDRESS_INVALID', 'evidence address entries require a non-empty address'));
    });
  }
}

function validateRewardChange(value, path, issues) {
  if (value === null) return;
  if (!isRecord(value)) { issues.push(issue(path, 'REWARD_CHANGE_INVALID', 'change must be null or an observed reward transition')); return; }
  rejectUnknownKeys(value, ['id', 'event', 'bindingId', 'facilityKind', 'effect', 'state', 'evidence'], path, issues);
  for (const key of ['id', 'event', 'bindingId', 'facilityKind', 'effect']) if (!nonEmpty(value[key])) issues.push(issue(`${path}.${key}`, 'REWARD_CHANGE_INVALID', 'reward transition field is required'));
  const expected = REWARD_CHANGES[value.event];
  if (!expected || value.bindingId !== expected.id || value.facilityKind !== expected.facilityKind || value.effect !== expected.effect) issues.push(issue(path, 'REWARD_CHANGE_NOT_ALLOWED', 'change must match the canonical repository_inspected reward binding'));
  if (value.state !== 'observed') issues.push(issue(`${path}.state`, 'REWARD_CHANGE_NOT_OBSERVED', 'reward transition state must be observed'));
  if (!isRecord(value.evidence)) issues.push(issue(`${path}.evidence`, 'REWARD_EVIDENCE_REQUIRED', 'tri-state evidence is required'));
  else {
    rejectUnknownKeys(value.evidence, EVIDENCE_STATES, `${path}.evidence`, issues);
    for (const state of EVIDENCE_STATES) if (!array(value.evidence[state]) || value.evidence[state].some((entry) => !nonEmpty(entry))) issues.push(issue(`${path}.evidence.${state}`, 'REWARD_EVIDENCE_INVALID', 'reward evidence states must contain strings'));
    if (!array(value.evidence.observed) || value.evidence.observed.length === 0) issues.push(issue(`${path}.evidence.observed`, 'REWARD_EVIDENCE_NOT_OBSERVED', 'at least one preserved observed evidence address is required'));
  }
}

function validateAsset(asset, path, selectors, issues) {
  if (!isRecord(asset)) {
    issues.push(issue(path, 'ASSET_REQUIRED', 'exact approved asset reference required'));
    return;
  }
  rejectUnknownKeys(asset, ['selector', 'assetId', 'version', 'path', 'url', 'sha256', 'dimensions', 'pivot', 'usage'], path, issues);
  for (const key of ['selector', 'assetId', 'version', 'path', 'url', 'sha256']) {
    if (!nonEmpty(asset[key])) issues.push(issue(`${path}.${key}`, 'ASSET_FIELD_REQUIRED', 'asset field is required'));
  }
  if (!HASH_RE.test(asset.sha256 ?? '')) issues.push(issue(`${path}.sha256`, 'ASSET_HASH_INVALID', 'sha256 must be hexadecimal SHA-256'));
  if (!isRecord(asset.dimensions) || !integer(asset.dimensions.width) || !integer(asset.dimensions.height) || asset.dimensions.width <= 0 || asset.dimensions.height <= 0) {
    issues.push(issue(`${path}.dimensions`, 'ASSET_DIMENSIONS_INVALID', 'positive integer dimensions required'));
  }
  if (!isRecord(asset.pivot) || !integer(asset.pivot.x) || !integer(asset.pivot.y)) issues.push(issue(`${path}.pivot`, 'ASSET_PIVOT_INVALID', 'integer pivot required'));
  if (!isRecord(asset.usage) || !isRecord(asset.usage.frame)
    || !integer(asset.usage.frame.width) || !integer(asset.usage.frame.height)
    || !integer(asset.usage.frame.columns) || !integer(asset.usage.frame.rows)
    || asset.usage.frame.width <= 0 || asset.usage.frame.height <= 0
    || asset.usage.frame.columns <= 0 || asset.usage.frame.rows <= 0
    || asset.usage.frame.width * asset.usage.frame.columns !== asset.dimensions?.width
    || asset.usage.frame.height * asset.usage.frame.rows !== asset.dimensions?.height) {
    issues.push(issue(`${path}.usage.frame`, 'ASSET_FRAME_INVALID', 'usage must declare an exact positive frame grid'));
  }
  if (typeof asset.path === 'string' && (asset.path.startsWith('/') || asset.path.includes('://') || asset.path.split('/').includes('..'))) issues.push(issue(`${path}.path`, 'ASSET_PATH_UNSAFE', 'asset path must be local and relative'));
  if (typeof asset.url === 'string' && (asset.url.startsWith('//') || asset.url.includes('://'))) issues.push(issue(`${path}.url`, 'ASSET_URL_REMOTE', 'remote asset URLs are forbidden'));
  for (const key of ['fallback', 'default', 'fallbackAssetId', 'defaultAssetId']) if (own(asset, key)) issues.push(issue(`${path}.${key}`, 'ASSET_FALLBACK_FORBIDDEN', 'fallback assets are forbidden'));
  if (nonEmpty(asset.selector)) {
    if (selectors.has(asset.selector)) issues.push(issue(`${path}.selector`, 'ASSET_SELECTOR_DUPLICATE', 'asset selectors must be unique'));
    selectors.set(asset.selector, asset);
  }
}

function validateCharacterAnimations(asset, path, requiredStates, issues, { exactFrameCount = null } = {}) {
  if (!isRecord(asset?.usage) || asset.usage.kind !== 'character' || asset.usage.layer !== 'actor' || !isRecord(asset.usage.animations)) {
    issues.push(issue(path, 'CHARACTER_USAGE_INVALID', 'character asset usage and actor layer are required'));
    return;
  }
  const frameCount = asset.usage.frame?.columns * asset.usage.frame?.rows;
  if (exactFrameCount !== null && frameCount !== exactFrameCount) issues.push(issue(`${path}.usage.frame`, 'CHARACTER_FRAME_COUNT_INVALID', `character sheet must contain exactly ${exactFrameCount} frames`));
  for (const [state, length] of Object.entries(requiredStates)) {
    for (const direction of ASSET_DIRECTIONS) {
      const animation = asset.usage.animations?.[state]?.[direction];
      if (!isRecord(animation) || !array(animation.frames) || animation.frames.length !== length || !positive(animation.fps)
        || animation.frames.some((index) => !integer(index) || index < 0 || index >= frameCount)) {
        issues.push(issue(`${path}.usage.animations.${state}.${direction}`, 'CHARACTER_ANIMATION_INVALID', `${state}/${direction} must contain exactly ${length} valid frames and a positive fps`));
      }
    }
  }
}

function validateRectArray(value, path, issues) {
  if (!array(value)) {
    issues.push(issue(path, 'RECT_ARRAY_REQUIRED', 'an array of pixel rectangles is required'));
    return;
  }
  value.forEach((entry, index) => { if (!rect(entry)) issues.push(issue(`${path}[${index}]`, 'RECT_INVALID', 'positive pixel rectangle required')); });
}

function validateSceneCollisions(value, game, issues) {
  if (!isRecord(value)) {
    issues.push(issue('$.collisions', 'COLLISIONS_REQUIRED', 'serialized exterior and interior collision layers are required'));
    return;
  }
  for (const key of ['solidRects', 'entranceRects', 'blockedPlotIds', 'blockedCells', 'waterCells', 'vacantPlotIds', 'interiorByRoom']) {
    if (!array(value[key])) issues.push(issue(`$.collisions.${key}`, 'COLLISION_ARRAY_REQUIRED', 'collision field must be an array'));
  }
  const roomIds = new Set();
  for (const [index, entry] of (array(value.interiorByRoom) ? value.interiorByRoom : []).entries()) {
    const path = `$.collisions.interiorByRoom[${index}]`;
    rejectUnknownKeys(entry, ['roomId', 'solidRects'], path, issues);
    if (!isRecord(entry) || !nonEmpty(entry.roomId)) issues.push(issue(`${path}.roomId`, 'INTERIOR_ROOM_ID_INVALID', 'interior collision record requires a roomId'));
    validateRectArray(entry?.solidRects, `${path}.solidRects`, issues);
    if (nonEmpty(entry?.roomId)) {
      if (roomIds.has(entry.roomId)) issues.push(issue(`${path}.roomId`, 'DUPLICATE_ID', 'interior collision room IDs must be unique'));
      roomIds.add(entry.roomId);
    }
  }
  const declaredRoomIds = new Set(array(game?.rooms) ? game.rooms.filter((room) => nonEmpty(room?.id)).map((room) => room.id) : []);
  for (const roomId of declaredRoomIds) {
    if (!roomIds.has(roomId)) issues.push(issue('$.collisions.interiorByRoom', 'INTERIOR_ROOM_MISSING', `interior collision record is required for room ${roomId}`));
  }
  for (const roomId of roomIds) {
    if (!declaredRoomIds.has(roomId)) issues.push(issue('$.collisions.interiorByRoom', 'INTERIOR_ROOM_UNKNOWN', `interior collision record references unknown room ${roomId}`));
  }
}

function validateGame(game, assets, issues) {
  if (!isRecord(game)) {
    issues.push(issue('$.game', 'GAME_REQUIRED', 'SceneBundle.game is required'));
    return;
  }
  rejectUnknownKeys(game, REQUIRED_GAME_KEYS, '$.game', issues);
  for (const key of REQUIRED_GAME_KEYS) if (!own(game, key)) issues.push(issue(`$.game.${key}`, 'GAME_FIELD_REQUIRED', 'game field is required'));
  if (!isRecord(game.logicalSize) || game.logicalSize.width !== LOGICAL_SIZE.width || game.logicalSize.height !== LOGICAL_SIZE.height) issues.push(issue('$.game.logicalSize', 'LOGICAL_SIZE_INVALID', 'logical size must be exactly 384x216'));
  if (!isRecord(game.worldSize) || !integer(game.worldSize.width) || !integer(game.worldSize.height) || game.worldSize.width < LOGICAL_SIZE.width || game.worldSize.height < LOGICAL_SIZE.height) issues.push(issue('$.game.worldSize', 'WORLD_SIZE_INVALID', 'world size must contain integer dimensions at least 384x216'));
  if (!isRecord(game.spawn) || !nonEmpty(game.spawn.plotId) || !finite(game.spawn.x) || !finite(game.spawn.y)) issues.push(issue('$.game.spawn', 'SPAWN_INVALID', 'spawn needs plotId and pixel x/y'));

  const player = game.player;
  if (!isRecord(player)) issues.push(issue('$.game.player', 'PLAYER_REQUIRED', 'player contract is required'));
  else {
    rejectUnknownKeys(player, ['assetSelector', 'footbox', 'speeds', 'interactDistance'], '$.game.player', issues);
    if (!nonEmpty(player.assetSelector) || !assets.has(player.assetSelector)) issues.push(issue('$.game.player.assetSelector', 'ASSET_SELECTOR_UNKNOWN', 'player asset selector must be declared'));
    else validateCharacterAnimations(assets.get(player.assetSelector), `$.assets.${player.assetSelector}`, { idle: 2, walk: 4, run: 6 }, issues, { exactFrameCount: 48 });
    if (!rect(player.footbox)) issues.push(issue('$.game.player.footbox', 'FOOTBOX_INVALID', 'player footbox must be a frame-relative rectangle'));
    if (!isRecord(player.speeds) || !positive(player.speeds.run) || !positive(player.speeds.walk)) issues.push(issue('$.game.player.speeds', 'SPEEDS_INVALID', 'positive run and walk speeds required'));
    if (isRecord(player.speeds) && (player.speeds.run !== 75 || player.speeds.walk !== 45)) issues.push(issue('$.game.player.speeds', 'SPEEDS_NONCANONICAL', 'default speeds must be run 75 and walk 45 pixels/second'));
    if (!positive(player.interactDistance)) issues.push(issue('$.game.player.interactDistance', 'INTERACT_DISTANCE_INVALID', 'positive interaction distance required'));
  }

  validateRectArray(game.collisions, '$.game.collisions', issues);
  const entranceIds = new Set();
  if (!array(game.entrances)) issues.push(issue('$.game.entrances', 'ENTRANCES_REQUIRED', 'entrances array required'));
  else game.entrances.forEach((entry, index) => {
    const path = `$.game.entrances[${index}]`;
    rejectUnknownKeys(entry, ['id', 'rect', 'roomId', 'cutawayIds', 'exteriorSpawn', 'interiorSpawn'], path, issues);
    if (!isRecord(entry) || !nonEmpty(entry.id) || !nonEmpty(entry.roomId) || !rect(entry.rect) || !array(entry.cutawayIds) || entry.cutawayIds.some((id) => !nonEmpty(id)) || !point(entry.exteriorSpawn) || !point(entry.interiorSpawn)) issues.push(issue(path, 'ENTRANCE_INVALID', 'entrance needs id, roomId, rect, cutawayIds, exteriorSpawn, and interiorSpawn'));
    if (nonEmpty(entry?.id)) { if (entranceIds.has(entry.id)) issues.push(issue(`${path}.id`, 'DUPLICATE_ID', 'entrance IDs must be unique')); entranceIds.add(entry.id); }
  });
  const roomIds = new Set();
  if (!array(game.rooms)) issues.push(issue('$.game.rooms', 'ROOMS_REQUIRED', 'rooms array required'));
  else game.rooms.forEach((room, index) => {
    const path = `$.game.rooms[${index}]`;
    rejectUnknownKeys(room, ['id', 'bounds', 'cutawayIds'], path, issues);
    if (!isRecord(room) || !nonEmpty(room.id) || !rect(room.bounds) || !array(room.cutawayIds) || room.cutawayIds.some((id) => !nonEmpty(id))) issues.push(issue(path, 'ROOM_INVALID', 'room needs id, bounds, and cutawayIds'));
    if (nonEmpty(room?.id)) { if (roomIds.has(room.id)) issues.push(issue(`${path}.id`, 'DUPLICATE_ID', 'room IDs must be unique')); roomIds.add(room.id); }
  });
  validateNpcs(game.npcs, assets, issues);
  validateQuests(game.quests, issues);
  if (!isRecord(game.request) || !nonEmpty(game.request.id) || !rect(game.request.rect) || !nonEmpty(game.request.prompt)) issues.push(issue('$.game.request', 'REQUEST_INVALID', 'request needs id, rect, and prompt'));
  else rejectUnknownKeys(game.request, ['id', 'rect', 'prompt'], '$.game.request', issues);
  if (!isRecord(game.report) || !nonEmpty(game.report.id) || !rect(game.report.rect) || !nonEmpty(game.report.prompt) || !own(game.report, 'change')) issues.push(issue('$.game.report', 'REPORT_INVALID', 'report needs id, rect, prompt, and nullable change'));
  else {
    rejectUnknownKeys(game.report, ['id', 'rect', 'prompt', 'change'], '$.game.report', issues);
    validateRewardChange(game.report.change, '$.game.report.change', issues);
  }
  validateGuild(game.guild, issues);
  if (!array(game.renderables)) issues.push(issue('$.game.renderables', 'RENDERABLES_REQUIRED', 'renderables array required'));
  else game.renderables.forEach((entry, index) => {
    const path = `$.game.renderables[${index}]`;
    rejectUnknownKeys(entry, ['id', 'assetSelector', 'position', 'footPivot', 'z', 'cutawayId', 'roomId', 'effect'], path, issues);
    if (!isRecord(entry) || !nonEmpty(entry.id) || !nonEmpty(entry.assetSelector) || !assets.has(entry.assetSelector) || !point(entry.position) || !point(entry.footPivot) || !finite(entry.z)) issues.push(issue(path, 'RENDERABLE_INVALID', 'renderable needs declared asset, position, footPivot, and z'));
    if (own(entry, 'effect') && (!nonEmpty(entry.effect) || !REWARD_EFFECTS.has(entry.effect))) issues.push(issue(`${path}.effect`, 'RENDERABLE_EFFECT_INVALID', 'conditional renderable effect must be the observed town-hall lantern change'));
  });
}

function validateNpcs(npcs, assets, issues) {
  if (!array(npcs)) { issues.push(issue('$.game.npcs', 'NPCS_REQUIRED', 'npcs array required')); return; }
  const ids = new Set();
  npcs.forEach((npc, index) => {
    const path = `$.game.npcs[${index}]`;
    rejectUnknownKeys(npc, ['id', 'kind', 'position', 'assetSelector', 'footPivot', 'interactionRect', 'prompt', 'dialogue', 'cutawayId'], path, issues);
    if (!isRecord(npc) || !nonEmpty(npc.id) || !['guild', 'resident'].includes(npc.kind) || !point(npc.position) || !nonEmpty(npc.assetSelector) || !assets.has(npc.assetSelector) || !point(npc.footPivot) || !rect(npc.interactionRect) || !nonEmpty(npc.prompt) || !array(npc.dialogue) || npc.dialogue.some((line) => !nonEmpty(line))) issues.push(issue(path, 'NPC_INVALID', 'npc needs kind, position, approved asset, pivot, interactionRect, prompt, and dialogue'));
    if (nonEmpty(npc?.assetSelector) && assets.has(npc.assetSelector)) validateCharacterAnimations(assets.get(npc.assetSelector), `$.assets.${npc.assetSelector}`, { idle: 2, walk: 4 }, issues);
    if (nonEmpty(npc?.id)) { if (ids.has(npc.id)) issues.push(issue(`${path}.id`, 'DUPLICATE_ID', 'npc IDs must be unique')); ids.add(npc.id); }
  });
}

function validateQuests(quests, issues) {
  if (!array(quests) || quests.length > 3) { issues.push(issue('$.game.quests', 'QUEST_COUNT_INVALID', 'quests must contain zero through three compiler-provided sites')); return; }
  const ids = new Set();
  quests.forEach((quest, index) => {
    const path = `$.game.quests[${index}]`;
    rejectUnknownKeys(quest, ['id', 'siteId', 'rect', 'subject', 'statement', 'evidenceAddresses'], path, issues);
    if (!isRecord(quest) || !nonEmpty(quest.id) || !nonEmpty(quest.siteId) || !rect(quest.rect) || !nonEmpty(quest.subject) || !nonEmpty(quest.statement)) issues.push(issue(path, 'QUEST_INVALID', 'quest needs id, siteId, rect, subject, statement, and evidenceAddresses'));
    validateEvidenceAddresses(quest?.evidenceAddresses, `${path}.evidenceAddresses`, issues);
    if (nonEmpty(quest?.id)) { if (ids.has(quest.id)) issues.push(issue(`${path}.id`, 'DUPLICATE_ID', 'quest IDs must be unique')); ids.add(quest.id); }
  });
}

function validateGuild(guild, issues) {
  if (!isRecord(guild) || !array(guild.tabs) || guild.tabs.length !== GUILD_TAB_LABELS.length) { issues.push(issue('$.game.guild', 'GUILD_INVALID', 'guild must contain exactly five tabs')); return; }
  rejectUnknownKeys(guild, ['tabs'], '$.game.guild', issues);
  guild.tabs.forEach((tab, index) => {
    const path = `$.game.guild.tabs[${index}]`;
    rejectUnknownKeys(tab, ['id', 'label', 'entries'], path, issues);
    if (!isRecord(tab) || !nonEmpty(tab.id) || tab.label !== GUILD_TAB_LABELS[index] || !array(tab.entries)) issues.push(issue(path, 'GUILD_TAB_INVALID', 'guild tabs must use the canonical five labels and entry arrays'));
  });
}

export function validateSceneBundle(bundle) {
  const issues = [];
  if (!isRecord(bundle)) return Object.freeze({ ok: false, issues: Object.freeze([issue('$', 'BUNDLE_INVALID', 'SceneBundle must be an object')]) });
  rejectUnknownKeys(bundle, ['format', 'schemaVersion', ...REQUIRED_SCENE_KEYS], '$', issues);
  if (bundle.format !== SCENE_BUNDLE_FORMAT) issues.push(issue('$.format', 'FORMAT_INVALID', `must be ${SCENE_BUNDLE_FORMAT}`));
  if (bundle.schemaVersion !== SCENE_BUNDLE_SCHEMA_VERSION) issues.push(issue('$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'must be exactly 1'));
  for (const key of REQUIRED_SCENE_KEYS) if (!own(bundle, key)) issues.push(issue(`$.${key}`, 'SCENE_FIELD_REQUIRED', 'SceneBundle v1 field is required'));
  if (bundle.bindingsVersion !== 1) issues.push(issue('$.bindingsVersion', 'BINDINGS_UNSUPPORTED', 'bindingsVersion must be exactly 1'));
  if (!isRecord(bundle.world) || !isRecord(bundle.world.identity) || !nonEmpty(bundle.world.identity.key)) issues.push(issue('$.world.identity', 'IDENTITY_REQUIRED', 'world identity.key is required'));
  else {
    rejectUnknownKeys(bundle.world, ['identity', 'contentDigest', 'seed', 'townType', 'climate', 'terrain', 'grid'], '$.world', issues);
    if (!HASH_RE.test(bundle.world.contentDigest ?? '')) issues.push(issue('$.world.contentDigest', 'CONTENT_DIGEST_INVALID', 'world contentDigest must be a SHA-256 digest'));
  }
  if (!array(bundle.assets) || bundle.assets.length === 0) issues.push(issue('$.assets', 'ASSETS_REQUIRED', 'at least one approved asset binding is required'));
  const selectors = new Map();
  if (array(bundle.assets)) bundle.assets.forEach((asset, index) => validateAsset(asset, `$.assets[${index}]`, selectors, issues));
  validateSceneCollisions(bundle.collisions, bundle.game, issues);
  validateGame(bundle.game, selectors, issues);
  try { JSON.stringify(bundle); } catch { issues.push(issue('$', 'SERIALIZATION_INVALID', 'SceneBundle must be JSON-serializable')); }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}

function assertValid(bundle) {
  const result = validateSceneBundle(bundle);
  if (!result.ok) throw new GameRuntimeError('SCENE_BUNDLE_INVALID', 'SceneBundle failed the runtime contract', result.issues);
}

function storageKey(identity, contentDigest) { return `codecity.game.v1.${encodeURIComponent(identity)}.${contentDigest}`; }
function assertStorage(storage) { if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') throw new GameRuntimeError('STORAGE_REQUIRED', 'an injected storage adapter is required'); }
function utf8Bytes(value) { if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength; return unescape(encodeURIComponent(value)).length; }

function readSaved(storage, key, identity) {
  let raw;
  try { raw = storage.getItem(key); } catch { return null; }
  if (typeof raw !== 'string' || utf8Bytes(raw) > PERSISTENCE_LIMIT_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    return isRecord(value) && value.version === 1 && value.identity === identity ? value : null;
  } catch { return null; }
}

function writeSaved(storage, key, state, identity, questIds) {
  const raw = JSON.stringify(persistenceSnapshot(state, identity, questIds));
  if (utf8Bytes(raw) > PERSISTENCE_LIMIT_BYTES) throw new GameRuntimeError('PERSISTENCE_LIMIT', 'runtime persistence exceeds 64 KiB');
  try { storage.setItem(key, raw); } catch (error) { throw new GameRuntimeError('PERSISTENCE_WRITE_FAILED', 'runtime persistence could not be written', [{ path: key, code: 'STORAGE_WRITE_FAILED', message: String(error?.message ?? error) }]); }
}

function assertCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new GameRuntimeError('CANVAS_REQUIRED', 'a Canvas element is required');
  const context = canvas.getContext('2d');
  if (!context) throw new GameRuntimeError('CANVAS_CONTEXT_REQUIRED', 'a 2D Canvas context is required');
  return context;
}

function assertUiRoot(uiRoot) {
  if (!uiRoot || !('textContent' in uiRoot)) throw new GameRuntimeError('UI_ROOT_REQUIRED', 'a DOM UI root with textContent is required');
}

function assertAssetLoader(assetLoader) { if (typeof assetLoader !== 'function') throw new GameRuntimeError('ASSET_LOADER_REQUIRED', 'an approved-asset loader is required'); }

async function loadAssets(bundle, assetLoader) {
  const loaded = new Map();
  for (const asset of bundle.assets) {
    let image;
    try { image = await assetLoader(Object.freeze({ ...asset })); } catch (error) { throw new GameRuntimeError('ASSET_LOAD_FAILED', `approved asset ${asset.selector} could not be loaded`, [{ path: asset.selector, code: 'ASSET_LOAD_FAILED', message: String(error?.message ?? error) }]); }
    if (!image || (typeof image !== 'object' && typeof image !== 'function')) throw new GameRuntimeError('ASSET_LOAD_FAILED', `approved asset ${asset.selector} did not produce an image`);
    loaded.set(asset.selector, image);
  }
  return loaded;
}

function defaultClock() {
  const performanceObject = globalThis.performance;
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  if (!performanceObject || typeof performanceObject.now !== 'function' || typeof raf !== 'function' || typeof caf !== 'function') return null;
  return { now: () => performanceObject.now(), requestFrame: raf.bind(globalThis), cancelFrame: caf.bind(globalThis) };
}

function defaultGamepadSource() {
  const navigatorObject = globalThis.navigator;
  if (!navigatorObject || typeof navigatorObject.getGamepads !== 'function') return [];
  try { return navigatorObject.getGamepads() ?? []; } catch { return []; }
}

function firstConnectedGamepad(value) {
  if (isRecord(value) && 'buttons' in value) return value;
  if (value == null) return null;
  let pads;
  try { pads = Array.from(value); } catch { return null; }
  return pads.find((gamepad) => isRecord(gamepad) && gamepad.connected !== false) ?? null;
}

function assetDirection(direction) {
  return ({ up: 'north', down: 'south', left: 'west', right: 'east' })[direction] ?? 'south';
}

function animationFrame(asset, state, direction, animationMs) {
  const frame = asset.usage.frame;
  if (asset.usage.kind !== 'character') return { index: 0, frame };
  const animation = asset.usage.animations?.[state]?.[assetDirection(direction)];
  if (!isRecord(animation) || !array(animation.frames) || animation.frames.length === 0 || !positive(animation.fps)) {
    throw new GameRuntimeError('ANIMATION_NOT_DECLARED', `asset ${asset.selector} does not declare ${state}/${assetDirection(direction)}`);
  }
  const offset = Math.floor((animationMs / 1000) * animation.fps) % animation.frames.length;
  return { index: animation.frames[offset], frame };
}

function drawFrame(context, canvas, bundle, state, images) {
  const scale = state.camera.scale;
  const pixelWidth = LOGICAL_SIZE.width * scale;
  const pixelHeight = LOGICAL_SIZE.height * scale;
  // Assigning canvas dimensions resets the backing store and context. Resize
  // only when the integer display scale actually changes, never every frame.
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  if ('imageSmoothingEnabled' in context) context.imageSmoothingEnabled = false;
  if (typeof context.setTransform === 'function') context.setTransform(scale, 0, 0, scale, 0, 0);
  if (typeof context.clearRect === 'function') context.clearRect(0, 0, LOGICAL_SIZE.width, LOGICAL_SIZE.height);
  const game = bundle.game;
  const assets = new Map(bundle.assets.map((asset) => [asset.selector, asset]));
  const camera = state.overlook ? centerCamera(game) : state.camera;
  const renderables = game.renderables.map((entry) => ({ ...entry, dynamic: false }));
  for (const npc of game.npcs) renderables.push({ id: `npc:${npc.id}`, assetSelector: npc.assetSelector, position: npc.position, footPivot: npc.footPivot, z: 10, roomId: npc.cutawayId, exteriorOnly: !npc.cutawayId, animationState: 'idle', direction: 'down' });
  renderables.push({ id: 'player', assetSelector: game.player.assetSelector, position: { x: state.player.x, y: state.player.y }, footPivot: { x: game.player.footbox.x + game.player.footbox.width / 2, y: game.player.footbox.y + game.player.footbox.height }, z: 100, animationState: state.player.moving ? (state.input.shift ? 'walk' : 'run') : 'idle', direction: state.player.direction });
  const activeRoom = game.rooms.find((room) => room.id === state.roomId);
  const visible = renderables.filter((entry) =>
    (!entry.effect || state.townChange?.effect === entry.effect)
    && (!entry.roomId || activeRoom?.id === entry.roomId)
    && (!entry.exteriorOnly || !activeRoom)
    && (!entry.cutawayId || !activeRoom || !activeRoom.cutawayIds.includes(entry.cutawayId))
  );
  visible.sort((left, right) => (left.position.y + left.footPivot.y) - (right.position.y + right.footPivot.y) || left.z - right.z || left.id.localeCompare(right.id));
  for (const entry of visible) {
    const image = images.get(entry.assetSelector);
    if (!image) throw new GameRuntimeError('ASSET_NOT_LOADED', `asset ${entry.assetSelector} was not loaded`);
    const asset = assets.get(entry.assetSelector);
    if (!asset) throw new GameRuntimeError('ASSET_NOT_DECLARED', `asset ${entry.assetSelector} was not declared`);
    const selected = animationFrame(asset, entry.animationState ?? 'idle', entry.direction ?? 'down', state.animationMs);
    const sourceX = (selected.index % selected.frame.columns) * selected.frame.width;
    const sourceY = Math.floor(selected.index / selected.frame.columns) * selected.frame.height;
    if (typeof context.drawImage === 'function') context.drawImage(
      image,
      sourceX,
      sourceY,
      selected.frame.width,
      selected.frame.height,
      Math.round(entry.position.x - camera.x),
      Math.round(entry.position.y - camera.y),
      selected.frame.width,
      selected.frame.height,
    );
  }
}

function centerCamera(game) { return { x: Math.max(0, (game.worldSize.width - LOGICAL_SIZE.width) / 2), y: Math.max(0, (game.worldSize.height - LOGICAL_SIZE.height) / 2), scale: 1 }; }

function renderUi(uiRoot, state, bundle, gamepadNotice = '') {
  if (!uiRoot || !('textContent' in uiRoot)) return;
  const lines = [];
  if (gamepadNotice) lines.push(gamepadNotice);
  if (state.dialogue) {
    lines.push(...state.dialogue.lines);
    if (state.dialogue.kind === 'quest') lines.push(...state.dialogue.choices.map((choice, index) => `${index === state.dialogue.choiceIndex ? '▶ ' : '  '}${choice}`));
  } else if (state.guild.open) {
    const tab = bundle.game.guild.tabs[state.guild.tabIndex];
    lines.push(`名簿:${tab.label}`);
    for (const entry of tab.entries) lines.push(typeof entry === 'string' ? entry : String(entry.name ?? entry.label ?? entry.id ?? ''));
  } else if (state.phase === 'exit') {
    lines.push('またおいで。', 'Enterで同じ街へ戻れます。');
  } else if (state.quest.status === 'no_request') {
    lines.push('掲示板に、新しい依頼はありません。');
  } else if (state.quest.status === 'available') {
    lines.push('書記が、掲示板の前で待っています。');
  } else if (state.quest.status === 'investigating') {
    lines.push('掲示板の依頼を、街で確かめてください。');
  } else if (state.quest.status === 'ready_report') {
    lines.push('書記が、調査の記録を待っています。');
  } else if (state.quest.reported) {
    lines.push(state.townChange ? '街のようすが、ひとつ変わりました。' : '調査の記録が、札に綴じられました。');
  }
  uiRoot.textContent = lines.filter(Boolean).join('\n');
}

function actionForKey(key) {
  const action = KEY_ACTIONS[key];
  if (action === 'SCALE_UP') return { type: 'SCALE', delta: 1 };
  if (action === 'SCALE_DOWN') return { type: 'SCALE', delta: -1 };
  if (action === 'OVERLOOK') return { type: 'OVERLOOK' };
  if (action) return { type: action };
  return null;
}

export function createGameRuntime({ bundle, canvas, uiRoot, storage, assetLoader, inputTarget, clock, gamepadSource } = {}) {
  assertValid(bundle);
  const context = assertCanvas(canvas);
  assertUiRoot(uiRoot);
  assertStorage(storage);
  assertAssetLoader(assetLoader);
  const identity = bundle.world.identity.key;
  const key = storageKey(identity, bundle.world.contentDigest);
  let state = createInitialState(bundle, readSaved(storage, key, identity));
  let images = new Map();
  let frame = null;
  let previousTime = null;
  let running = false;
  let previousGamepad = readGamepadInput(null);
  let gamepadConnected = false;
  let gamepadNoticeUntil = 0;
  let lastMovementSaveAt = 0;
  const target = inputTarget ?? globalThis.window;
  const timer = clock ?? defaultClock();
  const getGamepads = typeof gamepadSource === 'function' ? gamepadSource : defaultGamepadSource;
  const listeners = [];

  const render = () => {
    drawFrame(context, canvas, bundle, state, images);
    const now = timer && typeof timer.now === 'function' ? timer.now() : 0;
    renderUi(uiRoot, state, bundle, gamepadNoticeUntil > now ? 'パッドで遊べます' : '');
  };
  const save = () => writeSaved(storage, key, state, identity, bundle.game.quests.map((quest) => quest.id));
  const dispatch = (action) => {
    const previousState = state;
    state = reduceGameState(state, action, bundle);
    // Animation and held-input events can arrive every frame. Persisting those
    // events would turn rendering into a synchronous localStorage write loop.
    // Meaningful transitions save immediately. Held movement is throttled so
    // abrupt termination loses at most a short interval without turning the
    // render loop into synchronous localStorage I/O at 60 Hz.
    if (action?.type === 'TICK') {
      const moved = state.player.x !== previousState.player.x || state.player.y !== previousState.player.y;
      const now = timer && typeof timer.now === 'function' ? timer.now() : 0;
      if (moved && now - lastMovementSaveAt >= 250) { save(); lastMovementSaveAt = now; }
    } else if (!['KEY_DOWN', 'KEY_UP', 'GAMEPAD_INPUT'].includes(action?.type)) {
      save();
    }
    if (running) render();
    return state;
  };
  const onKeyDown = (event) => {
    let action = actionForKey(event.code);
    // Escape exits from free exploration; while a dialogue, guild, or room is
    // open it first performs the local Back action so the user never loses a
    // conversation or leaves an interior accidentally.
    if (action?.type === 'EXIT' && (state.dialogue || state.guild.open || state.phase === 'room')) action = { type: 'BACK' };
    if (action) { event.preventDefault?.(); dispatch(action); return; }
    dispatch({ type: 'KEY_DOWN', key: event.code });
  };
  const onKeyUp = (event) => dispatch({ type: 'KEY_UP', key: event.code });
  const pollGamepad = (now) => {
    let gamepad = null;
    try { gamepad = firstConnectedGamepad(getGamepads()); } catch { gamepad = null; }
    const mapped = gamepadToActions(gamepad, previousGamepad);
    if (mapped.snapshot.connected && !gamepadConnected) gamepadNoticeUntil = now + 3200;
    gamepadConnected = mapped.snapshot.connected;
    previousGamepad = mapped.snapshot;
    for (const action of mapped.actions) dispatch(action);
  };
  const attach = () => {
    if (!target || typeof target.addEventListener !== 'function') throw new GameRuntimeError('INPUT_TARGET_REQUIRED', 'an input target with addEventListener is required');
    target.addEventListener('keydown', onKeyDown); target.addEventListener('keyup', onKeyUp);
    listeners.push(['keydown', onKeyDown], ['keyup', onKeyUp]);
  };
  const detach = () => { for (const [type, listener] of listeners.splice(0)) target.removeEventListener?.(type, listener); };
  const tick = (time) => {
    if (!running) return;
    const previous = previousTime ?? time;
    previousTime = time;
    pollGamepad(time);
    dispatch({ type: 'TICK', dtMs: Math.max(0, Math.min(250, time - previous)) });
    frame = timer.requestFrame(tick);
  };
  return {
    get state() { return state; },
    get storageKey() { return key; },
    dispatch,
    render,
    async start() {
      if (running) return this;
      if (!timer || typeof timer.now !== 'function' || typeof timer.requestFrame !== 'function' || typeof timer.cancelFrame !== 'function') throw new GameRuntimeError('CLOCK_REQUIRED', 'a deterministic clock or browser animation clock is required');
      images = await loadAssets(bundle, assetLoader);
      attach();
      running = true;
      previousTime = timer.now();
      lastMovementSaveAt = previousTime;
      previousGamepad = readGamepadInput(null);
      gamepadConnected = false;
      gamepadNoticeUntil = 0;
      pollGamepad(previousTime);
      render();
      frame = timer.requestFrame(tick);
      return this;
    },
    stop() {
      if (frame !== null) timer?.cancelFrame?.(frame);
      frame = null; running = false; previousTime = null; previousGamepad = readGamepadInput(null); gamepadConnected = false; gamepadNoticeUntil = 0; detach(); save();
      return this;
    },
    destroy() { this.stop(); },
  };
}

export async function startGameRuntime(options = {}) {
  const runtime = createGameRuntime(options);
  await runtime.start();
  return runtime;
}

export {
  createInitialState,
  evidenceSentence,
  gamepadToActions,
  mapGamepadInput,
  readGamepadInput,
  persistenceSnapshot,
  reduceGameState,
};
