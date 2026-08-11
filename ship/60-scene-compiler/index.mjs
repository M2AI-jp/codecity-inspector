/**
 * WorldPlan v2 + one complete shipping worldview -> one serialized SceneBundle.
 *
 * This module is the only shipping join between repository-derived logical
 * places and supplied pixels. It materializes whole surfaces and places from
 * one worldview recipe.
 */
import { REPOSITORY_INSPECTION_BINDING } from '../30-town-domain/index.mjs';
import { validateWorldPlan } from '../40-worldgen/index.mjs';
import { resolveAsset, validateAssetManifest } from '../50-art/index.mjs';

const SCENE_BUNDLE_FORMAT = 'codecity.scene-bundle';
const SCENE_BUNDLE_SCHEMA_VERSION = 2;
const WORLDVIEW_ID = 'late-medieval-night';
const PIXELS_PER_UNIT = 16;
const WORLD_MARGIN = 96;
const VIEW_SIZE = Object.freeze({ width: 640, height: 360 });
const GAME_SPEEDS = Object.freeze({ run: 92, walk: 56 });
const FOLLOW_DEAD_ZONE = Object.freeze({
  x: Math.round(VIEW_SIZE.width * 0.25),
  y: Math.round(VIEW_SIZE.height * 0.25),
  width: Math.round(VIEW_SIZE.width * 0.5),
  height: Math.round(VIEW_SIZE.height * 0.5),
});
const FOLLOW_LOOK_AHEAD = 8;
const REQUIRED_ASSETS = Object.freeze({
  player: 'player--default-v1',
  dialogue: 'ui--dialogue-v1',
  report: 'ui--inspection-report-v1',
});
const UI_FRAME_SIZE = Object.freeze({ width: 384, height: 216 });
// These are the only authored place layers the selected worldview can use.
// The appearance is the worldgen decision; semantic facility kinds never
// select pixels in the scene compiler.
const PLACE_APPEARANCES = Object.freeze([
  'gate', 'town-hall', 'warehouse', 'well', 'workshop', 'dojo', 'watchtower',
  'shop', 'guild', 'dock', 'ruin',
  'dwelling-gabled', 'dwelling-stone', 'dwelling-tall',
]);
const RESIDENT_APPEARANCES = Object.freeze([
  'keeper', 'artisan', 'porter', 'watcher', 'neighbor', 'traveler',
]);
const UI_CONTRACT = Object.freeze({
  frame: Object.freeze({ ...UI_FRAME_SIZE }),
  dialogue: Object.freeze({
    assetId: REQUIRED_ASSETS.dialogue,
    prompt: Object.freeze({ x: 35, y: 28, width: 111, height: 16 }),
    body: Object.freeze({ x: 29, y: 51, width: 324, height: 130 }),
    footer: Object.freeze({ x: 31, y: 184, width: 321, height: 16 }),
  }),
  report: Object.freeze({
    assetId: REQUIRED_ASSETS.report,
    prompt: Object.freeze({ x: 43, y: 13, width: 293, height: 18 }),
    body: Object.freeze({ x: 27, y: 48, width: 329, height: 114 }),
    footer: Object.freeze({ x: 43, y: 174, width: 293, height: 26 }),
  }),
});
const SURFACE_RECIPES = Object.freeze({
  ground: Object.freeze({ assetId: 'surface--ground-v1', kind: 'terrain', z: 0, blocked: false }),
  water: Object.freeze({ assetId: 'surface--water-v1', kind: 'water', z: 2, blocked: true }),
  bank: Object.freeze({ assetId: 'surface--bank-v1', kind: 'terrain', z: 3, blocked: false }),
  main_route: Object.freeze({ assetId: 'surface--road-main-v1', kind: 'road', z: 6, blocked: false }),
  local_route: Object.freeze({ assetId: 'surface--road-local-v1', kind: 'road', z: 7, blocked: false }),
  plaza: Object.freeze({ assetId: 'surface--plaza-v1', kind: 'road', z: 8, blocked: false }),
  crossing: Object.freeze({ assetId: 'surface--crossing-v1', kind: 'road', z: 9, blocked: false }),
});
const PROP_RECIPES = Object.freeze({
  signboard: Object.freeze({ assetId: 'prop--sign-v1', kind: 'prop' }),
  lamp_post: Object.freeze({ assetId: 'prop--lamp-v1', kind: 'prop' }),
  tree_cluster: Object.freeze({ assetId: 'prop--tree-v1', kind: 'prop' }),
});
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);

export class SceneCompilerError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = 'SceneCompilerError';
    this.code = code;
    this.issues = Object.freeze(issues.map((entry) => Object.freeze({ ...entry })));
  }
}

function issue(path, code, message) { return { path, code, message }; }
function fail(code, message, issues = []) { throw new SceneCompilerError(code, message, issues); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === 'string' && value.trim() !== ''; }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function positive(value) { return finite(value) && value > 0; }
function point(value) { return isRecord(value) && finite(value.x) && finite(value.y); }
function rect(value) { return isRecord(value) && finite(value.x) && finite(value.y) && positive(value.width) && positive(value.height); }
function rejectUnknownKeys(value, allowed, path, issues) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push(issue(`${path}.${key}`, 'UNKNOWN_FIELD', 'field is not part of SceneBundle v2'));
  }
}

function clone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const output = Array.isArray(value) ? [] : {};
  seen.set(value, output);
  if (Array.isArray(value)) value.forEach((entry) => output.push(clone(entry, seen)));
  else Object.keys(value).sort().forEach((key) => { output[key] = clone(value[key], seen); });
  return output;
}

function freeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => freeze(entry, seen));
  return Object.freeze(value);
}

function compareId(left, right) { return String(left.id).localeCompare(String(right.id)); }

function validatedWorldPlan(value) {
  try {
    return validateWorldPlan(value);
  } catch (error) {
    fail('WORLD_PLAN_INVALID', error.message, error.issues ?? [issue('$', 'WORLD_PLAN_INVALID', 'WorldPlan v2 is invalid')]);
  }
}

function manifestAssetIds(manifest) {
  return new Set(Array.isArray(manifest?.assets) ? manifest.assets.map((asset) => asset?.id).filter(nonEmpty) : []);
}

function requiredWorldviewAssets(plan) {
  const required = new Map([
    [REQUIRED_ASSETS.player, 'character'],
    [REQUIRED_ASSETS.dialogue, 'ui'],
    [REQUIRED_ASSETS.report, 'ui'],
  ]);
  for (const surface of plan.surfaces) {
    const recipe = SURFACE_RECIPES[surface.recipe];
    if (recipe) required.set(recipe.assetId, recipe.kind);
  }
  for (const place of plan.places) {
    if (!nonEmpty(place.appearance)) continue;
    required.set(placeLayerId(place.appearance, 'base'), 'building');
    required.set(placeLayerId(place.appearance, 'upper'), 'building');
    required.set(placeLayerId(place.appearance, 'foreground'), 'building');
    if (place.requirements?.distinctInterior === true) {
      required.set(placeLayerId(place.appearance, 'interior'), 'room');
      required.set(placeLayerId(place.appearance, 'interior-foreground'), 'room');
    }
  }
  for (const prop of plan.props) {
    const recipe = PROP_RECIPES[prop.recipe];
    if (recipe) required.set(recipe.assetId, recipe.kind);
  }
  for (const light of plan.lights) required.set(`light--${light.state}-v1`, 'light');
  for (const resident of plan.residents) required.set(residentAssetId(resident.appearance), 'character');
  for (const investigation of plan.investigations) required.set(`clue--${investigation.target.recipe}-v1`, 'quest');
  if (plan.journey.transition?.state === 'observed') required.set('light--lit-v1', 'light');
  return required;
}

function completeWorldviewAssets() {
  const required = new Map([
    [REQUIRED_ASSETS.player, 'character'],
    [REQUIRED_ASSETS.dialogue, 'ui'],
    [REQUIRED_ASSETS.report, 'ui'],
  ]);
  for (const surface of Object.keys(SURFACE_RECIPES)) {
    const recipe = SURFACE_RECIPES[surface];
    required.set(recipe.assetId, recipe.kind);
  }
  for (const appearance of PLACE_APPEARANCES) {
    for (const layer of ['base', 'upper', 'foreground']) required.set(placeLayerId(appearance, layer), 'building');
  }
  const interiorAppearances = new Set([
    'town-hall', 'workshop', 'gate', 'warehouse', 'well', 'dojo', 'watchtower', 'shop',
  ]);
  for (const appearance of interiorAppearances) {
    required.set(placeLayerId(appearance, 'interior'), 'room');
    required.set(placeLayerId(appearance, 'interior-foreground'), 'room');
  }
  for (const prop of Object.values(PROP_RECIPES)) required.set(prop.assetId, prop.kind);
  for (const state of ['lit', 'unlit', 'unknown']) required.set(`light--${state}-v1`, 'light');
  for (const appearance of RESIDENT_APPEARANCES) required.set(residentAssetId(appearance), 'character');
  for (const recipe of ['threshold', 'ledger', 'water-source', 'inspection-mark', 'night-log', 'repair-tools']) {
    required.set(`clue--${recipe}-v1`, 'quest');
  }
  return required;
}

function assertCompleteWorldview(plan, manifest) {
  const manifestById = new Map((manifest.assets ?? []).map((asset) => [asset.id, asset]));
  const issues = [];
  const required = completeWorldviewAssets();
  for (const [id, kind] of requiredWorldviewAssets(plan)) required.set(id, kind);
  for (const [id, kind] of [...required].sort(([left], [right]) => left.localeCompare(right))) {
    const asset = manifestById.get(id);
    if (!asset) issues.push(issue('$.assets', 'WORLDVIEW_ASSET_MISSING', `${id} (${kind})`));
    else if (asset.usage?.kind !== kind) issues.push(issue(`$.assets.${id}.usage.kind`, 'WORLDVIEW_ROLE_INVALID', `expected ${kind}`));
    else if (kind === 'character') {
      const states = id === REQUIRED_ASSETS.player ? ['idle', 'walk', 'run'] : ['idle', 'walk', 'work'];
      for (const state of states) {
        for (const direction of ['north', 'south', 'east', 'west']) {
          const animation = asset.usage?.animations?.[state]?.[direction];
          if (!isRecord(animation) || !Array.isArray(animation.frames) || animation.frames.length === 0 || !positive(animation.fps)) {
            issues.push(issue(`$.assets.${id}.usage.animations.${state}.${direction}`, 'WORLDVIEW_ANIMATION_MISSING', `${state}/${direction}`));
          }
        }
      }
    }
  }
  if (issues.length > 0) fail('WORLDVIEW_INCOMPLETE', 'the selected worldview cannot materialize this town', issues);
}

function assetReference(asset) {
  return {
    id: asset.id,
    version: asset.version,
    path: asset.path,
    url: asset.url,
    sha256: asset.sha256,
    dimensions: clone(asset.dimensions),
    pivot: clone(asset.pivot),
    usage: clone(asset.usage),
  };
}

function createArtResolver(manifest, assetRoot) {
  const ids = manifestAssetIds(manifest);
  const used = new Map();
  const get = (id, expectedKind, { required = true } = {}) => {
    if (!ids.has(id)) {
      if (required) fail('WORLDVIEW_ASSET_MISSING', `complete worldview asset ${id} is missing`, [issue('$.assets', 'WORLDVIEW_ASSET_MISSING', id)]);
      return null;
    }
    let resolved;
    try {
      resolved = resolveAsset(manifest, id, assetRoot);
    } catch (error) {
      fail('WORLDVIEW_ASSET_INVALID', error.message, error.issues ?? [issue(`$.assets.${id}`, 'WORLDVIEW_ASSET_INVALID', id)]);
    }
    if (resolved.usage?.kind !== expectedKind) {
      fail('WORLDVIEW_ROLE_INVALID', `${id} cannot perform the required ${expectedKind} role`, [issue(`$.assets.${id}.usage.kind`, 'WORLDVIEW_ROLE_INVALID', `expected ${expectedKind}`)]);
    }
    const reference = assetReference(resolved);
    used.set(reference.id, reference);
    return reference;
  };
  return { get, used };
}

function makeTransform(plan) {
  const bounds = plan.composition.bounds;
  const width = (bounds.maxX - bounds.minX) * PIXELS_PER_UNIT;
  const height = (bounds.maxY - bounds.minY) * PIXELS_PER_UNIT;
  return {
    bounds,
    point(value) {
      if (!point(value)) fail('LOGICAL_POINT_INVALID', 'logical point is invalid');
      return {
        x: Math.round(WORLD_MARGIN + (value.x - bounds.minX) * PIXELS_PER_UNIT),
        y: Math.round(WORLD_MARGIN + (value.y - bounds.minY) * PIXELS_PER_UNIT),
      };
    },
    distance(value) {
      if (!positive(value)) fail('LOGICAL_DISTANCE_INVALID', 'logical distance must be positive');
      return Math.max(1, Math.round(value * PIXELS_PER_UNIT));
    },
    worldRect: { x: WORLD_MARGIN, y: WORLD_MARGIN, width: Math.round(width), height: Math.round(height) },
    worldSize: { width: Math.round(width + WORLD_MARGIN * 2), height: Math.round(height + WORLD_MARGIN * 2) },
  };
}

function quantizedOverviewZoom(bounds, view) {
  const fitRatio = Math.max(bounds.width / view.width, bounds.height / view.height);
  let exponent = !finite(fitRatio) || fitRatio <= 1 ? 0 : Math.max(0, Math.ceil(Math.log2(fitRatio)));
  while (true) {
    const zoom = 1 / (2 ** exponent);
    const quantum = Math.max(1, Math.round(1 / zoom));
    const visibleWorld = { width: view.width / zoom, height: view.height / zoom };
    const origin = {
      x: Math.round((bounds.x + (bounds.width - visibleWorld.width) / 2) / quantum) * quantum,
      y: Math.round((bounds.y + (bounds.height - visibleWorld.height) / 2) / quantum) * quantum,
    };
    if (origin.x <= bounds.x && origin.y <= bounds.y
      && origin.x + visibleWorld.width >= bounds.x + bounds.width
      && origin.y + visibleWorld.height >= bounds.y + bounds.height) return zoom;
    exponent += 1;
  }
}

function quantizeCameraOrigin(value, zoom) {
  const quantum = Math.max(1, Math.round(1 / zoom));
  return Math.round(value / quantum) * quantum;
}

function unionRect(left, right) {
  const minX = Math.min(left.x, right.x);
  const minY = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.ceil(maxX) - Math.floor(minX),
    height: Math.ceil(maxY) - Math.floor(minY),
  };
}

function surfaceVisibleBounds(surface) {
  const geometry = surface?.geometry;
  if (geometry?.kind === 'area' && rect(geometry.rect)) return geometry.rect;
  if (geometry?.kind !== 'path' || !Array.isArray(geometry.points) || !positive(geometry.width)) return null;
  const half = geometry.width / 2;
  const xs = geometry.points.map((entry) => entry.x);
  const ys = geometry.points.map((entry) => entry.y);
  return {
    x: Math.min(...xs) - half,
    y: Math.min(...ys) - half,
    width: Math.max(...xs) - Math.min(...xs) + geometry.width,
    height: Math.max(...ys) - Math.min(...ys) + geometry.width,
  };
}

function assetFrameBounds(entry, assets) {
  const frame = assets.get(entry?.assetId)?.usage?.frame;
  if (!point(entry?.position) || !isRecord(frame) || !positive(frame.width) || !positive(frame.height)) return null;
  return { x: entry.position.x, y: entry.position.y, width: frame.width, height: frame.height };
}

function residentVisibleBounds(entry, assets) {
  const frame = assets.get(entry?.assetId)?.usage?.frame;
  const pivot = assets.get(entry?.assetId)?.pivot;
  if (!isRecord(frame) || !positive(frame.width) || !positive(frame.height)) return null;
  const points = Array.isArray(entry?.path?.points) && entry.path.points.length > 0
    ? entry.path.points
    : [entry?.position];
  let bounds = null;
  for (const anchor of points) {
    if (!point(anchor)) continue;
    const position = point(pivot) ? assetPosition(anchor, { pivot }) : anchor;
    const next = { x: position.x, y: position.y, width: frame.width, height: frame.height };
    bounds = bounds ? unionRect(bounds, next) : next;
  }
  return bounds;
}

function materializeCamera(transform, art, { surfaces, renderables, npcs, playerAsset, spawn }) {
  const minimumView = clone(VIEW_SIZE);
  const assets = art.used;
  let bounds = clone(transform.worldRect);
  for (const surface of surfaces) {
    const visible = surfaceVisibleBounds(surface);
    // The ground is continuous, but the composition footprint is the useful
    // authored bound. Other surface roles can extend that footprint.
    if (visible && surface.recipe !== 'ground') bounds = unionRect(bounds, visible);
  }
  for (const entry of renderables) {
    const visible = assetFrameBounds(entry, assets);
    if (visible) bounds = unionRect(bounds, visible);
  }
  for (const entry of npcs) {
    const visible = residentVisibleBounds(entry, assets);
    if (visible) bounds = unionRect(bounds, visible);
  }
  const playerFrame = playerAsset?.usage?.frame;
  if (point(spawn) && isRecord(playerFrame)) {
    bounds = unionRect(bounds, { x: spawn.x, y: spawn.y, width: playerFrame.width, height: playerFrame.height });
  }
  const zoom = quantizedOverviewZoom(bounds, minimumView);
  const visibleWorld = {
    width: minimumView.width / zoom,
    height: minimumView.height / zoom,
  };
  const origin = {
    x: quantizeCameraOrigin(bounds.x + (bounds.width - visibleWorld.width) / 2, zoom),
    y: quantizeCameraOrigin(bounds.y + (bounds.height - visibleWorld.height) / 2, zoom),
  };
  return {
    minimumView,
    overview: { bounds, zoom, origin },
    follow: {
      zoom: 1,
      deadZone: clone(FOLLOW_DEAD_ZONE),
      lookAhead: FOLLOW_LOOK_AHEAD,
    },
  };
}

function logicalRect(value, field) {
  if (!isRecord(value)) fail('LOGICAL_RECT_INVALID', `${field} must be a logical rectangle`, [issue(field, 'LOGICAL_RECT_INVALID', 'rectangle is required')]);
  if ([value.x, value.y, value.width, value.height].every(finite) && value.width > 0 && value.height > 0) {
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  }
  if ([value.minX, value.maxX, value.minY, value.maxY].every(finite) && value.maxX > value.minX && value.maxY > value.minY) {
    return { x: value.minX, y: value.minY, width: value.maxX - value.minX, height: value.maxY - value.minY };
  }
  fail('LOGICAL_RECT_INVALID', `${field} must have x/y/width/height or min/max bounds`, [issue(field, 'LOGICAL_RECT_INVALID', 'rectangle shape is invalid')]);
}

function pixelRect(value, transform, field) {
  const logical = logicalRect(value, field);
  const origin = transform.point({ x: logical.x, y: logical.y });
  return {
    x: origin.x,
    y: origin.y,
    width: transform.distance(logical.width),
    height: transform.distance(logical.height),
  };
}

function pointRegion(value, transform, radiusUnits = 1.5) {
  const center = transform.point(value);
  const radius = transform.distance(radiusUnits);
  return { x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2 };
}

function geometryRect(value, transform, field) {
  const hasRectangleShape = isRecord(value)
    && ((finite(value.width) && finite(value.height))
      || (finite(value.minX) && finite(value.maxX) && finite(value.minY) && finite(value.maxY)));
  if (hasRectangleShape) return pixelRect(value, transform, field);
  if (point(value)) return pointRegion(value, transform);
  fail('LOGICAL_REGION_INVALID', `${field} must be a logical point or rectangle`, [issue(field, 'LOGICAL_REGION_INVALID', 'point or rectangle required')]);
}

function assetPosition(anchor, asset) {
  return { x: Math.round(anchor.x - asset.pivot.x), y: Math.round(anchor.y - asset.pivot.y) };
}

function placeLayerId(appearance, layer) {
  if (!PLACE_APPEARANCES.includes(appearance)) {
    fail('PLACE_APPEARANCE_UNKNOWN', `place appearance ${appearance ?? 'unknown'} is not authored`, [
      issue('$.places.appearance', 'PLACE_APPEARANCE_UNKNOWN', String(appearance ?? 'unknown')),
    ]);
  }
  if (!['base', 'upper', 'foreground', 'interior', 'interior-foreground'].includes(layer)) {
    fail('PLACE_LAYER_UNKNOWN', `place layer ${layer} is not authored`, [
      issue('$.places.appearance', 'PLACE_LAYER_UNKNOWN', layer),
    ]);
  }
  return `place--${appearance}--${layer}-v1`;
}

function residentAssetId(appearance) {
  if (!RESIDENT_APPEARANCES.includes(appearance)) {
    fail('RESIDENT_APPEARANCE_UNKNOWN', `resident appearance ${appearance ?? 'unknown'} is not authored`, [
      issue('$.residents.appearance', 'RESIDENT_APPEARANCE_UNKNOWN', String(appearance ?? 'unknown')),
    ]);
  }
  return `npc--${appearance}-v1`;
}

function samePoint(left, right) {
  return left?.x === right?.x && left?.y === right?.y;
}

function assertPlaceLayers(place, layers) {
  const reference = layers[0];
  if (layers.some((asset) => asset.usage?.frame?.columns !== 1 || asset.usage?.frame?.rows !== 1)) {
    fail('PLACE_LAYER_FRAME_INVALID', `${place.id} layers must each be one co-registered frame`);
  }
  for (const asset of layers.slice(1)) {
    if (asset.dimensions.width !== reference.dimensions.width
      || asset.dimensions.height !== reference.dimensions.height
      || !samePoint(asset.pivot, reference.pivot)) {
      fail('PLACE_LAYERS_NOT_REGISTERED', `${place.id} layers must share one canvas and pivot`, [
        issue(`$.places.${place.id}`, 'PLACE_LAYERS_NOT_REGISTERED', `${reference.id} and ${asset.id} do not align`),
      ]);
    }
  }
}

function containsRect(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function assertLayerCovers(place, asset, position, geometry, role) {
  const frame = asset.usage.frame;
  const visibleBounds = { x: position.x, y: position.y, width: frame.width, height: frame.height };
  if (!containsRect(visibleBounds, geometry)) {
    fail('PLACE_LAYER_GEOMETRY_MISMATCH', `${place.id} ${role} layer does not cover its declared geometry`, [
      issue(`$.places.${place.id}.geometry`, 'PLACE_LAYER_GEOMETRY_MISMATCH', asset.id),
    ]);
  }
}

function absoluteUsageRects(asset, position, field = 'collision') {
  const local = asset.usage?.[field];
  if (!isRecord(local)) return [];
  const rectangles = local.kind === 'rect' ? [local] : local.kind === 'rects' && Array.isArray(local.rects) ? local.rects : [];
  return rectangles.filter((rect) => [rect.x, rect.y, rect.width, rect.height].every(finite) && rect.width > 0 && rect.height > 0)
    .map((rect) => ({ x: position.x + rect.x, y: position.y + rect.y, width: rect.width, height: rect.height }));
}

function overlaps(left, right) {
  return rect(left) && rect(right)
    && left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function intersectRect(left, right) {
  if (!overlaps(left, right)) return null;
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightX = Math.min(left.x + left.width, right.x + right.width);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  return { x, y, width: rightX - x, height: bottom - y };
}

function subtractRect(base, cut) {
  const overlap = intersectRect(base, cut);
  if (!overlap) return [base];
  const pieces = [];
  if (overlap.y > base.y) pieces.push({ x: base.x, y: base.y, width: base.width, height: overlap.y - base.y });
  if (overlap.y + overlap.height < base.y + base.height) pieces.push({ x: base.x, y: overlap.y + overlap.height, width: base.width, height: base.y + base.height - overlap.y - overlap.height });
  if (overlap.x > base.x) pieces.push({ x: base.x, y: overlap.y, width: overlap.x - base.x, height: overlap.height });
  if (overlap.x + overlap.width < base.x + base.width) pieces.push({ x: overlap.x + overlap.width, y: overlap.y, width: base.x + base.width - overlap.x - overlap.width, height: overlap.height });
  return pieces.filter((entry) => entry.width > 0 && entry.height > 0);
}

function materializeSurfaces(plan, transform, art) {
  const surfaces = [];
  for (const [index, source] of plan.surfaces.entries()) {
    const recipe = SURFACE_RECIPES[source.recipe];
    if (!recipe) fail('SURFACE_RECIPE_UNKNOWN', `surface recipe ${source.recipe} is not part of ${WORLDVIEW_ID}`, [issue(`$.surfaces[${index}].recipe`, 'SURFACE_RECIPE_UNKNOWN', source.recipe)]);
    const asset = art.get(recipe.assetId, recipe.kind);
    const geometry = source.geometry;
    let compiledGeometry;
    if (geometry?.kind === 'area') {
      compiledGeometry = {
        kind: 'area',
        rect: source.recipe === 'ground'
          ? { x: 0, y: 0, width: transform.worldSize.width, height: transform.worldSize.height }
          : pixelRect(geometry.bounds ?? geometry, transform, `$.surfaces[${index}].geometry`),
      };
    } else if (geometry?.kind === 'path' && Array.isArray(geometry.points) && geometry.points.length >= 2) {
      compiledGeometry = {
        kind: 'path',
        points: geometry.points.map((value) => transform.point(value)),
        width: transform.distance(geometry.width ?? source.width),
      };
    } else {
      fail('SURFACE_GEOMETRY_INVALID', `surface ${source.id} needs an area or path`, [issue(`$.surfaces[${index}].geometry`, 'SURFACE_GEOMETRY_INVALID', 'area or path required')]);
    }
    surfaces.push({ id: source.id, recipe: source.recipe, assetId: asset.id, z: recipe.z, blocked: recipe.blocked, geometry: compiledGeometry });
  }
  if (!surfaces.some((surface) => surface.recipe === 'ground' && surface.geometry.kind === 'area')) {
    fail('GROUND_SURFACE_REQUIRED', 'the place recipe must declare one composed ground area', [issue('$.surfaces', 'GROUND_SURFACE_REQUIRED', 'ground area missing')]);
  }
  surfaces.sort((left, right) => left.z - right.z || left.id.localeCompare(right.id));
  return { surfaces };
}

function placeApproach(place, transform) {
  if (place.geometry?.access?.region) return geometryRect(place.geometry.access.region, transform, `$.places.${place.id}.geometry.access.region`);
  if (place.geometry?.entrance?.point) return geometryRect(place.geometry.entrance.point, transform, `$.places.${place.id}.geometry.entrance.point`);
  const footprint = pixelRect(place.footprint, transform, `$.places.${place.id}.footprint`);
  const width = Math.min(48, Math.max(24, footprint.width));
  return { x: footprint.x + (footprint.width - width) / 2, y: footprint.y + footprint.height, width, height: 24 };
}

function interactionRectAt(body, reach, facing) {
  if (!rect(body) || !positive(reach)) fail('RESIDENT_INTERACTION_INVALID', 'resident interaction needs an authored body and positive reach');
  if (facing === 'up') return { x: body.x, y: body.y - reach, width: body.width, height: reach };
  if (facing === 'down') return { x: body.x, y: body.y + body.height, width: body.width, height: reach };
  if (facing === 'left') return { x: body.x - reach, y: body.y, width: reach, height: body.height };
  if (facing === 'right') return { x: body.x + body.width, y: body.y, width: reach, height: body.height };
  fail('RESIDENT_INTERACTION_INVALID', `resident interaction facing ${String(facing)} is not authored`);
}

function materializePlaces(plan, transform, art) {
  const renderables = [];
  const collisions = [];
  const interiors = [];
  const placeGeometry = new Map();
  for (const place of plan.places) {
    const footprint = pixelRect(place.footprint, transform, `$.places.${place.id}.footprint`);
    const anchor = { x: footprint.x + footprint.width / 2, y: footprint.y + footprint.height };
    const access = place.geometry?.access?.region
      ? geometryRect(place.geometry.access.region, transform, `$.places.${place.id}.geometry.access.region`)
      : null;
    const approach = placeApproach(place, transform);
    const interaction = pointRegion(place.anchor, transform, 1.75);
    placeGeometry.set(place.id, { footprint, anchor, access, approach, interaction, interiorId: null });
    if (!nonEmpty(place.appearance)) continue;
    const base = art.get(placeLayerId(place.appearance, 'base'), 'building');
    const upper = art.get(placeLayerId(place.appearance, 'upper'), 'building');
    const foreground = art.get(placeLayerId(place.appearance, 'foreground'), 'building');
    const needsInterior = place.requirements?.distinctInterior === true;
    if (needsInterior && place.geometry?.interior?.kind !== 'cutaway') {
      fail('PLACE_INTERIOR_GEOMETRY_MISSING', `${place.id} requires a cutaway footprint`);
    }
    const interior = needsInterior
      ? art.get(placeLayerId(place.appearance, 'interior'), 'room')
      : null;
    const interiorForeground = needsInterior
      ? art.get(placeLayerId(place.appearance, 'interior-foreground'), 'room')
      : null;
    assertPlaceLayers(place, [base, upper, foreground, ...(interior ? [interior, interiorForeground] : [])]);
    const basePosition = assetPosition(anchor, base);
    const upperPosition = assetPosition(anchor, upper);
    const foregroundPosition = assetPosition(anchor, foreground);
    const roof = pixelRect(place.geometry.occlusion.roof, transform, `$.places.${place.id}.geometry.occlusion.roof`);
    const foregroundGeometry = pixelRect(place.geometry.occlusion.foreground, transform, `$.places.${place.id}.geometry.occlusion.foreground`);
    assertLayerCovers(place, base, basePosition, footprint, 'base');
    assertLayerCovers(place, upper, upperPosition, roof, 'upper');
    assertLayerCovers(place, foreground, foregroundPosition, foregroundGeometry, 'foreground');
    const interiorId = interior ? `interior:${place.id}` : null;
    placeGeometry.set(place.id, { ...placeGeometry.get(place.id), interiorId });
    renderables.push({
      id: `structure-base:${place.id}`,
      assetId: base.id,
      position: basePosition,
      footPivot: clone(base.pivot),
      z: 30,
      plane: 'ground',
    });
    if (interior) {
      if (!access) fail('INTERIOR_ACCESS_REQUIRED', `${place.id} has an interior without an access region`, [issue(`$.places.${place.id}.geometry.access`, 'INTERIOR_ACCESS_REQUIRED', 'access required')]);
      const bounds = geometryRect(place.geometry.interior.footprint, transform, `$.places.${place.id}.geometry.interior.footprint`);
      const interiorPosition = assetPosition(anchor, interior);
      const interiorForegroundPosition = assetPosition(anchor, interiorForeground);
      assertLayerCovers(place, interior, interiorPosition, bounds, 'interior');
      assertLayerCovers(place, interiorForeground, interiorForegroundPosition, bounds, 'interior foreground');
      interiors.push({
        id: interiorId,
        placeId: place.id,
        bounds,
        access,
        cutawayIds: [interiorId],
        collisions: [
          ...absoluteUsageRects(interior, interiorPosition),
          ...absoluteUsageRects(interiorForeground, interiorForegroundPosition),
        ],
      });
      renderables.push({
        id: `interior-layer:${place.id}`,
        assetId: interior.id,
        position: interiorPosition,
        footPivot: clone(interior.pivot),
        z: 32,
        plane: 'ground',
        interiorId,
      });
      renderables.push({
        id: `interior-foreground:${place.id}`,
        assetId: interiorForeground.id,
        position: interiorForegroundPosition,
        footPivot: clone(interiorForeground.pivot),
        z: 75,
        plane: 'foreground',
        interiorId,
      });
      collisions.push(...subtractRect(footprint, access));
    } else {
      collisions.push(footprint);
    }
    renderables.push({
      id: `structure-upper:${place.id}`,
      assetId: upper.id,
      position: upperPosition,
      footPivot: clone(upper.pivot),
      z: 36,
      plane: 'depth',
      ...(interiorId ? { cutawayId: interiorId } : {}),
    });
    renderables.push({
      id: `structure-foreground:${place.id}`,
      assetId: foreground.id,
      position: foregroundPosition,
      footPivot: clone(foreground.pivot),
      z: 80,
      plane: 'foreground',
      ...(interiorId ? { cutawayId: interiorId } : {}),
    });
  }
  return { renderables, collisions, interiors, placeGeometry };
}

function materializeProps(plan, transform, art) {
  const renderables = [];
  const collisions = [];
  for (const prop of plan.props) {
    const recipe = PROP_RECIPES[prop.recipe];
    if (!recipe) fail('PROP_RECIPE_UNKNOWN', `prop recipe ${prop.recipe} is not part of ${WORLDVIEW_ID}`, [issue(`$.props.${prop.id}.recipe`, 'PROP_RECIPE_UNKNOWN', prop.recipe)]);
    const asset = art.get(recipe.assetId, recipe.kind);
    const anchor = transform.point(prop.anchor);
    const position = assetPosition(anchor, asset);
    renderables.push({ id: `prop:${prop.id}`, assetId: asset.id, position, footPivot: clone(asset.pivot), z: 40, plane: 'depth' });
    collisions.push(...absoluteUsageRects(asset, position));
  }
  for (const light of plan.lights) {
    const asset = art.get(`light--${light.state}-v1`, 'light');
    const anchor = transform.point(light.anchor);
    renderables.push({ id: `light:${light.id}`, assetId: asset.id, position: assetPosition(anchor, asset), footPivot: clone(asset.pivot), z: 50, plane: 'depth' });
  }
  return { renderables, collisions };
}

function pointInRect(value, rectangle) {
  return point(value) && rect(rectangle)
    && value.x >= rectangle.x && value.x <= rectangle.x + rectangle.width
    && value.y >= rectangle.y && value.y <= rectangle.y + rectangle.height;
}

function segmentsIntersect(leftFrom, leftTo, rightFrom, rightTo) {
  const cross = (origin, first, second) => (first.x - origin.x) * (second.y - origin.y)
    - (first.y - origin.y) * (second.x - origin.x);
  const onSegment = (origin, end, value) => value.x >= Math.min(origin.x, end.x)
    && value.x <= Math.max(origin.x, end.x)
    && value.y >= Math.min(origin.y, end.y)
    && value.y <= Math.max(origin.y, end.y);
  const leftA = cross(leftFrom, leftTo, rightFrom);
  const leftB = cross(leftFrom, leftTo, rightTo);
  const rightA = cross(rightFrom, rightTo, leftFrom);
  const rightB = cross(rightFrom, rightTo, leftTo);
  if (((leftA > 0 && leftB < 0) || (leftA < 0 && leftB > 0))
    && ((rightA > 0 && rightB < 0) || (rightA < 0 && rightB > 0))) return true;
  return (leftA === 0 && onSegment(leftFrom, leftTo, rightFrom))
    || (leftB === 0 && onSegment(leftFrom, leftTo, rightTo))
    || (rightA === 0 && onSegment(rightFrom, rightTo, leftFrom))
    || (rightB === 0 && onSegment(rightFrom, rightTo, leftTo));
}

function segmentIntersectsRect(from, to, rectangle) {
  if (pointInRect(from, rectangle) || pointInRect(to, rectangle)) return true;
  const topLeft = { x: rectangle.x, y: rectangle.y };
  const topRight = { x: rectangle.x + rectangle.width, y: rectangle.y };
  const bottomLeft = { x: rectangle.x, y: rectangle.y + rectangle.height };
  const bottomRight = { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height };
  return segmentsIntersect(from, to, topLeft, topRight)
    || segmentsIntersect(from, to, topRight, bottomRight)
    || segmentsIntersect(from, to, bottomRight, bottomLeft)
    || segmentsIntersect(from, to, bottomLeft, topLeft);
}

function distancePointToRect(value, rectangle) {
  const dx = Math.max(rectangle.x - value.x, 0, value.x - (rectangle.x + rectangle.width));
  const dy = Math.max(rectangle.y - value.y, 0, value.y - (rectangle.y + rectangle.height));
  return Math.hypot(dx, dy);
}

function distancePointToSegment(value, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(value.x - from.x, value.y - from.y);
  const progress = Math.max(0, Math.min(1, ((value.x - from.x) * dx + (value.y - from.y) * dy) / length));
  return Math.hypot(value.x - (from.x + dx * progress), value.y - (from.y + dy * progress));
}

function segmentDistanceToRect(from, to, rectangle) {
  if (segmentIntersectsRect(from, to, rectangle)) return 0;
  return Math.min(
    distancePointToRect(from, rectangle),
    distancePointToRect(to, rectangle),
    ...[
      { x: rectangle.x, y: rectangle.y },
      { x: rectangle.x + rectangle.width, y: rectangle.y },
      { x: rectangle.x, y: rectangle.y + rectangle.height },
      { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
    ].map((corner) => distancePointToSegment(corner, from, to)),
  );
}

function blockedSurfaceAt(surfaces, body) {
  const crossings = surfaces.filter((surface) => surface.recipe === 'crossing');
  for (const surface of surfaces) {
    if (!surface.blocked) continue;
    const geometry = surface.geometry;
    const hit = geometry?.kind === 'area'
      ? overlaps(geometry.rect, body)
      : geometry?.kind === 'path' && geometry.points?.some((pointValue, index) => index > 0
        && segmentDistanceToRect(geometry.points[index - 1], pointValue, body) <= geometry.width / 2);
    if (hit && !crossings.some((crossing) => {
      const crossingGeometry = crossing.geometry;
      return crossingGeometry?.kind === 'area'
        ? overlaps(crossingGeometry.rect, body)
        : crossingGeometry?.kind === 'path' && crossingGeometry.points?.some((pointValue, index) => index > 0
          && segmentDistanceToRect(crossingGeometry.points[index - 1], pointValue, body) <= crossingGeometry.width / 2);
    })) return true;
  }
  return false;
}

function onCompiledRoute(surfaces, body) {
  return surfaces.some((surface) => {
    if (!['main_route', 'local_route', 'plaza', 'crossing'].includes(surface.recipe)) return false;
    const geometry = surface.geometry;
    if (geometry?.kind === 'area') return overlaps(geometry.rect, body);
    return geometry?.kind === 'path' && geometry.points?.some((pointValue, index) => index > 0
      && segmentDistanceToRect(geometry.points[index - 1], pointValue, body) <= geometry.width / 2);
  });
}

function interpolatePath(points) {
  const samples = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      samples.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }
  samples.push(points.at(-1));
  return samples;
}

function residentBodyAtAnchor(anchor, asset) {
  const position = assetPosition(anchor, asset);
  if (asset.usage?.collision?.kind !== 'rect') {
    fail('RESIDENT_BODY_REQUIRED', `${asset.id} must declare one authored rect collision`);
  }
  const bodies = absoluteUsageRects(asset, position);
  if (bodies.length !== 1) {
    fail('RESIDENT_BODY_REQUIRED', `${asset.id} must declare one authored rect collision`);
  }
  const [body] = bodies;
  return { position, body };
}

function residentPhase(id) {
  let hash = 2166136261;
  for (const character of String(id)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

function directionForPath(points, fallback = 'down') {
  if (!Array.isArray(points) || points.length < 2) return fallback;
  const delta = { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
  if (Math.abs(delta.x) >= Math.abs(delta.y) && delta.x !== 0) return delta.x < 0 ? 'left' : 'right';
  if (delta.y !== 0) return delta.y < 0 ? 'up' : 'down';
  return fallback;
}

function residentAction(resident) {
  if (resident.behavior === 'walk') return 'walk';
  if (resident.behavior === 'work') return 'work';
  if (resident.behavior === 'talk') return 'talk';
  return 'idle';
}

function residentAnimationState(action) {
  // The bounded resident sheets author idle/walk/work directions. Talking
  // and watching remain semantic actions while their visible body uses the
  // authored idle pose rather than an invented animation family.
  return action === 'walk' || action === 'work' ? action : 'idle';
}

function materializeResidents(plan, transform, art, placeGeometry, interiors, surfaces, existingWorldCollisions) {
  const npcs = [];
  const materializedResidentBodies = [];
  const interiorById = new Map(interiors.map((interior) => [interior.id, interior]));
  const activityCopy = {
    welcoming: '門前で旅人を迎えています。',
    guiding: '役場で道案内をしています。',
    carrying: '荷を運んでいます。',
    working: '仕事を続けています。',
    watching: 'あたりを見張っています。',
    speaking: 'つながりについて話しています。',
  };
  const stateCopy = {
    observed: '確認できたこととして話しています。',
    inferred: '手がかりからそう考えています。',
    unknown: 'まだ確かめられていないことは、わからないままです。',
  };
  const directionByActivity = { welcoming: 'down', guiding: 'left', carrying: 'right', working: 'left', watching: 'down', speaking: 'down' };
  for (const resident of plan.residents) {
    if (!point(resident.anchor)) continue;
    const asset = art.get(residentAssetId(resident.appearance), 'character');
    const initialAnchor = transform.point(resident.anchor);
    const place = placeGeometry.get(resident.placeId);
    const interiorId = resident.interiorPlaceId && place?.interiorId ? place.interiorId : null;
    const interior = interiorId ? interiorById.get(interiorId) : null;
    const logicalPath = resident.motion?.kind === 'ping-pong' ? resident.motion.points : [resident.anchor];
    const path = logicalPath.map((value) => transform.point(value));
    if (path.length < 1) fail('RESIDENT_PATH_INVALID', `${resident.id} must have a still or ping-pong path`);
    const pathSamples = interpolatePath(path);
    const bodies = pathSamples.map((anchor) => residentBodyAtAnchor(anchor, asset));
    for (const { body } of bodies) {
      const conflict = materializedResidentBodies.find((entry) => entry.interiorId === interiorId
        && overlaps(entry.body, body));
      if (conflict) {
        fail('RESIDENT_PATH_CONFLICT', `${resident.id} body path overlaps resident ${conflict.id}`);
      }
      if (interiorId) {
        if (!interior || !containsRect(interior.bounds, body) || interior.collisions.some((entry) => overlaps(entry, body))) {
          fail('RESIDENT_PATH_BLOCKED', `${resident.id} must stay inside its authored interior plane`);
        }
      } else {
        if (existingWorldCollisions.some((entry) => overlaps(entry, body)) || blockedSurfaceAt(surfaces, body)) {
          fail('RESIDENT_PATH_BLOCKED', `${resident.id} must stay clear of places, props, and water`);
        }
        if (resident.motion?.kind === 'ping-pong' && !onCompiledRoute(surfaces, body)) {
          fail('RESIDENT_PATH_OFF_ROUTE', `${resident.id} must remain on a compiled route while walking`);
        }
        // An outdoor actor must never cross into a cutaway plane.  The
        // authored approach remains outside the interior bounds.
        if (interiors.some((entry) => overlaps(entry.bounds, body) && !overlaps(entry.access, body))) {
          fail('RESIDENT_PATH_PLANE_CROSSING', `${resident.id} must remain outdoors`);
        }
      }
    }
    materializedResidentBodies.push(...bodies.map(({ body }) => ({ id: resident.id, interiorId, body })));
    const initial = residentBodyAtAnchor(initialAnchor, asset);
    if (!pointInRect(initialAnchor, transform.worldRect)) fail('RESIDENT_POSITION_INVALID', `${resident.id} lies outside the world`);
    const action = residentAction(resident);
    const animationState = residentAnimationState(action);
    const direction = directionForPath(path, directionByActivity[resident.activity] ?? 'down');
    const reach = 18;
    npcs.push({
      id: resident.id,
      position: initial.position,
      body: initial.body,
      assetId: asset.id,
      footPivot: clone(asset.pivot),
      interactionRect: interactionRectAt(initial.body, reach, direction),
      reach,
      prompt: `${resident.name}に話す`,
      dialogue: [`${activityCopy[resident.activity] ?? 'この場所で過ごしています。'} ${stateCopy[resident.state]}`],
      animationState,
      action,
      behavior: resident.behavior,
      direction,
      facing: direction,
      path: { kind: resident.motion?.kind === 'ping-pong' ? 'ping-pong' : 'still', points: path },
      speed: resident.motion?.kind === 'ping-pong' ? 24 : 0,
      phase: residentPhase(resident.id),
      ...(interiorId ? { interiorId } : {}),
    });
  }
  return { npcs: npcs.sort(compareId) };
}

function evidenceAddresses(evidence, base) {
  const output = { observed: [], inferred: [], unknown: [] };
  for (const state of EVIDENCE_STATES) {
    if (!Array.isArray(evidence?.[state])) continue;
    evidence[state].forEach((claim, index) => output[state].push({ address: `${base}.${state}[${index}]`, claim: clone(claim) }));
  }
  return output;
}

function materializeInvestigations(plan, transform, art, placeGeometry, interiors) {
  const quests = [];
  const renderables = [];
  const interiorCollisionById = new Map();
  const interiorById = new Map(interiors.map((interior) => [interior.id, interior]));
  for (const [index, investigation] of plan.investigations.entries()) {
    const place = placeGeometry.get(investigation.placeId);
    if (!place?.interiorId) fail('INVESTIGATION_INTERIOR_REQUIRED', `${investigation.id} must have a visible same-place interior`);
    const interior = interiorById.get(place.interiorId);
    if (!interior) fail('INVESTIGATION_INTERIOR_REQUIRED', `${investigation.id} interior is not materialized`);
    const asset = art.get(`clue--${investigation.target.recipe}-v1`, 'quest');
    const anchor = transform.point(investigation.target.anchor);
    const position = assetPosition(anchor, asset);
    const authoredCollisions = absoluteUsageRects(asset, position);
    if (authoredCollisions.some((entry) => !containsRect(interior.bounds, entry))) {
      fail('INVESTIGATION_GEOMETRY_MISMATCH', `${investigation.id} authored collision must remain inside its interior`);
    }
    interiorCollisionById.set(place.interiorId, [
      ...(interiorCollisionById.get(place.interiorId) ?? []),
      ...authoredCollisions,
    ]);
    renderables.push({
      id: `clue:${investigation.id}`,
      assetId: asset.id,
      position,
      footPivot: clone(asset.pivot),
      z: 48,
      plane: 'depth',
      interiorId: place.interiorId,
    });
    quests.push({
      id: investigation.id,
      placeId: investigation.placeId,
      rect: pointRegion(investigation.target.anchor, transform, investigation.target.reach),
      subject: investigation.subject,
      action: investigation.action,
      statement: investigation.statement,
      state: investigation.state,
      evidenceAddresses: evidenceAddresses(investigation.evidence, `$.investigations[${index}].evidence`),
      interiorId: place.interiorId,
    });
  }
  if (quests.length !== 3 || new Set(quests.map((entry) => entry.placeId)).size !== 3) {
    fail('THREE_DISTINCT_INVESTIGATIONS_REQUIRED', 'the place recipe must materialize three distinct investigation targets');
  }
  return {
    quests: quests.sort(compareId),
    renderables: renderables.sort(compareId),
    interiorCollisionById,
  };
}

function materializeJourney(plan, placeGeometry, quests) {
  const placeFor = (id, field) => {
    const value = placeGeometry.get(id);
    if (!value) fail('JOURNEY_PLACE_MISSING', `${field} does not resolve to a materialized place`, [issue(`$.journey.${field}`, 'JOURNEY_PLACE_MISSING', id)]);
    return value;
  };
  const requestPlace = placeFor(plan.journey.requestPlaceId, 'requestPlaceId');
  const reportPlace = placeFor(plan.journey.reportPlaceId, 'reportPlaceId');
  if (plan.journey.requestPlaceId === plan.journey.reportPlaceId) fail('JOURNEY_PLACES_NOT_DISTINCT', 'request and report places must be distinct');
  const transition = plan.journey.transition;
  const expected = REPOSITORY_INSPECTION_BINDING;
  const change = transition?.state === 'observed'
    && transition.bindingId === expected.id
    && transition.event === expected.event
    && transition.facilityKind === expected.facilityKind
    && transition.effect === expected.effect
    ? clone(transition)
    : null;
  if (!change) fail('TOWN_CHANGE_REQUIRED', 'the completed investigation journey must produce the observed town-hall change');
  return {
    quests,
    request: { id: `request:${plan.journey.requestPlaceId}`, rect: clone(requestPlace.approach), prompt: '掲示板の依頼' },
    report: {
      id: `report:${plan.journey.reportPlaceId}`,
      rect: clone(reportPlace.interaction),
      prompt: '調査報告をまとめる',
      change,
      ...(reportPlace.interiorId ? { interiorId: reportPlace.interiorId } : {}),
    },
  };
}

function materializeEffect(plan, transform, art, placeGeometry) {
  if (!plan.journey.transition || plan.journey.transition.state !== 'observed') fail('TOWN_CHANGE_REQUIRED', 'the observed town-hall change is required');
  const target = placeGeometry.get(plan.journey.townHallLanternPlaceId);
  if (!target) fail('TOWN_CHANGE_PLACE_MISSING', 'the observed town change has no placed town hall');
  const light = plan.lights.find((entry) => entry.reportState?.transitionId === plan.journey.transition.id);
  if (!light) fail('TOWN_CHANGE_LIGHT_MISSING', 'the observed town change has no placed lantern state');
  const asset = art.get('light--lit-v1', 'light');
  const anchor = transform.point(light.anchor);
  return {
    id: `effect:${plan.journey.transition.effect}`,
    assetId: asset.id,
    position: assetPosition(anchor, asset),
    footPivot: clone(asset.pivot),
    z: 70,
    plane: 'depth',
    effect: plan.journey.transition.effect,
  };
}

function uniqueRects(values) {
  const seen = new Set();
  return values.filter(rect).filter((value) => {
    const key = `${value.x},${value.y},${value.width},${value.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.y - right.y || left.x - right.x || left.width - right.width);
}

function materializeGame(plan, transform, art) {
  const playerAsset = art.get(REQUIRED_ASSETS.player, 'character');
  art.get(REQUIRED_ASSETS.dialogue, 'ui');
  art.get(REQUIRED_ASSETS.report, 'ui');
  const surfaces = materializeSurfaces(plan, transform, art);
  const places = materializePlaces(plan, transform, art);
  const investigations = materializeInvestigations(plan, transform, art, places.placeGeometry, places.interiors);
  // Investigation clues are authored interior solids. Apply their collision
  // rectangles before resident validation so indoor workers cannot be placed
  // on a clue that was materialized later in the old order.
  for (const [interiorId, clueCollisions] of investigations.interiorCollisionById.entries()) {
    const interior = places.interiors.find((entry) => entry.id === interiorId);
    if (!interior) fail('INVESTIGATION_INTERIOR_REQUIRED', `${interiorId} is not materialized`);
    interior.collisions.push(...clueCollisions);
  }
  const props = materializeProps(plan, transform, art);
  const npcs = materializeResidents(
    plan,
    transform,
    art,
    places.placeGeometry,
    places.interiors,
    surfaces.surfaces,
    [...places.collisions, ...props.collisions],
  );
  const journey = materializeJourney(plan, places.placeGeometry, investigations.quests);
  const effect = materializeEffect(plan, transform, art, places.placeGeometry);
  const footbox = clone(playerAsset.usage.collision);
  if (footbox?.kind !== 'rect') fail('PLAYER_FOOTBOX_REQUIRED', 'player art must declare one authored footbox');
  delete footbox.kind;
  const spawnFoot = transform.point(plan.composition.spawn);
  const spawn = { x: spawnFoot.x - footbox.x - footbox.width / 2, y: spawnFoot.y - footbox.y - footbox.height / 2 };
  const renderables = [...places.renderables, ...investigations.renderables, ...props.renderables, ...(effect ? [effect] : [])]
    .sort((left, right) => left.z - right.z || left.id.localeCompare(right.id));
  // Resident bodies are live state, not static world collision. The runtime
  // checks their current body rectangles on every player move.
  const collisions = uniqueRects([...places.collisions, ...props.collisions]);
  const spawnBody = { x: spawn.x + footbox.x, y: spawn.y + footbox.y, width: footbox.width, height: footbox.height };
  if (collisions.some((entry) => overlaps(entry, spawnBody))) {
    fail('SPAWN_BLOCKED', 'the arrival recipe placed the player inside authored collision', [
      issue('$.composition.spawn', 'SPAWN_BLOCKED', 'spawn must remain walkable'),
    ]);
  }
  if (npcs.npcs.some((resident) => overlaps(resident.body, spawnBody))) {
    fail('SPAWN_BLOCKED', 'the arrival recipe placed the player inside a resident body', [
      issue('$.composition.spawn', 'SPAWN_BLOCKED', 'spawn must remain clear of live residents'),
    ]);
  }
  const camera = materializeCamera(transform, art, {
    surfaces: surfaces.surfaces,
    renderables,
    npcs: npcs.npcs,
    playerAsset,
    spawn,
  });
  return {
    viewSize: clone(VIEW_SIZE),
    worldSize: clone(transform.worldSize),
    camera,
    ui: clone(UI_CONTRACT),
    spawn,
    player: { assetId: playerAsset.id, footbox, speeds: clone(GAME_SPEEDS) },
    surfaces: surfaces.surfaces,
    collisions,
    interiors: places.interiors.sort(compareId),
    npcs: npcs.npcs,
    quests: journey.quests,
    request: journey.request,
    report: journey.report,
    renderables,
  };
}

/** Compile one validated logical town through the complete late-medieval worldview. */
export function compileScene({ worldPlan, assetManifest, assetRoot } = {}) {
  const plan = validatedWorldPlan(worldPlan);
  if (plan.worldview?.id !== WORLDVIEW_ID) fail('WORLDVIEW_UNSUPPORTED', `worldview ${plan.worldview?.id ?? 'unknown'} is not complete`);
  if (!nonEmpty(assetRoot)) fail('ASSET_ROOT_REQUIRED', 'assetRoot is required');
  let manifest;
  try {
    manifest = validateAssetManifest(assetManifest, assetRoot);
  } catch (error) {
    fail('ASSET_MANIFEST_INVALID', error.message, error.issues ?? [issue('$', 'ASSET_MANIFEST_INVALID', 'shipping manifest is invalid')]);
  }
  assertCompleteWorldview(plan, manifest);
  const art = createArtResolver(manifest, assetRoot);
  const transform = makeTransform(plan);
  const game = materializeGame(plan, transform, art);
  const bundle = {
    format: SCENE_BUNDLE_FORMAT,
    schemaVersion: SCENE_BUNDLE_SCHEMA_VERSION,
    world: {
      identity: clone(plan.identity),
      contentDigest: plan.contentSeed,
      worldview: clone(plan.worldview),
      bounds: clone(transform.worldRect),
    },
    assets: [...art.used.values()].sort(compareId),
    game,
  };
  const validation = validateSceneBundle(bundle);
  if (!validation.ok) fail('SCENE_BUNDLE_INVALID', 'compiler produced an invalid SceneBundle', validation.issues);
  return freeze(clone(bundle));
}

function validateAsset(value, path, ids, issues) {
  if (!isRecord(value)) { issues.push(issue(path, 'ASSET_INVALID', 'asset must be an object')); return; }
  for (const key of ['id', 'version', 'path', 'url', 'sha256']) if (!nonEmpty(value[key])) issues.push(issue(`${path}.${key}`, 'ASSET_FIELD_REQUIRED', key));
  if (!isRecord(value.dimensions) || !positive(value.dimensions.width) || !positive(value.dimensions.height)) issues.push(issue(`${path}.dimensions`, 'ASSET_DIMENSIONS_INVALID', 'dimensions required'));
  if (!point(value.pivot) || !isRecord(value.usage)) issues.push(issue(path, 'ASSET_GEOMETRY_INVALID', 'pivot and usage required'));
  if (nonEmpty(value.id)) {
    if (ids.has(value.id)) issues.push(issue(`${path}.id`, 'ASSET_ID_DUPLICATE', value.id));
    ids.add(value.id);
  }
}

function evidenceAddressState(value) {
  if (!isRecord(value)) return null;
  return EVIDENCE_STATES.find((state) => Array.isArray(value[state]) && value[state].length > 0) ?? null;
}

function validateQuestEvidenceAddresses(value, path, issues) {
  if (!isRecord(value)) {
    issues.push(issue(path, 'EVIDENCE_ADDRESSES_REQUIRED', 'tri-state evidence addresses are required'));
    return;
  }
  for (const state of EVIDENCE_STATES) {
    if (!Array.isArray(value[state])) {
      issues.push(issue(`${path}.${state}`, 'EVIDENCE_ADDRESS_INVALID', 'evidence addresses must be arrays'));
      continue;
    }
    value[state].forEach((entry, index) => {
      if (!isRecord(entry) || !nonEmpty(entry.address) || !nonEmpty(entry.claim)) {
        issues.push(issue(`${path}.${state}[${index}]`, 'EVIDENCE_ADDRESS_INVALID', 'an addressed evidence claim is required'));
      }
    });
  }
}

function quantizedZoom(value) {
  if (!positive(value) || value > 1) return false;
  const quantum = 1 / value;
  return Number.isInteger(quantum) && (quantum & (quantum - 1)) === 0;
}

function validateCamera(value, path, viewSize, issues) {
  if (!isRecord(value)) {
    issues.push(issue(path, 'CAMERA_INVALID', 'camera composition is required'));
    return;
  }
  rejectUnknownKeys(value, ['minimumView', 'overview', 'follow'], path, issues);
  const minimumView = value.minimumView;
  if (!isRecord(minimumView) || !positive(minimumView.width) || !positive(minimumView.height)) {
    issues.push(issue(`${path}.minimumView`, 'CAMERA_VIEW_INVALID', 'minimum camera view is required'));
  } else if (isRecord(viewSize)
    && (minimumView.width !== viewSize.width || minimumView.height !== viewSize.height)) {
    issues.push(issue(`${path}.minimumView`, 'CAMERA_VIEW_MISMATCH', 'minimum camera view must match game.viewSize'));
  }
  const overview = value.overview;
  if (isRecord(overview)) rejectUnknownKeys(overview, ['bounds', 'zoom', 'origin'], `${path}.overview`, issues);
  if (!isRecord(overview) || !rect(overview.bounds) || !quantizedZoom(overview.zoom) || !point(overview.origin)) {
    issues.push(issue(`${path}.overview`, 'CAMERA_OVERVIEW_INVALID', 'overview bounds, quantized zoom, and origin are required'));
  } else {
    const quantum = Math.max(1, Math.round(1 / overview.zoom));
    if (overview.origin.x % quantum !== 0 || overview.origin.y % quantum !== 0) {
      issues.push(issue(`${path}.overview.origin`, 'CAMERA_ORIGIN_INVALID', 'overview origin must align to its zoom quantum'));
    }
    if (isRecord(minimumView)
      && (overview.origin.x > overview.bounds.x || overview.origin.y > overview.bounds.y
        || overview.origin.x + minimumView.width / overview.zoom < overview.bounds.x + overview.bounds.width
        || overview.origin.y + minimumView.height / overview.zoom < overview.bounds.y + overview.bounds.height)) {
      issues.push(issue(`${path}.overview`, 'CAMERA_OVERVIEW_FIT_INVALID', 'overview camera must fit its authored bounds in the minimum view'));
    }
  }
  const follow = value.follow;
  if (isRecord(follow)) rejectUnknownKeys(follow, ['zoom', 'deadZone', 'lookAhead'], `${path}.follow`, issues);
  if (!isRecord(follow) || !quantizedZoom(follow.zoom) || !rect(follow.deadZone) || !finite(follow.lookAhead) || follow.lookAhead < 0) {
    issues.push(issue(`${path}.follow`, 'CAMERA_FOLLOW_INVALID', 'follow zoom, dead zone, and look-ahead are required'));
  } else if (isRecord(minimumView)
    && (follow.deadZone.x < 0 || follow.deadZone.y < 0
      || follow.deadZone.x + follow.deadZone.width > minimumView.width
      || follow.deadZone.y + follow.deadZone.height > minimumView.height)) {
    issues.push(issue(`${path}.follow.deadZone`, 'CAMERA_DEAD_ZONE_INVALID', 'dead zone must fit the minimum view'));
  }
}

function validateGame(value, assetIds, issues) {
  if (!isRecord(value)) { issues.push(issue('$.game', 'GAME_INVALID', 'game must be an object')); return; }
  if (!isRecord(value.viewSize) || !positive(value.viewSize.width) || !positive(value.viewSize.height)) issues.push(issue('$.game.viewSize', 'VIEW_INVALID', 'view size required'));
  if (!isRecord(value.worldSize) || !positive(value.worldSize.width) || !positive(value.worldSize.height)) issues.push(issue('$.game.worldSize', 'WORLD_SIZE_INVALID', 'world size required'));
  validateCamera(value.camera, '$.game.camera', value.viewSize, issues);
  if (!point(value.spawn)) issues.push(issue('$.game.spawn', 'SPAWN_INVALID', 'spawn required'));
  if (!isRecord(value.player) || !assetIds.has(value.player.assetId) || !rect(value.player.footbox)) issues.push(issue('$.game.player', 'PLAYER_INVALID', 'player asset and footbox required'));
  const uiPath = '$.game.ui';
  if (!isRecord(value.ui)) {
    issues.push(issue(uiPath, 'UI_REQUIRED', 'one framed dialogue/report UI contract is required'));
  } else {
    rejectUnknownKeys(value.ui, ['frame', 'dialogue', 'report'], uiPath, issues);
    if (!isRecord(value.ui.frame) || value.ui.frame.width !== UI_FRAME_SIZE.width || value.ui.frame.height !== UI_FRAME_SIZE.height) {
      issues.push(issue(`${uiPath}.frame`, 'UI_FRAME_INVALID', 'the UI frame must be exactly 384 by 216 logical pixels'));
    }
    for (const kind of ['dialogue', 'report']) {
      const contract = value.ui[kind];
      const path = `${uiPath}.${kind}`;
      if (!isRecord(contract)) {
        issues.push(issue(path, 'UI_CONTRACT_INVALID', `${kind} UI contract is required`));
        continue;
      }
      rejectUnknownKeys(contract, ['assetId', 'prompt', 'body', 'footer'], path, issues);
      if (!nonEmpty(contract.assetId) || !assetIds.has(contract.assetId)) issues.push(issue(`${path}.assetId`, 'UI_ASSET_REQUIRED', `${kind} frame asset is required`));
      for (const region of ['prompt', 'body', 'footer']) {
        const rectValue = contract[region];
        if (!rect(rectValue) || !Number.isInteger(rectValue.x) || !Number.isInteger(rectValue.y)
          || !Number.isInteger(rectValue.width) || !Number.isInteger(rectValue.height)
          || !containsRect({ x: 0, y: 0, ...UI_FRAME_SIZE }, rectValue)) {
          issues.push(issue(`${path}.${region}`, 'UI_SAFE_RECT_INVALID', 'safe UI rect must be an integer rectangle inside the 384 by 216 frame'));
        }
      }
    }
  }
  for (const key of ['surfaces', 'collisions', 'interiors', 'npcs', 'quests', 'renderables']) if (!Array.isArray(value[key])) issues.push(issue(`$.game.${key}`, 'ARRAY_REQUIRED', key));
  if (Array.isArray(value.surfaces)) value.surfaces.forEach((surface, index) => {
    if (!isRecord(surface) || !nonEmpty(surface.id) || !assetIds.has(surface.assetId) || !isRecord(surface.geometry)) issues.push(issue(`$.game.surfaces[${index}]`, 'SURFACE_INVALID', 'surface contract invalid'));
    else if (surface.geometry.kind === 'area' ? !rect(surface.geometry.rect) : surface.geometry.kind === 'path' ? !Array.isArray(surface.geometry.points) || surface.geometry.points.length < 2 || !positive(surface.geometry.width) : true) issues.push(issue(`$.game.surfaces[${index}].geometry`, 'SURFACE_GEOMETRY_INVALID', 'surface geometry invalid'));
  });
  if (Array.isArray(value.collisions) && value.collisions.some((entry) => !rect(entry))) issues.push(issue('$.game.collisions', 'COLLISION_INVALID', 'collision rectangles required'));
  if (Array.isArray(value.npcs)) value.npcs.forEach((npc, index) => {
    const path = `$.game.npcs[${index}]`;
    if (!isRecord(npc) || !nonEmpty(npc.id) || !point(npc.position) || !assetIds.has(npc.assetId)
      || !rect(npc.body) || !point(npc.footPivot) || !rect(npc.interactionRect) || !positive(npc.reach)
      || !nonEmpty(npc.prompt) || !Array.isArray(npc.dialogue) || npc.dialogue.some((line) => !nonEmpty(line))
      || !['idle', 'work', 'talk', 'walk'].includes(npc.action) || !['idle', 'work', 'walk'].includes(npc.animationState)
      || !['up', 'down', 'left', 'right'].includes(npc.direction) || npc.facing !== npc.direction
      || !isRecord(npc.path) || !['still', 'ping-pong'].includes(npc.path.kind)
      || !Array.isArray(npc.path.points) || npc.path.points.length < 1 || npc.path.points.some((entry) => !point(entry))
      || (npc.path.kind === 'ping-pong' && npc.path.points.length < 2)
      || !finite(npc.speed) || npc.speed < 0 || !finite(npc.phase) || npc.phase < 0 || npc.phase >= 1) {
      issues.push(issue(path, 'NPC_INVALID', 'resident contract invalid'));
    }
  });
  if (Array.isArray(value.renderables)) value.renderables.forEach((entry, index) => {
    if (!isRecord(entry) || !nonEmpty(entry.id) || !assetIds.has(entry.assetId) || !point(entry.position) || !point(entry.footPivot) || !finite(entry.z) || !['ground', 'depth', 'foreground'].includes(entry.plane)) issues.push(issue(`$.game.renderables[${index}]`, 'RENDERABLE_INVALID', 'renderable contract invalid'));
  });
  if (!isRecord(value.request) || !rect(value.request.rect) || !nonEmpty(value.request.prompt)) issues.push(issue('$.game.request', 'REQUEST_INVALID', 'request place required'));
  if (!isRecord(value.report) || !rect(value.report.rect) || !nonEmpty(value.report.prompt) || !isRecord(value.report.change)) issues.push(issue('$.game.report', 'REPORT_INVALID', 'report place and observed town change required'));
  if (!Array.isArray(value.quests) || value.quests.length !== 3
    || new Set(value.quests.map((entry) => entry?.id)).size !== 3
    || new Set(value.quests.map((entry) => entry?.placeId)).size !== 3) {
    issues.push(issue('$.game.quests', 'QUESTS_INVALID', 'three distinct place quests required'));
  } else {
    value.quests.forEach((quest, index) => {
      const path = `$.game.quests[${index}]`;
      if (!isRecord(quest) || !nonEmpty(quest.id) || !nonEmpty(quest.placeId) || !rect(quest.rect)
        || !nonEmpty(quest.subject) || !nonEmpty(quest.action) || !nonEmpty(quest.statement)
        || !EVIDENCE_STATES.includes(quest.state)) {
        issues.push(issue(path, 'QUEST_INVALID', 'investigation place, action, statement, and truth state are required'));
      }
      validateQuestEvidenceAddresses(quest?.evidenceAddresses, `${path}.evidenceAddresses`, issues);
      const addressedState = evidenceAddressState(quest?.evidenceAddresses);
      if (EVIDENCE_STATES.includes(quest?.state) && addressedState !== quest.state) {
        issues.push(issue(`${path}.state`, 'QUEST_EVIDENCE_STATE_MISMATCH', 'quest state must match the highest-priority non-empty evidence bucket'));
      }
    });
  }
}

/** Validate the only serialized contract accepted by the runtime. */
export function validateSceneBundle(bundle) {
  const issues = [];
  if (!isRecord(bundle)) return { ok: false, issues: [issue('$', 'SCENE_INVALID', 'scene must be an object')] };
  if (bundle.format !== SCENE_BUNDLE_FORMAT) issues.push(issue('$.format', 'FORMAT_INVALID', SCENE_BUNDLE_FORMAT));
  if (bundle.schemaVersion !== SCENE_BUNDLE_SCHEMA_VERSION) issues.push(issue('$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'schemaVersion must be 2'));
  if (!isRecord(bundle.world) || !isRecord(bundle.world.identity) || !nonEmpty(bundle.world.contentDigest) || !isRecord(bundle.world.worldview) || !rect(bundle.world.bounds)) issues.push(issue('$.world', 'WORLD_INVALID', 'world identity, digest, worldview, and bounds required'));
  const assetIds = new Set();
  if (!Array.isArray(bundle.assets) || bundle.assets.length === 0) issues.push(issue('$.assets', 'ASSETS_REQUIRED', 'shipping assets required'));
  else bundle.assets.forEach((asset, index) => validateAsset(asset, `$.assets[${index}]`, assetIds, issues));
  validateGame(bundle.game, assetIds, issues);
  return { ok: issues.length === 0, issues };
}
