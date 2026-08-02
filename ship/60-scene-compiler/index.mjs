/**
 * WorldPlan + approved Asset Manifest -> deterministic logical SceneBundle.
 *
 * This is the only shipping boundary that joins logical world data to an
 * approved asset.  It deliberately contains no renderer, DOM, server,
 * network, random, or fallback behaviour.
 */
import { validateWorldPlan } from '../40-worldgen/index.mjs';
import { resolveAsset, validateAssetManifest } from '../50-art/index.mjs';

export const SCENE_BUNDLE_FORMAT = 'codecity.scene-bundle';
export const SCENE_BUNDLE_SCHEMA_VERSION = 1;
export const SCENE_BINDINGS_FORMAT = 'codecity.scene-bindings';
export const SCENE_BINDINGS_SCHEMA_VERSION = 1;

export const GAME_LOGICAL_SIZE = Object.freeze({ width: 384, height: 216 });
export const GAME_TILE_SIZE = 16;
export const GAME_WORLD_INTEGER_SCALES = Object.freeze([2, 3, 4, 5]);
export const GAME_SPEEDS = Object.freeze({ run: 75, walk: 45 });
export const PRODUCT_SELECTORS = Object.freeze([
  'player:default',
  'ui:dialogue',
  'ui:choice',
  'ui:guild-roster',
  'ui:inspection-report',
]);
export const GUILD_TAB_LABELS = Object.freeze(['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい']);
export const QUEST_CHOICES = Object.freeze(['見た', 'そうらしい', 'わからない']);
export const EVIDENCE_GRAMMAR = Object.freeze({
  observed: Object.freeze({ choice: '見た', ending: 'です。' }),
  inferred: Object.freeze({ choice: 'そうらしい', ending: 'のようです。' }),
  unknown: Object.freeze({ choice: 'わからない', ending: 'まだ、わかりません。' }),
});
export const UI_BINDINGS = Object.freeze({
  dialogueAssetSelector: 'ui:dialogue',
  choiceAssetSelector: 'ui:choice',
  guildRosterAssetSelector: 'ui:guild-roster',
  inspectionReportAssetSelector: 'ui:inspection-report',
});
export const CONTROLS = Object.freeze({
  move: Object.freeze({
    up: Object.freeze(['ArrowUp', 'KeyW']),
    down: Object.freeze(['ArrowDown', 'KeyS']),
    left: Object.freeze(['ArrowLeft', 'KeyA']),
    right: Object.freeze(['ArrowRight', 'KeyD']),
  }),
  interact: Object.freeze(['Enter', 'Space', 'KeyE', 'KeyZ']),
  cancel: Object.freeze(['Escape', 'KeyX']),
  overview: Object.freeze(['KeyM', 'Tab']),
  save: Object.freeze(['KeyP']),
  walkModifier: Object.freeze(['ShiftLeft', 'ShiftRight']),
  zoomIn: Object.freeze(['Equal', 'NumpadAdd']),
  zoomOut: Object.freeze(['Minus', 'NumpadSubtract']),
});

const HASH_RE = /^[a-f0-9]{64}$/iu;
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
const EVIDENCE_SET = new Set(EVIDENCE_STATES);
const DIRECTIONS = Object.freeze(['north', 'south', 'east', 'west']);
const CHARACTER_STATES = Object.freeze({ player: ['idle', 'walk', 'run'], npc: ['idle', 'walk'] });
const REWARD_CHANGES = Object.freeze({
  build_passed: Object.freeze({ bindingId: 'reward.build_passed', facilityKind: 'workshop', effect: 'forge_fire' }),
  local_run: Object.freeze({ bindingId: 'reward.local_run', facilityKind: 'town_hall', effect: 'town_powered' }),
  public_url_responded: Object.freeze({ bindingId: 'reward.public_url_responded', facilityKind: 'inn', effect: 'inn_lit' }),
  real_access: Object.freeze({ bindingId: 'reward.real_access', facilityKind: 'inn', effect: 'traveler_arrived' }),
  external_api_responded: Object.freeze({ bindingId: 'reward.external_api_responded', facilityKind: 'pub', effect: 'pub_bustle' }),
  distribution_released: Object.freeze({ bindingId: 'reward.distribution_released', facilityKind: 'dock', effect: 'ship_departed' }),
  logs_recorded: Object.freeze({ bindingId: 'reward.logs_recorded', facilityKind: 'watchtower', effect: 'watch_lit' }),
  tests_passed: Object.freeze({ bindingId: 'reward.tests_passed', facilityKind: 'dojo', effect: 'inspection_stamp' }),
  rollback_confirmed: Object.freeze({ bindingId: 'reward.rollback_confirmed', facilityKind: 'shop', effect: 'repair_tools' }),
});
const REWARD_TRANSITION_KEYS = Object.freeze(['bindingId', 'effect', 'event', 'evidence', 'facilityKind', 'id', 'state']);
const USAGE_COMPATIBILITY = Object.freeze({
  terrain: Object.freeze({ kind: 'terrain', layer: 'ground' }),
  water: Object.freeze({ kind: 'water', layer: 'ground' }),
  road: Object.freeze({ kind: 'road', layer: 'ground' }),
  plot: Object.freeze({ kind: 'terrain', layer: 'ground' }),
  building: Object.freeze({ kind: 'building', layer: 'object' }),
  room: Object.freeze({ kind: 'room', layer: 'object' }),
  npc: Object.freeze({ kind: 'character', layer: 'actor' }),
  prop: Object.freeze({ kind: 'prop', layer: 'object' }),
  light: Object.freeze({ kind: 'light', layer: 'foreground' }),
  quest: Object.freeze({ kind: 'quest', layer: 'foreground' }),
  ui: Object.freeze({ kind: 'ui', layer: 'ui' }),
  player: Object.freeze({ kind: 'character', layer: 'actor' }),
  effect: Object.freeze({ kind: 'effect', layer: 'effect' }),
});

export class SceneCompilerError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'SceneCompilerError';
    this.code = code;
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function fail(code, message, issues = []) {
  throw new SceneCompilerError(code, message, issues);
}

function issue(path, code, message, details = {}) {
  return { path, code, message, ...details };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('scene input must not contain cycles');
  seen.add(value);
  const output = Array.isArray(value)
    ? value.map((entry) => clone(entry, seen))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, clone(value[key], seen)]));
  seen.delete(value);
  return output;
}

function stableEqual(left, right) {
  return JSON.stringify(clone(left)) === JSON.stringify(clone(right));
}

function freeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}

function compareId(a, b) {
  return String(a.id ?? a.selector ?? a).localeCompare(String(b.id ?? b.selector ?? b));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function integer(value) {
  return Number.isInteger(value);
}

function positive(value) {
  return finite(value) && value > 0;
}

function rect(value) {
  return isRecord(value) && finite(value.x) && finite(value.y) && positive(value.width) && positive(value.height);
}

function point(value) {
  return isRecord(value) && finite(value.x) && finite(value.y);
}

function directionAnimations(usage, state) {
  return isRecord(usage?.animations) && isRecord(usage.animations[state]) ? usage.animations[state] : null;
}

function expectedSelectorKind(selector) {
  if (selector === 'player:default') return 'player';
  if (selector.startsWith('terrain:')) return 'terrain';
  if (selector.startsWith('water:')) return 'water';
  if (selector.startsWith('road:')) return 'road';
  if (selector.startsWith('plot:')) return 'plot';
  if (selector.startsWith('building:')) return 'building';
  if (selector.startsWith('room:')) return 'room';
  if (selector.startsWith('npc:')) return 'npc';
  if (selector.startsWith('prop:')) return 'prop';
  if (selector.startsWith('light:')) return 'light';
  if (selector.startsWith('quest:')) return 'quest';
  if (selector.startsWith('ui:')) return 'ui';
  if (selector.startsWith('effect:')) return 'effect';
  return null;
}

function usageIssues(usage, selector, path, dimensions = null) {
  const issues = [];
  const kind = expectedSelectorKind(selector);
  const expected = kind ? USAGE_COMPATIBILITY[kind] : null;
  if (!isRecord(usage)) {
    issues.push(issue(`${path}.usage`, 'USAGE_REQUIRED', 'every asset reference must carry its semantic usage record'));
    return issues;
  }
  if (expected && (usage.kind !== expected.kind || usage.layer !== expected.layer)) {
    issues.push(issue(`${path}.usage`, 'USAGE_INCOMPATIBLE', `${selector} requires usage ${expected.kind}/${expected.layer}`, { selector, expected: clone(expected), actual: { kind: usage.kind, layer: usage.layer } }));
  }
  if (!isRecord(usage.frame) || !integer(usage.frame.width) || !integer(usage.frame.height) || !integer(usage.frame.columns) || !integer(usage.frame.rows) || usage.frame.width <= 0 || usage.frame.height <= 0 || usage.frame.columns <= 0 || usage.frame.rows <= 0) {
    issues.push(issue(`${path}.usage.frame`, 'USAGE_FRAME_INVALID', 'usage.frame must contain positive width, height, columns, and rows'));
  }
  if (!isRecord(usage.collision) || !['none', 'rect'].includes(usage.collision.kind)) {
    issues.push(issue(`${path}.usage.collision`, 'USAGE_COLLISION_INVALID', 'usage.collision must be none or rect'));
  } else if (usage.collision.kind === 'rect' && !rect(usage.collision)) {
    issues.push(issue(`${path}.usage.collision`, 'USAGE_COLLISION_INVALID', 'rect collision usage must contain a positive rectangle'));
  }
  if (kind === 'player' || kind === 'npc') {
    const requiredStates = CHARACTER_STATES[kind];
    if (usage.kind !== 'character') return issues;
    if (kind === 'player' && usage.collision?.kind !== 'rect') issues.push(issue(`${path}.usage.collision`, 'CHARACTER_FOOTBOX_REQUIRED', 'player character usage requires a rect collision/footbox'));
    for (const state of requiredStates) {
      const directions = directionAnimations(usage, state);
      if (!directions) {
        issues.push(issue(`${path}.usage.animations.${state}`, 'ANIMATION_STATE_REQUIRED', `${kind} requires the ${state} animation`));
        continue;
      }
      for (const direction of DIRECTIONS) {
        const animation = directions[direction];
        const expectedLength = state === 'idle' ? 2 : state === 'walk' ? 4 : 6;
        if (!isRecord(animation) || !Array.isArray(animation.frames) || animation.frames.length !== expectedLength) {
          issues.push(issue(`${path}.usage.animations.${state}.${direction}.frames`, 'ANIMATION_FRAME_COUNT_INVALID', `${kind} ${state}/${direction} must contain exactly ${expectedLength} frames`));
        }
        if (!isRecord(animation) || !finite(animation.fps) || animation.fps <= 0) {
          issues.push(issue(`${path}.usage.animations.${state}.${direction}.fps`, 'ANIMATION_FPS_INVALID', 'animation fps must be positive'));
        }
      }
    }
  }
  if (kind === 'player') {
    if (usage.frame?.columns !== 6 || usage.frame?.rows !== 8 || usage.frame?.width !== 32 || usage.frame?.height !== 32) {
      issues.push(issue(`${path}.usage.frame`, 'PLAYER_SHEET_CONTRACT_INVALID', 'player must use a 192x256 sheet tiled as 6 columns by 8 rows of 32x32 cells'));
    }
    if (dimensions && (dimensions.width !== 192 || dimensions.height !== 256)) {
      issues.push(issue(`${path}.dimensions`, 'PLAYER_SHEET_CONTRACT_INVALID', 'player dimensions must be exactly 192x256 for the 48-cell sheet'));
    }
  }
  if (kind === 'building' && (!isRecord(usage.entrance) || !rect(usage.entrance))) {
    issues.push(issue(`${path}.usage.entrance`, 'BUILDING_ENTRANCE_REQUIRED', 'building usage requires a bounded entrance rectangle'));
  }
  return issues;
}

function validateBindings(bindings) {
  const issues = [];
  if (!isRecord(bindings)) return { ok: false, issues: [issue('$', 'INVALID_BINDINGS', 'bindings must be an object')] };
  if (bindings.format !== SCENE_BINDINGS_FORMAT) issues.push(issue('$.format', 'INVALID_FORMAT', `must be ${SCENE_BINDINGS_FORMAT}`));
  if (bindings.schemaVersion !== SCENE_BINDINGS_SCHEMA_VERSION) issues.push(issue('$.schemaVersion', 'UNSUPPORTED_SCHEMA', 'must be exactly 1'));
  if (!isRecord(bindings.selectors)) {
    issues.push(issue('$.selectors', 'INVALID_SELECTORS', 'selectors must be an object'));
  } else {
    for (const [selector, assetId] of Object.entries(bindings.selectors)) {
      if (!nonEmpty(selector)) issues.push(issue('$.selectors', 'INVALID_SELECTOR', 'selector keys must be non-empty'));
      if (selector.includes('*') || selector.includes('?')) issues.push(issue(`$.selectors.${selector}`, 'WILDCARD_FORBIDDEN', 'wildcard selectors are forbidden'));
      if (!nonEmpty(assetId)) issues.push(issue(`$.selectors.${selector}`, 'ASSET_ID_REQUIRED', 'selector value must be an explicit asset ID'));
    }
  }
  for (const key of ['fallback', 'default', 'fallbackAssetId', 'defaultAssetId']) {
    if (Object.prototype.hasOwnProperty.call(bindings, key)) issues.push(issue(`$.${key}`, 'FALLBACK_FORBIDDEN', 'fallback bindings are forbidden'));
  }
  return { ok: issues.length === 0, issues };
}

function validatedWorldPlan(value) {
  try {
    return validateWorldPlan(value);
  } catch (error) {
    fail('WORLD_PLAN_INVALID', error.message, error.issues ?? [issue('$', 'WORLD_PLAN_INVALID', 'WorldPlan v1 validation failed')]);
  }
}

function occupantKnown(entry, occupant) {
  if (entry?.state !== 'occupied') return false;
  const state = String(occupant?.state ?? '').toLowerCase();
  return !['unknown', 'missing', 'not-applicable', 'not_applicable'].includes(state);
}

function knownOccupantPairs(plan) {
  return plan.occupancy.flatMap((entry) => entry.occupants.filter((occupant) => occupantKnown(entry, occupant)).map((occupant) => ({ entry, occupant })));
}

function selectedQuestSites(plan) {
  return plan.questSites.slice(0, 3).map((site, index) => ({ site, index }));
}

function observedRewardTransition(plan) {
  const transition = (plan.townState?.rewards?.transitions ?? []).find((entry) => entry?.state === 'observed' || entry?.evidence?.state === 'observed') ?? null;
  if (!transition) return null;
  const keys = Object.keys(transition).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...REWARD_TRANSITION_KEYS].sort())) fail('REWARD_TRANSITION_INVALID', 'observed report change must be one exact TownModel reward transition', [issue('$.townState.rewards.transitions', 'REWARD_TRANSITION_INVALID', 'transition fields must be exactly id,event,bindingId,facilityKind,effect,state,evidence')]);
  const expected = REWARD_CHANGES[transition.event];
  if (!expected || !nonEmpty(transition.id) || transition.bindingId !== expected.bindingId || transition.facilityKind !== expected.facilityKind || transition.effect !== expected.effect || transition.state !== 'observed') fail('REWARD_TRANSITION_INVALID', 'observed report change does not match one of the nine canonical reward bindings', [issue('$.townState.rewards.transitions', 'REWARD_TRANSITION_INVALID', 'event, binding, facility, and effect must match exactly')]);
  const observed = transition.evidence?.observed;
  if (!Array.isArray(observed) || observed.length === 0 || observed.some((entry) => !nonEmpty(entry)) || !Array.isArray(transition.evidence?.inferred) || transition.evidence.inferred.some((entry) => !nonEmpty(entry)) || !Array.isArray(transition.evidence?.unknown) || transition.evidence.unknown.some((entry) => !nonEmpty(entry))) fail('REWARD_TRANSITION_INVALID', 'observed report change must preserve a non-empty observed evidence bag', [issue('$.townState.rewards.transitions', 'REWARD_TRANSITION_INVALID', 'all evidence bags must contain source-address strings and observed must be non-empty')]);
  return transition;
}

function requiredSelectorsForPlan(plan) {
  const selectors = new Set(PRODUCT_SELECTORS);
  selectors.add(`terrain:${plan.terrain}`);
  selectors.add('water:default');
  for (const road of plan.roads) selectors.add(`road:${road.kind}`);
  const occupancyByPlot = new Map(plan.occupancy.map((entry) => [entry.plotId, entry]));
  for (const plot of plan.plots) selectors.add(`plot:${occupancyByPlot.get(plot.id)?.state ?? 'unknown'}`);
  for (const { occupant } of knownOccupantPairs(plan)) selectors.add(`building:${occupant.kind}`);
  const knownPlotIds = new Set(knownOccupantPairs(plan).map(({ entry }) => entry.plotId));
  for (const room of plan.rooms) if (knownPlotIds.has(room.plotId)) selectors.add(`room:${room.kind}`);
  for (const npc of plan.npcs) if (occupancyByPlot.has(npc.plotId)) selectors.add(`npc:${npc.role}`);
  for (const prop of plan.props) selectors.add(`prop:${prop.kind}`);
  for (const light of plan.lights) if (occupancyByPlot.has(light.plotId)) selectors.add(`light:${light.state}`);
  for (const { site } of selectedQuestSites(plan)) selectors.add(`quest:${site.action}`);
  const transition = observedRewardTransition(plan);
  if (transition) selectors.add(`effect:${transition.effect}`);
  return [...selectors].sort();
}

/** Return the exact semantic selectors a plan requires, without selecting assets. */
export function requiredAssetSelectors(worldPlan) {
  return Object.freeze(requiredSelectorsForPlan(validatedWorldPlan(worldPlan)).slice());
}

function assetRef(selector, resolved) {
  return {
    selector,
    assetId: resolved.id,
    version: resolved.version,
    path: resolved.path,
    url: resolved.url,
    sha256: resolved.sha256,
    dimensions: { ...resolved.dimensions },
    pivot: { ...resolved.pivot },
    usage: clone(resolved.usage),
  };
}

function resolveBindings(plan, manifest, assetRoot, bindings) {
  const validation = validateBindings(bindings);
  if (!validation.ok) fail('BINDINGS_INVALID', 'Scene bindings failed the version 1 contract', validation.issues);
  const selectors = requiredSelectorsForPlan(plan);
  const required = new Set(selectors);
  const issues = [];
  for (const selector of Object.keys(bindings.selectors)) {
    if (!required.has(selector)) issues.push(issue(`$.selectors.${selector}`, 'SELECTOR_UNKNOWN', 'binding selector is not required by this WorldPlan; extra bindings are forbidden'));
  }
  const resolved = new Map();
  for (const selector of selectors) {
    const assetId = bindings.selectors[selector];
    if (!nonEmpty(assetId)) {
      issues.push(issue(`$.selectors.${selector}`, 'BINDING_MISSING', 'every required selector needs an explicit asset ID'));
      continue;
    }
    try {
      const resolvedAsset = resolveAsset(manifest, assetId, { assetRoot });
      const reference = assetRef(selector, resolvedAsset);
      issues.push(...usageIssues(reference.usage, selector, `$.selectors.${selector}`, reference.dimensions));
      resolved.set(selector, reference);
    } catch (error) {
      issues.push(issue(`$.selectors.${selector}`, 'ASSET_NOT_RESOLVED', error.message, { assetId, cause: error.code }));
    }
  }
  if (issues.length > 0) fail('ASSET_BINDINGS_INVALID', 'Scene asset selectors failed the explicit usage contract', issues);
  return resolved;
}

function collectEvidence(value, address, output, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (isRecord(value.evidence)) {
    for (const state of EVIDENCE_STATES) {
      if (Array.isArray(value.evidence[state])) value.evidence[state].forEach((claim, index) => output[state].push({ address: `${address}.evidence.${state}[${index}]`, claim: clone(claim) }));
    }
    if (typeof value.evidence.state === 'string' && EVIDENCE_SET.has(value.evidence.state)) output[value.evidence.state].push({ address: `${address}.evidence.state`, claim: value.evidence.state });
  }
  if (Array.isArray(value)) value.forEach((child, index) => collectEvidence(child, `${address}[${index}]`, output, seen));
  else for (const [key, child] of Object.entries(value)) collectEvidence(child, `${address}.${key}`, output, seen);
  seen.delete(value);
}

function townEvidenceAddresses(plan) {
  const output = Object.fromEntries(EVIDENCE_STATES.map((state) => [state, []]));
  collectEvidence(plan.townState, '$.townState', output);
  for (const state of EVIDENCE_STATES) output[state].sort((a, b) => a.address.localeCompare(b.address));
  return output;
}

function candidateMap(plan) {
  return new Map((plan.townState?.investigations?.candidates ?? []).map((candidate, index) => [candidate.id, { candidate, index }]));
}

function candidateEvidence(candidate, candidateIndex) {
  const output = Object.fromEntries(EVIDENCE_STATES.map((state) => [state, []]));
  if (candidate) collectEvidence(candidate, `$.townState.investigations.candidates[${candidateIndex}]`, output);
  for (const state of EVIDENCE_STATES) output[state].sort((a, b) => a.address.localeCompare(b.address));
  return output;
}

function plotPixelRect(plot) {
  return { x: plot.cell.x * GAME_TILE_SIZE, y: plot.cell.y * GAME_TILE_SIZE, width: plot.cell.width * GAME_TILE_SIZE, height: plot.cell.height * GAME_TILE_SIZE };
}

function anchorForPlot(plot, asset) {
  const bounds = plotPixelRect(plot);
  return { x: Math.round(bounds.x + bounds.width / 2 - asset.pivot.x), y: Math.round(bounds.y + bounds.height - asset.pivot.y) };
}

function anchorForCell(cell, asset) {
  return { x: Math.round(cell.x * GAME_TILE_SIZE + GAME_TILE_SIZE / 2 - asset.pivot.x), y: Math.round(cell.y * GAME_TILE_SIZE + GAME_TILE_SIZE - asset.pivot.y) };
}

function absoluteRect(anchor, local) {
  return { x: anchor.x + local.x, y: anchor.y + local.y, width: local.width, height: local.height };
}

function usageRect(asset, anchor, field = 'collision') {
  const local = asset.usage?.[field];
  if (!isRecord(local) || (field === 'collision' && local.kind !== 'rect') || (field !== 'collision' && !rect(local))) return null;
  const { kind: _kind, ...rectangle } = local;
  return absoluteRect(anchor, rectangle);
}

function renderable(id, asset, position, z, extras = {}) {
  return {
    id,
    assetSelector: asset.selector,
    position: { ...position },
    footPivot: { ...asset.pivot },
    z,
    ...extras,
  };
}

function pathCell(value) {
  return isRecord(value) && integer(value.x) && integer(value.y);
}

function compileLayers(plan, assets) {
  const occupancyByPlot = new Map(plan.occupancy.map((entry) => [entry.plotId, entry]));
  const plotById = new Map(plan.plots.map((plot) => [plot.id, plot]));
  const binding = (selector) => clone(assets.get(selector));
  const knownPairs = knownOccupantPairs(plan);
  const knownPlotIds = new Set(knownPairs.map(({ entry }) => entry.plotId));
  const plots = plan.plots.map((plot) => {
    const occupancy = occupancyByPlot.get(plot.id)?.state ?? 'unknown';
    const asset = binding(`plot:${occupancy}`);
    const position = anchorForPlot(plot, asset);
    return { id: plot.id, region: plot.region, cell: clone(plot.cell), elevation: plot.elevation, terrain: plot.terrain, occupancy, pixelRect: plotPixelRect(plot), position, footPivot: { ...asset.pivot }, asset };
  });
  const buildings = knownPairs.map(({ entry, occupant }) => {
    const plot = plotById.get(entry.plotId);
    const asset = binding(`building:${occupant.kind}`);
    const position = anchorForPlot(plot, asset);
    return {
      id: occupant.facilityId,
      plotId: entry.plotId,
      kind: occupant.kind,
      name: occupant.name,
      state: occupant.state,
      pixelRect: plotPixelRect(plot),
      position,
      footPivot: { ...asset.pivot },
      collisionRect: usageRect(asset, position),
      entranceRect: usageRect(asset, position, 'entrance'),
      asset,
    };
  }).sort(compareId);
  const rooms = plan.rooms.filter((room) => knownPlotIds.has(room.plotId)).map((room) => {
    const plot = plotById.get(room.plotId);
    const asset = binding(`room:${room.kind}`);
    const position = anchorForPlot(plot, asset);
    return { ...clone(room), bounds: plotPixelRect(plot), position, footPivot: { ...asset.pivot }, collisionRect: usageRect(asset, position), asset };
  }).sort(compareId);
  const roads = plan.roads.map((road) => ({
    id: road.id,
    kind: road.kind,
    fromPlotId: road.fromPlotId,
    toPlotId: road.toPlotId,
    width: road.width,
    path: clone(road.path),
    asset: binding(`road:${road.kind}`),
  }));
  const props = plan.props.map((prop) => {
    const asset = binding(`prop:${prop.kind}`);
    const position = anchorForCell(prop.cell, asset);
    return { ...clone(prop), position, footPivot: { ...asset.pivot }, collisionRect: usageRect(asset, position), asset };
  }).sort(compareId);
  const lights = plan.lights.filter((light) => knownPlotIds.has(light.plotId)).map((light) => {
    const plot = plotById.get(light.plotId);
    const asset = binding(`light:${light.state}`);
    const position = anchorForPlot(plot, asset);
    return { ...clone(light), position, footPivot: { ...asset.pivot }, asset };
  }).sort(compareId);
  return {
    terrain: { kind: plan.terrain, asset: binding(`terrain:${plan.terrain}`), position: { x: 0, y: 0 } },
    water: { path: clone(plan.water.path), asset: binding('water:default') },
    roads,
    plots,
    buildings,
    rooms,
    props,
    lights,
  };
}

function uniqueRects(rectangles) {
  const seen = new Set();
  return rectangles.filter((rectangle) => rect(rectangle)).filter((rectangle) => {
    const key = `${rectangle.x},${rectangle.y},${rectangle.width},${rectangle.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height);
}

function overlaps(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function carveRect(solid, opening) {
  if (!rect(solid) || !rect(opening) || !overlaps(solid, opening)) return rect(solid) ? [solid] : [];
  const left = Math.max(solid.x, opening.x);
  const right = Math.min(solid.x + solid.width, opening.x + opening.width);
  const top = Math.max(solid.y, opening.y);
  const bottom = Math.min(solid.y + solid.height, opening.y + opening.height);
  return uniqueRects([
    { x: solid.x, y: solid.y, width: left - solid.x, height: solid.height },
    { x: right, y: solid.y, width: solid.x + solid.width - right, height: solid.height },
    { x: left, y: solid.y, width: right - left, height: top - solid.y },
    { x: left, y: bottom, width: right - left, height: solid.y + solid.height - bottom },
  ]);
}

function interactionRectAround(rectangle, distance = GAME_TILE_SIZE) {
  return { x: rectangle.x - distance, y: rectangle.y - distance, width: rectangle.width + distance * 2, height: rectangle.height + distance * 2 };
}

function walkableRect(bounds, collisions, preferred = null) {
  const size = Math.min(12, Math.max(4, Math.floor(Math.min(bounds.width, bounds.height) / 3)));
  const candidates = [];
  if (preferred) candidates.push(
    { x: preferred.x - size / 2, y: preferred.y + 2, width: size, height: size },
    { x: preferred.x - size / 2, y: preferred.y - size - 2, width: size, height: size },
    { x: preferred.x + 2, y: preferred.y - size / 2, width: size, height: size },
    { x: preferred.x - size - 2, y: preferred.y - size / 2, width: size, height: size },
  );
  for (let y = bounds.y + bounds.height - size; y >= bounds.y; y -= Math.max(4, size)) {
    for (let x = bounds.x; x <= bounds.x + bounds.width - size; x += Math.max(4, size)) candidates.push({ x, y, width: size, height: size });
  }
  const found = candidates.find((candidate) => candidate.x >= bounds.x && candidate.y >= bounds.y
    && candidate.x + candidate.width <= bounds.x + bounds.width
    && candidate.y + candidate.height <= bounds.y + bounds.height
    && !collisions.some((collision) => overlaps(candidate, collision)));
  if (!found) fail('INTERACTION_UNREACHABLE', 'no collision-free interaction point exists in the mapped plot', [issue('$.game', 'INTERACTION_UNREACHABLE', 'asset collision geometry leaves no reachable interaction point')]);
  return found;
}

function compileCollisions(plan, layers, npcs) {
  const staticRects = [
    ...layers.buildings.flatMap((entry) => carveRect(entry.collisionRect, entry.entranceRect)),
    ...layers.rooms.map((entry) => entry.collisionRect),
    ...layers.props.map((entry) => entry.collisionRect),
    ...npcs.map((entry) => entry.collisionRect),
  ];
  const solidRects = uniqueRects(staticRects);
  const waterCells = plan.water.path.filter(pathCell).map((cell) => ({ x: cell.x * GAME_TILE_SIZE, y: cell.y * GAME_TILE_SIZE, width: GAME_TILE_SIZE, height: GAME_TILE_SIZE }));
  const gameCollisions = uniqueRects([...solidRects, ...waterCells]);
  const occupancy = new Map(plan.occupancy.map((entry) => [entry.plotId, entry]));
  return {
    gameCollisions,
    topLevel: {
      grid: { ...plan.grid },
      solidRects,
      entranceRects: layers.buildings.filter((entry) => entry.entranceRect).map((entry) => entry.entranceRect),
      blockedPlotIds: [],
      blockedCells: [],
      waterCells: clone(plan.water.path),
      vacantPlotIds: plan.plots.filter((plot) => occupancy.get(plot.id)?.state === 'vacant').map((plot) => plot.id).sort(),
    },
  };
}

function compileRoomsActorsInteractions(plan, layers, assets) {
  const plotById = new Map(plan.plots.map((plot) => [plot.id, plot]));
  const binding = (selector) => clone(assets.get(selector));
  const rooms = layers.rooms.map((room) => ({
    ...clone(room),
    cutawayAssetSelector: room.asset.selector,
    cutawayIds: [room.id],
  }));
  const actors = plan.npcs.filter((npc) => plotById.has(npc.plotId)).map((npc) => {
    const plot = plotById.get(npc.plotId);
    const asset = binding(`npc:${npc.role}`);
    const position = anchorForPlot(plot, asset);
    const collisionRect = usageRect(asset, position);
    const actorRect = collisionRect ?? { x: position.x, y: position.y, width: Math.max(1, asset.usage.frame.width), height: Math.max(1, asset.usage.frame.height) };
    const interactionRect = interactionRectAround(actorRect);
    return {
      ...clone(npc),
      position,
      footPivot: { ...asset.pivot },
      collisionRect,
      interactionRect,
      prompt: nonEmpty(npc.prompt) ? npc.prompt : '話す',
      dialogue: Array.isArray(npc.dialogue) ? clone(npc.dialogue) : [],
      asset,
      address: { plotId: npc.plotId },
    };
  }).sort(compareId);
  const interactions = [];
  for (const building of layers.buildings) interactions.push({ id: `facility:${building.id}`, kind: 'facility', plotId: building.plotId, targetId: building.id, position: building.position, asset: clone(building.asset) });
  for (const prop of layers.props) interactions.push({ id: `prop:${prop.id}`, kind: 'prop', targetId: prop.id, cell: clone(prop.cell), position: prop.position, asset: clone(prop.asset) });
  return { rooms, actors, interactions: interactions.sort(compareId) };
}

function compileQuests(plan, assets) {
  const candidates = candidateMap(plan);
  const output = [];
  for (const { site, index } of selectedQuestSites(plan)) {
    const candidateRecord = candidates.get(site.candidateId);
    if (!candidateRecord) fail('QUEST_CANDIDATE_MISSING', `quest site ${site.id} is not backed by a townState investigation candidate`, [issue(`$.questSites[${index}].candidateId`, 'QUEST_CANDIDATE_MISSING', 'candidateId must resolve in townState.investigations.candidates')]);
    const asset = clone(assets.get(`quest:${site.action}`));
    const evidence = candidateEvidence(candidateRecord.candidate, candidateRecord.index);
    const statement = candidateRecord.candidate.statement ?? candidateRecord.candidate.text ?? candidateRecord.candidate.prompt ?? '';
    const subject = candidateRecord.candidate.subject ?? candidateRecord.candidate.capability ?? candidateRecord.candidate.role ?? site.action;
    if (!nonEmpty(statement)) fail('QUEST_STATEMENT_MISSING', `quest candidate ${site.candidateId} has no statement`, [issue(`$.townState.investigations.candidates[${candidateRecord.index}].statement`, 'QUEST_STATEMENT_MISSING', 'candidate statement is required; compiler will not invent dialogue')]);
    const plot = plan.plots.find((entry) => entry.id === site.plotId);
    const position = plot ? anchorForPlot(plot, asset) : { x: 0, y: 0 };
    output.push({
      id: site.id,
      siteId: site.id,
      candidateId: site.candidateId,
      plotId: site.plotId,
      action: site.action,
      subject: String(subject),
      statement: String(statement),
      rect: plot ? plotPixelRect(plot) : { x: 0, y: 0, width: GAME_TILE_SIZE, height: GAME_TILE_SIZE },
      position,
      footPivot: { ...asset.pivot },
      evidenceAddresses: evidence,
      asset,
    });
  }
  return output;
}

function guildPayload(townState) {
  const source = townState.guild ?? { tabs: [], representativeConnections: [], connections: [] };
  const tabs = GUILD_TAB_LABELS.map((label, index) => {
    const sourceTab = source.tabs?.[index] ?? {};
    return { id: sourceTab.id ?? `guild-tab-${index + 1}`, label, entries: Array.isArray(sourceTab.entries) ? clone(sourceTab.entries) : [] };
  });
  return { tabs };
}

function reportPayload(plan, layers, collisions) {
  const townHall = layers.buildings.find((building) => building.kind === 'town_hall');
  const fallbackPlot = plan.plots.find((plot) => plot.region === 'life')
    ?? plan.plots.find((plot) => plot.id === plan.nav.startPlotId)
    ?? plan.plots[0];
  const plot = townHall ? plan.plots.find((entry) => entry.id === townHall.plotId) : fallbackPlot;
  const preferred = townHall?.entranceRect
    ? { x: townHall.entranceRect.x + townHall.entranceRect.width / 2, y: townHall.entranceRect.y + townHall.entranceRect.height }
    : null;
  const transition = observedRewardTransition(plan);
  return {
    id: 'report-town-hall',
    rect: walkableRect(plotPixelRect(plot), collisions, preferred),
    prompt: '工事報告を見る',
    change: transition ? clone(transition) : null,
  };
}

function requestPayload(plan, layers, collisions) {
  const board = layers.props.find((prop) => prop.kind === 'sign');
  const startPlot = plan.plots.find((plot) => plot.id === plan.nav.startPlotId) ?? plan.plots[0];
  const boardCell = board?.cell;
  const searchRect = boardCell
    ? { x: (boardCell.x - 1) * GAME_TILE_SIZE, y: (boardCell.y - 1) * GAME_TILE_SIZE, width: GAME_TILE_SIZE * 3, height: GAME_TILE_SIZE * 3 }
    : plotPixelRect(startPlot);
  const preferred = boardCell
    ? { x: boardCell.x * GAME_TILE_SIZE, y: (boardCell.y + 1) * GAME_TILE_SIZE }
    : null;
  return {
    id: board ? `request:${board.id}` : 'request:start-board',
    rect: walkableRect(searchRect, collisions, preferred),
    prompt: '掲示板の依頼',
  };
}

function buildGame(plan, layers, roomActorData, quests, collisionData, assets) {
  const playerAsset = assets.get('player:default');
  const startPlot = plan.plots.find((plot) => plot.id === plan.nav.startPlotId) ?? plan.plots[0];
  const { kind: _footboxKind, ...playerFootbox } = playerAsset.usage.collision;
  const spawnFoot = walkableRect(plotPixelRect(startPlot), collisionData.gameCollisions);
  const playerPosition = { x: spawnFoot.x - playerFootbox.x, y: spawnFoot.y - playerFootbox.y };
  const roomByFacility = new Map(layers.rooms.map((room) => [room.facilityId, room]));
  const entrances = layers.buildings.filter((building) => building.entranceRect).map((building) => {
    const room = roomByFacility.get(building.id);
    const entrance = building.entranceRect;
    const exteriorFoot = { x: entrance.x + entrance.width / 2 - playerFootbox.width / 2, y: entrance.y + entrance.height + 1 };
    const interiorFoot = { x: entrance.x + entrance.width / 2 - playerFootbox.width / 2, y: entrance.y + entrance.height - playerFootbox.height - 1 };
    return {
      id: `entrance:${building.id}`,
      roomId: room?.id ?? `room-${building.id}`,
      rect: entrance,
      cutawayIds: room ? [room.id] : [],
      exteriorSpawn: { x: exteriorFoot.x - playerFootbox.x, y: exteriorFoot.y - playerFootbox.y },
      interiorSpawn: { x: interiorFoot.x - playerFootbox.x, y: interiorFoot.y - playerFootbox.y },
    };
  }).sort(compareId);
  const rooms = roomActorData.rooms.map((room) => ({
    id: room.id,
    bounds: room.bounds,
    cutawayIds: [room.id],
  }));
  const npcs = roomActorData.actors.map((actor) => ({
    id: actor.id,
    kind: roomActorData.actors[0]?.id === actor.id ? 'guild' : 'resident',
    position: actor.position,
    assetSelector: actor.asset.selector,
    footPivot: actor.footPivot,
    interactionRect: actor.interactionRect,
    prompt: actor.prompt,
    dialogue: actor.dialogue,
    ...(roomActorData.rooms.find((room) => room.plotId === actor.plotId) ? { cutawayId: roomActorData.rooms.find((room) => room.plotId === actor.plotId).id } : {}),
  }));
  const renderables = [];
  const terrain = layers.terrain;
  for (let y = 0; y < plan.grid.rows; y += 1) {
    for (let x = 0; x < plan.grid.columns; x += 1) renderables.push(renderable(`terrain:${x}:${y}`, terrain.asset, anchorForCell({ x, y }, terrain.asset), 0));
  }
  const waterAsset = layers.water.asset;
  for (const [index, cell] of layers.water.path.filter(pathCell).entries()) renderables.push(renderable(`water:${index}`, waterAsset, anchorForCell(cell, waterAsset), 1));
  for (const road of layers.roads) {
    const roadPath = Array.isArray(road.path) ? road.path.filter(pathCell) : [];
    for (const [index, cell] of roadPath.entries()) renderables.push(renderable(`road:${road.id}:${index}`, road.asset, anchorForCell(cell, road.asset), 2));
  }
  for (const plot of layers.plots) renderables.push(renderable(`plot:${plot.id}`, plot.asset, plot.position, 3));
  for (const building of layers.buildings) {
    const room = roomByFacility.get(building.id);
    renderables.push(renderable(`building:${building.id}`, building.asset, building.position, 20, room ? { cutawayId: room.id } : {}));
  }
  for (const room of layers.rooms) renderables.push(renderable(`room:${room.id}`, room.asset, room.position, 30, { roomId: room.id }));
  for (const prop of layers.props) renderables.push(renderable(`prop:${prop.id}`, prop.asset, prop.position, 40));
  for (const light of layers.lights) renderables.push(renderable(`light:${light.id}`, light.asset, light.position, 50));
  for (const quest of quests) renderables.push(renderable(`quest:${quest.id}`, quest.asset, quest.position, 60));
  const transition = observedRewardTransition(plan);
  if (transition) {
    const effectAsset = assets.get(`effect:${transition.effect}`);
    const target = layers.buildings.find((building) => building.kind === transition.facilityKind);
    const targetPlot = target ? plan.plots.find((plot) => plot.id === target.plotId) : startPlot;
    renderables.push(renderable(`effect:${transition.effect}`, effectAsset, anchorForPlot(targetPlot, effectAsset), 70, { effect: transition.effect }));
  }
  renderables.sort((left, right) => left.z - right.z || left.id.localeCompare(right.id));
  return {
    logicalSize: { ...GAME_LOGICAL_SIZE },
    worldSize: { width: plan.grid.columns * GAME_TILE_SIZE, height: plan.grid.rows * GAME_TILE_SIZE },
    spawn: { plotId: plan.nav.startPlotId, x: playerPosition.x, y: playerPosition.y },
    player: {
      assetSelector: playerAsset.selector,
      footbox: playerFootbox,
      speeds: { ...GAME_SPEEDS },
      interactDistance: GAME_TILE_SIZE,
    },
    collisions: collisionData.gameCollisions,
    entrances,
    rooms,
    npcs,
    quests: quests.map((quest) => {
      const plot = plan.plots.find((entry) => entry.id === quest.plotId);
      const building = layers.buildings.find((entry) => entry.plotId === quest.plotId);
      const preferred = building?.entranceRect
        ? { x: building.entranceRect.x + building.entranceRect.width / 2, y: building.entranceRect.y + building.entranceRect.height }
        : null;
      return {
        id: quest.id,
        siteId: quest.siteId,
        rect: walkableRect(plotPixelRect(plot), collisionData.gameCollisions, preferred),
        subject: quest.subject,
        statement: quest.statement,
        evidenceAddresses: clone(quest.evidenceAddresses),
      };
    }),
    request: requestPayload(plan, layers, collisionData.gameCollisions),
    report: reportPayload(plan, layers, collisionData.gameCollisions),
    guild: guildPayload(plan.townState),
    renderables,
  };
}

/** Compile a validated WorldPlan and approved manifest into a deterministic SceneBundle. */
export function compileScene({ worldPlan, assetManifest, assetRoot, bindings } = {}) {
  const plan = validatedWorldPlan(worldPlan);
  if (typeof assetRoot !== 'string' || assetRoot.trim() === '') fail('ASSET_ROOT_REQUIRED', 'assetRoot is required to prove every shipping file exists', [issue('assetRoot', 'ASSET_ROOT_REQUIRED', 'must be a non-empty directory path')]);
  let manifest;
  try {
    manifest = validateAssetManifest(assetManifest, { assetRoot, verifyFiles: true });
  } catch (error) {
    fail('ASSET_MANIFEST_INVALID', error.message, error.issues ?? [issue('$', 'ASSET_MANIFEST_INVALID', 'asset manifest validation failed')]);
  }
  const assets = resolveBindings(plan, manifest, assetRoot, bindings);
  const layers = compileLayers(plan, assets);
  const roomActorData = compileRoomsActorsInteractions(plan, layers, assets);
  const quests = compileQuests(plan, assets);
  const collisionData = compileCollisions(plan, layers, roomActorData.actors);
  const game = buildGame(plan, layers, roomActorData, quests, collisionData, assets);
  const evidence = townEvidenceAddresses(plan);
  const bundle = {
    format: SCENE_BUNDLE_FORMAT,
    schemaVersion: SCENE_BUNDLE_SCHEMA_VERSION,
    bindingsVersion: SCENE_BINDINGS_SCHEMA_VERSION,
    world: {
      identity: clone(plan.identity),
      contentDigest: plan.contentSeed,
      seed: plan.seed,
      townType: plan.townType,
      climate: plan.climate,
      terrain: plan.terrain,
      grid: clone(plan.grid),
    },
    assets: [...assets.values()].map((entry) => clone(entry)).sort(compareId),
    layers,
    collisions: collisionData.topLevel,
    nav: clone(plan.nav),
    rooms: roomActorData.rooms,
    actors: roomActorData.actors,
    interactions: roomActorData.interactions,
    questSites: quests,
    evidence,
    game,
  };
  const validation = validateSceneBundle(bundle);
  if (!validation.ok) fail('SCENE_BUNDLE_INVALID', 'compiler produced an invalid SceneBundle', validation.issues);
  return freeze(clone(bundle));
}

function validateAssetReference(value, path, assets, issues, { declaration = false } = {}) {
  if (!isRecord(value)) {
    issues.push(issue(path, 'ASSET_REFERENCE_REQUIRED', 'exact asset binding is required'));
    return;
  }
  for (const key of ['selector', 'assetId', 'version', 'path', 'url', 'sha256']) if (!nonEmpty(value[key])) issues.push(issue(`${path}.${key}`, 'MISSING_FIELD', 'required asset binding field is missing'));
  if (!HASH_RE.test(value.sha256 ?? '')) issues.push(issue(`${path}.sha256`, 'INVALID_HASH', 'sha256 must be a 64-character hexadecimal hash'));
  if (!isRecord(value.dimensions) || !integer(value.dimensions.width) || !integer(value.dimensions.height) || value.dimensions.width <= 0 || value.dimensions.height <= 0) issues.push(issue(`${path}.dimensions`, 'INVALID_DIMENSIONS', 'positive dimensions are required'));
  if (!isRecord(value.pivot) || !integer(value.pivot.x) || !integer(value.pivot.y)) issues.push(issue(`${path}.pivot`, 'INVALID_PIVOT', 'integer pivot is required'));
  if (isRecord(value.dimensions) && isRecord(value.pivot) && integer(value.dimensions.width) && integer(value.dimensions.height) && integer(value.pivot.x) && integer(value.pivot.y) && (value.pivot.x < 0 || value.pivot.y < 0 || value.pivot.x >= value.dimensions.width || value.pivot.y >= value.dimensions.height)) issues.push(issue(`${path}.pivot`, 'INVALID_PIVOT', 'pivot must lie inside dimensions'));
  if (typeof value.path === 'string' && (value.path.startsWith('/') || value.path.includes('://') || value.path.split('/').includes('..'))) issues.push(issue(`${path}.path`, 'UNSAFE_PATH', 'asset path must remain local and relative'));
  if (typeof value.url === 'string' && (value.url.includes('://') || value.url.startsWith('//'))) issues.push(issue(`${path}.url`, 'REMOTE_URL_FORBIDDEN', 'asset URL must remain local'));
  issues.push(...usageIssues(value.usage, value.selector ?? '', path, value.dimensions));
  if (!declaration && nonEmpty(value.selector) && !assets.has(value.selector)) issues.push(issue(`${path}.selector`, 'ASSET_REFERENCE_UNKNOWN', 'asset selector must be declared in bundle.assets'));
  if (nonEmpty(value.selector) && assets.has(value.selector) && !stableEqual(assets.get(value.selector), value)) issues.push(issue(path, 'ASSET_REFERENCE_MISMATCH', 'asset reference must match the canonical selector binding'));
}

function validateEvidence(value, path, issues) {
  if (!isRecord(value)) {
    issues.push(issue(path, 'EVIDENCE_REQUIRED', 'observed, inferred, and unknown arrays are required'));
    return;
  }
  for (const state of EVIDENCE_STATES) {
    if (!Array.isArray(value[state])) {
      issues.push(issue(`${path}.${state}`, 'EVIDENCE_ARRAY_REQUIRED', 'evidence state must be an array'));
      continue;
    }
    value[state].forEach((entry, index) => {
      if (!isRecord(entry) || !nonEmpty(entry.address)) issues.push(issue(`${path}.${state}[${index}]`, 'EVIDENCE_ADDRESS_REQUIRED', 'evidence entries need a source address'));
    });
  }
}

function rejectUnknownKeys(value, allowed, path, issues) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push(issue(`${path}.${key}`, 'UNKNOWN_FIELD', 'field is not part of the exact game contract'));
}

function validateGame(bundle, assets, issues) {
  const game = bundle.game;
  const gameKeys = ['logicalSize', 'worldSize', 'spawn', 'player', 'collisions', 'entrances', 'rooms', 'npcs', 'quests', 'request', 'report', 'guild', 'renderables'];
  if (!isRecord(game)) { issues.push(issue('$.game', 'GAME_REQUIRED', 'SceneBundle.game is required')); return; }
  rejectUnknownKeys(game, gameKeys, '$.game', issues);
  for (const key of gameKeys) if (!Object.prototype.hasOwnProperty.call(game, key)) issues.push(issue(`$.game.${key}`, 'GAME_FIELD_REQUIRED', 'game field is required'));
  if (!isRecord(game.logicalSize) || game.logicalSize.width !== GAME_LOGICAL_SIZE.width || game.logicalSize.height !== GAME_LOGICAL_SIZE.height) issues.push(issue('$.game.logicalSize', 'LOGICAL_SIZE_INVALID', 'logical size must be exactly 384x216'));
  if (!isRecord(game.worldSize) || !integer(game.worldSize.width) || !integer(game.worldSize.height) || game.worldSize.width < GAME_LOGICAL_SIZE.width || game.worldSize.height < GAME_LOGICAL_SIZE.height) issues.push(issue('$.game.worldSize', 'WORLD_SIZE_INVALID', 'world size must be at least 384x216'));
  if (!isRecord(game.spawn) || !nonEmpty(game.spawn.plotId) || !finite(game.spawn.x) || !finite(game.spawn.y)) issues.push(issue('$.game.spawn', 'SPAWN_INVALID', 'spawn needs plotId and pixel x/y'));
  rejectUnknownKeys(game.player, ['assetSelector', 'footbox', 'speeds', 'interactDistance'], '$.game.player', issues);
  if (!isRecord(game.player) || game.player.assetSelector !== 'player:default' || !assets.has(game.player.assetSelector) || !rect(game.player.footbox) || game.player.speeds?.run !== 75 || game.player.speeds?.walk !== 45 || !positive(game.player.interactDistance)) issues.push(issue('$.game.player', 'PLAYER_INVALID', 'player contract is invalid'));
  if (!Array.isArray(game.collisions) || game.collisions.some((entry) => !rect(entry))) issues.push(issue('$.game.collisions', 'COLLISIONS_INVALID', 'collisions must be rectangle arrays'));
  for (const [index, entry] of (game.entrances ?? []).entries()) {
    rejectUnknownKeys(entry, ['id', 'rect', 'roomId', 'cutawayIds', 'exteriorSpawn', 'interiorSpawn'], `$.game.entrances[${index}]`, issues);
    if (!nonEmpty(entry.id) || !nonEmpty(entry.roomId) || !rect(entry.rect) || !Array.isArray(entry.cutawayIds) || !point(entry.exteriorSpawn) || !point(entry.interiorSpawn)) issues.push(issue(`$.game.entrances[${index}]`, 'ENTRANCE_INVALID', 'entrance contract is invalid'));
  }
  for (const [index, room] of (game.rooms ?? []).entries()) {
    rejectUnknownKeys(room, ['id', 'bounds', 'cutawayIds'], `$.game.rooms[${index}]`, issues);
    if (!nonEmpty(room.id) || !rect(room.bounds) || !Array.isArray(room.cutawayIds)) issues.push(issue(`$.game.rooms[${index}]`, 'ROOM_INVALID', 'room contract is invalid'));
  }
  for (const [index, npc] of (game.npcs ?? []).entries()) {
    rejectUnknownKeys(npc, ['id', 'kind', 'position', 'assetSelector', 'footPivot', 'interactionRect', 'prompt', 'dialogue', 'cutawayId'], `$.game.npcs[${index}]`, issues);
    if (!nonEmpty(npc.id) || !['guild', 'resident'].includes(npc.kind) || !point(npc.position) || !assets.has(npc.assetSelector) || !point(npc.footPivot) || !rect(npc.interactionRect) || !nonEmpty(npc.prompt) || !Array.isArray(npc.dialogue)) issues.push(issue(`$.game.npcs[${index}]`, 'NPC_INVALID', 'npc contract is invalid'));
  }
  if (!Array.isArray(game.quests) || game.quests.length > 3) issues.push(issue('$.game.quests', 'QUEST_COUNT_INVALID', 'zero through three quests are allowed'));
  for (const [index, quest] of (game.quests ?? []).entries()) {
    rejectUnknownKeys(quest, ['id', 'siteId', 'rect', 'subject', 'statement', 'evidenceAddresses'], `$.game.quests[${index}]`, issues);
    if (!nonEmpty(quest.id) || !nonEmpty(quest.siteId) || !rect(quest.rect) || !nonEmpty(quest.subject) || !nonEmpty(quest.statement)) issues.push(issue(`$.game.quests[${index}]`, 'QUEST_INVALID', 'quest contract is invalid'));
    validateEvidence(quest.evidenceAddresses, `$.game.quests[${index}].evidenceAddresses`, issues);
  }
  rejectUnknownKeys(game.request, ['id', 'rect', 'prompt'], '$.game.request', issues);
  if (!isRecord(game.request) || !nonEmpty(game.request.id) || !rect(game.request.rect) || !nonEmpty(game.request.prompt)) issues.push(issue('$.game.request', 'REQUEST_INVALID', 'request board contract is invalid'));
  rejectUnknownKeys(game.report, ['id', 'rect', 'prompt', 'change'], '$.game.report', issues);
  if (!isRecord(game.report) || !nonEmpty(game.report.id) || !rect(game.report.rect) || !nonEmpty(game.report.prompt) || !Object.prototype.hasOwnProperty.call(game.report, 'change')) issues.push(issue('$.game.report', 'REPORT_INVALID', 'report contract is invalid'));
  rejectUnknownKeys(game.guild, ['tabs'], '$.game.guild', issues);
  if (!isRecord(game.guild) || !Array.isArray(game.guild.tabs) || game.guild.tabs.length !== 5) issues.push(issue('$.game.guild', 'GUILD_INVALID', 'guild must contain five tabs'));
  for (const [index, tab] of (game.guild?.tabs ?? []).entries()) {
    rejectUnknownKeys(tab, ['id', 'label', 'entries'], `$.game.guild.tabs[${index}]`, issues);
    if (!nonEmpty(tab.id) || tab.label !== GUILD_TAB_LABELS[index] || !Array.isArray(tab.entries)) issues.push(issue(`$.game.guild.tabs[${index}]`, 'GUILD_TAB_INVALID', 'guild tab is invalid'));
  }
  if (!Array.isArray(game.renderables)) issues.push(issue('$.game.renderables', 'RENDERABLES_REQUIRED', 'renderables array required'));
  for (const [index, entry] of (game.renderables ?? []).entries()) {
    rejectUnknownKeys(entry, ['id', 'assetSelector', 'position', 'footPivot', 'z', 'cutawayId', 'roomId', 'effect'], `$.game.renderables[${index}]`, issues);
    if (!nonEmpty(entry.id) || !assets.has(entry.assetSelector) || !point(entry.position) || !point(entry.footPivot) || !finite(entry.z)) issues.push(issue(`$.game.renderables[${index}]`, 'RENDERABLE_INVALID', 'renderable contract is invalid'));
  }
}

/** Validate SceneBundle shape and exact asset bindings without touching disk. */
export function validateSceneBundle(bundle) {
  const issues = [];
  if (!isRecord(bundle)) return Object.freeze({ ok: false, issues: Object.freeze([issue('$', 'INVALID_BUNDLE', 'SceneBundle must be an object')]) });
  if (bundle.format !== SCENE_BUNDLE_FORMAT) issues.push(issue('$.format', 'INVALID_FORMAT', `must be ${SCENE_BUNDLE_FORMAT}`));
  if (bundle.schemaVersion !== SCENE_BUNDLE_SCHEMA_VERSION) issues.push(issue('$.schemaVersion', 'UNSUPPORTED_SCHEMA', 'must be exactly 1'));
  for (const key of ['bindingsVersion', 'world', 'assets', 'layers', 'collisions', 'nav', 'rooms', 'actors', 'interactions', 'questSites', 'evidence', 'game']) if (!Object.prototype.hasOwnProperty.call(bundle, key)) issues.push(issue(`$.${key}`, 'SCENE_FIELD_REQUIRED', 'SceneBundle v1 field is required'));
  if (bundle.bindingsVersion !== SCENE_BINDINGS_SCHEMA_VERSION) issues.push(issue('$.bindingsVersion', 'BINDINGS_UNSUPPORTED', 'bindingsVersion must be exactly 1'));
  if (!isRecord(bundle.world) || !isRecord(bundle.world.identity) || !nonEmpty(bundle.world.identity.key)) issues.push(issue('$.world.identity', 'IDENTITY_REQUIRED', 'world identity.key is required'));
  else {
    rejectUnknownKeys(bundle.world, ['identity', 'contentDigest', 'seed', 'townType', 'climate', 'terrain', 'grid'], '$.world', issues);
    if (!HASH_RE.test(bundle.world.contentDigest ?? '')) issues.push(issue('$.world.contentDigest', 'CONTENT_DIGEST_INVALID', 'world contentDigest must be the exact WorldPlan content seed'));
  }
  if (!Array.isArray(bundle.assets) || bundle.assets.length === 0) issues.push(issue('$.assets', 'ASSETS_REQUIRED', 'at least one approved asset binding is required'));
  const assets = new Map();
  if (Array.isArray(bundle.assets)) bundle.assets.forEach((asset, index) => {
    validateAssetReference(asset, `$.assets[${index}]`, assets, issues, { declaration: true });
    if (nonEmpty(asset?.selector)) {
      if (assets.has(asset.selector)) issues.push(issue(`$.assets[${index}].selector`, 'DUPLICATE_SELECTOR', 'selectors must be unique'));
      assets.set(asset.selector, asset);
    }
  });
  for (const selector of PRODUCT_SELECTORS) if (!assets.has(selector)) issues.push(issue('$.assets', 'PRODUCT_SELECTOR_MISSING', `required product selector ${selector} is missing`));
  if (!isRecord(bundle.layers)) issues.push(issue('$.layers', 'LAYERS_REQUIRED', 'logical layers are required'));
  else {
    for (const key of ['terrain', 'water']) if (!isRecord(bundle.layers[key])) issues.push(issue(`$.layers.${key}`, 'LAYER_REQUIRED', 'layer is required'));
    if (isRecord(bundle.layers.terrain)) validateAssetReference(bundle.layers.terrain.asset, '$.layers.terrain.asset', assets, issues);
    if (isRecord(bundle.layers.water)) validateAssetReference(bundle.layers.water.asset, '$.layers.water.asset', assets, issues);
    for (const key of ['roads', 'plots', 'buildings', 'rooms', 'props', 'lights']) {
      if (!Array.isArray(bundle.layers[key])) issues.push(issue(`$.layers.${key}`, 'LAYER_ARRAY_REQUIRED', 'layer must be an array'));
      else bundle.layers[key].forEach((entry, index) => validateAssetReference(entry.asset, `$.layers.${key}[${index}].asset`, assets, issues));
    }
  }
  if (!isRecord(bundle.collisions)) issues.push(issue('$.collisions', 'COLLISIONS_REQUIRED', 'collision layer is required'));
  else {
    if (!Array.isArray(bundle.collisions.solidRects)) issues.push(issue('$.collisions.solidRects', 'COLLISION_ARRAY_REQUIRED', 'solidRects array is required'));
    if (!Array.isArray(bundle.collisions.entranceRects)) issues.push(issue('$.collisions.entranceRects', 'COLLISION_ARRAY_REQUIRED', 'entranceRects array is required'));
    for (const key of ['blockedPlotIds', 'blockedCells', 'waterCells', 'vacantPlotIds']) if (!Array.isArray(bundle.collisions[key])) issues.push(issue(`$.collisions.${key}`, 'COLLISION_ARRAY_REQUIRED', 'collision array is required'));
  }
  if (!isRecord(bundle.nav)) issues.push(issue('$.nav', 'NAV_REQUIRED', 'navigation graph is required'));
  for (const key of ['rooms', 'actors', 'interactions', 'questSites']) if (!Array.isArray(bundle[key])) issues.push(issue(`$.${key}`, 'ARRAY_REQUIRED', 'array is required'));
  if (Array.isArray(bundle.rooms)) bundle.rooms.forEach((entry, index) => validateAssetReference(entry.asset, `$.rooms[${index}].asset`, assets, issues));
  if (Array.isArray(bundle.actors)) bundle.actors.forEach((entry, index) => validateAssetReference(entry.asset, `$.actors[${index}].asset`, assets, issues));
  if (Array.isArray(bundle.interactions)) bundle.interactions.forEach((entry, index) => validateAssetReference(entry.asset, `$.interactions[${index}].asset`, assets, issues));
  if (Array.isArray(bundle.questSites)) bundle.questSites.forEach((entry, index) => { validateAssetReference(entry.asset, `$.questSites[${index}].asset`, assets, issues); validateEvidence(entry.evidenceAddresses, `$.questSites[${index}].evidenceAddresses`, issues); });
  validateEvidence(bundle.evidence, '$.evidence', issues);
  validateGame(bundle, assets, issues);
  try { JSON.stringify(bundle); } catch { issues.push(issue('$', 'SERIALIZATION_INVALID', 'SceneBundle must be JSON-serializable')); }
  return Object.freeze({ ok: issues.length === 0, issues: Object.freeze(issues) });
}
