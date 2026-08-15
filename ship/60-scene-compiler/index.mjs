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
const PIXELS_PER_UNIT = 16;
// Keep the current authored plan inside the 1280-pixel game view. The margin
// is part of the scene transform, so the world and camera use the same value.
const WORLD_MARGIN = 112;
// A 16:9 game view that gives the authored town room to establish itself.
// At common 1280x720 and larger browser sizes this keeps a useful world
// viewport instead of scaling a 640x360 technical window until the whole town
// must be reduced to unreadable 1/4-size actors.
const VIEW_SIZE = Object.freeze({ width: 1280, height: 720 });
const GAME_SPEEDS = Object.freeze({ run: 92, walk: 56 });
const FOLLOW_DEAD_ZONE = Object.freeze({
  x: Math.round(VIEW_SIZE.width * 0.25),
  y: Math.round(VIEW_SIZE.height * 0.25),
  width: Math.round(VIEW_SIZE.width * 0.5),
  height: Math.round(VIEW_SIZE.height * 0.5),
});
const FOLLOW_LOOK_AHEAD = 8;
const UI_FRAME_SIZE = Object.freeze({ width: 384, height: 216 });
// These are the only authored place layers the selected worldview can use.
// The appearance is the worldgen decision; semantic facility kinds never
// select pixels in the scene compiler.
const LATE_PLACE_APPEARANCES = Object.freeze([
  'gate', 'town-hall', 'warehouse', 'well', 'workshop', 'dojo', 'watchtower',
  'shop', 'guild', 'dock', 'ruin',
  'dwelling-gabled', 'dwelling-stone', 'dwelling-tall',
  'dwelling-stone-bay', 'dwelling-tall-narrow',
]);
const SNOW_PLACE_APPEARANCES = Object.freeze([
  'gate', 'town-hall', 'warehouse', 'well', 'workshop',
  'dwelling-gabled', 'dwelling-stone',
]);
const LATE_RESIDENT_APPEARANCES = Object.freeze([
  'keeper', 'artisan', 'porter', 'watcher', 'neighbor', 'traveler',
]);
const SNOW_RESIDENT_APPEARANCES = Object.freeze(['keeper', 'artisan', 'neighbor']);
const EVIDENCE_STATES = Object.freeze(['observed', 'inferred', 'unknown']);
// Movement semantics are carried by each compiled surface.  Keep this map
// literal and closed: the runtime must not infer movement from pixels or from
// a second world-level mask.
const SURFACE_WALKABILITY = Object.freeze({
  main_route: true,
  local_route: true,
  plaza: true,
  crossing: true,
  ground: false,
  water: false,
  bank: false,
});

// The late compact environment is a complete authored ground composition.
// Keep detection tied to the stable world grammar, not to labels supplied by
// a repository or to the presence of the environment asset itself. Any extra
// route, water, bank, or dock surface keeps the normal surface backplate.
const LATE_COMPACT_ENVIRONMENT_ASSET_ID = 'environment--late-compact-v1';
const LATE_COMPACT_REQUIRED_SURFACE_IDS = Object.freeze([
  'surface.precinct.civic',
  'surface.precinct.east',
  'surface.precinct.north',
  'surface.precinct.south',
]);
const LATE_COMPACT_ALLOWED_SURFACE_IDS = new Set([
  'surface.ground.world',
  'surface.plaza.civic',
  'surface.precinct.civic',
  'surface.precinct.court',
  'surface.precinct.north',
  'surface.precinct.north.apron.hall',
  'surface.precinct.east',
  'surface.precinct.south',
]);

// The tiny late-medieval repository has a smaller authored composition than
// the compact work-and-living town above.  It has one arrival gate, one hall,
// one warehouse, one well, and one civic plaza.  Keep this selector fully
// closed to that geometry.  A worldview label, asset ID, or matching route
// alone must never paint a background that belongs to another town.
const LATE_SMALL_ENVIRONMENT_ASSET_ID = 'environment--late-small-v1';
const LATE_SMALL_SURFACE_GRAMMAR = Object.freeze({
  'surface.ground.world': Object.freeze({ recipe: 'ground', district: 'civic', kind: 'area' }),
  'surface.plaza.civic': Object.freeze({ recipe: 'plaza', district: 'civic', kind: 'area' }),
  'surface.precinct.civic': Object.freeze({ recipe: 'main_route', district: 'civic', kind: 'path', points: 6, width: 5 }),
  'surface.precinct.living.connector': Object.freeze({ recipe: 'local_route', district: 'living', kind: 'path', points: 2, width: 3 }),
  'surface.precinct.work.north': Object.freeze({ recipe: 'local_route', district: 'work', kind: 'path', points: 3, width: 3 }),
});
const LATE_SMALL_SURFACE_IDS = new Set(Object.keys(LATE_SMALL_SURFACE_GRAMMAR));
const LATE_SMALL_PLACE_GRAMMAR = Object.freeze({
  'place.civic-plaza': Object.freeze({
    recipe: 'civic_plaza', district: 'civic', appearance: null, facilityKind: null,
    anchor: Object.freeze({ x: 31, y: 28 }),
    footprint: Object.freeze({ x: 27, y: 25.5, width: 8, height: 5 }),
    entrance: Object.freeze({ point: Object.freeze({ x: 31, y: 31.5 }), approach: Object.freeze([
      Object.freeze({ x: 31, y: 33.5 }), Object.freeze({ x: 31, y: 31.5 }),
    ]) }),
    interior: 'open', distinctInterior: false,
  }),
  'place.gate': Object.freeze({
    recipe: 'arrival_gate', district: 'arrival', appearance: 'gate', facilityKind: 'gate',
    anchor: Object.freeze({ x: 7, y: 22 }),
    footprint: Object.freeze({ x: 3, y: 18, width: 8, height: 8 }),
    entrance: Object.freeze({ point: Object.freeze({ x: 7, y: 27 }), approach: Object.freeze([
      Object.freeze({ x: 7, y: 29 }), Object.freeze({ x: 7, y: 27 }),
    ]) }),
    interior: 'open', distinctInterior: false,
  }),
  'place.town-hall': Object.freeze({
    recipe: 'civic_hall', district: 'civic', appearance: 'town-hall', facilityKind: 'town_hall',
    anchor: Object.freeze({ x: 32, y: 11.5 }),
    footprint: Object.freeze({ x: 25, y: 6.5, width: 14, height: 10 }),
    entrance: Object.freeze({ point: Object.freeze({ x: 32, y: 17.5 }), approach: Object.freeze([
      Object.freeze({ x: 32, y: 19.5 }), Object.freeze({ x: 32, y: 17.5 }),
    ]) }),
    interior: 'cutaway', distinctInterior: true,
  }),
  'place.warehouse': Object.freeze({
    recipe: 'facility', district: 'work', appearance: 'warehouse', facilityKind: 'warehouse',
    anchor: Object.freeze({ x: 46.75, y: 12 }),
    footprint: Object.freeze({ x: 40.75, y: 8, width: 12, height: 8 }),
    entrance: Object.freeze({ point: Object.freeze({ x: 46.75, y: 17 }), approach: Object.freeze([
      Object.freeze({ x: 46.75, y: 19 }), Object.freeze({ x: 46.75, y: 17 }),
    ]) }),
    interior: 'cutaway', distinctInterior: true,
  }),
  'place.well': Object.freeze({
    recipe: 'facility', district: 'living', appearance: 'well', facilityKind: 'well',
    anchor: Object.freeze({ x: 9.5, y: 40 }),
    footprint: Object.freeze({ x: 6, y: 36.5, width: 7, height: 7 }),
    entrance: Object.freeze({ point: Object.freeze({ x: 4, y: 44.5 }), approach: Object.freeze([
      Object.freeze({ x: 4, y: 46.5 }), Object.freeze({ x: 4, y: 44.5 }),
    ]) }),
    interior: 'open', distinctInterior: false,
  }),
});
const LATE_SMALL_PLACE_IDS = new Set(Object.keys(LATE_SMALL_PLACE_GRAMMAR));

// The broad late environment is one authored parcel and street language. It
// can leave optional facility parcels and residence yards empty, but every
// live place must still occupy the parcel declared by worldgen. Keep this
// selector closed to that grammar so a large generic late plan cannot borrow
// the broad town image because it happens to have similar dimensions.
const LATE_BROAD_ENVIRONMENT_ASSET_ID = 'environment--late-broad-v1';
const LATE_BROAD_COMPOSITION = Object.freeze({
  bounds: Object.freeze({ minX: -2, maxX: 71, minY: 1.5, maxY: 47 }),
  entry: Object.freeze({ x: 5, y: 29.5 }),
  spawn: Object.freeze({ x: 6, y: 27.5 }),
  civic: Object.freeze({ x: 25, y: 21.5 }),
});
const LATE_BROAD_FACILITY_GRAMMAR = Object.freeze({
  dock: Object.freeze({ id: 'place.dock', recipe: 'waterfront_dock', district: 'waterside', appearance: 'dock', anchor: Object.freeze({ x: 53.5, y: 37.5 }) }),
  dojo: Object.freeze({ id: 'place.dojo', recipe: 'facility', district: 'work', appearance: 'dojo', anchor: Object.freeze({ x: 28, y: 32 }) }),
  gate: Object.freeze({ id: 'place.gate', recipe: 'arrival_gate', district: 'arrival', appearance: 'gate', anchor: Object.freeze({ x: 5, y: 22.5 }) }),
  guild: Object.freeze({ id: 'place.guild', recipe: 'facility', district: 'civic', appearance: 'guild', anchor: Object.freeze({ x: 42, y: 23 }) }),
  ruin: Object.freeze({ id: 'place.ruin', recipe: 'heritage_ruin', district: 'heritage', appearance: 'ruin', anchor: Object.freeze({ x: 40.5, y: 9.5 }) }),
  shop: Object.freeze({ id: 'place.shop', recipe: 'facility', district: 'work', appearance: 'shop', anchor: Object.freeze({ x: 15, y: 22.5 }) }),
  town_hall: Object.freeze({ id: 'place.town-hall', recipe: 'civic_hall', district: 'civic', appearance: 'town-hall', anchor: Object.freeze({ x: 28, y: 13.5 }) }),
  warehouse: Object.freeze({ id: 'place.warehouse', recipe: 'facility', district: 'work', appearance: 'warehouse', anchor: Object.freeze({ x: 41, y: 36.5 }) }),
  watchtower: Object.freeze({ id: 'place.watchtower', recipe: 'facility', district: 'heritage', appearance: 'watchtower', anchor: Object.freeze({ x: 5.5, y: 8.5 }) }),
  well: Object.freeze({ id: 'place.well', recipe: 'facility', district: 'living', appearance: 'well', anchor: Object.freeze({ x: 5.5, y: 37.5 }) }),
  workshop: Object.freeze({ id: 'place.workshop', recipe: 'facility', district: 'work', appearance: 'workshop', anchor: Object.freeze({ x: 52, y: 13.5 }) }),
});
const LATE_BROAD_HOME_SLOTS = new Set([
  '15.5,8.5', '62.5,8.5', '61,22.5', '14.5,37.5', '64.5,33.5',
]);
const LATE_BROAD_DISTRICTS = new Set(['arrival', 'civic', 'heritage', 'living', 'waterside', 'work']);

function exactPoint(value, expected) {
  return isRecord(value) && value.x === expected.x && value.y === expected.y;
}

function exactRect(value, expected) {
  return isRecord(value)
    && value.x === expected.x && value.y === expected.y
    && value.width === expected.width && value.height === expected.height;
}

function exactBounds(value, expected) {
  return isRecord(value)
    && value.minX === expected.minX && value.maxX === expected.maxX
    && value.minY === expected.minY && value.maxY === expected.maxY;
}

function exactPath(value, expectedPoints, expectedWidth) {
  return isRecord(value) && value.kind === 'path'
    && value.width === expectedWidth
    && Array.isArray(value.points)
    && value.points.length === expectedPoints.length
    && value.points.every((entry, index) => exactPoint(entry, expectedPoints[index]));
}

function isLateSmallComposition(plan) {
  if (plan?.worldview?.id !== 'late-medieval-night'
    || !isRecord(plan?.composition)
    || !Array.isArray(plan?.surfaces)
    || !Array.isArray(plan?.places)) return false;

  // These bounds compile to the authored native 1312x928 world (about 68x44
  // logical units at 16 pixels per unit with the shared 112-pixel margin).
  const bounds = plan.composition.bounds;
  if (!isRecord(bounds)
    || !finite(bounds.minX) || !finite(bounds.maxX)
    || !finite(bounds.minY) || !finite(bounds.maxY)
    || Math.max(VIEW_SIZE.width, Math.round((bounds.maxX - bounds.minX) * PIXELS_PER_UNIT + WORLD_MARGIN * 2)) !== 1312
    || Math.max(VIEW_SIZE.height, Math.round((bounds.maxY - bounds.minY) * PIXELS_PER_UNIT + WORLD_MARGIN * 2)) !== 928) return false;
  if (!exactPoint(plan.composition.entry, { x: 7, y: 29 })
    || !exactPoint(plan.composition.spawn, { x: 8.5, y: 28.0 })
    || !exactPoint(plan.composition.civic, { x: 31, y: 28 })) return false;

  const surfaceById = new Map(plan.surfaces.map((surface) => [surface?.id, surface]));
  if (plan.surfaces.length !== LATE_SMALL_SURFACE_IDS.size
    || surfaceById.size !== LATE_SMALL_SURFACE_IDS.size) return false;
  for (const [id, grammar] of Object.entries(LATE_SMALL_SURFACE_GRAMMAR)) {
    const surface = surfaceById.get(id);
    if (!surface || surface.recipe !== grammar.recipe || surface.district !== grammar.district) return false;
    if (grammar.kind === 'area') {
      if (surface.geometry?.kind !== 'area' || !isRecord(surface.geometry.bounds)) return false;
    } else if (!exactPath(surface.geometry, grammar.points === 6
      ? [
        { x: 7, y: 27 }, { x: 12, y: 32 }, { x: 17, y: 28 },
        { x: 32, y: 17.5 }, { x: 27, y: 26 }, { x: 31, y: 31.5 },
      ]
      : grammar.points === 3
        ? [{ x: 31, y: 31.5 }, { x: 40, y: 29.5 }, { x: 46.75, y: 17 }]
        : [{ x: 4, y: 44.5 }, { x: 4, y: 40 }], grammar.width)) return false;
  }

  if (plan.places.length !== LATE_SMALL_PLACE_IDS.size) return false;
  const placeById = new Map(plan.places.map((place) => [place?.id, place]));
  if (placeById.size !== LATE_SMALL_PLACE_IDS.size) return false;
  for (const [id, grammar] of Object.entries(LATE_SMALL_PLACE_GRAMMAR)) {
    const place = placeById.get(id);
    if (!place || place.recipe !== grammar.recipe || place.district !== grammar.district
      || place.appearance !== grammar.appearance
      || (grammar.facilityKind === null ? place.facilityKind != null : place.facilityKind !== grammar.facilityKind)
      || !exactPoint(place.anchor, grammar.anchor)
      || !exactRect(place.footprint, grammar.footprint)) return false;
    const entrance = place.geometry?.entrance;
    if (!isRecord(entrance) || entrance.width !== 3
      || !exactPoint(entrance.point, grammar.entrance.point)
      || !Array.isArray(entrance.approach)
      || entrance.approach.length !== grammar.entrance.approach.length
      || !entrance.approach.every((entry, index) => exactPoint(entry, grammar.entrance.approach[index]))) return false;
    if (place.geometry?.interior?.kind !== grammar.interior
      || place.requirements?.distinctInterior !== grammar.distinctInterior) return false;
  }
  return true;
}

function isLateBroadSurfaceGrammar(plan, hasDock) {
  if (!Array.isArray(plan?.surfaces) || !Array.isArray(plan?.routes)) return false;
  const surfaceById = new Map(plan.surfaces.map((surface) => [surface?.id, surface]));
  if (surfaceById.size !== plan.surfaces.length) return false;
  const routeById = new Map(plan.routes.map((route) => [route?.id, route]));
  if (routeById.size !== plan.routes.length || routeById.has(undefined)) return false;
  const linkedRouteIds = new Set();
  const dockSurfaceIds = new Set([
    'surface.bank.waterside',
    'surface.water.waterside',
  ]);
  let crossingCount = 0;

  for (const surface of plan.surfaces) {
    if (surface?.id === 'surface.ground.world') {
      if (surface.recipe !== 'ground' || surface.district !== 'civic'
        || surface.geometry?.kind !== 'area'
        || !exactBounds(surface.geometry.bounds, LATE_BROAD_COMPOSITION.bounds)) return false;
      continue;
    }
    if (surface?.id === 'surface.plaza.civic') {
      if (surface.recipe !== 'plaza' || surface.district !== 'civic'
        || surface.geometry?.kind !== 'area'
        || !exactBounds(surface.geometry.bounds, { minX: 19, maxX: 31, minY: 17, maxY: 26 })) return false;
      continue;
    }
    if (surface?.id === 'surface.bank.waterside') {
      if (!hasDock || surface.recipe !== 'bank' || surface.district !== 'waterside'
        || !exactPath(surface.geometry, [
          { x: 53.5, y: 40.25 }, { x: 61.25, y: 40 }, { x: 69, y: 40.25 },
        ], 1.5)) return false;
      continue;
    }
    if (surface?.id === 'surface.water.waterside') {
      if (!hasDock || surface.recipe !== 'water' || surface.district !== 'waterside'
        || !exactPath(surface.geometry, [{ x: 53.5, y: 44 }, { x: 69, y: 44 }], 6)) return false;
      continue;
    }
    if (/^surface\.crossing\.waterside\.\d+$/u.test(surface?.id ?? '')) {
      if (!hasDock || surface.recipe !== 'crossing' || surface.district !== 'waterside'
        || surface.geometry?.kind !== 'path' || surface.geometry.width !== 3
        || !Array.isArray(surface.geometry.points) || surface.geometry.points.length !== 2) return false;
      crossingCount += 1;
    } else if (/^surface\.route\./u.test(surface?.id ?? '')) {
      if (!['main_route', 'local_route'].includes(surface.recipe)
        || !LATE_BROAD_DISTRICTS.has(surface.district)
        || surface.geometry?.kind !== 'path'
        || surface.geometry.width !== (surface.recipe === 'main_route' ? 5 : 3)
        || !Array.isArray(surface.geometry.points) || surface.geometry.points.length < 2) return false;
    } else return false;

    if (!Array.isArray(surface.links?.routeIds) || surface.links.routeIds.length === 0) return false;
    for (const routeId of surface.links.routeIds) {
      const route = routeById.get(routeId);
      if (!route) return false;
      if (surface.recipe === 'main_route' && route.recipe !== 'main') return false;
      if (surface.recipe === 'local_route' && route.recipe !== 'local') return false;
      linkedRouteIds.add(routeId);
    }
  }

  if (!surfaceById.has('surface.ground.world') || !surfaceById.has('surface.plaza.civic')
    || !surfaceById.has('surface.route.main.arrival-civic')
    || !surfaceById.has('surface.route.main.civic-plaza')) return false;
  if (hasDock) {
    if (![...dockSurfaceIds].every((id) => surfaceById.has(id)) || crossingCount < 1) return false;
  } else if ([...dockSurfaceIds].some((id) => surfaceById.has(id)) || crossingCount !== 0) return false;
  return [...routeById.keys()].every((id) => linkedRouteIds.has(id));
}

function isLateBroadComposition(plan) {
  if (plan?.worldview?.id !== 'late-medieval-night'
    || !isRecord(plan?.composition)
    || !Array.isArray(plan?.places)
    || !exactBounds(plan.composition.bounds, LATE_BROAD_COMPOSITION.bounds)
    || !exactPoint(plan.composition.entry, LATE_BROAD_COMPOSITION.entry)
    || !exactPoint(plan.composition.spawn, LATE_BROAD_COMPOSITION.spawn)
    || !exactPoint(plan.composition.civic, LATE_BROAD_COMPOSITION.civic)) return false;

  const placeIds = new Set(plan.places.map((place) => place?.id));
  if (placeIds.size !== plan.places.length || placeIds.has(undefined)) return false;
  const facilities = plan.places.filter((place) => nonEmpty(place?.facilityKind));
  const facilityKinds = new Set();
  for (const place of facilities) {
    const grammar = LATE_BROAD_FACILITY_GRAMMAR[place.facilityKind];
    if (!grammar || facilityKinds.has(place.facilityKind)
      || place.id !== grammar.id || place.recipe !== grammar.recipe
      || place.district !== grammar.district || place.appearance !== grammar.appearance
      || !exactPoint(place.anchor, grammar.anchor)) return false;
    facilityKinds.add(place.facilityKind);
  }
  if (!facilityKinds.has('gate') || !facilityKinds.has('town_hall')) return false;

  const plaza = plan.places.filter((place) => place?.recipe === 'civic_plaza');
  if (plaza.length !== 1 || plaza[0].id !== 'place.civic-plaza'
    || plaza[0].district !== 'civic' || plaza[0].appearance !== null
    || plaza[0].facilityKind != null || !exactPoint(plaza[0].anchor, LATE_BROAD_COMPOSITION.civic)) return false;

  const residences = plan.places.filter((place) => place?.recipe === 'residence');
  if (residences.length > LATE_BROAD_HOME_SLOTS.size) return false;
  const occupiedSlots = new Set();
  const claimedGroupIds = new Set();
  for (const residence of residences) {
    const slot = `${residence.anchor?.x},${residence.anchor?.y}`;
    if (residence.facilityKind != null
      || ![
        'dwelling-gabled', 'dwelling-stone', 'dwelling-tall',
        'dwelling-stone-bay', 'dwelling-tall-narrow',
      ].includes(residence.appearance)
      || !LATE_BROAD_HOME_SLOTS.has(slot) || occupiedSlots.has(slot)
      || !Array.isArray(residence.sourceGroupIds) || residence.sourceGroupIds.length === 0) return false;
    occupiedSlots.add(slot);
    for (const groupId of residence.sourceGroupIds) {
      if (!nonEmpty(groupId) || claimedGroupIds.has(groupId)) return false;
      claimedGroupIds.add(groupId);
    }
  }
  if (plan.places.length !== facilities.length + residences.length + 1) return false;
  return isLateBroadSurfaceGrammar(plan, facilityKinds.has('dock'));
}

function isLateCompactComposition(plan) {
  if (plan?.worldview?.id !== 'late-medieval-night' || !Array.isArray(plan?.surfaces)) return false;
  const surfaces = plan.surfaces;
  const ids = new Set(surfaces.map((surface) => surface?.id).filter(nonEmpty));
  if (!LATE_COMPACT_REQUIRED_SURFACE_IDS.every((id) => ids.has(id))) return false;
  if (surfaces.some((surface) => !LATE_COMPACT_ALLOWED_SURFACE_IDS.has(surface?.id)
    || surface?.recipe === 'water'
    || surface?.recipe === 'bank'
    || surface?.district === 'waterside')) return false;
  return true;
}

// The compact snow harbor is a distinct authored composition. It keeps the
// same repository-caused place grammar as the snow-harbor world recipe: one
// gate, civic hall and plaza; one work pair; one living pair; and one dock
// with a continuous bank, water and crossing edge. Detection is deliberately
// closed to the complete surface and place grammar, so a snow label or one
// matching route cannot select this environment by itself.
const SNOW_COMPACT_ENVIRONMENT_ASSET_ID = 'environment--snow-compact-v1';
const SNOW_COMPACT_SURFACE_GRAMMAR = Object.freeze({
  'surface.bank.waterside': Object.freeze({ recipe: 'bank', district: 'waterside', kind: 'path', points: 3 }),
  'surface.crossing.waterside.1': Object.freeze({ recipe: 'crossing', district: 'waterside', kind: 'path', points: 2 }),
  'surface.ground.world': Object.freeze({ recipe: 'ground', district: 'civic', kind: 'area' }),
  'surface.plaza.civic': Object.freeze({ recipe: 'plaza', district: 'civic', kind: 'area' }),
  'surface.precinct.civic': Object.freeze({ recipe: 'main_route', district: 'civic', kind: 'path', points: 5 }),
  'surface.precinct.harbor.edge': Object.freeze({ recipe: 'local_route', district: 'waterside', kind: 'path', points: 2 }),
  'surface.precinct.living.connector': Object.freeze({ recipe: 'local_route', district: 'living', kind: 'path', points: 4 }),
  'surface.precinct.living.lane': Object.freeze({ recipe: 'local_route', district: 'living', kind: 'path', points: 3 }),
  'surface.precinct.work.north': Object.freeze({ recipe: 'local_route', district: 'work', kind: 'path', points: 6 }),
  'surface.water.waterside': Object.freeze({ recipe: 'water', district: 'waterside', kind: 'path', points: 2 }),
});
const SNOW_COMPACT_SURFACE_IDS = new Set(Object.keys(SNOW_COMPACT_SURFACE_GRAMMAR));
const SNOW_COMPACT_FACILITY_GRAMMAR = Object.freeze({
  'place.dock': Object.freeze({ facilityKind: 'dock', recipe: 'waterfront_dock', appearance: 'warehouse', district: 'waterside', distinctInterior: false }),
  'place.gate': Object.freeze({ facilityKind: 'gate', recipe: 'arrival_gate', appearance: 'gate', district: 'arrival', distinctInterior: false }),
  'place.town-hall': Object.freeze({ facilityKind: 'town_hall', recipe: 'civic_hall', appearance: 'town-hall', district: 'civic', distinctInterior: true }),
  'place.warehouse': Object.freeze({ facilityKind: 'warehouse', recipe: 'facility', appearance: 'warehouse', district: 'work', distinctInterior: true }),
  'place.well': Object.freeze({ facilityKind: 'well', recipe: 'facility', appearance: 'well', district: 'living', distinctInterior: false }),
  'place.workshop': Object.freeze({ facilityKind: 'workshop', recipe: 'facility', appearance: 'workshop', district: 'work', distinctInterior: true }),
});

function isSnowCompactComposition(plan) {
  if (plan?.worldview?.id !== 'snow-harbor-night'
    || !Array.isArray(plan?.surfaces)
    || !Array.isArray(plan?.places)) return false;

  const surfaces = plan.surfaces;
  const surfaceById = new Map(surfaces.map((surface) => [surface?.id, surface]));
  if (surfaces.length !== SNOW_COMPACT_SURFACE_IDS.size || surfaceById.size !== SNOW_COMPACT_SURFACE_IDS.size) return false;
  for (const [id, grammar] of Object.entries(SNOW_COMPACT_SURFACE_GRAMMAR)) {
    const surface = surfaceById.get(id);
    if (!surface || surface.recipe !== grammar.recipe || surface.district !== grammar.district
      || surface.geometry?.kind !== grammar.kind) return false;
    if (grammar.points !== undefined && (!Array.isArray(surface.geometry.points)
      || surface.geometry.points.length !== grammar.points)) return false;
  }

  // Six fixed facility roles plus exactly one living and one work residence
  // form the compact harbor. Residence IDs are repository-derived and can
  // vary, so the stable grammar checks their district, recipe and appearance.
  const facilityPlaces = plan.places.filter((place) => nonEmpty(place?.facilityKind));
  if (facilityPlaces.length !== Object.keys(SNOW_COMPACT_FACILITY_GRAMMAR).length) return false;
  for (const [id, grammar] of Object.entries(SNOW_COMPACT_FACILITY_GRAMMAR)) {
    const place = plan.places.find((entry) => entry?.id === id);
    if (!place || place.facilityKind !== grammar.facilityKind || place.recipe !== grammar.recipe
      || place.appearance !== grammar.appearance || place.district !== grammar.district
      || place.requirements?.distinctInterior !== grammar.distinctInterior) return false;
  }
  const plaza = plan.places.find((place) => place?.id === 'place.civic-plaza');
  if (!plaza || plaza.recipe !== 'civic_plaza' || plaza.appearance !== null || plaza.district !== 'civic') return false;
  const residences = plan.places.filter((place) => place?.recipe === 'residence');
  if (residences.length !== 2
    || !residences.some((place) => place.district === 'living' && place.appearance === 'dwelling-gabled')
    || !residences.some((place) => place.district === 'work' && place.appearance === 'dwelling-stone')) return false;
  if (plan.places.length !== Object.keys(SNOW_COMPACT_FACILITY_GRAMMAR).length + residences.length + 1) return false;
  return plan.places.every((place) => Array.isArray(place?.geometry?.entrance?.approach)
    && place.geometry.entrance.approach.length >= 2);
}

function selectedEnvironmentAssetId(plan) {
  if (isLateBroadComposition(plan)) return LATE_BROAD_ENVIRONMENT_ASSET_ID;
  if (isLateSmallComposition(plan)) return LATE_SMALL_ENVIRONMENT_ASSET_ID;
  if (isLateCompactComposition(plan)) return LATE_COMPACT_ENVIRONMENT_ASSET_ID;
  if (isSnowCompactComposition(plan)) return SNOW_COMPACT_ENVIRONMENT_ASSET_ID;
  return null;
}

// Each worldview is a small, literal recipe. Asset IDs are complete IDs from
// the shipping manifest. There is no prefix fallback and no nearest-match
// asset lookup. Snow carries its visible roles in clues and lights, so it has
// no generic late-medieval prop recipe.
const WORLDVIEW_RECIPES = Object.freeze({
  'late-medieval-night': Object.freeze({
    id: 'late-medieval-night',
    playerAssetId: 'player--default-v1',
    dialogueAssetId: 'ui--dialogue-v1',
    reportAssetId: 'ui--inspection-report-v1',
    exitAssetId: 'ui--exit-v1',
    placePrefix: 'place--',
    residentPrefix: 'npc--',
    cluePrefix: 'clue--',
    lightPrefix: 'light--',
    placeAppearances: LATE_PLACE_APPEARANCES,
    residentAppearances: LATE_RESIDENT_APPEARANCES,
    props: Object.freeze({
      signboard: Object.freeze({ assetId: 'prop--sign-v1', kind: 'prop' }),
      lamp_post: Object.freeze({ assetId: 'prop--lamp-v1', kind: 'prop' }),
      tree_cluster: Object.freeze({ assetId: 'prop--tree-v1', kind: 'prop' }),
      work_clutter: Object.freeze({ assetId: 'prop--work-clutter-v1', kind: 'prop' }),
      civic_planter: Object.freeze({ assetId: 'prop--civic-planter-v1', kind: 'prop' }),
      living_woodpile: Object.freeze({ assetId: 'prop--living-woodpile-v1', kind: 'prop' }),
      edge_stone_stair: Object.freeze({ assetId: 'prop--edge-stone-stair-v1', kind: 'prop' }),
      edge_hedge_curb: Object.freeze({ assetId: 'prop--edge-hedge-curb-v1', kind: 'prop' }),
    }),
    surfaces: Object.freeze({
      ground: Object.freeze({ assetId: 'surface--ground-v1', kind: 'terrain', z: 0, blocked: false, opacity: 1 }),
      water: Object.freeze({ assetId: 'surface--water-v1', kind: 'water', z: 2, blocked: true, opacity: 1 }),
      bank: Object.freeze({ assetId: 'surface--bank-v1', kind: 'terrain', z: 3, blocked: false, opacity: 1 }),
      main_route: Object.freeze({ assetId: 'surface--road-main-v1', kind: 'road', z: 6, blocked: false, opacity: 1 }),
      // Keep enough of the earth-toned local material visible for a player to
      // follow each doorway branch at native browser scale.
      local_route: Object.freeze({ assetId: 'surface--road-local-v1', kind: 'road', z: 7, blocked: false, opacity: 1 }),
      plaza: Object.freeze({ assetId: 'surface--plaza-v1', kind: 'road', z: 8, blocked: false, opacity: 1 }),
      crossing: Object.freeze({ assetId: 'surface--crossing-v1', kind: 'road', z: 9, blocked: false, opacity: 1 }),
    }),
  }),
  'snow-harbor-night': Object.freeze({
    id: 'snow-harbor-night',
    playerAssetId: 'snow--player-v1',
    dialogueAssetId: 'snow--ui--dialogue-v1',
    reportAssetId: 'snow--ui--inspection-report-v1',
    exitAssetId: 'snow--ui--exit-v1',
    placePrefix: 'snow--place--',
    residentPrefix: 'snow--npc--',
    cluePrefix: 'snow--clue--',
    lightPrefix: 'snow--light--',
    placeAppearances: SNOW_PLACE_APPEARANCES,
    residentAppearances: SNOW_RESIDENT_APPEARANCES,
    // Snow's outer edge, dock approach, and working cargo are authored
    // roles. Worldgen names these semantic jobs; this recipe resolves them
    // to the exact supplied pixels for this worldview.
    props: Object.freeze({
      snow_evergreen: Object.freeze({ assetId: 'snow--prop--evergreen-v1', kind: 'prop' }),
      snow_harbor_lamp: Object.freeze({ assetId: 'snow--prop--harbor-lamp-v1', kind: 'prop' }),
      snow_dock_cargo: Object.freeze({ assetId: 'snow--prop--dock-cargo-v1', kind: 'prop' }),
      snow_edge_evergreen_yard: Object.freeze({ assetId: 'snow--prop--edge-evergreen-yard-v1', kind: 'prop' }),
      snow_edge_harbor_shore: Object.freeze({ assetId: 'snow--prop--edge-harbor-shore-v1', kind: 'prop' }),
    }),
    surfaces: Object.freeze({
      ground: Object.freeze({ assetId: 'snow--surface--ground-v1', kind: 'terrain', z: 0, blocked: false, opacity: 1 }),
      water: Object.freeze({ assetId: 'snow--surface--water-v1', kind: 'water', z: 2, blocked: true, opacity: 1 }),
      bank: Object.freeze({ assetId: 'snow--surface--bank-v1', kind: 'terrain', z: 3, blocked: false, opacity: 1 }),
      // Snow route PNGs carry their own restrained material alpha. Render the
      // authored pixels once so that compositing is owned by the asset rather
      // than multiplied by a second hidden recipe fade.
      main_route: Object.freeze({ assetId: 'snow--surface--road-main-v1', kind: 'road', z: 6, blocked: false, opacity: 1 }),
      local_route: Object.freeze({ assetId: 'snow--surface--road-local-v1', kind: 'road', z: 7, blocked: false, opacity: 1 }),
      plaza: Object.freeze({ assetId: 'snow--surface--plaza-v1', kind: 'road', z: 8, blocked: false, opacity: 1 }),
      crossing: Object.freeze({ assetId: 'snow--surface--crossing-v1', kind: 'road', z: 9, blocked: false, opacity: 1 }),
    }),
  }),
});

function worldviewRecipe(worldviewId) {
  const recipe = WORLDVIEW_RECIPES[worldviewId];
  if (!recipe) fail('WORLDVIEW_UNSUPPORTED', `worldview ${worldviewId ?? 'unknown'} is not complete`);
  return recipe;
}

function uiContract(worldview) {
  const snow = worldview.id === 'snow-harbor-night';
  return {
    frame: Object.freeze({ ...UI_FRAME_SIZE }),
    dialogue: Object.freeze({
      assetId: worldview.dialogueAssetId,
      // The snow frame has a thick carved left post and a deep lower point.
      // Keep its copy inside the actual dark writing plane instead of laying
      // Japanese glyphs across those ornaments. The late frame retains its
      // wider parchment-safe area.
      prompt: Object.freeze(snow
        ? { x: 58, y: 34, width: 276, height: 16 }
        : { x: 35, y: 28, width: 111, height: 16 }),
      body: Object.freeze(snow
        ? { x: 58, y: 58, width: 276, height: 116 }
        : { x: 29, y: 51, width: 324, height: 130 }),
      footer: Object.freeze(snow
        ? { x: 58, y: 184, width: 276, height: 16 }
        : { x: 31, y: 184, width: 321, height: 16 }),
    }),
    report: Object.freeze({
      assetId: worldview.reportAssetId,
      prompt: Object.freeze({ x: 43, y: 13, width: 293, height: 18 }),
      body: Object.freeze({ x: 27, y: 48, width: 329, height: 114 }),
      footer: Object.freeze({ x: 43, y: 174, width: 293, height: 26 }),
    }),
    exit: Object.freeze({
      assetId: worldview.exitAssetId,
      prompt: Object.freeze(worldview.id === 'snow-harbor-night'
        ? { x: 100, y: 32, width: 210, height: 18 }
        : { x: 35, y: 28, width: 180, height: 18 }),
      body: Object.freeze(worldview.id === 'snow-harbor-night'
        ? { x: 84, y: 55, width: 236, height: 110 }
        : { x: 29, y: 51, width: 324, height: 114 }),
      footer: Object.freeze(worldview.id === 'snow-harbor-night'
        ? { x: 84, y: 170, width: 236, height: 18 }
        : { x: 31, y: 184, width: 321, height: 16 }),
    }),
  };
}

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
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
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

function requiredWorldviewAssets(plan, worldview) {
  const required = new Map([
    [worldview.playerAssetId, 'character'],
    [worldview.dialogueAssetId, 'ui'],
    [worldview.reportAssetId, 'ui'],
    [worldview.exitAssetId, 'ui'],
  ]);
  // Every authored place contributes an explicit local-route approach.  The
  // source plan may contain no local route surface of its own, so resolve this
  // role as a required asset before materializing those approaches.
  const approachRecipe = worldview.surfaces.local_route;
  if (approachRecipe) required.set(approachRecipe.assetId, approachRecipe.kind);
  for (const surface of plan.surfaces) {
    const recipe = worldview.surfaces[surface.recipe];
    if (recipe) required.set(recipe.assetId, recipe.kind);
  }
  for (const place of plan.places) {
    if (!nonEmpty(place.appearance)) continue;
    required.set(placeLayerId(place.appearance, 'base', worldview), 'building');
    required.set(placeLayerId(place.appearance, 'upper', worldview), 'building');
    required.set(placeLayerId(place.appearance, 'foreground', worldview), 'building');
    if (place.requirements?.distinctInterior === true) {
      required.set(placeLayerId(place.appearance, 'interior', worldview), 'room');
      required.set(placeLayerId(place.appearance, 'interior-foreground', worldview), 'room');
    }
  }
  // Broad backplate yards already perform the environment-prop role. Logical
  // props are deliberately not materialized for this grammar, so they must
  // not create an unused asset requirement either.
  if (!isLateBroadComposition(plan)) {
    for (const prop of plan.props) {
      const recipe = worldview.props[prop.recipe];
      if (recipe) required.set(recipe.assetId, recipe.kind);
    }
  }
  for (const light of plan.lights) required.set(`${worldview.lightPrefix}${light.state}-v1`, 'light');
  for (const resident of plan.residents) required.set(residentAssetId(resident.appearance, worldview), 'character');
  for (const investigation of plan.investigations) required.set(`${worldview.cluePrefix}${investigation.target.recipe}-v1`, 'quest');
  if (plan.journey.transition?.state === 'observed') required.set(`${worldview.lightPrefix}lit-v1`, 'light');
  const environmentAssetId = selectedEnvironmentAssetId(plan);
  if (environmentAssetId) required.set(environmentAssetId, 'terrain');
  return required;
}

function assertCompleteWorldview(plan, manifest, worldview) {
  const manifestById = new Map((manifest.assets ?? []).map((asset) => [asset.id, asset]));
  const issues = [];
  // Completeness is judged against the composed town that this repository
  // actually produces. Requiring every authored role, including roles that do
  // not occur in the scene, turns the manifest into an asset-count target and
  // blocks a complete customer town for unrelated missing pictures.
  const required = requiredWorldviewAssets(plan, worldview);
  for (const [id, kind] of [...required].sort(([left], [right]) => left.localeCompare(right))) {
    const asset = manifestById.get(id);
    if (!asset) issues.push(issue('$.assets', 'WORLDVIEW_ASSET_MISSING', `${id} (${kind})`));
    else if (asset.usage?.kind !== kind) issues.push(issue(`$.assets.${id}.usage.kind`, 'WORLDVIEW_ROLE_INVALID', `expected ${kind}`));
    else if (kind === 'character') {
      const states = id === worldview.playerAssetId ? ['idle', 'walk', 'run'] : ['idle', 'walk', 'work'];
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
  const worldSize = {
    width: Math.max(VIEW_SIZE.width, Math.round(width + WORLD_MARGIN * 2)),
    height: Math.max(VIEW_SIZE.height, Math.round(height + WORLD_MARGIN * 2)),
  };
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
    // The browser view is the minimum playable frame. A compact repository
    // town still needs a full ground plane behind that frame, so extend only
    // the supplied world canvas when the authored bounds are narrower or
    // shorter than the view. Logical placements and collision stay unchanged.
    worldSize,
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
  if (geometry?.kind === 'polygon' && Array.isArray(geometry.points) && geometry.points.length >= 3
    && geometry.points.every(point)) {
    const xs = geometry.points.map((entry) => entry.x);
    const ys = geometry.points.map((entry) => entry.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
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
  const pivot = assets.get(entry?.assetId)?.pivot;
  if (!point(entry?.position) || !isRecord(frame) || !positive(frame.width) || !positive(frame.height)) return null;
  // Renderables already store the image's top-left position. Their authored
  // pivot is available separately as footPivot; subtracting it a second time
  // expands the camera bound by a full building and forces compact towns to
  // half scale.
  const position = point(entry?.footPivot) && point(pivot)
    ? entry.position
    : point(pivot)
      ? assetPosition(entry.position, { pivot })
      : entry.position;
  return { x: position.x, y: position.y, width: frame.width, height: frame.height };
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
  // The useful overview is the authored town and its visible props, not the
  // full padded ground canvas. Starting from placed/visible geometry prevents
  // a compact repository from shrinking to half scale just because the world
  // keeps safe follow-camera margins around it.
  let bounds = null;
  const include = (visible) => {
    if (!visible) return;
    bounds = bounds ? unionRect(bounds, visible) : clone(visible);
  };
  for (const surface of surfaces) {
    const visible = surfaceVisibleBounds(surface);
    // The ground is continuous, but the composition footprint is the useful
    // authored bound. Snow water deliberately leaves through the lower-right
    // world edge; its off-screen continuation must not zoom the whole harbor
    // out or turn the sea into a visible card. The bank, crossing, and dock
    // still define the visible shoreline.
    // Entrance approaches are canonical movement connectors.  Their pixels
    // are useful in the pattern-rendered fallback, but the adjacent live
    // structure is already included in the camera bound.  Counting the short
    // outward tails a second time can push an otherwise native-scale town to
    // 1/2 zoom, especially along the lower street wall.
    const navigationOnlyApproach = surface.id?.startsWith('surface.approach.');
    if (!navigationOnlyApproach
      && surface.recipe !== 'ground'
      && !(surface.recipe === 'water' && surface.geometry.kind === 'polygon')) include(visible);
  }
  for (const entry of renderables) {
    const visible = assetFrameBounds(entry, assets);
    include(visible);
  }
  for (const entry of npcs) {
    const visible = residentVisibleBounds(entry, assets);
    include(visible);
  }
  const playerFrame = playerAsset?.usage?.frame;
  if (point(spawn) && isRecord(playerFrame)) {
    include({ x: spawn.x, y: spawn.y, width: playerFrame.width, height: playerFrame.height });
  }
  if (!bounds) bounds = clone(transform.worldRect);
  // One modest visual margin keeps roofs and the arrival threshold off the
  // viewport edge without reintroducing the empty moat from logical packing.
  // A 16px gutter is one native ground tile quarter: enough to keep roofs off
  // the viewport edge without demoting a compact authored town to 1/2 scale.
  const visualMargin = 12;
  bounds = {
    x: bounds.x - visualMargin,
    y: bounds.y - visualMargin,
    width: bounds.width + visualMargin * 2,
    height: bounds.height + visualMargin * 2,
  };
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

function pixelPointRegion(center, radiusUnits, transform) {
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

function placeLayerId(appearance, layer, worldview) {
  if (!worldview.placeAppearances.includes(appearance)) {
    fail('PLACE_APPEARANCE_UNKNOWN', `place appearance ${appearance ?? 'unknown'} is not authored`, [
      issue('$.places.appearance', 'PLACE_APPEARANCE_UNKNOWN', String(appearance ?? 'unknown')),
    ]);
  }
  if (!['base', 'upper', 'foreground', 'interior', 'interior-foreground'].includes(layer)) {
    fail('PLACE_LAYER_UNKNOWN', `place layer ${layer} is not authored`, [
      issue('$.places.appearance', 'PLACE_LAYER_UNKNOWN', layer),
    ]);
  }
  return `${worldview.placePrefix}${appearance}--${layer}-v1`;
}

function residentAssetId(appearance, worldview) {
  if (!worldview.residentAppearances.includes(appearance)) {
    fail('RESIDENT_APPEARANCE_UNKNOWN', `resident appearance ${appearance ?? 'unknown'} is not authored`, [
      issue('$.residents.appearance', 'RESIDENT_APPEARANCE_UNKNOWN', String(appearance ?? 'unknown')),
    ]);
  }
  return `${worldview.residentPrefix}${appearance}-v1`;
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

function chamferedSurface(rectangle) {
  // A civic pocket is a surface, not a rectangular texture card. Keep the
  // centre and all four approach directions open, then cut the corners with
  // small asymmetric steps so the authored material settles into the ground.
  const cutX = Math.min(32, Math.max(16, Math.round(rectangle.width * 0.14)));
  const cutY = Math.min(24, Math.max(14, Math.round(rectangle.height * 0.18)));
  return {
    kind: 'polygon',
    points: [
      { x: rectangle.x + cutX, y: rectangle.y },
      { x: rectangle.x + rectangle.width - cutX * 0.8, y: rectangle.y },
      { x: rectangle.x + rectangle.width - cutX * 0.35, y: rectangle.y + cutY * 0.55 },
      { x: rectangle.x + rectangle.width, y: rectangle.y + cutY * 1.15 },
      { x: rectangle.x + rectangle.width - cutX * 0.65, y: rectangle.y + rectangle.height - cutY * 0.85 },
      { x: rectangle.x + rectangle.width - cutX * 1.25, y: rectangle.y + rectangle.height },
      { x: rectangle.x + cutX * 1.05, y: rectangle.y + rectangle.height },
      { x: rectangle.x + cutX * 0.45, y: rectangle.y + rectangle.height - cutY * 1.1 },
      { x: rectangle.x, y: rectangle.y + rectangle.height - cutY * 0.55 },
      { x: rectangle.x + cutX * 0.35, y: rectangle.y + cutY * 0.65 },
    ].map((entry) => ({ x: Math.round(entry.x), y: Math.round(entry.y) })),
  };
}

function surfacePathStyle(recipe) {
  const shoreLike = recipe === 'water' || recipe === 'bank' || recipe === 'crossing';
  return {
    cap: shoreLike ? 'butt' : 'round',
    join: recipe === 'crossing' ? 'miter' : 'round',
  };
}

function snowHarborWaterSurface(points, width, worldSize) {
  // The harbour is a shoreline, not a thick painted line. Its sea edge runs
  // to the right world boundary while the inland end forms one shallow cove
  // beneath the dock. The bank follows the same upper contour, so there is no
  // exposed rectangular water-card corner.
  const from = points[0];
  const to = points.at(-1);
  const half = width / 2;
  const inset = Math.min(28, Math.max(14, Math.round(width * 0.28)));
  const right = Math.max(worldSize?.width ?? 0, to.x + width);
  const bottom = Math.max(worldSize?.height ?? 0, to.y + width);
  return {
    kind: 'polygon',
    points: [
      { x: from.x + inset, y: from.y - half },
      { x: right + width, y: to.y - half * 0.75 },
      { x: right + width, y: bottom + width },
      { x: from.x + inset * 1.25, y: bottom + width },
      { x: from.x, y: from.y + half * 0.65 },
      { x: from.x - half * 0.2, y: from.y },
      { x: from.x, y: from.y - half * 0.65 },
    ].map((entry) => ({ x: Math.round(entry.x), y: Math.round(entry.y) })),
  };
}

function materializeSurfaces(plan, transform, art, worldview) {
  const surfaces = [];
  for (const [index, source] of plan.surfaces.entries()) {
    const recipe = worldview.surfaces[source.recipe];
    if (!recipe) fail('SURFACE_RECIPE_UNKNOWN', `surface recipe ${source.recipe} is not part of ${worldview.id}`, [issue(`$.surfaces[${index}].recipe`, 'SURFACE_RECIPE_UNKNOWN', source.recipe)]);
    const asset = art.get(recipe.assetId, recipe.kind);
    const geometry = source.geometry;
    let compiledGeometry;
    if (geometry?.kind === 'area') {
      const area = source.recipe === 'ground'
        ? { x: 0, y: 0, width: transform.worldSize.width, height: transform.worldSize.height }
        : pixelRect(geometry.bounds ?? geometry, transform, `$.surfaces[${index}].geometry`);
      const authoredPrecinct = source.id.startsWith('surface.precinct.');
      compiledGeometry = {
        ...((source.recipe === 'plaza' || authoredPrecinct)
          ? chamferedSurface(area)
          : { kind: 'area', rect: area }),
      };
    } else if (geometry?.kind === 'path' && Array.isArray(geometry.points) && geometry.points.length >= 2) {
      const points = geometry.points.map((value) => transform.point(value));
      const width = transform.distance(geometry.width ?? source.width);
      compiledGeometry = {
        ...(worldview.id === 'snow-harbor-night' && source.recipe === 'water'
          ? snowHarborWaterSurface(points, width, transform.worldSize)
          : { kind: 'path', points, width, ...surfacePathStyle(source.recipe) }),
      };
    } else {
      fail('SURFACE_GEOMETRY_INVALID', `surface ${source.id} needs an area or path`, [issue(`$.surfaces[${index}].geometry`, 'SURFACE_GEOMETRY_INVALID', 'area or path required')]);
    }
    surfaces.push({
      id: source.id,
      recipe: source.recipe,
      assetId: asset.id,
      z: recipe.z,
      blocked: recipe.blocked,
      walkable: SURFACE_WALKABILITY[source.recipe],
      opacity: recipe.opacity,
      geometry: compiledGeometry,
    });
  }

  // Approaches are explicit route surfaces, not an inferred mask and not a
  // property of the building collision.  Every place owns one stable ID based
  // on its WorldPlan place ID; sorting below then gives deterministic depth and
  // ID order regardless of source array ordering.
  const approachRecipe = worldview.surfaces.local_route;
  if (!approachRecipe) {
    fail('SURFACE_RECIPE_UNKNOWN', `worldview ${worldview.id} has no local_route approach recipe`, [
      issue('$.worldview.surfaces.local_route', 'SURFACE_RECIPE_UNKNOWN', 'local_route recipe required for place approaches'),
    ]);
  }
  const approachAsset = art.get(approachRecipe.assetId, approachRecipe.kind);
  const places = [...plan.places].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  for (const place of places) {
    const entrance = place.geometry?.entrance;
    const approach = entrance?.approach;
    if (!Array.isArray(approach) || approach.length < 2 || !approach.every(point)) {
      fail('PLACE_APPROACH_INVALID', `${place.id} needs a logical entrance approach path`, [
        issue(`$.places.${place.id}.geometry.entrance.approach`, 'PLACE_APPROACH_INVALID', 'at least two logical points are required'),
      ]);
    }
    if (!positive(entrance.width)) {
      fail('PLACE_APPROACH_INVALID', `${place.id} needs a positive entrance width`, [
        issue(`$.places.${place.id}.geometry.entrance.width`, 'PLACE_APPROACH_INVALID', 'a positive logical width is required'),
      ]);
    }
    const points = approach.map((value) => transform.point(value));
    surfaces.push({
      id: `surface.approach.${place.id}`,
      recipe: 'local_route',
      assetId: approachAsset.id,
      z: approachRecipe.z,
      blocked: false,
      walkable: true,
      opacity: approachRecipe.opacity,
      geometry: {
        kind: 'path',
        points,
        width: transform.distance(entrance.width),
        ...surfacePathStyle('local_route'),
      },
    });
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

function materializePlaces(plan, transform, art, worldview) {
  const renderables = [];
  const collisions = [];
  const interiors = [];
  const structureShadows = [];
  const placeGeometry = new Map();
  for (const place of plan.places) {
    const footprint = pixelRect(place.footprint, transform, `$.places.${place.id}.footprint`);
    const anchor = { x: footprint.x + footprint.width / 2, y: footprint.y + footprint.height };
    const entrance = place.geometry?.entrance?.point
      ? transform.point(place.geometry.entrance.point)
      : anchor;
    const access = place.geometry?.access?.region
      ? geometryRect(place.geometry.access.region, transform, `$.places.${place.id}.geometry.access.region`)
      : null;
    const approach = placeApproach(place, transform);
    // Reports must be reachable on the same plane as the report place. For a
    // cutaway building the authored entrance is the reliable interaction
    // centre; the footprint's lower anchor can sit outside the interior floor.
    const interaction = pointRegion(place.geometry?.interior?.entrance ?? place.geometry?.entrance?.point ?? place.anchor, transform, 1.75);
    placeGeometry.set(place.id, { footprint, anchor, entrance, access, approach, interaction, interiorId: null });
    if (!nonEmpty(place.appearance)) continue;
    const base = art.get(placeLayerId(place.appearance, 'base', worldview), 'building');
    const upper = art.get(placeLayerId(place.appearance, 'upper', worldview), 'building');
    const foreground = art.get(placeLayerId(place.appearance, 'foreground', worldview), 'building');
    const needsInterior = place.requirements?.distinctInterior === true;
    if (needsInterior && place.geometry?.interior?.kind !== 'cutaway') {
      fail('PLACE_INTERIOR_GEOMETRY_MISSING', `${place.id} requires a cutaway footprint`);
    }
    const interior = needsInterior
      ? art.get(placeLayerId(place.appearance, 'interior', worldview), 'room')
      : null;
    const interiorForeground = needsInterior
      ? art.get(placeLayerId(place.appearance, 'interior-foreground', worldview), 'room')
      : null;
    assertPlaceLayers(place, [base, upper, foreground, ...(interior ? [interior, interiorForeground] : [])]);
    // Some authored sheets keep a small transparent snow or ground margin
    // below the pivot. Shift the visual layer anchor only when that margin
    // would leave the declared footprint uncovered. Logical anchors and
    // collision stay unchanged.
    const layerAnchor = {
      x: anchor.x,
      y: anchor.y - Math.max(0, footprint.height - base.pivot.y),
    };
    const basePosition = assetPosition(layerAnchor, base);
    const upperPosition = assetPosition(layerAnchor, upper);
    const foregroundPosition = assetPosition(layerAnchor, foreground);
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
    // The transient backplate needs one contact-shadow footprint for each
    // exterior structure. Keep this tied to the same authored base
    // renderable and logical footprint that drive collision and placement.
    // Interior layers, actors, props, and effects are dynamic and stay out of
    // this first-pass static surface contract.
    structureShadows.push({
      renderableId: `structure-base:${place.id}`,
      footprint: clone(footprint),
    });
    if (interior) {
      if (!access) fail('INTERIOR_ACCESS_REQUIRED', `${place.id} has an interior without an access region`, [issue(`$.places.${place.id}.geometry.access`, 'INTERIOR_ACCESS_REQUIRED', 'access required')]);
      const bounds = geometryRect(place.geometry.interior.footprint, transform, `$.places.${place.id}.geometry.interior.footprint`);
      const interiorPosition = assetPosition(layerAnchor, interior);
      const interiorForegroundPosition = assetPosition(layerAnchor, interiorForeground);
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
    } else if (place.facilityKind === 'gate' && access) {
      // The arrival gate is an outdoor threshold, not a sealed building or a
      // detached room. Its authored passage remains walkable so the visible
      // way into town agrees with collision and the entry clue can be reached.
      // The player footbox is taller than the narrow bottom access region. Cut
      // the passage through the whole gate footprint, or the upper lintel
      // blocks the player while crossing the visible opening.
      const passage = intersectRect(footprint, {
        x: access.x,
        y: footprint.y,
        width: access.width,
        height: footprint.height,
      });
      collisions.push(...subtractRect(footprint, passage ?? access));
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
  return { renderables, collisions, interiors, placeGeometry, structureShadows };
}

function materializeProps(plan, transform, art, worldview, { includePlanProps = true } = {}) {
  const renderables = [];
  const collisions = [];
  // Snow harbor uses visible clue and light roles for its authored street
  // language. Ignore the late-medieval generic props from the logical plan.
  // This is an explicit recipe choice, not a fallback to another prop set.
  if (includePlanProps && Object.keys(worldview.props).length > 0) {
    for (const prop of plan.props) {
      const recipe = worldview.props[prop.recipe];
      if (!recipe) fail('PROP_RECIPE_UNKNOWN', `prop recipe ${prop.recipe} is not part of ${worldview.id}`, [issue(`$.props.${prop.id}.recipe`, 'PROP_RECIPE_UNKNOWN', prop.recipe)]);
      const asset = art.get(recipe.assetId, recipe.kind);
      const anchor = transform.point(prop.anchor);
      const position = assetPosition(anchor, asset);
      renderables.push({ id: `prop:${prop.id}`, assetId: asset.id, position, footPivot: clone(asset.pivot), z: 40, plane: 'depth' });
      collisions.push(...absoluteUsageRects(asset, position));
    }
  }
  for (const light of plan.lights) {
    const asset = art.get(`${worldview.lightPrefix}${light.state}-v1`, 'light');
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

function pointInPolygon(value, polygon) {
  if (!point(value) || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    const crosses = (current.y > value.y) !== (prior.y > value.y)
      && value.x < ((prior.x - current.x) * (value.y - current.y)) / (prior.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonIntersectsRect(polygon, rectangle) {
  if (!Array.isArray(polygon) || polygon.length < 3 || !rect(rectangle)) return false;
  const corners = [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x, y: rectangle.y + rectangle.height },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
  ];
  if (corners.some((corner) => pointInPolygon(corner, polygon)) || polygon.some((entry) => pointInRect(entry, rectangle))) return true;
  for (let index = 1; index <= polygon.length; index += 1) {
    if (segmentIntersectsRect(polygon[index - 1], polygon[index % polygon.length], rectangle)) return true;
  }
  return false;
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
      : geometry?.kind === 'polygon'
        ? polygonIntersectsRect(geometry.points, body)
      : geometry?.kind === 'path' && geometry.points?.some((pointValue, index) => index > 0
        && segmentDistanceToRect(geometry.points[index - 1], pointValue, body) <= geometry.width / 2);
    if (hit && !crossings.some((crossing) => {
      const crossingGeometry = crossing.geometry;
      return crossingGeometry?.kind === 'area'
        ? overlaps(crossingGeometry.rect, body)
        : crossingGeometry?.kind === 'polygon'
          ? polygonIntersectsRect(crossingGeometry.points, body)
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
    if (geometry?.kind === 'polygon') return polygonIntersectsRect(geometry.points, body);
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

function materializeResidents(plan, transform, art, placeGeometry, interiors, surfaces, existingWorldCollisions, worldview) {
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
    const asset = art.get(residentAssetId(resident.appearance, worldview), 'character');
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

function materializeInvestigations(plan, transform, art, placeGeometry, interiors, worldview) {
  const quests = [];
  const renderables = [];
  const interiorCollisionById = new Map();
  const interiorById = new Map(interiors.map((interior) => [interior.id, interior]));
  for (const [index, investigation] of plan.investigations.entries()) {
    const place = placeGeometry.get(investigation.placeId);
    if (!place) fail('INVESTIGATION_PLACE_REQUIRED', `${investigation.id} place is not materialized`);
    const interior = place.interiorId ? interiorById.get(place.interiorId) : null;
    if (place.interiorId && !interior) fail('INVESTIGATION_INTERIOR_REQUIRED', `${investigation.id} interior is not materialized`);
    const asset = art.get(`${worldview.cluePrefix}${investigation.target.recipe}-v1`, 'quest');
    const requestedAnchor = transform.point(investigation.target.anchor);
    // Outdoor props remain solid. Worldgen keeps the semantic target inside
    // its place footprint, but the clue must be visible and reachable from
    // the authored approach. Keep the same place and its meaning while
    // placing the visible clue at the entrance when no cutaway exists.
    const anchor = interior
      ? requestedAnchor
      : place.entrance
        ? { x: place.entrance.x, y: place.entrance.y - transform.distance(1) }
        : requestedAnchor;
    const position = assetPosition(anchor, asset);
    const authoredCollisions = absoluteUsageRects(asset, position);
    if (interior && authoredCollisions.some((entry) => !containsRect(interior.bounds, entry))) {
      fail('INVESTIGATION_GEOMETRY_MISMATCH', `${investigation.id} authored collision must remain inside its interior`);
    }
    if (interior) {
      interiorCollisionById.set(place.interiorId, [
        ...(interiorCollisionById.get(place.interiorId) ?? []),
        ...authoredCollisions,
      ]);
    }
    // The well is already the visible, place-specific water-source clue.
    // Drawing the separate cyan probe beside it turned an ordinary world
    // object into a diagnostic marker and duplicated the thing the player is
    // meant to inspect. Keep the quest region and its truth-preserving copy;
    // only the redundant outdoor marker is omitted.
    if (interior || investigation.target.recipe !== 'water-source') {
      renderables.push({
        id: `clue:${investigation.id}`,
        assetId: asset.id,
        position,
        footPivot: clone(asset.pivot),
        z: 48,
        plane: 'depth',
        ...(place.interiorId ? { interiorId: place.interiorId } : {}),
      });
    }
    quests.push({
      id: investigation.id,
      placeId: investigation.placeId,
      rect: interior
        ? pointRegion(investigation.target.anchor, transform, investigation.target.reach)
        : pixelPointRegion(anchor, investigation.target.reach, transform),
      subject: investigation.subject,
      action: investigation.action,
      statement: investigation.statement,
      state: investigation.state,
      evidenceAddresses: evidenceAddresses(investigation.evidence, `$.investigations[${index}].evidence`),
      ...(place.interiorId ? { interiorId: place.interiorId } : {}),
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

function materializeEffect(plan, transform, art, placeGeometry, worldview) {
  if (!plan.journey.transition || plan.journey.transition.state !== 'observed') fail('TOWN_CHANGE_REQUIRED', 'the observed town-hall change is required');
  const target = placeGeometry.get(plan.journey.townHallLanternPlaceId);
  if (!target) fail('TOWN_CHANGE_PLACE_MISSING', 'the observed town change has no placed town hall');
  const light = plan.lights.find((entry) => entry.reportState?.transitionId === plan.journey.transition.id);
  if (!light) fail('TOWN_CHANGE_LIGHT_MISSING', 'the observed town change has no placed lantern state');
  const asset = art.get(`${worldview.lightPrefix}lit-v1`, 'light');
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

function materializeGame(plan, transform, art, worldview) {
  const playerAsset = art.get(worldview.playerAssetId, 'character');
  art.get(worldview.dialogueAssetId, 'ui');
  art.get(worldview.reportAssetId, 'ui');
  art.get(worldview.exitAssetId, 'ui');
  const broadEnvironment = isLateBroadComposition(plan);
  const environmentAssetId = selectedEnvironmentAssetId(plan);
  const environmentAsset = environmentAssetId ? art.get(environmentAssetId, 'terrain') : null;
  if (environmentAsset
    && (environmentAsset.dimensions.width !== transform.worldSize.width
      || environmentAsset.dimensions.height !== transform.worldSize.height)) {
    fail('ENVIRONMENT_DIMENSIONS_MISMATCH', 'the authored environment must cover the complete compiled world', [
      issue(`$.assets.${environmentAsset.id}.dimensions`, 'ENVIRONMENT_DIMENSIONS_MISMATCH', `expected ${transform.worldSize.width}x${transform.worldSize.height}`),
    ]);
  }
  const surfaces = materializeSurfaces(plan, transform, art, worldview);
  const places = materializePlaces(plan, transform, art, worldview);
  const investigations = materializeInvestigations(plan, transform, art, places.placeGeometry, places.interiors, worldview);
  // Investigation clues are authored interior solids. Apply their collision
  // rectangles before resident validation so indoor workers cannot be placed
  // on a clue that was materialized later in the old order.
  for (const [interiorId, clueCollisions] of investigations.interiorCollisionById.entries()) {
    const interior = places.interiors.find((entry) => entry.id === interiorId);
    if (!interior) fail('INVESTIGATION_INTERIOR_REQUIRED', `${interiorId} is not materialized`);
    interior.collisions.push(...clueCollisions);
  }
  const props = materializeProps(plan, transform, art, worldview, { includePlanProps: !broadEnvironment });
  const npcs = materializeResidents(
    plan,
    transform,
    art,
    places.placeGeometry,
    places.interiors,
    surfaces.surfaces,
    [...places.collisions, ...props.collisions],
    worldview,
  );
  const journey = materializeJourney(plan, places.placeGeometry, investigations.quests);
  const effect = materializeEffect(plan, transform, art, places.placeGeometry, worldview);
  const footbox = clone(playerAsset.usage.collision);
  if (footbox?.kind !== 'rect') fail('PLAYER_FOOTBOX_REQUIRED', 'player art must declare one authored footbox');
  delete footbox.kind;
  const spawnFoot = transform.point(plan.composition.spawn);
  const spawn = { x: spawnFoot.x - footbox.x - footbox.width / 2, y: spawnFoot.y - footbox.y - footbox.height / 2 };
  const renderables = [...places.renderables, ...investigations.renderables, ...props.renderables, ...(effect ? [effect] : [])]
    .sort((left, right) => left.z - right.z || left.id.localeCompare(right.id));
  const backplate = {
    version: 1,
    environmentAssetId: environmentAsset?.id ?? null,
    // materializeSurfaces has already sorted by authored depth and stable ID.
    // Keep the exact order so a renderer can cache one transient raster
    // without reinterpreting the logical world.
    surfaceIds: environmentAsset ? [] : surfaces.surfaces.map((surface) => surface.id),
    structureShadows: places.structureShadows
      .slice()
      .sort((left, right) => left.renderableId.localeCompare(right.renderableId)),
    // No renderable is static in the first pass. Buildings, roofs, interiors,
    // foreground, actors, clues, lights, and effects remain dynamic.
    staticRenderableIds: [],
  };
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
  // Broad surface pixels are hidden behind the selected environment and must
  // not enlarge its overview. The broad hall lantern and its completed-state
  // effect remain live renderables, but their tall glow frames are decoration
  // above the hall roof rather than composition bounds.
  const cameraRenderables = broadEnvironment
    ? renderables.filter((entry) => entry.id !== 'light:light.town-hall-lantern'
      && entry.id !== `effect:${REPOSITORY_INSPECTION_BINDING.effect}`)
    : renderables;
  const camera = materializeCamera(transform, art, {
    surfaces: broadEnvironment ? [] : surfaces.surfaces,
    renderables: cameraRenderables,
    npcs: npcs.npcs,
    playerAsset,
    spawn,
  });
  return {
    viewSize: clone(VIEW_SIZE),
    worldSize: clone(transform.worldSize),
    camera,
    ui: clone(uiContract(worldview)),
    spawn,
    player: { assetId: playerAsset.id, footbox, speeds: clone(GAME_SPEEDS) },
    surfaces: surfaces.surfaces,
    backplate,
    collisions,
    interiors: places.interiors.sort(compareId),
    npcs: npcs.npcs,
    quests: journey.quests,
    request: journey.request,
    report: journey.report,
    renderables,
  };
}

/** Compile one validated logical town through its selected complete worldview. */
export function compileScene({ worldPlan, assetManifest, assetRoot } = {}) {
  const plan = validatedWorldPlan(worldPlan);
  const worldview = worldviewRecipe(plan.worldview?.id);
  if (!nonEmpty(assetRoot)) fail('ASSET_ROOT_REQUIRED', 'assetRoot is required');
  let manifest;
  try {
    manifest = validateAssetManifest(assetManifest, assetRoot);
  } catch (error) {
    fail('ASSET_MANIFEST_INVALID', error.message, error.issues ?? [issue('$', 'ASSET_MANIFEST_INVALID', 'shipping manifest is invalid')]);
  }
  assertCompleteWorldview(plan, manifest, worldview);
  const art = createArtResolver(manifest, assetRoot);
  const transform = makeTransform(plan);
  const game = materializeGame(plan, transform, art, worldview);
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

function validateBackplate(value, game, assetById, path, issues) {
  if (!isRecord(value)) {
    issues.push(issue(path, 'BACKPLATE_REQUIRED', 'transient backplate contract is required'));
    return;
  }
  rejectUnknownKeys(value, ['version', 'environmentAssetId', 'surfaceIds', 'structureShadows', 'staticRenderableIds'], path, issues);
  if (value.version !== 1) issues.push(issue(`${path}.version`, 'BACKPLATE_VERSION_INVALID', 'backplate version must be 1'));

  const hasEnvironment = typeof value.environmentAssetId === 'string' && value.environmentAssetId.trim() !== '';
  if (value.environmentAssetId !== null && !hasEnvironment) {
    issues.push(issue(`${path}.environmentAssetId`, 'BACKPLATE_ENVIRONMENT_ID_INVALID', 'environment asset ID must be a non-empty string or null'));
  }
  if (hasEnvironment) {
    const asset = assetById?.get(value.environmentAssetId);
    if (!asset) {
      issues.push(issue(`${path}.environmentAssetId`, 'BACKPLATE_ENVIRONMENT_ASSET_UNKNOWN', value.environmentAssetId));
    } else {
      if (asset.usage?.kind !== 'terrain') {
        issues.push(issue(`${path}.environmentAssetId`, 'BACKPLATE_ENVIRONMENT_ASSET_KIND_INVALID', 'environment asset must use terrain material'));
      }
      if (!isRecord(game?.worldSize)
        || asset.dimensions?.width !== game.worldSize.width
        || asset.dimensions?.height !== game.worldSize.height) {
        issues.push(issue(`${path}.environmentAssetId`, 'BACKPLATE_ENVIRONMENT_DIMENSIONS_INVALID', 'environment asset dimensions must equal game.worldSize'));
      }
    }
  }

  const surfaces = Array.isArray(game?.surfaces) ? game.surfaces : [];
  const surfaceById = new Map();
  surfaces.forEach((surface, index) => {
    if (!isRecord(surface) || !nonEmpty(surface.id)) return;
    if (surfaceById.has(surface.id)) {
      issues.push(issue(`$.game.surfaces[${index}].id`, 'SURFACE_ID_DUPLICATE', surface.id));
      return;
    }
    surfaceById.set(surface.id, surface);
  });
  if (!Array.isArray(value.surfaceIds)) {
    issues.push(issue(`${path}.surfaceIds`, 'BACKPLATE_SURFACE_IDS_REQUIRED', 'surface IDs must be an array'));
  } else {
    const seen = new Set();
    value.surfaceIds.forEach((id, index) => {
      const entryPath = `${path}.surfaceIds[${index}]`;
      if (!nonEmpty(id)) {
        issues.push(issue(entryPath, 'BACKPLATE_SURFACE_ID_INVALID', 'surface ID must be a non-empty string'));
        return;
      }
      if (seen.has(id)) issues.push(issue(entryPath, 'BACKPLATE_SURFACE_ID_DUPLICATE', id));
      seen.add(id);
      if (!surfaceById.has(id)) issues.push(issue(entryPath, 'BACKPLATE_SURFACE_ID_UNKNOWN', id));
    });
    if (hasEnvironment) {
      if (value.surfaceIds.length !== 0) {
        issues.push(issue(`${path}.surfaceIds`, 'BACKPLATE_SURFACE_IDS_WITH_ENVIRONMENT', 'surface IDs must be empty when an environment asset is selected'));
      }
    } else {
      if (value.surfaceIds.length !== surfaces.length) {
        issues.push(issue(`${path}.surfaceIds`, 'BACKPLATE_SURFACE_SET_INVALID', 'backplate must reference every compiled surface exactly once'));
      }
      const validSurfaces = surfaces.filter((surface) => isRecord(surface) && nonEmpty(surface.id) && finite(surface.z));
      const expectedOrder = validSurfaces
        .slice()
        .sort((left, right) => left.z - right.z || String(left.id).localeCompare(String(right.id)))
        .map((surface) => surface.id);
      if (expectedOrder.length === surfaces.length
        && (expectedOrder.length !== value.surfaceIds.length
          || expectedOrder.some((id, index) => value.surfaceIds[index] !== id))) {
        issues.push(issue(`${path}.surfaceIds`, 'BACKPLATE_SURFACE_ORDER_INVALID', 'surface IDs must use stable z/id order'));
      }
    }
  }

  const renderables = Array.isArray(game?.renderables) ? game.renderables : [];
  const renderableById = new Map();
  renderables.forEach((renderable, index) => {
    if (!isRecord(renderable) || !nonEmpty(renderable.id)) return;
    if (renderableById.has(renderable.id)) {
      issues.push(issue(`$.game.renderables[${index}].id`, 'RENDERABLE_ID_DUPLICATE', renderable.id));
      return;
    }
    renderableById.set(renderable.id, renderable);
  });
  const expectedStructureIds = renderables
    .filter((renderable) => nonEmpty(renderable?.id) && renderable.id.startsWith('structure-base:'))
    .map((renderable) => renderable.id)
    .sort((left, right) => left.localeCompare(right));
  if (!Array.isArray(value.structureShadows)) {
    issues.push(issue(`${path}.structureShadows`, 'BACKPLATE_STRUCTURE_SHADOWS_REQUIRED', 'structure shadows must be an array'));
  } else {
    const seen = new Set();
    value.structureShadows.forEach((shadow, index) => {
      const entryPath = `${path}.structureShadows[${index}]`;
      if (!isRecord(shadow)) {
        issues.push(issue(entryPath, 'BACKPLATE_STRUCTURE_SHADOW_INVALID', 'structure shadow must be an object'));
        return;
      }
      rejectUnknownKeys(shadow, ['renderableId', 'footprint'], entryPath, issues);
      if (!nonEmpty(shadow.renderableId)) {
        issues.push(issue(`${entryPath}.renderableId`, 'BACKPLATE_STRUCTURE_SHADOW_ID_INVALID', 'structure shadow renderable ID is required'));
      } else {
        if (seen.has(shadow.renderableId)) issues.push(issue(`${entryPath}.renderableId`, 'BACKPLATE_STRUCTURE_SHADOW_ID_DUPLICATE', shadow.renderableId));
        seen.add(shadow.renderableId);
        const renderable = renderableById.get(shadow.renderableId);
        if (!renderable) {
          issues.push(issue(`${entryPath}.renderableId`, 'BACKPLATE_STRUCTURE_SHADOW_RENDERABLE_UNKNOWN', shadow.renderableId));
        } else if (!shadow.renderableId.startsWith('structure-base:') || renderable.plane !== 'ground') {
          issues.push(issue(`${entryPath}.renderableId`, 'BACKPLATE_STRUCTURE_SHADOW_RENDERABLE_INVALID', 'only exterior structure base renderables can provide contact shadows'));
        }
      }
      if (!rect(shadow.footprint)) issues.push(issue(`${entryPath}.footprint`, 'BACKPLATE_STRUCTURE_SHADOW_FOOTPRINT_INVALID', 'a positive pixel footprint is required'));
    });
    if (value.structureShadows.length !== expectedStructureIds.length) {
      issues.push(issue(`${path}.structureShadows`, 'BACKPLATE_STRUCTURE_SHADOW_SET_INVALID', 'one contact shadow is required for each exterior structure base'));
    }
    const actualIds = value.structureShadows.filter((shadow) => nonEmpty(shadow?.renderableId)).map((shadow) => shadow.renderableId).sort((left, right) => left.localeCompare(right));
    if (actualIds.length !== expectedStructureIds.length
      || expectedStructureIds.some((id, index) => actualIds[index] !== id)) {
      issues.push(issue(`${path}.structureShadows`, 'BACKPLATE_STRUCTURE_SHADOW_SET_INVALID', 'structure shadows must cover exactly the exterior structure bases'));
    }
    const listedIds = value.structureShadows.filter((shadow) => nonEmpty(shadow?.renderableId)).map((shadow) => shadow.renderableId);
    if (listedIds.some((id, index) => id !== expectedStructureIds[index])) {
      issues.push(issue(`${path}.structureShadows`, 'BACKPLATE_STRUCTURE_SHADOW_ORDER_INVALID', 'structure shadows must use stable renderable ID order'));
    }
  }

  if (!Array.isArray(value.staticRenderableIds)) {
    issues.push(issue(`${path}.staticRenderableIds`, 'BACKPLATE_STATIC_IDS_REQUIRED', 'static renderable IDs must be an array'));
  } else {
    const seen = new Set();
    value.staticRenderableIds.forEach((id, index) => {
      const entryPath = `${path}.staticRenderableIds[${index}]`;
      if (!nonEmpty(id)) issues.push(issue(entryPath, 'BACKPLATE_STATIC_ID_INVALID', 'static renderable ID must be a non-empty string'));
      else {
        if (seen.has(id)) issues.push(issue(entryPath, 'BACKPLATE_STATIC_ID_DUPLICATE', id));
        seen.add(id);
        if (!renderableById.has(id)) issues.push(issue(entryPath, 'BACKPLATE_STATIC_ID_UNKNOWN', id));
      }
    });
    if (value.staticRenderableIds.length !== 0) {
      issues.push(issue(`${path}.staticRenderableIds`, 'BACKPLATE_STATIC_IDS_UNSUPPORTED', 'the first backplate pass keeps every renderable dynamic'));
    }
  }
}

function validateGame(value, assetIds, assetById, issues) {
  if (!isRecord(value)) { issues.push(issue('$.game', 'GAME_INVALID', 'game must be an object')); return; }
  if (!isRecord(value.viewSize) || !positive(value.viewSize.width) || !positive(value.viewSize.height)) issues.push(issue('$.game.viewSize', 'VIEW_INVALID', 'view size required'));
  if (!isRecord(value.worldSize) || !positive(value.worldSize.width) || !positive(value.worldSize.height)) issues.push(issue('$.game.worldSize', 'WORLD_SIZE_INVALID', 'world size required'));
  validateCamera(value.camera, '$.game.camera', value.viewSize, issues);
  if (!point(value.spawn)) issues.push(issue('$.game.spawn', 'SPAWN_INVALID', 'spawn required'));
  if (!isRecord(value.player) || !assetIds.has(value.player.assetId) || !rect(value.player.footbox)) issues.push(issue('$.game.player', 'PLAYER_INVALID', 'player asset and footbox required'));
  validateBackplate(value.backplate, value, assetById, '$.game.backplate', issues);
  const uiPath = '$.game.ui';
  if (!isRecord(value.ui)) {
    issues.push(issue(uiPath, 'UI_REQUIRED', 'framed dialogue, report, and exit UI contracts are required'));
  } else {
    rejectUnknownKeys(value.ui, ['frame', 'dialogue', 'report', 'exit'], uiPath, issues);
    if (!isRecord(value.ui.frame) || value.ui.frame.width !== UI_FRAME_SIZE.width || value.ui.frame.height !== UI_FRAME_SIZE.height) {
      issues.push(issue(`${uiPath}.frame`, 'UI_FRAME_INVALID', 'the UI frame must be exactly 384 by 216 logical pixels'));
    }
    for (const kind of ['dialogue', 'report', 'exit']) {
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
    const path = `$.game.surfaces[${index}]`;
    rejectUnknownKeys(surface, ['id', 'recipe', 'assetId', 'z', 'blocked', 'walkable', 'opacity', 'geometry'], path, issues);
    if (!isRecord(surface) || !nonEmpty(surface.id) || !nonEmpty(surface.recipe) || !assetIds.has(surface.assetId)
      || !finite(surface.z) || typeof surface.blocked !== 'boolean' || typeof surface.walkable !== 'boolean'
      || !finite(surface.opacity) || surface.opacity <= 0 || surface.opacity > 1 || !isRecord(surface.geometry)) {
      issues.push(issue(path, 'SURFACE_INVALID', 'surface role, asset, depth, movement, and geometry are required'));
      return;
    }
    if (!own(SURFACE_WALKABILITY, surface.recipe)) {
      issues.push(issue(`${path}.recipe`, 'SURFACE_RECIPE_INVALID', `unsupported surface recipe ${surface.recipe}`));
    } else if (surface.walkable !== SURFACE_WALKABILITY[surface.recipe]) {
      issues.push(issue(`${path}.walkable`, 'SURFACE_WALKABILITY_INVALID', `${surface.recipe} walkability must be ${SURFACE_WALKABILITY[surface.recipe]}`));
    }
    const geometry = surface.geometry;
    const validArea = geometry.kind === 'area' && rect(geometry.rect);
    const validPolygon = geometry.kind === 'polygon' && Array.isArray(geometry.points)
      && geometry.points.length >= 3 && geometry.points.every((entry) => point(entry));
    const validPath = geometry.kind === 'path' && Array.isArray(geometry.points)
      && geometry.points.length >= 2 && geometry.points.every((entry) => point(entry))
      && positive(geometry.width)
      && (!own(geometry, 'cap') || ['butt', 'round', 'square'].includes(geometry.cap))
      && (!own(geometry, 'join') || ['bevel', 'miter', 'round'].includes(geometry.join));
    if (!validArea && !validPolygon && !validPath) {
      issues.push(issue(`$.game.surfaces[${index}].geometry`, 'SURFACE_GEOMETRY_INVALID', 'surface geometry invalid'));
    }
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
  const assetById = new Map();
  if (!Array.isArray(bundle.assets) || bundle.assets.length === 0) issues.push(issue('$.assets', 'ASSETS_REQUIRED', 'shipping assets required'));
  else bundle.assets.forEach((asset, index) => {
    validateAsset(asset, `$.assets[${index}]`, assetIds, issues);
    if (nonEmpty(asset?.id)) assetById.set(asset.id, asset);
  });
  validateGame(bundle.game, assetIds, assetById, issues);
  return { ok: issues.length === 0, issues };
}
