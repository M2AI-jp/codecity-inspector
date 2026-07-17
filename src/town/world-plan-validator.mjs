// Semantic validator for WorldPlan v2.
//
// Shape/reference validation remains in world-plan-schema.mjs. This module
// checks the player-visible promises that a structurally valid plan must keep:
// every observed file is represented once, buildings do not overlap, entrances
// and interactions are reachable, import streets tell the truth, M+ interiors
// can be entered, and the permanent landmarks retain clear sightlines.

import { deepFreeze } from './schema.mjs';
import { validateWorldPlanShape } from './world-plan-schema.mjs';

const INTERIOR_CLASSES = new Set(['M', 'L', 'XL', 'rowhouse_s', 'rowhouse_l', 'tower']);
// The v2 renderer draws a building from the south footprint edge.  Approved
// exterior sprites can be 384px tall on 64px terrain, so reserve six tiles
// above that anchor and two below it for the entrance/lower art edge.
const MAX_BUILDING_SPRITE_HEIGHT_TILES = 6;
const BUILDING_BOTTOM_CLEARANCE_TILES = 2;

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function issue(code, message, severity = 'error') {
  return { code, message, severity };
}

function coordKey(x, y) {
  return `${x},${y}`;
}

function pointInRect(point, rect) {
  return point.x >= rect.x && point.x < rect.x + rect.w
    && point.y >= rect.y && point.y < rect.y + rect.h;
}

function interiorEntrancePoint(building) {
  const inward = {
    north: [0, 1],
    east: [-1, 0],
    south: [0, -1],
    west: [1, 0]
  }[building.entrance.dir] ?? [0, 0];
  return {
    x: building.entrance.x + inward[0],
    y: building.entrance.y + inward[1]
  };
}

function terrainAt(plan, x, y) {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)
    || x < 0 || y < 0 || x >= plan.world.widthTiles || y >= plan.world.heightTiles) return null;
  return plan.terrain[y * plan.world.widthTiles + x] ?? null;
}

function navIndexes(plan) {
  const byId = new Map(plan.nav.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(plan.nav.edges.map((edge) => [edge.id, edge]));
  const outdoorByCoord = new Map();
  const duplicateOutdoorCoords = new Set();
  const interiorsByBuilding = new Map();
  for (const node of plan.nav.nodes) {
    if (node.space === 'outdoor') {
      const key = coordKey(node.x, node.y);
      if (outdoorByCoord.has(key)) duplicateOutdoorCoords.add(key);
      else outdoorByCoord.set(key, node.id);
    } else if (nonemptyString(node.buildingId)) {
      const nodes = interiorsByBuilding.get(node.buildingId) ?? [];
      nodes.push(node);
      interiorsByBuilding.set(node.buildingId, nodes);
    }
  }
  const adjacency = new Map(plan.nav.nodes.map((node) => [node.id, new Set()]));
  const doorsByBuilding = new Map();
  for (const edge of plan.nav.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    adjacency.get(edge.from).add(edge.to);
    adjacency.get(edge.to).add(edge.from);
    if (edge.kind === 'door') {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      const outdoor = from.space === 'outdoor' ? from : to.space === 'outdoor' ? to : null;
      const interior = from.space === 'interior' ? from : to.space === 'interior' ? to : null;
      if (outdoor && interior) {
        const doors = doorsByBuilding.get(interior.buildingId) ?? [];
        doors.push({ edge, outdoor, interior });
        doorsByBuilding.set(interior.buildingId, doors);
      }
    }
  }
  return {
    byId,
    edgeById,
    outdoorByCoord,
    duplicateOutdoorCoords,
    interiorsByBuilding,
    doorsByBuilding,
    adjacency
  };
}

function reachableFrom(adjacency, startId) {
  const visited = new Set();
  if (!adjacency.has(startId)) return visited;
  const queue = [startId];
  visited.add(startId);
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of adjacency.get(queue[head]) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function checkFileCoverage(plan, inspection) {
  if (!inspection || typeof inspection !== 'object') return [];
  const expected = new Set([
    ...arrayOf(inspection?.graph?.nodes).map((node) => nonemptyString(node?.path)),
    ...arrayOf(inspection?.city?.buildings).map((building) => nonemptyString(building?.path))
  ].filter(Boolean));
  const counts = new Map();
  for (const building of plan.buildings) {
    for (const filePath of building.files) counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
  }
  const issues = [];
  for (const filePath of [...expected].sort(compareStrings)) {
    const count = counts.get(filePath) ?? 0;
    if (count !== 1) issues.push(issue(
      'FILE_COVERAGE',
      `Observed file "${filePath}" must appear in exactly one building; found ${count}.`
    ));
  }
  for (const filePath of [...counts.keys()].sort(compareStrings)) {
    if (!expected.has(filePath)) issues.push(issue(
      'FILE_COVERAGE',
      `Building file "${filePath}" was not present in the supplied inspection.`
    ));
  }
  return issues;
}

function checkNoOverlap(plan) {
  const issues = [];
  const occupancy = new Map();
  const reportedPairs = new Set();
  for (const building of plan.buildings) {
    for (let y = building.footprint.y; y < building.footprint.y + building.footprint.h; y += 1) {
      for (let x = building.footprint.x; x < building.footprint.x + building.footprint.w; x += 1) {
        const key = coordKey(x, y);
        const occupied = occupancy.get(key);
        if (!occupied) {
          occupancy.set(key, building);
          continue;
        }
        const pair = [occupied.id, building.id].sort(compareStrings);
        const pairKey = pair.join('\0');
        if (!reportedPairs.has(pairKey)) {
          reportedPairs.add(pairKey);
          issues.push(issue('NO_OVERLAP', `Buildings "${pair[0]}" and "${pair[1]}" overlap.`));
        }
      }
    }
  }
  return { issues, occupancy };
}

function checkEntrances(plan, indexes) {
  const issues = [];
  for (const building of plan.buildings) {
    const entrance = building.entrance;
    if (pointInRect(entrance, building.footprint)) {
      issues.push(issue('ENTRANCE_CLEAR', `Building "${building.id}" has an entrance inside its footprint.`));
    }
    if (terrainAt(plan, entrance.x, entrance.y)?.walkable !== true) {
      issues.push(issue('ENTRANCE_CLEAR', `Building "${building.id}" has a blocked entrance.`));
    }
    if (!indexes.outdoorByCoord.has(coordKey(entrance.x, entrance.y))) {
      issues.push(issue('ENTRANCE_CLEAR', `Building "${building.id}" entrance lacks an outdoor navigation node.`));
    }
  }
  return issues;
}

function checkSpriteClearance(plan) {
  const issues = [];
  for (const building of plan.buildings) {
    const baselineY = building.footprint.y + building.footprint.h;
    if (baselineY < MAX_BUILDING_SPRITE_HEIGHT_TILES) {
      issues.push(issue(
        'SPRITE_CLEARANCE',
        `Building "${building.id}" has only ${baselineY} tile(s) above its south art anchor; ${MAX_BUILDING_SPRITE_HEIGHT_TILES} are required for a 384px exterior.`
      ));
    }
    if (plan.world.heightTiles - baselineY < BUILDING_BOTTOM_CLEARANCE_TILES) {
      issues.push(issue(
        'SPRITE_CLEARANCE',
        `Building "${building.id}" has fewer than ${BUILDING_BOTTOM_CLEARANCE_TILES} tile(s) below its south art anchor.`
      ));
    }
  }
  return issues;
}

function checkReachability(plan, indexes, reached, inspection) {
  const issues = [];
  for (const building of plan.buildings) {
    const entranceId = indexes.outdoorByCoord.get(coordKey(building.entrance.x, building.entrance.y));
    if (!entranceId || !reached.has(entranceId)) {
      issues.push(issue('REACHABLE', `Building "${building.id}" cannot be reached from playerStart.`));
    }
    const anchorId = indexes.outdoorByCoord.get(coordKey(
      building.interaction.anchor.x,
      building.interaction.anchor.y
    ));
    if (!anchorId || !reached.has(anchorId)) {
      issues.push(issue('REACHABLE', `Interaction "${building.interaction.verb}" at "${building.id}" is unreachable.`));
    }
  }
  const hasObservedEntrypoint = arrayOf(inspection?.graph?.entrypoints)
    .some((entry) => nonemptyString(entry?.path));
  const hasGate = plan.buildings.some((building) => building.facilityKind === 'gate');
  if (!hasObservedEntrypoint || !hasGate) {
    issues.push(issue(
      'REACHABLE',
      'No observed repository entrypoint exists; the town remains explorable from the town hall.',
      'warning'
    ));
  }
  return issues;
}

function transitionPropIndexes(plan) {
  const byEdge = new Map();
  const byCoord = new Map();
  const props = plan.props.filter(({ kind }) => kind === 'bridge' || kind === 'stairs');
  for (const prop of props) {
    const edgeProps = byEdge.get(prop.navEdgeId) ?? [];
    edgeProps.push(prop);
    byEdge.set(prop.navEdgeId, edgeProps);
    const coordProps = byCoord.get(coordKey(prop.x, prop.y)) ?? [];
    coordProps.push(prop);
    byCoord.set(coordKey(prop.x, prop.y), coordProps);
  }
  return { props, byEdge, byCoord };
}

function boundaryKindAt(plan, node) {
  const candidates = [
    [[-1, 0], [1, 0]],
    [[0, -1], [0, 1]]
  ];
  for (const [leftOffset, rightOffset] of candidates) {
    const left = terrainAt(plan, node.x + leftOffset[0], node.y + leftOffset[1]);
    const right = terrainAt(plan, node.x + rightOffset[0], node.y + rightOffset[1]);
    if (!left || !right || left.walkable || right.walkable || left.assetId !== right.assetId) continue;
    if (left.assetId === 'terrain.water') return 'bridge';
    if (left.assetId === 'terrain.cliff') return 'stairs';
  }
  return null;
}

function checkTransitionEdge(plan, indexes, edge, from, to, prop) {
  const issues = [];
  const expectedAssetId = edge.kind === 'bridge' ? 'structure.bridge_stone' : 'structure.stairs_stone';
  const expectedBoundaryId = edge.kind === 'bridge' ? 'terrain.water' : 'terrain.cliff';
  if (prop.assetId !== expectedAssetId) {
    issues.push(issue('WALKABLE', `${edge.kind} edge "${edge.id}" has the wrong transition asset.`));
  }
  const markerIsFrom = prop.x === from.x && prop.y === from.y;
  const markerIsTo = prop.x === to.x && prop.y === to.y;
  if (markerIsFrom === markerIsTo) {
    issues.push(issue('WALKABLE', `${edge.kind} edge "${edge.id}" transition marker must occupy exactly one endpoint.`));
    return issues;
  }
  const marker = markerIsFrom ? from : to;
  const other = markerIsFrom ? to : from;
  if (edge.kind === 'stairs' && marker.elevation !== Math.max(from.elevation, to.elevation)) {
    issues.push(issue('WALKABLE', `stairs edge "${edge.id}" marker must occupy its higher endpoint.`));
  }
  const dx = marker.x - other.x;
  const dy = marker.y - other.y;
  const sideA = terrainAt(plan, marker.x - dy, marker.y + dx);
  const sideB = terrainAt(plan, marker.x + dy, marker.y - dx);
  if (!sideA || !sideB
    || sideA.assetId !== expectedBoundaryId || sideB.assetId !== expectedBoundaryId
    || sideA.walkable || sideB.walkable) {
    issues.push(issue('WALKABLE', `${edge.kind} edge "${edge.id}" does not cross its ${expectedBoundaryId} boundary.`));
  }
  if (edge.kind === 'stairs' && (sideA?.elevation !== marker.elevation || sideB?.elevation !== marker.elevation)) {
    issues.push(issue('WALKABLE', `stairs edge "${edge.id}" cliff boundary has the wrong elevation.`));
  }
  const beyondX = marker.x + dx;
  const beyondY = marker.y + dy;
  const beyondTerrain = terrainAt(plan, beyondX, beyondY);
  const beyondId = indexes.outdoorByCoord.get(coordKey(beyondX, beyondY));
  const beyond = beyondId ? indexes.byId.get(beyondId) : null;
  if (beyondTerrain?.walkable !== true || !beyond || beyond.elevation !== marker.elevation) {
    issues.push(issue('WALKABLE', `${edge.kind} edge "${edge.id}" does not continue onto reachable ground beyond its marker.`));
  }
  return issues;
}

function checkWalkableNavigation(plan, indexes, reached) {
  const issues = [];
  const buildingById = new Map(plan.buildings.map((building) => [building.id, building]));
  const transitionProps = transitionPropIndexes(plan);
  for (const key of [...indexes.duplicateOutdoorCoords].sort(compareStrings)) {
    issues.push(issue('WALKABLE', `Outdoor navigation coordinate "${key}" has more than one node.`));
  }
  for (let index = 0; index < plan.terrain.length; index += 1) {
    if (plan.terrain[index].walkable !== true) continue;
    const x = index % plan.world.widthTiles;
    const y = Math.floor(index / plan.world.widthTiles);
    if (!indexes.outdoorByCoord.has(coordKey(x, y))) {
      issues.push(issue('WALKABLE', `Walkable terrain at (${x},${y}) has no outdoor navigation node.`));
    }
  }
  for (const node of plan.nav.nodes) {
    if (node.space === 'outdoor') {
      const terrain = terrainAt(plan, node.x, node.y);
      if (terrain?.walkable !== true) {
        issues.push(issue('WALKABLE', `Outdoor navigation node "${node.id}" is not on walkable terrain.`));
      }
      if (terrain && node.elevation !== terrain.elevation) {
        issues.push(issue('WALKABLE', `Outdoor navigation node "${node.id}" elevation differs from its terrain.`));
      }
      const boundaryKind = boundaryKindAt(plan, node);
      if (boundaryKind && !(transitionProps.byCoord.get(coordKey(node.x, node.y)) ?? [])
        .some(({ kind }) => kind === boundaryKind)) {
        issues.push(issue('WALKABLE', `Outdoor boundary node "${node.id}" lacks its ${boundaryKind} transition marker.`));
      }
    }
    if (!reached.has(node.id)) {
      issues.push(issue('WALKABLE', `Navigation node "${node.id}" is disconnected from playerStart.`));
    }
  }
  const start = indexes.byId.get(plan.playerStart.navNodeId);
  if (!start || start.space !== 'outdoor'
    || start.x !== plan.playerStart.x || start.y !== plan.playerStart.y) {
    issues.push(issue('WALKABLE', 'playerStart must match its outdoor navigation node.'));
  }
  for (const prop of transitionProps.props) {
    const edge = indexes.edgeById.get(prop.navEdgeId);
    if (edge?.kind !== prop.kind) {
      issues.push(issue('WALKABLE', `Transition prop "${prop.id}" does not bind a matching ${prop.kind} edge.`));
    }
  }
  for (const edge of plan.nav.edges) {
    const from = indexes.byId.get(edge.from);
    const to = indexes.byId.get(edge.to);
    if (!from || !to) continue;
    if (edge.kind === 'door') {
      if (new Set([from.space, to.space]).size !== 2
        || ![from.space, to.space].includes('outdoor')
        || ![from.space, to.space].includes('interior')) {
        issues.push(issue('INTERIOR_WALKABLE', `Door edge "${edge.id}" must connect one outdoor and one interior node.`));
      } else {
        const outdoor = from.space === 'outdoor' ? from : to;
        const interior = from.space === 'interior' ? from : to;
        const building = buildingById.get(interior.buildingId);
        const expectedInterior = building ? interiorEntrancePoint(building) : null;
        if (!building
          || outdoor.x !== building.entrance.x || outdoor.y !== building.entrance.y
          || !pointInRect(interior, building.footprint)
          || interior.x !== expectedInterior.x || interior.y !== expectedInterior.y
          || interior.elevation !== outdoor.elevation) {
          issues.push(issue(
            'INTERIOR_WALKABLE',
            `Door edge "${edge.id}" must bind the exact entrance and interior of building "${interior.buildingId}" at its immediately-inside tile and one elevation.`
          ));
        }
      }
      continue;
    }
    const distance = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    if (distance !== 1 || from.space !== to.space) {
      issues.push(issue('WALKABLE', `Navigation edge "${edge.id}" must join adjacent nodes in the same space.`));
    }
    const boundProps = transitionProps.byEdge.get(edge.id) ?? [];
    if (edge.kind === 'walk') {
      if (from.elevation !== to.elevation) {
        issues.push(issue('WALKABLE', `Walk edge "${edge.id}" must remain at one elevation.`));
      }
      if (boundProps.length > 0) {
        issues.push(issue('WALKABLE', `Walk edge "${edge.id}" must not claim a transition marker.`));
      }
      continue;
    }
    if (from.space !== 'outdoor' || to.space !== 'outdoor') {
      issues.push(issue('WALKABLE', `${edge.kind} edge "${edge.id}" must remain outdoors.`));
    }
    const elevationDelta = Math.abs(from.elevation - to.elevation);
    if ((edge.kind === 'stairs' && elevationDelta !== 1)
      || (edge.kind === 'bridge' && elevationDelta !== 0)) {
      issues.push(issue(
        'WALKABLE',
        `${edge.kind} edge "${edge.id}" has an invalid elevation change of ${elevationDelta}.`
      ));
    }
    if (boundProps.length !== 1) {
      issues.push(issue('WALKABLE', `${edge.kind} edge "${edge.id}" must have exactly one bound transition marker.`));
    } else if (distance === 1 && from.space === 'outdoor' && to.space === 'outdoor') {
      issues.push(...checkTransitionEdge(plan, indexes, edge, from, to, boundProps[0]));
    }
  }
  return issues;
}

function edgeTarget(edge) {
  if (edge?.status === 'resolved') return nonemptyString(edge.to);
  if (edge?.status === 'unresolved') return nonemptyString(edge.targetHint);
  return null;
}

function normalizedObservedEdges(inspection) {
  const edges = [];
  for (const edge of arrayOf(inspection?.graph?.edges)) {
    const from = nonemptyString(edge?.from);
    const target = edgeTarget(edge);
    if (!from || !target || !['resolved', 'unresolved'].includes(edge?.status)) continue;
    edges.push({
      from,
      to: edge.status === 'resolved' ? target : null,
      targetHint: edge.status === 'unresolved' ? target : null,
      kind: nonemptyString(edge.kind) ?? 'import',
      status: edge.status
    });
  }
  return edges;
}

function repositoryEdgeIdentity(edge) {
  return [edge.from, edge.to ?? '', edge.targetHint ?? '', edge.kind, edge.status].join('\0');
}

function repositoryEdgeBinding(edge) {
  return `${edge.from}→${edge.status === 'resolved' ? edge.to : edge.targetHint}`;
}

function tilesConnected(tiles) {
  if (tiles.length <= 1) return true;
  const remaining = new Set(tiles.map(([x, y]) => coordKey(x, y)));
  const queue = [tiles[0]];
  remaining.delete(coordKey(tiles[0][0], tiles[0][1]));
  for (let head = 0; head < queue.length; head += 1) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = coordKey(x + dx, y + dy);
      if (!remaining.has(key)) continue;
      remaining.delete(key);
      queue.push([x + dx, y + dy]);
    }
  }
  return remaining.size === 0;
}

function tileSet(street) {
  return new Set(street.tiles.map(([x, y]) => coordKey(x, y)));
}

function checkImportStreets(plan, inspection) {
  const issues = [];
  const authoritativeEdges = normalizedObservedEdges(inspection);
  const authoritative = new Map();
  for (const edge of authoritativeEdges) {
    const identity = repositoryEdgeIdentity(edge);
    authoritative.set(identity, (authoritative.get(identity) ?? 0) + 1);
  }
  const represented = new Map();
  const byFile = new Map();
  for (const building of plan.buildings) {
    for (const filePath of building.files) byFile.set(filePath, building);
  }
  for (const street of plan.streets) {
    if (!tilesConnected(street.tiles)) {
      issues.push(issue('STREET_CONNECTS_IMPORT', `Street "${street.id}" has a discontinuous tile path.`));
    }
    if (street.kind === 'civic-avenue') continue;
    const tiles = tileSet(street);
    for (let index = 0; index < street.edgeBindings.length; index += 1) {
      const edge = street.edgeBindings[index];
      const identity = repositoryEdgeIdentity(edge);
      const binding = repositoryEdgeBinding(edge);
      if (street.edges[index] !== binding) {
        issues.push(issue('STREET_CONNECTS_IMPORT', `Street "${street.id}" has a display binding that differs from its structured import.`));
      }
      if (!authoritative.has(identity)) {
        issues.push(issue('STREET_CONNECTS_IMPORT', `Street "${street.id}" claims unobserved import "${binding}" (${edge.kind}/${edge.status}).`));
        continue;
      }
      represented.set(identity, (represented.get(identity) ?? 0) + 1);
      const from = byFile.get(edge.from);
      const target = edge.status === 'resolved' ? byFile.get(edge.to) : null;
      if (!from || !tiles.has(coordKey(from.entrance.x, from.entrance.y))) {
        issues.push(issue('STREET_CONNECTS_IMPORT', `Street for "${binding}" does not begin at its source building.`));
      }
      if (edge.status === 'resolved'
        && (!target || !tiles.has(coordKey(target.entrance.x, target.entrance.y)))) {
        issues.push(issue('STREET_CONNECTS_IMPORT', `Street for "${binding}" does not reach its target building.`));
      }
    }
  }
  for (const [identity, count] of [...authoritative].sort(([left], [right]) => compareStrings(left, right))) {
    const representedCount = represented.get(identity) ?? 0;
    if (representedCount !== count) {
      const edge = authoritativeEdges.find((candidate) => repositoryEdgeIdentity(candidate) === identity);
      issues.push(issue(
        'STREET_CONNECTS_IMPORT',
        `Observed import "${repositoryEdgeBinding(edge)}" (${edge.kind}/${edge.status}) must have ${count} street binding(s); found ${representedCount}.`
      ));
    }
  }
  return issues;
}

function checkInteriors(plan, indexes, reached) {
  const issues = [];
  const npcById = new Map(plan.npcs.map((npc) => [npc.id, npc]));
  const buildingById = new Map(plan.buildings.map((building) => [building.id, building]));
  const claimedFloorIds = new Set();
  const claimedNpcIds = new Set();
  for (const building of plan.buildings) {
    const requiresInterior = INTERIOR_CLASSES.has(building.class);
    const interiorNodes = indexes.interiorsByBuilding.get(building.id) ?? [];
    const buildingDoors = indexes.doorsByBuilding.get(building.id) ?? [];
    const entranceId = indexes.outdoorByCoord.get(coordKey(building.entrance.x, building.entrance.y));
    const entranceNode = entranceId ? indexes.byId.get(entranceId) : null;
    if (requiresInterior && interiorNodes.length === 0) {
      issues.push(issue('INTERIOR_WALKABLE', `Building "${building.id}" has no interior navigation floor.`));
      continue;
    }
    if (requiresInterior && buildingDoors.length !== 1) {
      issues.push(issue(
        'INTERIOR_WALKABLE',
        `Building "${building.id}" must have exactly one door from its entrance to its interior; found ${buildingDoors.length}.`
      ));
    }
    if (!requiresInterior && buildingDoors.length > 0) {
      issues.push(issue('INTERIOR_WALKABLE', `Building "${building.id}" must not claim an arbitrary interior door.`));
    }
    if (!requiresInterior && interiorNodes.length > 0) {
      issues.push(issue('INTERIOR_WALKABLE', `Building "${building.id}" must not claim arbitrary interior floors.`));
    }
    if (requiresInterior && buildingDoors.length === 0) {
      continue;
    }

    const interiorCoords = new Set();
    for (const node of interiorNodes) {
      const key = coordKey(node.x, node.y);
      if (interiorCoords.has(key)) {
        issues.push(issue('INTERIOR_WALKABLE', `Interior floor coordinate "${key}" is duplicated inside building "${building.id}".`));
      }
      interiorCoords.add(key);
      if (!pointInRect(node, building.footprint)) {
        issues.push(issue('INTERIOR_WALKABLE', `Interior floor node "${node.id}" lies outside building "${building.id}".`));
      }
      if (!entranceNode || node.elevation !== entranceNode.elevation) {
        issues.push(issue('INTERIOR_WALKABLE', `Interior floor node "${node.id}" must share building "${building.id}" entrance elevation.`));
      }
      if (!reached.has(node.id)) {
        issues.push(issue('INTERIOR_WALKABLE', `Interior floor node "${node.id}" in "${building.id}" cannot be walked to.`));
      }
    }

    const commonFloors = interiorNodes.filter((node) => !Object.hasOwn(node, 'roomRef'));
    if (requiresInterior && building.rooms.length === 0
      && (interiorNodes.length !== 1 || commonFloors.length !== 1)) {
      issues.push(issue('INTERIOR_WALKABLE', `Building "${building.id}" without rooms must have exactly one common interior floor.`));
    }
    if (requiresInterior && building.rooms.length > 0 && commonFloors.length > 0) {
      issues.push(issue('INTERIOR_WALKABLE', `Building "${building.id}" with rooms must not have an unclaimed common interior floor.`));
    }

    const claimedFloorCoords = new Set();
    const buildingClaimedFloorIds = new Set();
    for (const room of building.rooms) {
      const roomFloorIds = new Set(room.floorNavNodeIds);
      for (const floorId of room.floorNavNodeIds) {
        const node = indexes.byId.get(floorId);
        const validInterior = requiresInterior && node?.space === 'interior'
          && node.buildingId === building.id && node.roomRef === room.file
          && pointInRect(node, building.footprint);
        const validEntranceFloor = !requiresInterior && node?.space === 'outdoor'
          && node.x === building.entrance.x && node.y === building.entrance.y;
        if (!node || (!validInterior && !validEntranceFloor)) {
          issues.push(issue('INTERIOR_WALKABLE', `Room "${room.file}" in "${building.id}" lacks its own interior floor node.`));
          continue;
        }
        if (claimedFloorIds.has(floorId)) {
          issues.push(issue('INTERIOR_WALKABLE', `Interior floor node "${floorId}" is shared by more than one room.`));
        }
        claimedFloorIds.add(floorId);
        buildingClaimedFloorIds.add(floorId);
        const floorCoord = coordKey(node.x, node.y);
        if (claimedFloorCoords.has(floorCoord)) {
          issues.push(issue(
            'INTERIOR_WALKABLE',
            `Room floor coordinate "${floorCoord}" is shared inside building "${building.id}".`
          ));
        }
        claimedFloorCoords.add(floorCoord);
        if (!reached.has(floorId)) {
          issues.push(issue('INTERIOR_WALKABLE', `Room "${room.file}" in "${building.id}" cannot be walked to.`));
        }
      }
      const npc = npcById.get(room.npcId);
      if (!npc || npc.home !== building.id) {
        issues.push(issue('INTERIOR_WALKABLE', `Room "${room.file}" in "${building.id}" lacks its own resident.`));
        continue;
      }
      if (claimedNpcIds.has(npc.id)) {
        issues.push(issue('INTERIOR_WALKABLE', `Resident "${npc.id}" is shared by more than one room.`));
      }
      claimedNpcIds.add(npc.id);
      const reachableFloorCoords = new Set([...roomFloorIds].flatMap((floorId) => {
        const node = indexes.byId.get(floorId);
        return node && reached.has(floorId) ? [coordKey(node.x, node.y)] : [];
      }));
      const patrolStaysOnOwnFloor = npc.patrol.length > 0
        && npc.patrol.every(([x, y]) => reachableFloorCoords.has(coordKey(x, y)));
      if (!patrolStaysOnOwnFloor) {
        issues.push(issue('INTERIOR_WALKABLE', `Resident "${npc.id}" cannot patrol only its own reachable room "${room.file}".`));
      }
    }

    if (requiresInterior && building.rooms.length > 0) {
      for (const node of interiorNodes) {
        if (!buildingClaimedFloorIds.has(node.id)) {
          issues.push(issue('INTERIOR_WALKABLE', `Interior floor node "${node.id}" in "${building.id}" is not claimed by exactly one room.`));
        }
      }
    }
  }

  for (const npc of plan.npcs) {
    const home = buildingById.get(npc.home);
    if (!home) {
      issues.push(issue('INTERIOR_WALKABLE', `NPC "${npc.id}" has no valid home building.`));
      continue;
    }
    const homeInteriorNodes = indexes.interiorsByBuilding.get(home.id) ?? [];
    let allowedCoords;
    let locationDescription;
    if (npc.role.startsWith('keeper.')) {
      const keeperX = home.entrance.x - 1;
      const keeperY = home.entrance.y;
      const keeperNodeId = indexes.outdoorByCoord.get(coordKey(keeperX, keeperY));
      const keeperNode = keeperNodeId ? indexes.byId.get(keeperNodeId) : null;
      allowedCoords = keeperNode && keeperNode.space === 'outdoor' && reached.has(keeperNode.id)
        ? new Set([coordKey(keeperX, keeperY)])
        : new Set();
      locationDescription = 'reachable outdoor tile beside its home entrance';
    } else if (homeInteriorNodes.length > 0) {
      allowedCoords = new Set(homeInteriorNodes
        .filter((node) => reached.has(node.id))
        .map((node) => coordKey(node.x, node.y)));
      locationDescription = 'reachable home interior';
    } else {
      const entranceId = indexes.outdoorByCoord.get(coordKey(home.entrance.x, home.entrance.y));
      allowedCoords = entranceId && reached.has(entranceId)
        ? new Set([coordKey(home.entrance.x, home.entrance.y)])
        : new Set();
      locationDescription = 'exact reachable home entrance';
    }
    if (npc.patrol.length === 0
      || npc.patrol.some(([x, y]) => !allowedCoords.has(coordKey(x, y)))) {
      issues.push(issue('INTERIOR_WALKABLE', `NPC "${npc.id}" must patrol only its ${locationDescription} at "${home.id}".`));
    }
    if (npc.role === 'resident' && !claimedNpcIds.has(npc.id)) {
      issues.push(issue('INTERIOR_WALKABLE', `Resident "${npc.id}" must be assigned to exactly one room in home "${home.id}".`));
    }
    if (npc.role.startsWith('keeper.')) {
      const facilityKind = npc.role.slice('keeper.'.length);
      if (home.facilityKind !== facilityKind) {
        issues.push(issue('INTERIOR_WALKABLE', `Keeper "${npc.id}" role "${npc.role}" must match home facility "${home.facilityKind ?? 'none'}" at "${home.id}".`));
      }
    }
    if (npc.role === 'dojo-student' && home.facilityKind !== 'dojo') {
      issues.push(issue('INTERIOR_WALKABLE', `Dojo student "${npc.id}" must have a dojo home; found "${home.facilityKind ?? 'none'}" at "${home.id}".`));
    }
    if (npc.role === 'witness' && home.id !== 'building.witness.resident') {
      issues.push(issue('INTERIOR_WALKABLE', `Witness "${npc.id}" must use the designated witness home "building.witness.resident".`));
    }
  }
  return issues;
}

function interactionFamily(building) {
  const identity = `${building.id} ${building.facilityKind ?? ''} ${building.assetId ?? ''} ${building.interaction?.verb ?? ''}`.toLowerCase();
  if (/town.?hall|civic|guild/.test(identity)) return 'ledger';
  if (/gate|bridge|harbor|dock/.test(identity)) return 'spatial';
  if (/dojo|school|archive|library/.test(identity)) return 'observe';
  if (/house|home|inn|residen|rowhouse/.test(identity)) return 'talk';
  if (/tower|survey|observatory|workshop/.test(identity)) return 'operate';
  return 'inspect';
}

function checkWitnessInteractions(plan) {
  const factIds = new Set(plan.facts.map(({ id }) => id));
  const witnessesByFamily = new Map();
  for (const building of plan.buildings) {
    const family = interactionFamily(building);
    if (family === 'ledger') continue;
    const validFacts = building.interaction.factRefs.filter((factId) => factIds.has(factId));
    if (validFacts.length > 0 && !witnessesByFamily.has(family)) {
      witnessesByFamily.set(family, building.id);
    }
  }
  if (witnessesByFamily.size >= 3) return [];
  return [issue(
    'WITNESS_INTERACTION',
    `First tour requires three non-ledger interaction families with facts; found ${witnessesByFamily.size}.`
  )];
}

// Integer Bresenham line, including both endpoints.
function lineTiles(from, to) {
  const points = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const sx = x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - y);
  const sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}

function firstSightlineBlocker(occupancy, from, to, ignoredIds = new Set()) {
  for (const point of lineTiles(from, to).slice(1, -1)) {
    const blocker = occupancy.get(coordKey(point.x, point.y));
    if (blocker && !ignoredIds.has(blocker.id)) return blocker;
  }
  return null;
}

function sightlineCorridorRows(plan, survey, minX, maxX) {
  const blockerByY = new Map();
  for (const building of plan.buildings) {
    if (building.id === survey.id
      || building.footprint.x > maxX
      || building.footprint.x + building.footprint.w - 1 < minX) continue;
    for (let y = building.footprint.y; y < building.footprint.y + building.footprint.h; y += 1) {
      const current = blockerByY.get(y);
      if (!current || compareStrings(building.id, current.id) < 0) blockerByY.set(y, building);
    }
  }
  return [...blockerByY].sort(([leftY], [rightY]) => leftY - rightY);
}

function firstCorridorBlocker(rows, fromY, toY) {
  const minimum = Math.min(fromY, toY) + 1;
  const maximum = Math.max(fromY, toY) - 1;
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle][0] < minimum) low = middle + 1;
    else high = middle;
  }
  return rows[low]?.[0] <= maximum ? rows[low][1] : null;
}

function checkSightlines(plan, indexes, occupancy) {
  const issues = [];
  const survey = plan.buildings.find((building) => building.id === 'building.survey_tower');
  if (!survey) {
    return [issue('SIGHTLINE_TO_LANDMARK', 'The permanent survey tower is missing.')];
  }
  const vantages = plan.districts.map((district) => ({
    district,
    vantage: {
      x: district.bounds.x + 1,
      y: district.bounds.y + Math.floor(district.bounds.h / 2)
    }
  }));
  const minX = Math.min(survey.entrance.x, ...vantages.map(({ vantage }) => vantage.x));
  const maxX = Math.max(survey.entrance.x, ...vantages.map(({ vantage }) => vantage.x));
  const corridorRows = sightlineCorridorRows(plan, survey, minX, maxX);
  for (const { district, vantage } of vantages) {
    if (!indexes.outdoorByCoord.has(coordKey(vantage.x, vantage.y))) {
      issues.push(issue('SIGHTLINE_TO_LANDMARK', `District "${district.id}" has no navigable landmark vantage.`));
      continue;
    }
    const blocker = firstCorridorBlocker(corridorRows, vantage.y, survey.entrance.y);
    if (blocker) {
      issues.push(issue('SIGHTLINE_TO_LANDMARK', `District "${district.id}" sightline to the survey tower is blocked by "${blocker.id}".`));
    }
  }
  const gate = plan.buildings.find((building) => building.facilityKind === 'gate');
  const townHall = plan.buildings.find((building) => building.facilityKind === 'town_hall');
  if (gate && townHall) {
    const blocker = firstSightlineBlocker(
      occupancy,
      gate.entrance,
      townHall.entrance,
      new Set([gate.id, townHall.id])
    );
    if (blocker) {
      issues.push(issue('SIGHTLINE_TO_LANDMARK', `Gate-to-town-hall sightline is blocked by "${blocker.id}".`));
    }
  }
  return issues;
}

/**
 * Crash-free semantic validation. STRUCTURE failures stop deeper checks so a
 * malformed candidate can never throw or be accidentally adopted.
 */
export function validateWorldPlan(plan, { inspection } = {}) {
  const shape = validateWorldPlanShape(plan);
  if (!shape.ok) return shape;
  let issues;
  try {
    const indexes = navIndexes(plan);
    const reached = reachableFrom(indexes.adjacency, plan.playerStart.navNodeId);
    const overlap = checkNoOverlap(plan);
    issues = [
      ...checkFileCoverage(plan, inspection),
      ...overlap.issues,
      ...checkSpriteClearance(plan),
      ...checkEntrances(plan, indexes),
      ...checkWalkableNavigation(plan, indexes, reached),
      ...checkReachability(plan, indexes, reached, inspection),
      ...checkImportStreets(plan, inspection),
      ...checkInteriors(plan, indexes, reached),
      ...checkWitnessInteractions(plan),
      ...checkSightlines(plan, indexes, overlap.occupancy)
    ];
  } catch {
    issues = [issue('STRUCTURE', 'WorldPlan semantic validation could not inspect the candidate safely.')];
  }
  issues.sort((left, right) => (
    compareStrings(left.code, right.code)
      || compareStrings(left.message, right.message)
      || compareStrings(left.severity, right.severity)
  ));
  return deepFreeze({ ok: !issues.some(({ severity }) => severity === 'error'), issues });
}

/** Return a fresh frozen plan with its semantic verdict embedded. */
export function annotateWorldPlan(plan, options = {}) {
  const validation = validateWorldPlan(plan, options);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return deepFreeze({ validation });
  }
  return deepFreeze({ ...plan, validation });
}
