// C-01–C-06: repository places become one connected street, with all geometry
// expressed in the same world coordinates. Asset IDs refer to existing art;
// rendering, input, and repository interpretation belong to other modules.
import { TOWN_PLACE_CAPACITY } from '../30-town-domain/index.mjs';

const point = (x, y) => ({ x, y });
const rect = (x, y, width, height) => ({ x, y, width, height });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const WORLD_SCALE = 1;
const APPEARANCES = {
  'development-work': ['workshop'],
  feature: ['dwelling-gabled', 'dwelling-tall', 'dwelling-stone'],
  module: ['guild', 'dwelling-stone', 'dwelling-tall-narrow'],
  component: ['dwelling-stone-bay', 'dwelling-tall-narrow'],
  ui: ['shop', 'dwelling-stone-bay'],
};
// Front-door anchors on the authored compact neighbourhood's empty parcels.
// The first parcel faces the central street; linked places take nearby parcels.
const LOTS = [
  [655, 264], [430, 275], [898, 265], [980, 490], [970, 690],
  [738, 765], [520, 752], [310, 736], [205, 480], [1090, 170],
].map(([x, y]) => point(x, y));
const BOUNDS = rect(0, 0, 1312, 920);

function districtKey(place) {
  const path = place.sourcePaths[0] ?? '.';
  return path.includes('/') ? path.split('/')[0] : '.';
}

// Connected components occupy consecutive parcels. Within each component,
// high-degree places lead, and source districts break ties before stable IDs.
function clusterOrder(town) {
  const byId = new Map(town.places.map(place => [place.id, place]));
  const neighbours = new Map(town.places.map(place => [place.id, new Set()]));
  for (const link of town.links) {
    neighbours.get(link.fromPlaceId).add(link.toPlaceId);
    neighbours.get(link.toPlaceId).add(link.fromPlaceId);
  }
  const order = (a, b) => neighbours.get(b).size - neighbours.get(a).size
    || compare(districtKey(byId.get(a)), districtKey(byId.get(b))) || compare(a, b);
  const seen = new Set();
  const result = [];
  for (const root of [...byId.keys()].sort(order)) {
    const pending = [root];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({ ...byId.get(id), clusterId: `cluster:${root}` });
      pending.push(...[...neighbours.get(id)].sort(order).reverse());
    }
  }
  return result;
}

function assignLots(sources, links) {
  const remaining = [...LOTS];
  const assigned = new Map();
  for (const source of sources) {
    const neighbours = links.flatMap(link => link.fromPlaceId === source.id
      ? [assigned.get(link.toPlaceId)]
      : link.toPlaceId === source.id ? [assigned.get(link.fromPlaceId)] : []).filter(Boolean);
    const distance = lot => neighbours.reduce((sum, neighbour) =>
      sum + Math.hypot(lot.x - neighbour.x, lot.y - neighbour.y), 0);
    remaining.sort((a, b) => distance(a) - distance(b));
    assigned.set(source.id, remaining.shift());
  }
  return assigned;
}

function geometry(anchor, workshop) {
  const { x, y } = anchor;
  const footprint = rect(x - 88, y - 88, 176, 88);
  const interior = workshop
    ? rect(x - 76, y - 76, 152, 64)
    : rect(x - 60, y - 124, 120, 112);
  const threshold = workshop
    ? rect(x - 16, y - 20, 32, 28)
    : rect(x - 32, y - 20, 68, 28);
  return {
    footprint,
    entrance: point(x, y),
    access: { automaticEntry: true, threshold, approach: [point(x, y + 32), point(x, y - 16)] },
    interior: { footprint: interior },
    collision: workshop ? [
      rect(x - 88, y - 88, 176, 12),
      rect(x - 88, y - 76, 12, 76),
      rect(x + 76, y - 76, 12, 76),
      rect(x - 76, y - 12, 60, 12),
      rect(x + 16, y - 12, 60, 12),
    ] : [
      // Room-image coordinates, translated by pivot (120,150). The rear wall
      // is at y=18..26, not across the visible central floor at y=62..74.
      // Stepped side strips follow the perspective walls; the front leaves
      // the painted x=88..156 entry open. Manifest collisions own furniture.
      [56, 18, 128, 8],
      [52, 26, 8, 44], [46, 70, 8, 32], [40, 102, 8, 36],
      [180, 26, 8, 44], [186, 70, 8, 32], [192, 102, 8, 36],
      [40, 130, 48, 8], [156, 130, 44, 8],
    ].map(([px, py, width, height]) => rect(x + px - 120, y + py - 150, width, height)),
    occlusion: {
      roof: footprint,
      foreground: rect(x - 88, y - 32, 176, 32),
      revealRegions: [threshold, interior],
    },
  };
}

function makePlace(source, anchor, variant) {
  const workshop = source.kind === 'workshop';
  const family = APPEARANCES[source.meaning];
  const appearance = family[variant % family.length];
  const aged = Boolean(source.history?.markers?.length);
  const shape = geometry(anchor, workshop);
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    meaning: source.meaning,
    sourcePaths: [...source.sourcePaths],
    basis: structuredClone(source.basis),
    ...(source.members ? { members: structuredClone(source.members), internalLinks: structuredClone(source.internalLinks) } : {}),
    ...(source.history ? { history: structuredClone(source.history) } : {}),
    districtId: `district:${districtKey(source)}`,
    clusterId: source.clusterId,
    appearance,
    appearanceBasis: {
      meaning: source.meaning,
      silhouette: appearance,
      variation: 'Stable round-robin within the same meaning; facade variation adds no repository claim.',
      interior: workshop
        ? 'An equipped workshop room for development work.'
        : 'A furnished timber room with everyday storage, reused across occupied building silhouettes.',
      history: aged ? 'Worn stone steps retain the visible history of this occupied place.' : null,
      historyPropAssetId: aged ? 'prop--edge-stone-stair-v1' : null,
    },
    anchor,
    scale: WORLD_SCALE,
    assets: {
      base: `place--${appearance}--base-v1`,
      upper: `place--${appearance}--upper-v1`,
      foreground: `place--${appearance}--foreground-v1`,
    },
    ...shape,
    interior: {
      ...shape.interior,
      // Both furnished room pairs are 240×160 with pivot (120,150), matching
      // every selected exterior. Their floors and furniture are already drawn.
      // The reusable room asset's internal name does not change place meaning.
      assetId: workshop ? 'place--workshop--interior-v1' : 'place--warehouse--interior-v1',
      foregroundAssetId: workshop
        ? 'place--workshop--interior-foreground-v1'
        : 'place--warehouse--interior-foreground-v1',
    },
  };
}

function validateTown(town) {
  if (town?.version !== 1 || typeof town.repository?.identity !== 'string'
      || typeof town.repository?.name !== 'string' || !Array.isArray(town.places)
      || !Array.isArray(town.links)) throw new TypeError('Expected a version 1 TownModel');
  if (town.places.length > TOWN_PLACE_CAPACITY || TOWN_PLACE_CAPACITY > LOTS.length) {
    throw new RangeError('TownModel must aggregate source groups within the authored parcel capacity');
  }
  const ids = new Set();
  for (const place of town.places) {
    if (!place || typeof place.id !== 'string' || ids.has(place.id)
        || typeof place.name !== 'string' || !['workshop', 'building'].includes(place.kind)
        || !Object.hasOwn(APPEARANCES, place.meaning)
        || !Array.isArray(place.sourcePaths) || !place.sourcePaths.every(path => typeof path === 'string')
        || place.basis === undefined) throw new TypeError('Invalid TownModel place');
    ids.add(place.id);
  }
  for (const link of town.links) {
    if (!ids.has(link.fromPlaceId) || !ids.has(link.toPlaceId) || link.basis === undefined) {
      throw new TypeError('TownModel link must connect existing places and retain its basis');
    }
  }
}

export function generateWorldPlan({ town } = {}) {
  validateTown(town);
  const sources = clusterOrder(town);
  const anchors = assignLots(sources, town.links);
  const variants = new Map();
  const places = sources.map(source => {
    const variant = variants.get(source.meaning) ?? 0;
    variants.set(source.meaning, variant + 1);
    return makePlace(source, anchors.get(source.id), variant);
  });
  const bounds = { ...BOUNDS };
  const byId = new Map(places.map(place => [place.id, place]));
  const districts = [...new Set(places.map(place => place.districtId))].map(id => {
    const members = places.filter(place => place.districtId === id);
    return {
      id,
      name: id.slice('district:'.length) === '.' ? town.repository.name : id.slice('district:'.length),
      sourcePaths: [...new Set(members.flatMap(place => place.sourcePaths))].sort(compare),
      placeIds: members.map(place => place.id),
      clusterIds: [...new Set(members.map(place => place.clusterId))],
    };
  });
  const routes = [];
  for (const place of places) routes.push({
    id: `access:${place.id}`, kind: 'access', width: 28,
    points: place.access.approach, placeIds: [place.id],
  });
  // Relations choose physical neighbours above and remain inspectable here.
  // The authored stone street owns paving; relation data never paints stamps.
  town.links.forEach((link, index) => {
    const from = byId.get(link.fromPlaceId);
    const to = byId.get(link.toPlaceId);
    routes.push({
      id: `connection:${index}`, kind: 'connection', width: 20,
      fromPlaceId: from.id, toPlaceId: to.id,
      placeIds: [from.id, to.id],
      districtIds: [...new Set([from.districtId, to.districtId])],
      basis: structuredClone(link.basis),
      points: [from.access.approach[0], to.access.approach[0]],
    });
  });
  const residents = ['neighbor', 'keeper', 'traveler', 'porter'];
  const people = places.filter((place, index) => place.kind === 'workshop' || index % 2 === 0).map((place, index) => ({
    id: `person:${place.id}`, placeId: place.id,
    assetId: `npc--${place.kind === 'workshop' ? 'artisan' : residents[index % residents.length]}-v1`,
    anchor: point(place.anchor.x + (index % 2 ? -48 : 44), place.anchor.y + 24 + index % 3 * 6),
    scale: WORLD_SCALE,
    animation: place.kind === 'workshop' ? 'work' : 'idle',
    direction: ['south', 'west', 'east'][index % 3],
  }));
  const props = places.filter(place => place.history?.markers?.length).map(place => ({
    id: `history:${place.id}`, placeId: place.id,
    assetId: place.appearanceBasis.historyPropAssetId,
    anchor: point(place.anchor.x - 60, place.anchor.y + 10),
    scale: WORLD_SCALE,
  }));
  return {
    version: 1,
    repository: { ...town.repository },
    style: {
      projection: 'three-quarter-top-down', light: 'upper-left-night', rotation: 0,
      worldScale: WORLD_SCALE, scaleBasis: 'One authored asset pixel per world unit for buildings, people, and props.',
    },
    bounds,
    spawn: point(655, 312),
    camera: { follow: 'player', rotation: 0 },
    player: { assetId: 'player--default-v1', scale: WORLD_SCALE },
    districts,
    places,
    routes,
    surfaces: [{
      id: 'environment', assetId: 'environment--late-compact-v1', mode: 'image', bounds,
    }],
    // Broad rock edges and deep hedge islands only. Narrow street edges stay
    // permissive, so these authored-background solids do not block entrances.
    collision: [
      rect(0, 0, 95, 920), rect(1195, 0, 117, 920),
      rect(100, 20, 170, 260), rect(1110, 285, 85, 435),
      rect(715, 420, 108, 185), rect(405, 475, 95, 120),
      rect(485, 292, 72, 40), rect(715, 285, 60, 55),
    ],
    people,
    props,
  };
}
