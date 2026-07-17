export const TILE_SIZE = 64;
export const INTEGER_ZOOMS = Object.freeze([1, 2, 3]);
export const TOUR_WITNESS_COUNT = 3;

const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);
const BUILDING_ACCESS = Object.freeze(['enterable', 'closed']);
const BUILDING_LABEL_MODES = Object.freeze(['proximity']);
const CUTAWAY_EASINGS = Object.freeze(['ease-in-out-cubic', 'linear']);
const PREFAB_IDS = Object.freeze([
  'prefab.service.inn.enterable',
  'prefab.module.closed-unreached'
]);
const COLLISION_EXTERIORS = Object.freeze(['solid-footprint']);
const COLLISION_ENTRANCES = Object.freeze(['door', 'blocked']);
const COLLISION_INTERIORS = Object.freeze(['walkable', 'none']);
const QUESTION_PRIORITY = Object.freeze([
  'unresolved',
  'cycle',
  'unverified',
  'unreached',
  'runtime_unknown',
  'truncation',
  'survey_scope',
  'facility_absent',
  'test_association',
  'entrypoint',
  'facility_present'
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0))];
}

export function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateRuntimeWorldPlan(plan) {
  const issues = [];
  if (!isRecord(plan)) return { ok: false, issues: ['worldPlan must be an object'] };
  if (plan.schemaVersion !== 2) issues.push('worldPlan.schemaVersion must be 2');
  if (typeof plan.seed !== 'string' || plan.seed.length === 0) issues.push('worldPlan.seed is required');
  if (typeof plan.inspectionDigest !== 'string' || plan.inspectionDigest.length === 0) issues.push('worldPlan.inspectionDigest is required');
  if (!isRecord(plan.validation) || plan.validation.ok !== true) issues.push('worldPlan.validation.ok must be true');

  const world = plan.world;
  if (!isRecord(world)) {
    issues.push('worldPlan.world is required');
  } else {
    if (!positiveInteger(world.widthTiles)) issues.push('world.widthTiles must be a positive integer');
    if (!positiveInteger(world.heightTiles)) issues.push('world.heightTiles must be a positive integer');
    if (world.tileSize !== TILE_SIZE) issues.push(`world.tileSize must be ${TILE_SIZE}`);
  }

  const expectedCells = positiveInteger(world?.widthTiles) && positiveInteger(world?.heightTiles)
    ? world.widthTiles * world.heightTiles
    : null;
  if (!Array.isArray(plan.terrain)) {
    issues.push('terrain must be a row-major array');
  } else if (expectedCells !== null && plan.terrain.length !== expectedCells) {
    issues.push(`terrain must contain ${expectedCells} row-major cells`);
  }

  for (const key of ['districts', 'streets', 'buildings', 'npcs', 'props', 'lights', 'facts']) {
    if (!Array.isArray(plan[key])) issues.push(`${key} must be an array`);
  }
  if (!isRecord(plan.nav) || !Array.isArray(plan.nav.nodes) || !Array.isArray(plan.nav.edges)) {
    issues.push('nav.nodes and nav.edges must be arrays');
  }
  if (!isRecord(plan.playerStart)) {
    issues.push('playerStart is required');
  } else {
    if (!Number.isInteger(plan.playerStart.x) || !Number.isInteger(plan.playerStart.y)) issues.push('playerStart coordinates must be integers');
    if (!DIRECTIONS.includes(plan.playerStart.facing)) issues.push('playerStart.facing is invalid');
    if (typeof plan.playerStart.navNodeId !== 'string') issues.push('playerStart.navNodeId is required');
  }

  const nodeIds = new Set();
  for (const node of plan.nav?.nodes ?? []) {
    if (!isRecord(node) || typeof node.id !== 'string' || node.id.length === 0) {
      issues.push('every nav node needs an id');
      continue;
    }
    if (nodeIds.has(node.id)) issues.push(`duplicate nav node: ${node.id}`);
    nodeIds.add(node.id);
    if (!Number.isInteger(node.x) || !Number.isInteger(node.y)) issues.push(`nav node ${node.id} coordinates must be integers`);
  }
  for (const edge of plan.nav?.edges ?? []) {
    if (!isRecord(edge) || typeof edge.id !== 'string') {
      issues.push('every nav edge needs an id');
      continue;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) issues.push(`nav edge ${edge.id} points to a missing node`);
  }
  if (typeof plan.playerStart?.navNodeId === 'string' && !nodeIds.has(plan.playerStart.navNodeId)) {
    issues.push('playerStart.navNodeId points to a missing node');
  }

  const buildingIds = new Set();
  for (const building of plan.buildings ?? []) {
    if (!isRecord(building) || typeof building.id !== 'string' || building.id.length === 0) {
      issues.push('every building needs an id');
      continue;
    }
    if (buildingIds.has(building.id)) issues.push(`duplicate building: ${building.id}`);
    buildingIds.add(building.id);
    if (typeof building.assetId !== 'string') issues.push(`building ${building.id} needs an assetId`);
    for (const field of ['prefabId', 'behaviorId', 'animationSetId', 'soundSetId', 'speakerRole']) {
      if (Object.hasOwn(building, field)
        && (typeof building[field] !== 'string' || building[field].length === 0)) {
        issues.push(`building ${building.id} has an invalid ${field}`);
      }
    }
    if (Object.hasOwn(building, 'access') && !BUILDING_ACCESS.includes(building.access)) {
      issues.push(`building ${building.id} has an invalid access`);
    }
    if (Object.hasOwn(building, 'labelMode') && !BUILDING_LABEL_MODES.includes(building.labelMode)) {
      issues.push(`building ${building.id} has an invalid labelMode`);
    }
    if (Object.hasOwn(building, 'cutawayDurationMs')
      && (!Number.isInteger(building.cutawayDurationMs) || building.cutawayDurationMs < 0)) {
      issues.push(`building ${building.id} has an invalid cutawayDurationMs`);
    }
    if (Object.hasOwn(building, 'cutawayEasing') && !CUTAWAY_EASINGS.includes(building.cutawayEasing)) {
      issues.push(`building ${building.id} has an invalid cutawayEasing`);
    }
    if (Object.hasOwn(building, 'prefabId') && !PREFAB_IDS.includes(building.prefabId)) {
      issues.push(`building ${building.id} has an unknown prefabId`);
    }
    if (Object.hasOwn(building, 'collisionExterior')
      && !COLLISION_EXTERIORS.includes(building.collisionExterior)) {
      issues.push(`building ${building.id} has an invalid collisionExterior`);
    }
    if (Object.hasOwn(building, 'collisionEntrance')
      && !COLLISION_ENTRANCES.includes(building.collisionEntrance)) {
      issues.push(`building ${building.id} has an invalid collisionEntrance`);
    }
    if (Object.hasOwn(building, 'collisionInterior')
      && !COLLISION_INTERIORS.includes(building.collisionInterior)) {
      issues.push(`building ${building.id} has an invalid collisionInterior`);
    }
    if (Object.hasOwn(building, 'eventIds')) {
      const eventIds = uniqueStrings(building.eventIds);
      if (!Array.isArray(building.eventIds) || eventIds.length === 0 || eventIds.length !== building.eventIds.length) {
        issues.push(`building ${building.id} has invalid eventIds`);
      }
    }
    if (PREFAB_IDS.includes(building.prefabId)) {
      if (!COLLISION_EXTERIORS.includes(building.collisionExterior)
        || !COLLISION_ENTRANCES.includes(building.collisionEntrance)
        || !COLLISION_INTERIORS.includes(building.collisionInterior)
        || !Array.isArray(building.eventIds) || building.eventIds.length === 0) {
        issues.push(`building ${building.id} has an incomplete prefab program`);
      }
      if ((building.access === 'enterable'
        && (building.collisionEntrance !== 'door' || building.collisionInterior !== 'walkable'))
        || (building.access === 'closed'
          && (building.collisionEntrance !== 'blocked' || building.collisionInterior !== 'none'))) {
        issues.push(`building ${building.id} collision does not match access`);
      }
    }
    if (!isRecord(building.footprint)
      || !Number.isInteger(building.footprint.x)
      || !Number.isInteger(building.footprint.y)
      || !positiveInteger(building.footprint.w)
      || !positiveInteger(building.footprint.h)) issues.push(`building ${building.id} has an invalid footprint`);
    if (!isRecord(building.entrance) || !Number.isInteger(building.entrance.x) || !Number.isInteger(building.entrance.y)) {
      issues.push(`building ${building.id} has an invalid entrance`);
    }
  }

  const townHalls = (plan.buildings ?? []).filter((building) => (
    building?.facilityKind === 'town_hall' && building?.interaction?.verb === 'receive-journal'
  ));
  if (townHalls.length !== 1) issues.push('worldPlan needs exactly one playable town hall ledger');

  const knownFactIds = new Set((plan.facts ?? []).map((fact) => fact?.id).filter((id) => typeof id === 'string'));
  const witnessFamilies = new Set((plan.buildings ?? []).flatMap((building) => {
    const protocol = interactionProtocol(building);
    const factRefs = uniqueStrings(building?.interaction?.factRefs).filter((id) => knownFactIds.has(id));
    return protocol.supported && protocol.family && protocol.family !== 'ledger' && factRefs.length > 0
      ? [protocol.family]
      : [];
  }));
  if (witnessFamilies.size < TOUR_WITNESS_COUNT) {
    issues.push(`worldPlan needs ${TOUR_WITNESS_COUNT} distinct fact-bound witness methods for the first tour`);
  }

  return { ok: issues.length === 0, issues };
}

export function tileCenter(x, y, tileSize = TILE_SIZE) {
  return Object.freeze({
    x: x * tileSize + tileSize / 2,
    y: y * tileSize + tileSize / 2
  });
}

function normalizeBuilding(building, tileSize) {
  const footprint = Object.freeze({
    tileX: building.footprint.x,
    tileY: building.footprint.y,
    tileWidth: building.footprint.w,
    tileHeight: building.footprint.h,
    x: building.footprint.x * tileSize,
    y: building.footprint.y * tileSize,
    width: building.footprint.w * tileSize,
    height: building.footprint.h * tileSize
  });
  const entrance = tileCenter(building.entrance.x, building.entrance.y, tileSize);
  const interactionTile = building.interaction?.anchor;
  const interaction = Object.freeze({
    x: Number.isInteger(interactionTile?.x) ? interactionTile.x * tileSize + tileSize / 2 : entrance.x,
    y: Number.isInteger(interactionTile?.y) ? interactionTile.y * tileSize + tileSize / 2 : entrance.y,
    verb: typeof building.interaction?.verb === 'string' ? building.interaction.verb : 'inspect',
    factRefs: Object.freeze(uniqueStrings(building.interaction?.factRefs))
  });
  const eventIds = Object.freeze(uniqueStrings(building.eventIds));
  const collision = Object.freeze({
    exterior: COLLISION_EXTERIORS.includes(building.collisionExterior) ? building.collisionExterior : null,
    entrance: COLLISION_ENTRANCES.includes(building.collisionEntrance) ? building.collisionEntrance : null,
    interior: COLLISION_INTERIORS.includes(building.collisionInterior) ? building.collisionInterior : null
  });
  const prefab = Object.freeze({
    id: typeof building.prefabId === 'string' ? building.prefabId : null,
    access: BUILDING_ACCESS.includes(building.access) ? building.access : null,
    behaviorId: typeof building.behaviorId === 'string' ? building.behaviorId : null,
    animationSetId: typeof building.animationSetId === 'string' ? building.animationSetId : null,
    cutawayDurationMs: Number.isInteger(building.cutawayDurationMs) ? building.cutawayDurationMs : null,
    cutawayEasing: CUTAWAY_EASINGS.includes(building.cutawayEasing) ? building.cutawayEasing : null,
    collision,
    eventIds,
    soundSetId: typeof building.soundSetId === 'string' ? building.soundSetId : null,
    labelMode: BUILDING_LABEL_MODES.includes(building.labelMode) ? building.labelMode : null,
    speakerRole: typeof building.speakerRole === 'string' ? building.speakerRole : null,
    interactionVerb: interaction.verb
  });
  return Object.freeze({
    ...building,
    footprint,
    entrance: Object.freeze({ ...building.entrance, ...entrance }),
    interaction,
    eventIds,
    prefab
  });
}

export function createWorldRuntime(plan) {
  const validation = validateRuntimeWorldPlan(plan);
  if (!validation.ok) throw new Error(`WorldPlan cannot be played:\n- ${validation.issues.join('\n- ')}`);

  const tileSize = plan.world.tileSize;
  const nodes = plan.nav.nodes.map((node) => {
    const center = tileCenter(node.x, node.y, tileSize);
    return Object.freeze({ ...node, worldX: center.x, worldY: center.y });
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  const edgeByPair = new Map();
  for (const edge of plan.nav.edges) {
    adjacency.get(edge.from).push(Object.freeze({ nodeId: edge.to, edge }));
    adjacency.get(edge.to).push(Object.freeze({ nodeId: edge.from, edge }));
    edgeByPair.set(`${edge.from}\u0000${edge.to}`, edge);
    edgeByPair.set(`${edge.to}\u0000${edge.from}`, edge);
  }

  const buildings = plan.buildings.map((building) => normalizeBuilding(building, tileSize));
  const facts = plan.facts.map((fact) => Object.freeze({
    ...fact,
    evidence: Object.freeze({
      observed: Object.freeze(uniqueStrings(fact.evidence?.observed)),
      inferred: Object.freeze(uniqueStrings(fact.evidence?.inferred)),
      unknown: Object.freeze(uniqueStrings(fact.evidence?.unknown))
    })
  }));
  const terrainRows = Array.from({ length: plan.world.heightTiles }, (_, y) => Object.freeze(
    plan.terrain.slice(y * plan.world.widthTiles, (y + 1) * plan.world.widthTiles)
  ));
  const startNode = nodeById.get(plan.playerStart.navNodeId);

  return Object.freeze({
    plan,
    tileSize,
    widthTiles: plan.world.widthTiles,
    heightTiles: plan.world.heightTiles,
    width: plan.world.widthTiles * tileSize,
    height: plan.world.heightTiles * tileSize,
    terrainRows: Object.freeze(terrainRows),
    nodes: Object.freeze(nodes),
    nodeById,
    adjacency,
    edgeByPair,
    buildings: Object.freeze(buildings),
    buildingById: new Map(buildings.map((building) => [building.id, building])),
    facts: Object.freeze(facts),
    factById: new Map(facts.map((fact) => [fact.id, fact])),
    start: Object.freeze({
      x: startNode.worldX,
      y: startNode.worldY,
      facing: plan.playerStart.facing,
      navNodeId: startNode.id
    })
  });
}

export function terrainCellAt(runtime, tileX, tileY) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return null;
  return runtime.terrainRows[tileY]?.[tileX] ?? null;
}

export function nearestNode(runtime, x, y, { space } = {}) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of runtime.nodes) {
    if (space && node.space !== space) continue;
    const distance = Math.hypot(node.worldX - x, node.worldY - y);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best ? Object.freeze({ node: best, distance: bestDistance }) : null;
}

export function edgeBetween(runtime, fromId, toId) {
  return runtime.edgeByPair.get(`${fromId}\u0000${toId}`) ?? null;
}

export function shortestPath(runtime, fromId, toId) {
  if (!runtime.nodeById.has(fromId) || !runtime.nodeById.has(toId)) return [];
  if (fromId === toId) return [fromId];
  const queue = [fromId];
  const previous = new Map([[fromId, null]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const neighbour of runtime.adjacency.get(current) ?? []) {
      if (previous.has(neighbour.nodeId)) continue;
      previous.set(neighbour.nodeId, current);
      if (neighbour.nodeId === toId) {
        const path = [toId];
        let step = current;
        while (step !== null) {
          path.push(step);
          step = previous.get(step);
        }
        return path.reverse();
      }
      queue.push(neighbour.nodeId);
    }
  }
  return [];
}

export function navigationIsConnected(runtime) {
  if (runtime.nodes.length === 0) return false;
  const seen = new Set([runtime.nodes[0].id]);
  const queue = [runtime.nodes[0].id];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbour of runtime.adjacency.get(queue[cursor]) ?? []) {
      if (seen.has(neighbour.nodeId)) continue;
      seen.add(neighbour.nodeId);
      queue.push(neighbour.nodeId);
    }
  }
  return seen.size === runtime.nodes.length;
}

export function directionBetweenPoints(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

export function nextNodeForDirection(runtime, fromId, direction) {
  const origin = runtime.nodeById.get(fromId);
  if (!origin || !DIRECTIONS.includes(direction)) return null;
  const vector = {
    north: [0, -1],
    east: [1, 0],
    south: [0, 1],
    west: [-1, 0]
  }[direction];
  let best = null;
  let bestScore = -Infinity;
  for (const neighbour of runtime.adjacency.get(fromId) ?? []) {
    const node = runtime.nodeById.get(neighbour.nodeId);
    const dx = node.worldX - origin.worldX;
    const dy = node.worldY - origin.worldY;
    const distance = Math.hypot(dx, dy) || 1;
    const alignment = (dx / distance) * vector[0] + (dy / distance) * vector[1];
    if (alignment <= 0.35) continue;
    const score = alignment * 1000 - distance;
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

export function createInterpolatedMovement({ from, to, startedAt = 0, duration = 180, reducedMotion = false }) {
  const safeDuration = reducedMotion ? 0 : Math.max(1, duration);
  return Object.freeze({
    from: Object.freeze({ x: from.x, y: from.y }),
    to: Object.freeze({ x: to.x, y: to.y }),
    startedAt,
    duration: safeDuration
  });
}

export function sampleInterpolatedMovement(movement, now) {
  if (!movement || movement.duration === 0) return Object.freeze({ ...movement?.to, progress: 1, done: true });
  const progress = clamp((now - movement.startedAt) / movement.duration, 0, 1);
  const eased = 1 - (1 - progress) ** 3;
  return Object.freeze({
    x: movement.from.x + (movement.to.x - movement.from.x) * eased,
    y: movement.from.y + (movement.to.y - movement.from.y) * eased,
    progress,
    done: progress >= 1
  });
}

export function computeWorldCamera({ viewportWidth, viewportHeight, worldWidth, worldHeight, focusX, focusY, zoom }) {
  if (!INTEGER_ZOOMS.includes(zoom)) throw new RangeError('zoom must be one of 1, 2, or 3');
  if (![viewportWidth, viewportHeight, worldWidth, worldHeight, focusX, focusY].every(finite)) {
    throw new TypeError('camera inputs must be finite numbers');
  }
  const sourceWidth = Math.min(worldWidth, viewportWidth / zoom);
  const sourceHeight = Math.min(worldHeight, viewportHeight / zoom);
  return Object.freeze({
    sourceX: clamp(focusX - sourceWidth / 2, 0, Math.max(0, worldWidth - sourceWidth)),
    sourceY: clamp(focusY - sourceHeight / 2, 0, Math.max(0, worldHeight - sourceHeight)),
    sourceWidth,
    sourceHeight,
    scale: zoom,
    zoom,
    viewportWidth,
    viewportHeight
  });
}

export function worldToScreen(camera, x, y) {
  return Object.freeze({ x: (x - camera.sourceX) * camera.scale, y: (y - camera.sourceY) * camera.scale });
}

export function screenToWorld(camera, x, y) {
  return Object.freeze({ x: camera.sourceX + x / camera.scale, y: camera.sourceY + y / camera.scale });
}

export function districtForPoint(runtime, x, y) {
  const tileX = Math.floor(x / runtime.tileSize);
  const tileY = Math.floor(y / runtime.tileSize);
  return runtime.plan.districts.find((district) => tileX >= district.bounds.x
    && tileY >= district.bounds.y
    && tileX < district.bounds.x + district.bounds.w
    && tileY < district.bounds.y + district.bounds.h) ?? null;
}

export function isTownHallInteraction(building) {
  return building?.facilityKind === 'town_hall' && building?.interaction?.verb === 'receive-journal';
}

export function interactionProtocol(building) {
  const verb = building?.interaction?.verb;
  if (verb === 'receive-journal') {
    return Object.freeze(isTownHallInteraction(building)
      ? { verb, kind: 'ledger', family: 'ledger', supported: true }
      : { verb, kind: 'away-sign', family: null, supported: false });
  }
  const protocol = ({
    'inspect-entry-tags': { kind: 'entry-tags', family: 'spatial' },
    'watch-forms': { kind: 'forms', family: 'observe' },
    'talk-neighbor': { kind: 'neighbor', family: 'talk' },
    'talk-innkeeper': { kind: 'neighbor', family: 'talk' },
    'use-telescope': { kind: 'overview', family: 'operate' },
    'read-away-sign': { kind: 'away-sign', family: 'inspect' },
    'inspect-closure-sign': { kind: 'away-sign', family: 'inspect' },
    'inspect-field-notice': { kind: 'away-sign', family: 'inspect' }
  })[verb];
  return Object.freeze(protocol
    ? { verb, ...protocol, supported: true }
    : { verb: typeof verb === 'string' ? verb : 'unknown', kind: 'away-sign', family: null, supported: false });
}

export function interactionFamily(building) {
  return interactionProtocol(building).family ?? 'unsupported';
}

export function interactionVerbLabel(family) {
  return ({
    ledger: '記録簿を開く',
    spatial: '位置関係を確かめる',
    observe: '痕跡を観察する',
    talk: '住人に聞く',
    operate: '装置を動かす',
    inspect: '留守札を読む'
  })[family] ?? '留守札を読む';
}

export function nearestInteraction(runtime, x, y, maxDistance = runtime.tileSize * 1.8) {
  let best = null;
  for (const building of runtime.buildings) {
    const distance = Math.hypot(building.interaction.x - x, building.interaction.y - y);
    if (distance > maxDistance || distance >= (best?.distance ?? Infinity)) continue;
    best = Object.freeze({
      type: 'building',
      building,
      x: building.interaction.x,
      y: building.interaction.y,
      distance,
      family: interactionFamily(building)
    });
  }
  return best;
}

function pointInFootprint(building, x, y, margin = 0) {
  return x >= building.footprint.x - margin
    && x <= building.footprint.x + building.footprint.width + margin
    && y >= building.footprint.y - margin
    && y <= building.footprint.y + building.footprint.height + margin;
}

export function buildingForCutaway(runtime, x, y) {
  const inside = runtime.buildings.find((building) => pointInFootprint(building, x, y, runtime.tileSize * 0.15));
  if (inside) return inside;
  const nearby = nearestInteraction(runtime, x, y, runtime.tileSize * 0.8);
  return nearby?.building ?? null;
}

export function withinBuildingReleaseZone(runtime, building, x, y) {
  if (!building) return false;
  return pointInFootprint(building, x, y, runtime.tileSize)
    || Math.hypot(building.interaction.x - x, building.interaction.y - y) <= runtime.tileSize;
}

export function occludingBuilding(runtime, x, y, cutawayBuildingId = null) {
  return runtime.buildings.find((building) => building.id !== cutawayBuildingId && pointInFootprint(building, x, y)) ?? null;
}

export function playerOccluded(runtime, x, y, cutawayBuildingId = null) {
  return Boolean(occludingBuilding(runtime, x, y, cutawayBuildingId));
}

export function buildingFactIds(runtime, building) {
  const ids = [...building.interaction.factRefs];
  for (const npc of runtime.plan.npcs) {
    if (npc.home === building.id) ids.push(...uniqueStrings(npc.factRefs));
  }
  for (const prop of runtime.plan.props) {
    if (!prop.factRef) continue;
    const point = tileCenter(prop.x, prop.y, runtime.tileSize);
    if (pointInFootprint(building, point.x, point.y)) ids.push(prop.factRef);
  }
  return [...new Set(ids)].filter((id) => runtime.factById.has(id));
}

function factRoomFiles(fact) {
  const params = fact?.params ?? {};
  return uniqueStrings([
    params.path,
    params.source,
    params.test,
    params.from,
    ...((Array.isArray(params.members) ? params.members : []))
  ]);
}

export function residentConversationTarget(runtime, building, fact) {
  const rooms = Array.isArray(building?.rooms) ? building.rooms : [];
  const npcs = Array.isArray(runtime?.plan?.npcs) ? runtime.plan.npcs : [];
  const roomByFile = new Map(rooms
    .filter((room) => typeof room?.file === 'string' && room.file.length > 0)
    .map((room) => [room.file, room]));
  const exactRoom = factRoomFiles(fact).map((file) => roomByFile.get(file)).find(Boolean) ?? null;
  const room = exactRoom
    ?? rooms.find((candidate) => typeof candidate?.npcId === 'string' && candidate.npcId.length > 0)
    ?? rooms[0]
    ?? null;
  const roomActor = typeof room?.npcId === 'string'
    ? npcs.find((npc) => npc.id === room.npcId && npc.home === building.id) ?? null
    : null;
  const actor = exactRoom ? roomActor : roomActor ?? npcs.find((npc) => npc.home === building?.id) ?? null;
  return Object.freeze({ room, actor, exactRoom: exactRoom !== null });
}

export function selectTourQuestions(facts, maximum = 3) {
  const rank = new Map(QUESTION_PRIORITY.map((type, index) => [type, index]));
  return [...facts]
    .filter((fact) => fact && typeof fact.id === 'string')
    .sort((left, right) => (rank.get(left.type) ?? 999) - (rank.get(right.type) ?? 999) || compareCodeUnits(left.id, right.id))
    .slice(0, maximum);
}

export function selectableTourQuestions(runtime) {
  if (!runtime?.facts || !runtime?.factById || !Array.isArray(runtime.buildings)) return [];
  return selectTourQuestions(
    runtime.facts.filter((fact) => factHasWitnessSite(runtime, fact.id)),
    TOUR_WITNESS_COUNT
  );
}

export function interactionFactId(runtime, building, selectedQuestionId = null) {
  if (!runtime || !building) return null;
  const factIds = buildingFactIds(runtime, building);
  if (typeof selectedQuestionId === 'string' && factIds.includes(selectedQuestionId)) return selectedQuestionId;
  return factIds[0] ?? null;
}

export function formatDialogueText(value, maximumColumns = 40, maximumLines = 3) {
  const width = positiveInteger(maximumColumns) ? maximumColumns : 40;
  const lineLimit = positiveInteger(maximumLines) ? maximumLines : 3;
  const remaining = Array.from(String(value ?? '').trim().replace(/\s+/g, ' '));
  const lines = [];
  while (remaining.length > 0 && lines.length < lineLimit) {
    const isLast = lines.length === lineLimit - 1;
    if (isLast && remaining.length > width) {
      lines.push(`${remaining.slice(0, Math.max(1, width - 1)).join('')}…`);
      break;
    }
    let take = Math.min(width, remaining.length);
    if (remaining.length > width && !isLast) {
      const window = remaining.slice(0, width);
      const preferred = window.reduce((best, character, index) => (
        index >= Math.floor(width * 0.55) && /[。！？、」』]/.test(character) ? index + 1 : best
      ), 0);
      if (preferred > 0) take = preferred;
    }
    lines.push(remaining.splice(0, take).join('').trim());
  }
  return lines.filter(Boolean).join('\n');
}

function basenameLabel(value, fallback = '対象') {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  return withoutQuery.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback;
}

function factSubject(fact) {
  const params = fact?.params ?? {};
  if (typeof params.path === 'string') return basenameLabel(params.path);
  if (typeof params.from === 'string') return basenameLabel(params.from);
  if (typeof params.source === 'string') return basenameLabel(params.source);
  if (typeof params.name === 'string') return params.name;
  if (typeof params.kind === 'string') return ({
    'dynamic-import': '動的な参照',
    'static-import': '静的な参照',
    import: '参照',
    require: '読み込み'
  })[params.kind] ?? '参照関係';
  if (typeof params.facilityKind === 'string') return ({
    town_hall: '市庁舎', gate: '街の門', dojo: '道場', inn: '宿屋',
    house: '住居', survey_tower: '測量塔', dock: '港', guild: '会館'
  })[params.facilityKind] ?? '街の施設';
  return 'この対象';
}

export function describeFact(fact) {
  if (!fact) return 'この問いの証拠は、まだ街で見つかっていません。';
  const subject = factSubject(fact);
  if (fact.type === 'unverified') {
    return `${subject} は、まだ道場に通っていないだけで、壊れているとは確認されていません。`;
  }
  if (typeof fact.sayings?.primary === 'string'
    && fact.sayings.primary.length > 0
    && !/^fact\.[a-z_]+\.primary$/.test(fact.sayings.primary)
    && !/(?:fact\.[a-z0-9_.-]+|[\\/])/.test(fact.sayings.primary)) return fact.sayings.primary;
  const target = fact.params?.targetHint ? `から「${basenameLabel(fact.params.targetHint)}」へ` : '';
  const members = Array.isArray(fact.params?.members)
    ? fact.params.members.map((value) => basenameLabel(value)).join('と')
    : subject;
  if (fact.type === 'survey_scope') {
    const unknown = (fact.evidence?.unknown?.length ?? 0) > 0;
    if (fact.params?.dimension === 'repository') {
      return unknown
        ? 'この検査では、リポジトリ名までは確認できません。'
        : `この街は「${fact.params?.name ?? '名称未設定'}」リポジトリの測量結果です。`;
    }
    if (fact.params?.dimension === 'files') {
      return unknown
        ? 'この検査では、街を作るファイルの総数はまだ分かりません。'
        : `街を作るファイルを ${fact.params?.count ?? 0} 件、直接確認しました。`;
    }
    if (fact.params?.dimension === 'static_dependencies') {
      return unknown
        ? 'この検査では、ファイル同士を結ぶ静的な道の総数はまだ分かりません。'
        : `ファイル同士を結ぶ静的な道を ${fact.params?.count ?? 0} 本、直接確認しました。`;
    }
  }
  return ({
    entrypoint: `${subject} は、検査で確認された街への入口です。`,
    unresolved: `${subject}${target}の参照先が街の記録から見つかりません。`,
    cycle: `${members} は互いに参照し続ける輪になっています。`,
    test_association: `${subject}と${basenameLabel(fact.params?.test, 'テスト')}の関連が推定されています。`,
    unreached: `${subject} へ至る道筋はまだ見つかっていません。`,
    runtime_unknown: `${subject} の実行時の様子は、この調査だけでは分かりません。`,
    truncation: `検査上限に達したため、一部の範囲はまだ不明です。`,
    facility_absent: `${subject} に対応する施設は街にありません。`,
    facility_present: `${subject} に対応する施設が街で確認されています。`
  })[fact.type] ?? `${subject} について確かめる必要があります。`;
}

export function createTourState() {
  return Object.freeze({
    version: 1,
    status: 'need-journal',
    journalReceived: false,
    questionId: null,
    witnesses: Object.freeze([]),
    answer: null
  });
}

export function tourHasQuestionWitness(state) {
  return typeof state?.questionId === 'string'
    && (state.witnesses ?? []).some((entry) => entry.factIds.includes(state.questionId));
}

export function tourCanReport(state) {
  return (state?.witnesses?.length ?? 0) >= TOUR_WITNESS_COUNT && tourHasQuestionWitness(state);
}

export function factHasWitnessSite(runtime, factId) {
  if (!runtime?.factById?.has(factId)) return false;
  return runtime.buildings.some((building) => {
    const protocol = interactionProtocol(building);
    return protocol.supported && protocol.family && protocol.family !== 'ledger'
      && buildingFactIds(runtime, building).includes(factId);
  });
}

export function restoreTourState(value, runtime) {
  if (!isRecord(value) || value.version !== 1 || !runtime?.buildingById || !runtime?.factById) return createTourState();
  const allowedStatuses = new Set(['need-journal', 'choose-question', 'investigating', 'return-town-hall', 'answer', 'complete']);
  if (!allowedStatuses.has(value.status) || !Array.isArray(value.witnesses)
    || value.witnesses.length > TOUR_WITNESS_COUNT) return createTourState();
  const selectableQuestionIds = new Set(selectableTourQuestions(runtime).map((fact) => fact.id));
  if (value.questionId !== null
    && (typeof value.questionId !== 'string' || !selectableQuestionIds.has(value.questionId))) return createTourState();
  const questionId = typeof value.questionId === 'string' && selectableQuestionIds.has(value.questionId)
    ? value.questionId
    : null;
  const witnesses = [];
  const seenBuildings = new Set();
  const seenFamilies = new Set();
  for (const entry of value.witnesses) {
    if (!isRecord(entry) || typeof entry.buildingId !== 'string' || typeof entry.family !== 'string') return createTourState();
    const building = runtime.buildingById.get(entry.buildingId);
    const protocol = interactionProtocol(building);
    if (!building || !protocol.supported || !protocol.family || protocol.family === 'ledger' || protocol.family !== entry.family) return createTourState();
    if (seenBuildings.has(building.id) || seenFamilies.has(protocol.family)) return createTourState();
    const factId = interactionFactId(runtime, building, questionId);
    if (!factId || !Array.isArray(entry.factIds) || entry.factIds.length !== 1 || entry.factIds[0] !== factId) return createTourState();
    seenBuildings.add(building.id);
    seenFamilies.add(protocol.family);
    witnesses.push(Object.freeze({
      buildingId: building.id,
      family: protocol.family,
      factIds: Object.freeze([factId])
    }));
  }
  const restored = Object.freeze({
    version: 1,
    status: value.status,
    journalReceived: value.journalReceived === true,
    questionId,
    witnesses: Object.freeze(witnesses),
    answer: typeof value.answer === 'boolean' ? value.answer : null
  });
  const empty = witnesses.length === 0 && restored.questionId === null && restored.answer === null;
  if (restored.status === 'need-journal') return !restored.journalReceived && empty ? restored : createTourState();
  if (restored.status === 'choose-question') return restored.journalReceived && empty ? restored : createTourState();
  if (!restored.journalReceived || !restored.questionId) return createTourState();
  const canReport = tourCanReport(restored);
  if (restored.status === 'investigating') return !canReport && restored.answer === null ? restored : createTourState();
  if (restored.status === 'return-town-hall') return canReport && restored.answer === null ? restored : createTourState();
  if (restored.status === 'answer') return canReport && restored.answer === null ? restored : createTourState();
  if (restored.status === 'complete') return canReport && typeof restored.answer === 'boolean' ? restored : createTourState();
  return createTourState();
}

export function reduceTour(state, action, runtime = null) {
  if (!isRecord(action)) return state;
  const actionBuilding = typeof action.buildingId === 'string' ? runtime?.buildingById?.get(action.buildingId) : null;
  if (action.type === 'receiveJournal' && state.status === 'need-journal' && isTownHallInteraction(actionBuilding)) {
    return Object.freeze({ ...state, status: 'choose-question', journalReceived: true });
  }
  if (action.type === 'selectQuestion' && state.status === 'choose-question'
    && typeof action.questionId === 'string'
    && selectableTourQuestions(runtime).some((fact) => fact.id === action.questionId)) {
    return Object.freeze({ ...state, status: 'investigating', questionId: action.questionId });
  }
  if (action.type === 'witness' && state.status === 'investigating'
    && typeof action.buildingId === 'string'
    && typeof action.family === 'string') {
    const protocol = interactionProtocol(actionBuilding);
    if (!actionBuilding || !protocol.supported || !protocol.family || protocol.family === 'ledger' || action.family !== protocol.family) return state;
    const factId = interactionFactId(runtime, actionBuilding, state.questionId);
    if (!factId || action.factId !== factId) return state;
    const existingBuildingIndex = state.witnesses.findIndex((entry) => entry.buildingId === actionBuilding.id);
    if (existingBuildingIndex >= 0) return state;
    const existingFamilyIndex = state.witnesses.findIndex((entry) => entry.family === protocol.family);
    const witness = Object.freeze({
      buildingId: actionBuilding.id,
      family: protocol.family,
      factIds: Object.freeze([factId])
    });
    let nextWitnesses;
    if (existingFamilyIndex >= 0) {
      if (factId !== state.questionId) return state;
      nextWitnesses = [...state.witnesses];
      nextWitnesses[existingFamilyIndex] = witness;
    } else {
      nextWitnesses = [...state.witnesses, witness];
    }
    const witnesses = Object.freeze(nextWitnesses);
    return Object.freeze({
      ...state,
      witnesses,
      status: witnesses.length >= TOUR_WITNESS_COUNT
        && witnesses.some((entry) => entry.factIds.includes(state.questionId))
        ? 'return-town-hall'
        : 'investigating'
    });
  }
  if (action.type === 'report' && state.status === 'return-town-hall'
    && isTownHallInteraction(actionBuilding) && tourCanReport(state)) {
    return Object.freeze({ ...state, status: 'answer' });
  }
  if (action.type === 'answer' && state.status === 'answer' && typeof action.value === 'boolean') {
    return Object.freeze({ ...state, status: 'complete', answer: action.value });
  }
  return state;
}

function firstDepthIndex(entries, minimumDepth) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entries[middle].depth < minimumDepth) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function visibleDepthEntries(sortedEntries, camera, maximumHeight = 0) {
  if (!Array.isArray(sortedEntries) || !camera) return [];
  const left = camera.sourceX;
  const right = camera.sourceX + camera.sourceWidth;
  const top = camera.sourceY;
  const bottom = camera.sourceY + camera.sourceHeight;
  const start = firstDepthIndex(sortedEntries, top - Math.max(0, maximumHeight));
  const visible = [];
  for (let index = start; index < sortedEntries.length; index += 1) {
    const entry = sortedEntries[index];
    if (entry.depth > bottom + Math.max(0, maximumHeight)) break;
    const bounds = entry.bounds;
    if (!bounds || bounds.x + bounds.width < left || bounds.x > right
      || bounds.y + bounds.height < top || bounds.y > bottom) continue;
    visible.push(entry);
  }
  return visible;
}

export function tourObjective(state) {
  return ({
    'need-journal': '市庁舎で調査手帳を受け取る',
    'choose-question': '調べる問いをひとつ選ぶ',
    investigating: `異なる方法で現場を調べる（${state.witnesses.length}/${TOUR_WITNESS_COUNT}）`,
    'return-town-hall': '市庁舎へ戻って発見を報告する',
    answer: '記録官の最後の問いに答える',
    complete: '最初の調査は完了しました。街を自由に歩けます'
  })[state.status] ?? '街を調べる';
}

export function progressStorageKey(repositoryName, inspectionDigest) {
  const repository = typeof repositoryName === 'string' && repositoryName.length > 0 ? repositoryName : 'unknown-repository';
  const digest = typeof inspectionDigest === 'string' && inspectionDigest.length > 0 ? inspectionDigest : 'unknown-inspection';
  return `fable5:tour:v1:${encodeURIComponent(repository)}:${encodeURIComponent(digest)}`;
}
