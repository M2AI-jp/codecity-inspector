import {
  createInitialState,
  persistenceSnapshot,
  reduceGameState,
  RUNTIME_REPOSITORY_INSPECTION_BINDING,
} from './state.mjs';

const SCENE_BUNDLE_FORMAT = 'codecity.scene-bundle';
const SCENE_BUNDLE_SCHEMA_VERSION = 2;
const PERSISTENCE_LIMIT_BYTES = 64 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/iu;
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
const ASSET_DIRECTIONS = Object.freeze(['north', 'south', 'east', 'west']);
const UI_ASSET_IDS = Object.freeze({
  dialogue: 'ui--dialogue-v1',
  report: 'ui--inspection-report-v1',
});
const REWARD_CHANGES = Object.freeze({
  [RUNTIME_REPOSITORY_INSPECTION_BINDING.event]: RUNTIME_REPOSITORY_INSPECTION_BINDING,
});
const REWARD_EFFECTS = new Set(Object.values(REWARD_CHANGES).map(({ effect }) => effect));
const REQUIRED_GAME_KEYS = Object.freeze([
  'viewSize', 'worldSize', 'camera', 'spawn', 'player', 'surfaces', 'collisions',
  'interiors', 'npcs', 'quests', 'request', 'report', 'renderables', 'ui',
]);
const KEY_ACTIONS = Object.freeze({
  Enter: 'INTERACT', Space: 'INTERACT', KeyE: 'INTERACT', KeyZ: 'INTERACT',
  Escape: 'EXIT', KeyX: 'BACK',
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
function point(value) { return isRecord(value) && finite(value.x) && finite(value.y); }
function rect(value) { return point(value) && positive(value.width) && positive(value.height); }
function interactionRectMatches(body, reach, facing, actual) {
  if (!rect(body) || !positive(reach) || !rect(actual)) return false;
  const expected = facing === 'up'
    ? { x: body.x, y: body.y - reach, width: body.width, height: reach }
    : facing === 'down'
      ? { x: body.x, y: body.y + body.height, width: body.width, height: reach }
      : facing === 'left'
        ? { x: body.x - reach, y: body.y, width: reach, height: body.height }
        : facing === 'right'
          ? { x: body.x + body.width, y: body.y, width: reach, height: body.height }
          : null;
  return expected !== null && ['x', 'y', 'width', 'height'].every((key) => actual[key] === expected[key]);
}
function overlaps(left, right) {
  return rect(left) && rect(right)
    && left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}
function array(value) { return Array.isArray(value); }
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

function quantizedZoom(value) {
  if (!positive(value) || value > 1) return false;
  const quantum = 1 / value;
  return Number.isInteger(quantum) && (quantum & (quantum - 1)) === 0;
}

function rejectUnknownKeys(value, allowed, path, issues) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(issue(`${path}.${key}`, 'UNKNOWN_FIELD', 'field is not part of SceneBundle v2'));
  }
}

function validateFrame(asset, path, issues) {
  const frame = asset?.usage?.frame;
  if (!isRecord(frame)
    || !integer(frame.width) || !integer(frame.height)
    || !integer(frame.columns) || !integer(frame.rows)
    || frame.width <= 0 || frame.height <= 0 || frame.columns <= 0 || frame.rows <= 0
    || frame.width * frame.columns !== asset?.dimensions?.width
    || frame.height * frame.rows !== asset?.dimensions?.height) {
    issues.push(issue(`${path}.usage.frame`, 'ASSET_FRAME_INVALID', 'asset frame geometry must match its exact image dimensions'));
  }
}

function validateAsset(asset, path, assets, issues) {
  if (!isRecord(asset)) {
    issues.push(issue(path, 'ASSET_INVALID', 'shipping asset reference must be an object'));
    return;
  }
  rejectUnknownKeys(asset, ['id', 'version', 'path', 'url', 'sha256', 'dimensions', 'pivot', 'usage'], path, issues);
  for (const key of ['id', 'version', 'path', 'url', 'sha256']) {
    if (!nonEmpty(asset[key])) issues.push(issue(`${path}.${key}`, 'ASSET_FIELD_REQUIRED', 'shipping asset field is required'));
  }
  if (!HASH_RE.test(asset.sha256 ?? '')) issues.push(issue(`${path}.sha256`, 'ASSET_HASH_INVALID', 'sha256 must be a hexadecimal SHA-256 digest'));
  if (!isRecord(asset.dimensions) || !integer(asset.dimensions.width) || !integer(asset.dimensions.height)
    || asset.dimensions.width <= 0 || asset.dimensions.height <= 0) {
    issues.push(issue(`${path}.dimensions`, 'ASSET_DIMENSIONS_INVALID', 'positive integer image dimensions are required'));
  }
  if (!point(asset.pivot) || !isRecord(asset.usage) || !nonEmpty(asset.usage.kind)) {
    issues.push(issue(path, 'ASSET_GEOMETRY_INVALID', 'asset pivot and usage are required'));
  }
  validateFrame(asset, path, issues);
  if (typeof asset.path === 'string' && (asset.path.startsWith('/') || asset.path.includes('://') || asset.path.split('/').includes('..'))) {
    issues.push(issue(`${path}.path`, 'ASSET_PATH_UNSAFE', 'asset path must remain local and relative'));
  }
  if (typeof asset.url === 'string' && (asset.url.startsWith('//') || asset.url.includes('://'))) {
    issues.push(issue(`${path}.url`, 'ASSET_URL_REMOTE', 'remote asset URLs are forbidden'));
  }
  for (const key of ['fallback', 'default', 'fallbackAssetId', 'defaultAssetId']) {
    if (own(asset, key)) issues.push(issue(`${path}.${key}`, 'ASSET_FALLBACK_FORBIDDEN', 'alternate asset substitution is forbidden'));
  }
  if (nonEmpty(asset.id)) {
    if (assets.has(asset.id)) issues.push(issue(`${path}.id`, 'ASSET_ID_DUPLICATE', 'asset IDs must be unique'));
    assets.set(asset.id, asset);
  }
}

function validateCharacterAnimations(asset, path, requiredStates, issues) {
  if (asset?.usage?.kind !== 'character' || asset.usage.layer !== 'actor' || !isRecord(asset.usage.animations)) {
    issues.push(issue(path, 'CHARACTER_USAGE_INVALID', 'character actor usage is required'));
    return;
  }
  const frameCount = asset.usage.frame?.columns * asset.usage.frame?.rows;
  for (const state of requiredStates) {
    for (const direction of ASSET_DIRECTIONS) {
      const animation = asset.usage.animations?.[state]?.[direction];
      if (!isRecord(animation) || !array(animation.frames) || animation.frames.length === 0
        || animation.frames.some((index) => !integer(index) || index < 0 || index >= frameCount)
        || !positive(animation.fps)) {
        issues.push(issue(`${path}.usage.animations.${state}.${direction}`, 'CHARACTER_ANIMATION_INVALID', `${state}/${direction} animation is required`));
      }
    }
  }
}

function validateEvidenceAddresses(value, path, issues) {
  if (!isRecord(value)) {
    issues.push(issue(path, 'EVIDENCE_ADDRESSES_REQUIRED', 'tri-state evidence addresses are required'));
    return;
  }
  rejectUnknownKeys(value, EVIDENCE_STATES, path, issues);
  for (const state of EVIDENCE_STATES) {
    if (!array(value[state])) {
      issues.push(issue(`${path}.${state}`, 'EVIDENCE_ADDRESS_INVALID', 'each evidence state must contain addressed entries'));
      continue;
    }
    value[state].forEach((entry, index) => {
      const entryPath = `${path}.${state}[${index}]`;
      rejectUnknownKeys(entry, ['address', 'claim'], entryPath, issues);
      if (!isRecord(entry) || !nonEmpty(entry.address) || !nonEmpty(entry.claim)) {
        issues.push(issue(entryPath, 'EVIDENCE_ADDRESS_INVALID', 'each evidence entry needs its address and claim'));
      }
    });
  }
}

function evidenceAddressState(value) {
  if (!isRecord(value)) return null;
  return EVIDENCE_STATES.find((state) => array(value[state]) && value[state].length > 0) ?? null;
}

function validateRewardChange(value, path, issues) {
  if (!isRecord(value)) {
    issues.push(issue(path, 'REWARD_CHANGE_INVALID', 'town change must be an observed transition'));
    return;
  }
  for (const key of ['id', 'event', 'bindingId', 'facilityKind', 'effect']) {
    if (!nonEmpty(value[key])) issues.push(issue(`${path}.${key}`, 'REWARD_CHANGE_INVALID', 'transition field is required'));
  }
  const expected = REWARD_CHANGES[value.event];
  if (!expected || value.bindingId !== expected.id || value.facilityKind !== expected.facilityKind || value.effect !== expected.effect || value.state !== 'observed') {
    issues.push(issue(path, 'REWARD_CHANGE_NOT_ALLOWED', 'only the observed repository inspection town-hall transition is accepted'));
  }
  if (!isRecord(value.evidence)) {
    issues.push(issue(`${path}.evidence`, 'REWARD_EVIDENCE_REQUIRED', 'transition evidence is required'));
  } else {
    for (const state of EVIDENCE_STATES) {
      if (!array(value.evidence[state]) || value.evidence[state].some((entry) => !nonEmpty(entry))) {
        issues.push(issue(`${path}.evidence.${state}`, 'REWARD_EVIDENCE_INVALID', 'transition evidence must preserve tri-state strings'));
      }
    }
    if (!array(value.evidence.observed) || value.evidence.observed.length === 0) {
      issues.push(issue(`${path}.evidence.observed`, 'REWARD_EVIDENCE_NOT_OBSERVED', 'the visible town change needs observed evidence'));
    }
  }
}

function validateCamera(camera, viewSize, issues) {
  const path = '$.game.camera';
  if (!isRecord(camera)) {
    issues.push(issue(path, 'CAMERA_REQUIRED', 'camera composition is required'));
    return;
  }
  rejectUnknownKeys(camera, ['minimumView', 'overview', 'follow'], path, issues);
  const minimumView = camera.minimumView;
  if (!isRecord(minimumView) || !integer(minimumView.width) || !integer(minimumView.height)
    || minimumView.width <= 0 || minimumView.height <= 0) {
    issues.push(issue(`${path}.minimumView`, 'CAMERA_VIEW_INVALID', 'minimum camera view must be positive integers'));
  } else if (isRecord(viewSize)
    && (minimumView.width !== viewSize.width || minimumView.height !== viewSize.height)) {
    issues.push(issue(`${path}.minimumView`, 'CAMERA_VIEW_MISMATCH', 'minimum camera view must match game.viewSize'));
  }
  const overview = camera.overview;
  if (!isRecord(overview)) {
    issues.push(issue(`${path}.overview`, 'CAMERA_OVERVIEW_REQUIRED', 'overview camera is required'));
  } else {
    rejectUnknownKeys(overview, ['bounds', 'zoom', 'origin'], `${path}.overview`, issues);
    if (!rect(overview.bounds)) issues.push(issue(`${path}.overview.bounds`, 'CAMERA_BOUNDS_INVALID', 'overview bounds must be a positive rectangle'));
    if (!quantizedZoom(overview.zoom)) issues.push(issue(`${path}.overview.zoom`, 'CAMERA_ZOOM_INVALID', 'overview zoom must be 1, 1/2, 1/4, or another power-of-two reciprocal'));
    if (!point(overview.origin)) issues.push(issue(`${path}.overview.origin`, 'CAMERA_ORIGIN_INVALID', 'overview origin is required'));
    if (point(overview.origin) && quantizedZoom(overview.zoom)) {
      const quantum = Math.max(1, Math.round(1 / overview.zoom));
      if (overview.origin.x % quantum !== 0 || overview.origin.y % quantum !== 0) {
        issues.push(issue(`${path}.overview.origin`, 'CAMERA_ORIGIN_INVALID', 'overview origin must align to its zoom quantum'));
      }
      if (rect(overview.bounds) && isRecord(minimumView)
        && (overview.origin.x > overview.bounds.x || overview.origin.y > overview.bounds.y
          || overview.origin.x + minimumView.width / overview.zoom < overview.bounds.x + overview.bounds.width
          || overview.origin.y + minimumView.height / overview.zoom < overview.bounds.y + overview.bounds.height)) {
        issues.push(issue(`${path}.overview`, 'CAMERA_OVERVIEW_FIT_INVALID', 'overview camera must fit its authored bounds in the minimum view'));
      }
    }
  }
  const follow = camera.follow;
  if (!isRecord(follow)) {
    issues.push(issue(`${path}.follow`, 'CAMERA_FOLLOW_REQUIRED', 'follow camera is required'));
  } else {
    rejectUnknownKeys(follow, ['zoom', 'deadZone', 'lookAhead'], `${path}.follow`, issues);
    if (!quantizedZoom(follow.zoom)) issues.push(issue(`${path}.follow.zoom`, 'CAMERA_ZOOM_INVALID', 'follow zoom must be a power-of-two reciprocal'));
    if (!rect(follow.deadZone)) issues.push(issue(`${path}.follow.deadZone`, 'CAMERA_DEAD_ZONE_INVALID', 'follow dead zone is required'));
    if (!finite(follow.lookAhead) || follow.lookAhead < 0) issues.push(issue(`${path}.follow.lookAhead`, 'CAMERA_LOOK_AHEAD_INVALID', 'follow look-ahead must be non-negative'));
    if (rect(follow.deadZone) && isRecord(minimumView)
      && (follow.deadZone.x < 0 || follow.deadZone.y < 0
        || follow.deadZone.x + follow.deadZone.width > minimumView.width
        || follow.deadZone.y + follow.deadZone.height > minimumView.height)) {
      issues.push(issue(`${path}.follow.deadZone`, 'CAMERA_DEAD_ZONE_INVALID', 'follow dead zone must fit the minimum view'));
    }
  }
}

function validateGame(game, assets, issues) {
  if (!isRecord(game)) {
    issues.push(issue('$.game', 'GAME_REQUIRED', 'SceneBundle.game is required'));
    return;
  }
  rejectUnknownKeys(game, REQUIRED_GAME_KEYS, '$.game', issues);
  for (const key of REQUIRED_GAME_KEYS) if (!own(game, key)) issues.push(issue(`$.game.${key}`, 'GAME_FIELD_REQUIRED', 'game field is required'));
  for (const [key, size] of [['viewSize', game.viewSize], ['worldSize', game.worldSize]]) {
    if (!isRecord(size) || !integer(size.width) || !integer(size.height) || size.width <= 0 || size.height <= 0) {
      issues.push(issue(`$.game.${key}`, 'SIZE_INVALID', 'positive integer width and height are required'));
    }
  }
  validateCamera(game.camera, game.viewSize, issues);
  if (integer(game.viewSize?.width) && integer(game.worldSize?.width)
    && (game.viewSize.width > game.worldSize.width || game.viewSize.height > game.worldSize.height)) {
    issues.push(issue('$.game.viewSize', 'VIEW_EXCEEDS_WORLD', 'view must fit inside the world'));
  }
  if (!point(game.spawn)) issues.push(issue('$.game.spawn', 'SPAWN_INVALID', 'spawn needs pixel x/y'));

  if (!isRecord(game.player) || !nonEmpty(game.player.assetId) || !assets.has(game.player.assetId)
    || !rect(game.player.footbox) || !positive(game.player.speeds?.run) || !positive(game.player.speeds?.walk)) {
    issues.push(issue('$.game.player', 'PLAYER_INVALID', 'player asset, footbox, and movement speeds are required'));
  } else {
    rejectUnknownKeys(game.player, ['assetId', 'footbox', 'speeds'], '$.game.player', issues);
    validateCharacterAnimations(assets.get(game.player.assetId), `$.assets.${game.player.assetId}`, ['idle', 'walk', 'run'], issues);
  }

  if (!isRecord(game.ui)) {
    issues.push(issue('$.game.ui', 'UI_REQUIRED', 'the framed dialogue/report UI contract is required'));
  } else {
    rejectUnknownKeys(game.ui, ['frame', 'dialogue', 'report'], '$.game.ui', issues);
    const frame = game.ui.frame;
    if (!isRecord(frame) || frame.width !== 384 || frame.height !== 216) {
      issues.push(issue('$.game.ui.frame', 'UI_FRAME_INVALID', 'UI frame must be exactly 384 by 216 logical pixels'));
    }
    for (const kind of ['dialogue', 'report']) {
      const contract = game.ui[kind];
      const path = `$.game.ui.${kind}`;
      if (!isRecord(contract)) {
        issues.push(issue(path, 'UI_CONTRACT_INVALID', `${kind} UI contract is required`));
        continue;
      }
      rejectUnknownKeys(contract, ['assetId', 'prompt', 'body', 'footer'], path, issues);
      if (!nonEmpty(contract.assetId) || !assets.has(contract.assetId) || assets.get(contract.assetId)?.usage?.kind !== 'ui') {
        issues.push(issue(`${path}.assetId`, 'UI_ASSET_REQUIRED', `${kind} UI asset is required`));
      }
      for (const region of ['prompt', 'body', 'footer']) {
        const value = contract[region];
        if (!rect(value) || !integer(value.x) || !integer(value.y) || !integer(value.width) || !integer(value.height)
          || value.x < 0 || value.y < 0 || value.x + value.width > 384 || value.y + value.height > 216) {
          issues.push(issue(`${path}.${region}`, 'UI_SAFE_RECT_INVALID', 'safe rect must be an integer region inside the 384 by 216 frame'));
        }
      }
    }
  }

  if (!array(game.surfaces) || game.surfaces.length === 0) {
    issues.push(issue('$.game.surfaces', 'SURFACES_REQUIRED', 'the composed world needs surfaces'));
  } else {
    for (const [index, surface] of game.surfaces.entries()) {
      const path = `$.game.surfaces[${index}]`;
      rejectUnknownKeys(surface, ['id', 'recipe', 'assetId', 'z', 'blocked', 'geometry'], path, issues);
      if (!isRecord(surface) || !nonEmpty(surface.id) || !assets.has(surface.assetId) || !finite(surface.z) || typeof surface.blocked !== 'boolean') {
        issues.push(issue(path, 'SURFACE_INVALID', 'surface role, asset, and depth are required'));
        continue;
      }
      const geometry = surface.geometry;
      const validArea = geometry?.kind === 'area' && rect(geometry.rect);
      const validPath = geometry?.kind === 'path' && array(geometry.points) && geometry.points.length >= 2
        && geometry.points.every(point) && positive(geometry.width);
      if (!validArea && !validPath) issues.push(issue(`${path}.geometry`, 'SURFACE_GEOMETRY_INVALID', 'surface needs a whole area or continuous path'));
    }
    const ground = game.surfaces.find((surface) => surface?.recipe === 'ground' && surface.geometry?.kind === 'area');
    if (!ground) {
      issues.push(issue('$.game.surfaces', 'GROUND_SURFACE_REQUIRED', 'one composed ground area is required'));
    } else if (isRecord(game.worldSize) && positive(game.worldSize.width) && positive(game.worldSize.height)
      && (ground.geometry.rect.x > 0 || ground.geometry.rect.y > 0
      || ground.geometry.rect.x + ground.geometry.rect.width < game.worldSize.width
      || ground.geometry.rect.y + ground.geometry.rect.height < game.worldSize.height)) {
      issues.push(issue('$.game.surfaces', 'GROUND_COVERAGE_INVALID', 'the continuous ground must cover the whole walkable world'));
    }
  }

  if (!array(game.collisions) || game.collisions.some((entry) => !rect(entry))) {
    issues.push(issue('$.game.collisions', 'COLLISION_INVALID', 'world collisions must be pixel rectangles'));
  } else if (point(game.spawn) && rect(game.player?.footbox)) {
    const spawnBody = {
      x: game.spawn.x + game.player.footbox.x,
      y: game.spawn.y + game.player.footbox.y,
      width: game.player.footbox.width,
      height: game.player.footbox.height,
    };
    if (game.collisions.some((entry) => overlaps(entry, spawnBody))) issues.push(issue('$.game.spawn', 'SPAWN_BLOCKED', 'spawn must be walkable'));
  }
  const interiorIds = new Set();
  if (!array(game.interiors)) {
    issues.push(issue('$.game.interiors', 'INTERIORS_REQUIRED', 'same-place interiors array is required'));
  } else {
    for (const [index, interior] of game.interiors.entries()) {
      const path = `$.game.interiors[${index}]`;
      rejectUnknownKeys(interior, ['id', 'placeId', 'bounds', 'access', 'cutawayIds', 'collisions'], path, issues);
      if (!isRecord(interior) || !nonEmpty(interior.id) || !nonEmpty(interior.placeId)
        || !rect(interior.bounds) || !rect(interior.access)
        || !array(interior.cutawayIds) || interior.cutawayIds.some((id) => !nonEmpty(id))
        || !array(interior.collisions) || interior.collisions.some((entry) => !rect(entry))) {
        issues.push(issue(path, 'INTERIOR_INVALID', 'interior needs authored bounds, automatic access, cutaway layers, and collisions'));
      }
      if (nonEmpty(interior?.id)) {
        if (interiorIds.has(interior.id)) issues.push(issue(`${path}.id`, 'DUPLICATE_ID', 'interior IDs must be unique'));
        interiorIds.add(interior.id);
      }
    }
  }

  if (!array(game.npcs)) {
    issues.push(issue('$.game.npcs', 'NPCS_REQUIRED', 'resident array is required'));
  } else {
    for (const [index, npc] of game.npcs.entries()) {
      const path = `$.game.npcs[${index}]`;
      rejectUnknownKeys(npc, [
        'id', 'position', 'body', 'assetId', 'footPivot', 'interactionRect', 'reach', 'prompt', 'dialogue',
        'animationState', 'action', 'behavior', 'direction', 'facing', 'path', 'speed', 'phase', 'interiorId',
      ], path, issues);
      if (!isRecord(npc) || !nonEmpty(npc.id) || !point(npc.position) || !assets.has(npc.assetId)
        || !rect(npc.body) || !point(npc.footPivot) || !rect(npc.interactionRect) || !positive(npc.reach)
        || !interactionRectMatches(npc.body, npc.reach, npc.direction, npc.interactionRect) || !nonEmpty(npc.prompt)
        || !array(npc.dialogue) || npc.dialogue.length === 0 || npc.dialogue.some((line) => !nonEmpty(line))
        || !['idle', 'work', 'talk', 'walk'].includes(npc.action) || !['idle', 'work', 'walk'].includes(npc.animationState)
        || !['work', 'talk', 'watch', 'walk'].includes(npc.behavior) || !['up', 'down', 'left', 'right'].includes(npc.direction)
        || npc.facing !== npc.direction || !isRecord(npc.path) || !['still', 'ping-pong'].includes(npc.path.kind)
        || !array(npc.path.points) || npc.path.points.length < 1 || npc.path.points.some((entry) => !point(entry))
        || (npc.path.kind === 'ping-pong' && npc.path.points.length < 2) || !finite(npc.speed) || npc.speed < 0
        || !finite(npc.phase) || npc.phase < 0 || npc.phase >= 1) {
        issues.push(issue(path, 'NPC_INVALID', 'resident needs place, actor asset, interaction, and dialogue'));
      } else {
        validateCharacterAnimations(assets.get(npc.assetId), `$.assets.${npc.assetId}`, ['idle', 'walk', 'work'], issues);
      }
      if (own(npc, 'interiorId') && !interiorIds.has(npc.interiorId)) issues.push(issue(`${path}.interiorId`, 'INTERIOR_UNKNOWN', 'resident interior must exist'));
    }
  }

  if (!array(game.quests) || game.quests.length !== 3
    || new Set(game.quests.map((entry) => entry?.id)).size !== 3
    || new Set(game.quests.map((entry) => entry?.placeId)).size !== 3) {
    issues.push(issue('$.game.quests', 'QUESTS_INVALID', 'three distinct place investigations are required'));
  } else {
    for (const [index, quest] of game.quests.entries()) {
      const path = `$.game.quests[${index}]`;
      rejectUnknownKeys(quest, ['id', 'placeId', 'rect', 'subject', 'action', 'statement', 'state', 'evidenceAddresses', 'interiorId'], path, issues);
      if (!isRecord(quest) || !nonEmpty(quest.id) || !nonEmpty(quest.placeId) || !rect(quest.rect)
        || !nonEmpty(quest.subject) || !nonEmpty(quest.action) || !nonEmpty(quest.statement)
        || !EVIDENCE_STATES.includes(quest.state)) {
        issues.push(issue(path, 'QUEST_INVALID', 'investigation needs its place, action, statement, and truth state'));
      }
      if (own(quest, 'interiorId') && !interiorIds.has(quest.interiorId)) issues.push(issue(`${path}.interiorId`, 'INTERIOR_UNKNOWN', 'investigation interior must exist'));
      validateEvidenceAddresses(quest?.evidenceAddresses, `${path}.evidenceAddresses`, issues);
      const addressedState = evidenceAddressState(quest?.evidenceAddresses);
      if (EVIDENCE_STATES.includes(quest?.state) && addressedState !== quest.state) {
        issues.push(issue(`${path}.state`, 'QUEST_EVIDENCE_STATE_MISMATCH', 'truth state must match the highest-priority non-empty evidence bucket'));
      }
    }
  }

  if (!isRecord(game.request) || !nonEmpty(game.request.id) || !rect(game.request.rect) || !nonEmpty(game.request.prompt)) {
    issues.push(issue('$.game.request', 'REQUEST_INVALID', 'request place is required'));
  }
  if (!isRecord(game.report) || !nonEmpty(game.report.id) || !rect(game.report.rect)
    || !nonEmpty(game.report.prompt) || !own(game.report, 'change')) {
    issues.push(issue('$.game.report', 'REPORT_INVALID', 'report place and town change are required'));
  } else {
    rejectUnknownKeys(game.report, ['id', 'rect', 'prompt', 'change', 'interiorId'], '$.game.report', issues);
    if (own(game.report, 'interiorId') && !interiorIds.has(game.report.interiorId)) issues.push(issue('$.game.report.interiorId', 'INTERIOR_UNKNOWN', 'report interior must exist'));
    validateRewardChange(game.report.change, '$.game.report.change', issues);
  }

  if (!array(game.renderables)) {
    issues.push(issue('$.game.renderables', 'RENDERABLES_REQUIRED', 'place layers are required'));
  } else {
    for (const [index, entry] of game.renderables.entries()) {
      const path = `$.game.renderables[${index}]`;
      rejectUnknownKeys(entry, ['id', 'assetId', 'position', 'footPivot', 'z', 'plane', 'cutawayId', 'interiorId', 'effect'], path, issues);
      if (!isRecord(entry) || !nonEmpty(entry.id) || !assets.has(entry.assetId)
        || !point(entry.position) || !point(entry.footPivot) || !finite(entry.z)
        || !['ground', 'depth', 'foreground'].includes(entry.plane)) {
        issues.push(issue(path, 'RENDERABLE_INVALID', 'place layer needs an exact asset, position, pivot, and depth'));
      }
      if (own(entry, 'effect') && (!nonEmpty(entry.effect) || !REWARD_EFFECTS.has(entry.effect))) {
        issues.push(issue(`${path}.effect`, 'RENDERABLE_EFFECT_INVALID', 'conditional layer must be the observed town-hall change'));
      }
    }
  }

  for (const id of Object.values(UI_ASSET_IDS)) {
    if (!assets.has(id) || assets.get(id)?.usage?.kind !== 'ui') issues.push(issue('$.assets', 'UI_ASSET_REQUIRED', `${id} is required`));
  }
}

export function validateSceneBundle(bundle) {
  const issues = [];
  if (!isRecord(bundle)) return Object.freeze({ ok: false, issues: Object.freeze([issue('$', 'BUNDLE_INVALID', 'SceneBundle must be an object')]) });
  rejectUnknownKeys(bundle, ['format', 'schemaVersion', 'world', 'assets', 'game'], '$', issues);
  if (bundle.format !== SCENE_BUNDLE_FORMAT) issues.push(issue('$.format', 'FORMAT_INVALID', `must be ${SCENE_BUNDLE_FORMAT}`));
  if (bundle.schemaVersion !== SCENE_BUNDLE_SCHEMA_VERSION) issues.push(issue('$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'must be exactly 2'));
  if (!isRecord(bundle.world) || !isRecord(bundle.world.identity) || !nonEmpty(bundle.world.identity.key)
    || !HASH_RE.test(bundle.world.contentDigest ?? '') || !isRecord(bundle.world.worldview) || !nonEmpty(bundle.world.worldview.id)
    || !rect(bundle.world.bounds)) {
    issues.push(issue('$.world', 'WORLD_INVALID', 'world identity, digest, worldview, and bounds are required'));
  } else {
    rejectUnknownKeys(bundle.world, ['identity', 'contentDigest', 'worldview', 'bounds'], '$.world', issues);
  }
  const assets = new Map();
  if (!array(bundle.assets) || bundle.assets.length === 0) issues.push(issue('$.assets', 'ASSETS_REQUIRED', 'shipping assets are required'));
  else bundle.assets.forEach((asset, index) => validateAsset(asset, `$.assets[${index}]`, assets, issues));
  validateGame(bundle.game, assets, issues);
  try { JSON.stringify(bundle); } catch { issues.push(issue('$', 'SERIALIZATION_INVALID', 'SceneBundle must be JSON serializable')); }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}

function assertValid(bundle) {
  const result = validateSceneBundle(bundle);
  if (!result.ok) throw new GameRuntimeError('SCENE_BUNDLE_INVALID', 'SceneBundle failed the runtime contract', result.issues);
}

function storageKey(identity, contentDigest) { return `codecity.game.v3.${encodeURIComponent(identity)}.${contentDigest}`; }
function assertStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new GameRuntimeError('STORAGE_REQUIRED', 'an injected storage adapter is required');
  }
}
function utf8Bytes(value) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

function readSaved(storage, key, identity) {
  let raw;
  try { raw = storage.getItem(key); } catch { return null; }
  if (typeof raw !== 'string' || utf8Bytes(raw) > PERSISTENCE_LIMIT_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    return isRecord(value) && value.version === 3 && value.identity === identity ? value : null;
  } catch { return null; }
}

function writeSaved(storage, key, state, identity, questIds) {
  const raw = JSON.stringify(persistenceSnapshot(state, identity, questIds));
  if (utf8Bytes(raw) > PERSISTENCE_LIMIT_BYTES) throw new GameRuntimeError('PERSISTENCE_LIMIT', 'runtime persistence exceeds 64 KiB');
  try { storage.setItem(key, raw); } catch (error) {
    throw new GameRuntimeError('PERSISTENCE_WRITE_FAILED', 'runtime persistence could not be written', [{ path: key, code: 'STORAGE_WRITE_FAILED', message: String(error?.message ?? error) }]);
  }
}

function assertCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new GameRuntimeError('CANVAS_REQUIRED', 'a Canvas element is required');
  const context = canvas.getContext('2d');
  if (!context) throw new GameRuntimeError('CANVAS_CONTEXT_REQUIRED', 'a 2D Canvas context is required');
  return context;
}
function assertUiRoot(uiRoot) {
  if (!uiRoot || !('textContent' in uiRoot)) throw new GameRuntimeError('UI_ROOT_REQUIRED', 'a DOM UI root is required');
}
function assertAssetLoader(assetLoader) {
  if (typeof assetLoader !== 'function') throw new GameRuntimeError('ASSET_LOADER_REQUIRED', 'a shipping-asset loader is required');
}

async function loadAssets(bundle, assetLoader) {
  const loaded = new Map();
  const results = await Promise.all(bundle.assets.map(async (asset) => {
    try { return { asset, image: await assetLoader(Object.freeze({ ...asset })), error: null }; }
    catch (error) { return { asset, image: null, error }; }
  }));
  for (const { asset, image, error } of results) {
    if (error) throw new GameRuntimeError('ASSET_LOAD_FAILED', `shipping asset ${asset.id} could not be loaded`, [{ path: asset.id, code: 'ASSET_LOAD_FAILED', message: String(error?.message ?? error) }]);
    if (!image || (typeof image !== 'object' && typeof image !== 'function')) throw new GameRuntimeError('ASSET_LOAD_FAILED', `shipping asset ${asset.id} did not produce an image`);
    loaded.set(asset.id, image);
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

function assetDirection(direction) {
  return ({ up: 'north', down: 'south', left: 'west', right: 'east' })[direction] ?? 'south';
}

function animationFrame(asset, state, direction, animationMs) {
  const frame = asset.usage.frame;
  if (asset.usage.kind !== 'character') return { index: 0, frame };
  const facing = assetDirection(direction);
  const animation = asset.usage.animations?.[state]?.[facing];
  if (!isRecord(animation) || !array(animation.frames) || animation.frames.length === 0 || !positive(animation.fps)) {
    throw new GameRuntimeError('ANIMATION_NOT_DECLARED', `asset ${asset.id} does not declare ${state}/${facing}`);
  }
  const offset = Math.floor((animationMs / 1000) * animation.fps) % animation.frames.length;
  return { index: animation.frames[offset], frame };
}

function createSurfacePatterns(context, game, images) {
  const patterns = new Map();
  for (const surface of game.surfaces) {
    if (patterns.has(surface.assetId)) continue;
    const image = images.get(surface.assetId);
    const pattern = image && context.createPattern?.(image, 'repeat');
    if (!pattern) throw new GameRuntimeError('SURFACE_PATTERN_FAILED', `surface asset ${surface.assetId} could not form a continuous material`);
    patterns.set(surface.assetId, pattern);
  }
  return patterns;
}

function drawSurfaces(context, game, camera, patterns) {
  context.save?.();
  context.scale?.(camera.zoom, camera.zoom);
  context.translate?.(-camera.x, -camera.y);
  for (const surface of game.surfaces) {
    const pattern = patterns.get(surface.assetId);
    if (!pattern) throw new GameRuntimeError('ASSET_NOT_LOADED', `surface asset ${surface.assetId} was not loaded`);
    if (surface.geometry.kind === 'area') {
      context.fillStyle = pattern;
      const area = surface.geometry.rect;
      context.fillRect?.(area.x, area.y, area.width, area.height);
      continue;
    }
    context.strokeStyle = pattern;
    context.lineWidth = surface.geometry.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath?.();
    surface.geometry.points.forEach((value, index) => {
      if (index === 0) context.moveTo?.(value.x, value.y);
      else context.lineTo?.(value.x, value.y);
    });
    context.stroke?.();
  }
  context.restore?.();
}

function drawRenderable(context, entry, asset, image, state, alpha) {
  const selected = animationFrame(
    asset,
    entry.animationState ?? 'idle',
    entry.direction ?? 'down',
    state.animationMs + (Number.isFinite(entry.phase) ? entry.phase * 1000 : 0),
  );
  const sourceX = (selected.index % selected.frame.columns) * selected.frame.width;
  const sourceY = Math.floor(selected.index / selected.frame.columns) * selected.frame.height;
  const previousAlpha = finite(context.globalAlpha) ? context.globalAlpha : 1;
  context.globalAlpha = alpha;
  context.drawImage?.(
    image,
    sourceX,
    sourceY,
    selected.frame.width,
    selected.frame.height,
    Math.round(entry.position.x),
    Math.round(entry.position.y),
    selected.frame.width,
    selected.frame.height,
  );
  context.globalAlpha = previousAlpha;
}

function drawDialogueFrame(context, view, state, game, assets, images) {
  const kind = state.dialogue?.kind;
  const report = kind === 'report' || (kind === 'feedback' && state.quest.reported);
  const contract = report ? game.ui.report : game.ui.dialogue;
  const ids = state.dialogue ? [contract.assetId] : [];
  for (const id of ids) {
    const asset = assets.get(id);
    const image = images.get(id);
    if (!asset || !image) throw new GameRuntimeError('ASSET_NOT_LOADED', `UI asset ${id} was not loaded`);
    const frame = asset.usage.frame;
    const x = Math.floor((view.width - 384) / 2);
    const y = Math.floor((view.height - 216) / 2);
    context.drawImage?.(image, 0, 0, frame.width, frame.height, x, y, frame.width, frame.height);
  }
}

function drawFrame(context, canvas, bundle, state, images, patterns, displayScale) {
  const game = bundle.game;
  const view = state.viewport;
  const pixelWidth = view.width * displayScale;
  const pixelHeight = view.height * displayScale;
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  if ('imageSmoothingEnabled' in context) context.imageSmoothingEnabled = false;
  context.setTransform?.(displayScale, 0, 0, displayScale, 0, 0);
  context.fillStyle = '#071016';
  context.fillRect?.(0, 0, view.width, view.height);
  const assets = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  const camera = state.camera;
  drawSurfaces(context, game, camera, patterns);

  const renderables = [...game.renderables];
  for (const npc of state.residents) {
    renderables.push({
      id: `npc:${npc.id}`,
      assetId: npc.assetId,
      position: npc.position,
      footPivot: npc.footPivot,
      z: 60,
      plane: 'depth',
      interiorId: npc.interiorId,
      animationState: npc.animationState,
      direction: npc.facing ?? npc.direction,
      phase: npc.phase,
    });
  }
  renderables.push({
    id: 'player',
    assetId: game.player.assetId,
    position: { x: state.player.x, y: state.player.y },
    footPivot: {
      x: game.player.footbox.x + game.player.footbox.width / 2,
      y: game.player.footbox.y + game.player.footbox.height,
    },
    z: 100,
    plane: 'depth',
    animationState: state.player.moving ? (state.input.shift ? 'walk' : 'run') : 'idle',
    direction: state.player.direction,
  });
  const visualInterior = game.interiors.find((interior) => interior.id === state.cutawayInteriorId);
  const visible = renderables.filter((entry) =>
    (!entry.effect || state.townChange?.effect === entry.effect)
    && (!entry.interiorId || visualInterior?.id === entry.interiorId));
  const prepared = [];
  for (const entry of visible) {
    const alpha = entry.interiorId && visualInterior?.id === entry.interiorId
      ? state.cutawayProgress
      : entry.cutawayId && visualInterior?.cutawayIds.includes(entry.cutawayId)
        ? 1 - state.cutawayProgress
        : 1;
    if (alpha > 0) prepared.push({ entry, alpha });
  }
  const byDepth = (left, right) =>
    (left.entry.position.y + left.entry.footPivot.y) - (right.entry.position.y + right.entry.footPivot.y)
    || left.entry.z - right.entry.z
    || left.entry.id.localeCompare(right.entry.id);
  const byLayer = (left, right) => left.entry.z - right.entry.z || left.entry.id.localeCompare(right.entry.id);
  const ordered = [
    ...prepared.filter(({ entry }) => entry.plane === 'ground').sort(byLayer),
    ...prepared.filter(({ entry }) => entry.plane === 'depth').sort(byDepth),
    ...prepared.filter(({ entry }) => entry.plane === 'foreground').sort(byLayer),
  ];
  context.save?.();
  context.scale?.(camera.zoom, camera.zoom);
  context.translate?.(-camera.x, -camera.y);
  for (const { entry, alpha } of ordered) {
    const asset = assets.get(entry.assetId);
    const image = images.get(entry.assetId);
    if (!asset || !image) throw new GameRuntimeError('ASSET_NOT_LOADED', `place asset ${entry.assetId} was not loaded`);
    drawRenderable(context, entry, asset, image, state, alpha);
  }
  context.restore?.();
  context.setTransform?.(displayScale, 0, 0, displayScale, 0, 0);
  drawDialogueFrame(context, view, state, game, assets, images);
}

const UI_TEXT_METRICS = Object.freeze({
  dialogue: Object.freeze({
    prompt: Object.freeze({ fontSize: 13, lineHeight: 1.3 }),
    body: Object.freeze({ fontSize: 13, lineHeight: 1.35 }),
    footer: Object.freeze({ fontSize: 11, lineHeight: 1.2 }),
  }),
  // The report body is intentionally smaller than the dialogue body. Its
  // authored 329x114 two-column safe rect must hold the longest current
  // inferred/unknown report copy without an auto-fit or generic pager.
  report: Object.freeze({
    prompt: Object.freeze({ fontSize: 11, lineHeight: 1.2 }),
    body: Object.freeze({ fontSize: 10, lineHeight: 1.2 }),
    footer: Object.freeze({ fontSize: 10, lineHeight: 1.2 }),
  }),
});

function createUiText(documentObject, className, text, safeRect, scale, metrics) {
  const element = documentObject.createElement('span');
  element.className = className;
  element.textContent = text;
  element.style.left = `${safeRect.x * scale}px`;
  element.style.top = `${safeRect.y * scale}px`;
  element.style.width = `${safeRect.width * scale}px`;
  element.style.height = `${safeRect.height * scale}px`;
  element.style.fontSize = `${metrics.fontSize * scale}px`;
  element.style.lineHeight = String(metrics.lineHeight);
  return element;
}

function renderUi(uiRoot, state, game, displayScale) {
  const active = Boolean(state.dialogue);
  const report = state.dialogue?.kind === 'report' || (state.dialogue?.kind === 'feedback' && state.quest.reported);
  const contract = report ? game.ui.report : game.ui.dialogue;
  const metrics = report ? UI_TEXT_METRICS.report : UI_TEXT_METRICS.dialogue;
  const frame = game.ui.frame;
  uiRoot.dataset.kind = state.dialogue?.kind ?? '';
  uiRoot.dataset.frame = active ? (report ? 'report' : 'dialogue') : '';
  uiRoot.hidden = !active;
  uiRoot.style.left = `${Math.floor((state.viewport.width - frame.width) / 2) * displayScale}px`;
  uiRoot.style.top = `${Math.floor((state.viewport.height - frame.height) / 2) * displayScale}px`;
  uiRoot.style.width = `${frame.width * displayScale}px`;
  uiRoot.style.height = `${frame.height * displayScale}px`;
  if (!active) {
    uiRoot.textContent = '';
    return;
  }
  const pages = Array.isArray(state.dialogue.pages) ? state.dialogue.pages : null;
  const page = Number.isInteger(state.dialogue.page) ? state.dialogue.page : 0;
  const bodyLines = pages ? (pages[page] ?? pages[0] ?? []) : (state.dialogue.lines ?? []);
  const submittedReport = state.dialogue?.kind === 'feedback' && state.quest.reported;
  const footer = report
    ? submittedReport
      ? pages && page < pages.length - 1 ? 'Enter：次のページ　X：閉じる' : 'Enter：閉じる　X：閉じる'
      : pages && page < pages.length - 1 ? 'Enter：次のページ　X：戻る' : 'Enter：役場へ届ける　X：戻る'
    : 'Enter：進む　X：戻る';
  const documentObject = globalThis.document;
  if (!documentObject || typeof documentObject.createElement !== 'function' || typeof uiRoot.replaceChildren !== 'function') {
    uiRoot.textContent = [state.dialogue.prompt, ...bodyLines, footer].filter(Boolean).join('\n');
    return;
  }
  const promptElement = createUiText(documentObject, 'game-ui-prompt', state.dialogue.prompt ?? '', contract.prompt, displayScale, metrics.prompt);
  const bodyElement = createUiText(documentObject, 'game-ui-body', bodyLines.join('\n'), contract.body, displayScale, metrics.body);
  const footerElement = createUiText(documentObject, 'game-ui-footer', footer, contract.footer, displayScale, metrics.footer);
  if (report) {
    // The authored report has two ruled columns. Keep the body inside the
    // single bounded rect while honoring that visual split.
    bodyElement.style.columnCount = '2';
    bodyElement.style.columnGap = `${17 * displayScale}px`;
  }
  uiRoot.replaceChildren(promptElement, bodyElement, footerElement);
}

function actionForKey(key) {
  const action = KEY_ACTIONS[key];
  return action ? { type: action } : null;
}

function fitCanvasToWindow(view, target) {
  const availableWidth = positive(target?.innerWidth) ? target.innerWidth : view.width;
  const availableHeight = positive(target?.innerHeight) ? target.innerHeight : view.height;
  const displayScale = Math.max(1, Math.floor(Math.min(availableWidth / view.width, availableHeight / view.height)));
  return {
    displayScale,
    // The logical viewport grows with the whole-pixel display scale. The
    // canvas and overlay still begin at integer top-left coordinates, leaving
    // any odd remainder to the right and bottom of the browser view.
    viewport: {
      width: Math.max(1, Math.floor(availableWidth / displayScale)),
      height: Math.max(1, Math.floor(availableHeight / displayScale)),
    },
  };
}

function createGameRuntime({ bundle, canvas, uiRoot, storage, assetLoader, onExit } = {}) {
  assertValid(bundle);
  const context = assertCanvas(canvas);
  assertUiRoot(uiRoot);
  assertStorage(storage);
  assertAssetLoader(assetLoader);
  const identity = bundle.world.identity.key;
  const key = storageKey(identity, bundle.world.contentDigest);
  let state = createInitialState(bundle, readSaved(storage, key, identity));
  let images = new Map();
  let patterns = new Map();
  let frame = null;
  let previousTime = null;
  let running = false;
  let displayScale = 1;
  let lastMovementSaveAt = 0;
  const target = globalThis.window;
  const timer = defaultClock();
  const listeners = [];
  const fitCanvas = () => {
    const fitted = fitCanvasToWindow(bundle.game.camera.minimumView, target);
    displayScale = fitted.displayScale;
    const pixelWidth = fitted.viewport.width * displayScale;
    const pixelHeight = fitted.viewport.height * displayScale;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    dispatch({ type: 'VIEWPORT_CHANGED', viewport: fitted.viewport });
  };

  const render = () => {
    drawFrame(context, canvas, bundle, state, images, patterns, displayScale);
    renderUi(uiRoot, state, bundle.game, displayScale);
  };
  const save = () => writeSaved(storage, key, state, identity, bundle.game.quests.map((quest) => quest.id));
  const dispatch = (action) => {
    const previousState = state;
    state = reduceGameState(state, action, bundle);
    if (action?.type === 'TICK') {
      const moved = state.player.x !== previousState.player.x || state.player.y !== previousState.player.y;
      const now = timer.now();
      if (moved && now - lastMovementSaveAt >= 250) { save(); lastMovementSaveAt = now; }
    } else if (!['KEY_DOWN', 'KEY_UP'].includes(action?.type)) {
      save();
    }
    if (running) render();
    if (action?.type === 'EXIT' && previousState.phase !== 'exit' && state.phase === 'exit') {
      // Render the exit dialogue frame before handing control to the app's
      // loopback shutdown callback. The callback then updates the same framed
      // DOM root with pending/success/failure copy.
      onExit?.();
    }
  };
  const onKeyDown = (event) => {
    let action = actionForKey(event.code);
    if (action) { event.preventDefault?.(); dispatch(action); return; }
    dispatch({ type: 'KEY_DOWN', key: event.code });
  };
  const onKeyUp = (event) => dispatch({ type: 'KEY_UP', key: event.code });
  const attach = () => {
    if (!target || typeof target.addEventListener !== 'function') throw new GameRuntimeError('INPUT_TARGET_REQUIRED', 'an input target is required');
    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('resize', fitCanvas);
    listeners.push(['keydown', onKeyDown], ['keyup', onKeyUp], ['resize', fitCanvas]);
  };
  const detach = () => {
    for (const [type, listener] of listeners.splice(0)) target.removeEventListener?.(type, listener);
  };
  const tick = (time) => {
    if (!running) return;
    const previous = previousTime ?? time;
    previousTime = time;
    dispatch({ type: 'TICK', dtMs: Math.max(0, Math.min(250, time - previous)) });
    frame = timer.requestFrame(tick);
  };
  return {
    async start() {
      if (!timer || typeof timer.now !== 'function' || typeof timer.requestFrame !== 'function' || typeof timer.cancelFrame !== 'function') {
        throw new GameRuntimeError('CLOCK_REQUIRED', 'a browser animation clock is required');
      }
      images = await loadAssets(bundle, assetLoader);
      fitCanvas();
      patterns = createSurfacePatterns(context, bundle.game, images);
      attach();
      running = true;
      previousTime = timer.now();
      lastMovementSaveAt = previousTime;
      render();
      frame = timer.requestFrame(tick);
    },
    stop() {
      if (frame !== null) timer.cancelFrame(frame);
      frame = null;
      running = false;
      previousTime = null;
      detach();
      save();
    },
  };
}

export async function startGameRuntime({ bundle, canvas, uiRoot, storage, assetLoader, onExit } = {}) {
  const runtime = createGameRuntime({ bundle, canvas, uiRoot, storage, assetLoader, onExit });
  await runtime.start();
  return runtime;
}
