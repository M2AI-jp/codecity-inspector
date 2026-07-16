// WorldPlan v2 shape contract.
//
// This module is deliberately limited to structural and referential checks.
// Geography/gameplay semantics such as STREET_CONNECTS_IMPORT,
// INTERIOR_WALKABLE, and SIGHTLINE_TO_LANDMARK belong to the later WorldPlan
// validator. It is pure, synchronous, deterministic, and read-only: there is
// no I/O, clock, locale-dependent ordering, or randomness here.

import { deepFreeze } from './schema.mjs';

export const WORLD_PLAN_VERSION = 2;
export const WORLD_GENERATOR_VERSION = '2.0.0';

export const WORLD_PLAN_TOP_LEVEL_FIELDS = deepFreeze([
  'schemaVersion',
  'seed',
  'inspectionDigest',
  'generatorVersion',
  'generation',
  'world',
  'terrain',
  'districts',
  'streets',
  'buildings',
  'npcs',
  'props',
  'lights',
  'facts',
  'nav',
  'playerStart',
  'validation'
]);

export const WORLD_PLAN_GENERATION_MODES = deepFreeze([
  'primary', 'retry', 'flat-fallback'
]);

export const WORLD_PLAN_STREET_KINDS = deepFreeze([
  'avenue', 'street', 'lane', 'seaway', 'civic-avenue'
]);

export const WORLD_PLAN_BUILDING_CLASSES = deepFreeze([
  'S', 'M', 'L', 'XL', 'rowhouse_s', 'rowhouse_l', 'tower'
]);

export const WORLD_PLAN_ROOM_STATES = deepFreeze([
  'lit', 'dark', 'ivy', 'warning', 'scaffold'
]);

export const WORLD_PLAN_FACINGS = deepFreeze([
  'north', 'east', 'south', 'west'
]);

export const WORLD_PLAN_NAV_SPACES = deepFreeze(['outdoor', 'interior']);
export const WORLD_PLAN_NAV_EDGE_KINDS = deepFreeze([
  'walk', 'bridge', 'stairs', 'door'
]);
export const WORLD_PLAN_LIGHT_KINDS = deepFreeze([
  'window', 'lantern', 'hearth'
]);

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GENERATION_MODE_SET = new Set(WORLD_PLAN_GENERATION_MODES);
const STREET_KIND_SET = new Set(WORLD_PLAN_STREET_KINDS);
const BUILDING_CLASS_SET = new Set(WORLD_PLAN_BUILDING_CLASSES);
const ROOM_STATE_SET = new Set(WORLD_PLAN_ROOM_STATES);
const FACING_SET = new Set(WORLD_PLAN_FACINGS);
const NAV_SPACE_SET = new Set(WORLD_PLAN_NAV_SPACES);
const NAV_EDGE_KIND_SET = new Set(WORLD_PLAN_NAV_EDGE_KINDS);
const LIGHT_KIND_SET = new Set(WORLD_PLAN_LIGHT_KINDS);
const EVIDENCE_FIELDS = ['observed', 'inferred', 'unknown'];
const FACT_TYPE_SET = new Set([
  'entrypoint', 'unresolved', 'cycle', 'test_association', 'unverified',
  'unreached', 'runtime_unknown', 'truncation', 'facility_present',
  'facility_absent', 'survey_scope', 'external'
]);
const EDGE_STATUS_SET = new Set(['resolved', 'unresolved']);
const MACHINE_EVIDENCE_KEY = /^[a-z0-9_.-]+$/;

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isAcyclicJsonTree(value, active = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || (!Array.isArray(value) && !isPlainObject(value))) return false;
  if (active.has(value)) return false;
  active.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isAcyclicJsonTree(value[index], active)) {
        active.delete(value);
        return false;
      }
    }
  } else {
    for (const key of Object.keys(value)) {
      if (!isAcyclicJsonTree(value[key], active)) {
        active.delete(value);
        return false;
      }
    }
  }
  active.delete(value);
  return true;
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function structureIssue(message) {
  return { code: 'STRUCTURE', message, severity: 'error' };
}

function add(issues, path, message) {
  issues.push(structureIssue(`${path} ${message}`));
}

function inspectObject(value, path, required, optional, issues) {
  if (!isPlainObject(value)) {
    add(issues, path, 'must be a plain object.');
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value).sort(compareStrings);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) add(issues, `${path}.${key}`, 'is required.');
  }
  for (const key of keys) {
    if (!allowed.has(key)) add(issues, `${path}.${key}`, 'is not allowed.');
  }
  return true;
}

function inspectArray(value, path, issues) {
  if (!Array.isArray(value)) {
    add(issues, path, 'must be an array.');
    return [];
  }
  return value;
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function requireNonemptyString(value, path, issues) {
  if (!isNonemptyString(value)) add(issues, path, 'must be a nonempty string.');
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value);
}

function requireInteger(value, path, issues, { minimum, maximum } = {}) {
  if (!isSafeInteger(value)
    || (minimum !== undefined && value < minimum)
    || (maximum !== undefined && value > maximum)) {
    const range = minimum !== undefined && maximum !== undefined
      ? ` from ${minimum} through ${maximum}`
      : minimum !== undefined ? ` greater than or equal to ${minimum}`
        : maximum !== undefined ? ` less than or equal to ${maximum}` : '';
    add(issues, path, `must be a safe integer${range}.`);
    return false;
  }
  return true;
}

function inBounds(width, height, x, y) {
  return isSafeInteger(x) && isSafeInteger(y)
    && x >= 0 && y >= 0 && x < width && y < height;
}

function inspectCoordinate(x, y, path, width, height, issues) {
  const validX = requireInteger(x, `${path}.x`, issues, { minimum: 0 });
  const validY = requireInteger(y, `${path}.y`, issues, { minimum: 0 });
  if (validX && validY && width > 0 && height > 0 && !inBounds(width, height, x, y)) {
    add(issues, path, 'must be inside world bounds.');
  }
}

function inspectTupleCoordinate(value, path, width, height, issues) {
  if (!Array.isArray(value) || value.length !== 2) {
    add(issues, path, 'must be an exact [x, y] tuple.');
    return;
  }
  inspectCoordinate(value[0], value[1], path, width, height, issues);
}

function inspectRectangle(value, path, width, height, issues) {
  if (!inspectObject(value, path, ['x', 'y', 'w', 'h'], [], issues)) return;
  const validX = requireInteger(value.x, `${path}.x`, issues, { minimum: 0 });
  const validY = requireInteger(value.y, `${path}.y`, issues, { minimum: 0 });
  const validW = requireInteger(value.w, `${path}.w`, issues, { minimum: 1 });
  const validH = requireInteger(value.h, `${path}.h`, issues, { minimum: 1 });
  if (validX && validY && validW && validH && width > 0 && height > 0
    && (value.x + value.w > width || value.y + value.h > height)) {
    add(issues, path, 'must fit completely inside world bounds.');
  }
}

function inspectStringArray(value, path, issues, { allowEmpty = true } = {}) {
  const values = inspectArray(value, path, issues);
  if (!allowEmpty && values.length === 0) add(issues, path, 'must not be empty.');
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    if (!isNonemptyString(values[index])) {
      add(issues, itemPath, 'must be a nonempty string.');
    } else if (seen.has(values[index])) {
      add(issues, itemPath, `duplicates "${values[index]}".`);
    } else {
      seen.add(values[index]);
    }
  }
  return values;
}

function collectIds(items, path, issues) {
  const ids = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isPlainObject(item)) continue;
    if (!isNonemptyString(item.id)) {
      add(issues, `${path}[${index}].id`, 'must be a nonempty string.');
    } else if (ids.has(item.id)) {
      add(issues, `${path}[${index}].id`, `duplicates "${item.id}".`);
    } else {
      ids.add(item.id);
    }
  }
  return ids;
}

function requireReference(value, path, targets, targetName, issues) {
  if (isNonemptyString(value) && !targets.has(value)) {
    add(issues, path, `references missing ${targetName} "${value}".`);
  }
}

function requireReferences(values, path, targets, targetName, issues) {
  if (!Array.isArray(values)) return;
  for (let index = 0; index < values.length; index += 1) {
    requireReference(values[index], `${path}[${index}]`, targets, targetName, issues);
  }
}

function inspectTerrain(terrainValue, width, height, issues) {
  const terrain = inspectArray(terrainValue, 'worldPlan.terrain', issues);
  if (width > 0 && height > 0) {
    const expected = width * height;
    if (!Number.isSafeInteger(expected)) {
      add(issues, 'worldPlan.world', 'area must be a safe integer.');
    } else if (terrain.length !== expected) {
      add(issues, 'worldPlan.terrain', `must contain exactly ${expected} row-major cells.`);
    }
  }
  for (let index = 0; index < terrain.length; index += 1) {
    const cell = terrain[index];
    const path = `worldPlan.terrain[${index}]`;
    if (!inspectObject(cell, path, ['assetId', 'variant', 'elevation', 'walkable'], [], issues)) continue;
    requireNonemptyString(cell.assetId, `${path}.assetId`, issues);
    requireNonemptyString(cell.variant, `${path}.variant`, issues);
    requireInteger(cell.elevation, `${path}.elevation`, issues, { minimum: 0 });
    if (typeof cell.walkable !== 'boolean') add(issues, `${path}.walkable`, 'must be a boolean.');
  }
  return terrain;
}

function inspectDistricts(value, width, height, issues) {
  const districts = inspectArray(value, 'worldPlan.districts', issues);
  collectIds(districts, 'worldPlan.districts', issues);
  for (let index = 0; index < districts.length; index += 1) {
    const district = districts[index];
    const path = `worldPlan.districts[${index}]`;
    if (!inspectObject(district, path, ['id', 'dir', 'biome', 'bounds', 'landmarkId'], [], issues)) continue;
    requireNonemptyString(district.id, `${path}.id`, issues);
    if (typeof district.dir !== 'string') add(issues, `${path}.dir`, 'must be a string.');
    requireNonemptyString(district.biome, `${path}.biome`, issues);
    inspectRectangle(district.bounds, `${path}.bounds`, width, height, issues);
    requireNonemptyString(district.landmarkId, `${path}.landmarkId`, issues);
  }
  return districts;
}

function inspectStreets(value, width, height, issues) {
  const streets = inspectArray(value, 'worldPlan.streets', issues);
  collectIds(streets, 'worldPlan.streets', issues);
  for (let index = 0; index < streets.length; index += 1) {
    const street = streets[index];
    const path = `worldPlan.streets[${index}]`;
    if (!inspectObject(street, path, ['id', 'tiles', 'width', 'edges', 'edgeBindings', 'kind'], [], issues)) continue;
    requireNonemptyString(street.id, `${path}.id`, issues);
    const tiles = inspectArray(street.tiles, `${path}.tiles`, issues);
    if (tiles.length === 0) add(issues, `${path}.tiles`, 'must not be empty.');
    for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
      inspectTupleCoordinate(tiles[tileIndex], `${path}.tiles[${tileIndex}]`, width, height, issues);
    }
    requireInteger(street.width, `${path}.width`, issues, { minimum: 1, maximum: 3 });
    const edges = inspectStringArray(street.edges, `${path}.edges`, issues);
    const edgeBindings = inspectArray(street.edgeBindings, `${path}.edgeBindings`, issues);
    for (let bindingIndex = 0; bindingIndex < edgeBindings.length; bindingIndex += 1) {
      const binding = edgeBindings[bindingIndex];
      const bindingPath = `${path}.edgeBindings[${bindingIndex}]`;
      if (!inspectObject(binding, bindingPath, ['from', 'to', 'targetHint', 'kind', 'status'], [], issues)) continue;
      requireNonemptyString(binding.from, `${bindingPath}.from`, issues);
      requireNonemptyString(binding.kind, `${bindingPath}.kind`, issues);
      if (!EDGE_STATUS_SET.has(binding.status)) {
        add(issues, `${bindingPath}.status`, 'must be resolved or unresolved.');
      }
      if (binding.status === 'resolved') {
        requireNonemptyString(binding.to, `${bindingPath}.to`, issues);
        if (binding.targetHint !== null) add(issues, `${bindingPath}.targetHint`, 'must be null for a resolved edge.');
      } else {
        if (binding.to !== null) add(issues, `${bindingPath}.to`, 'must be null for an unresolved edge.');
        requireNonemptyString(binding.targetHint, `${bindingPath}.targetHint`, issues);
      }
    }
    if (!STREET_KIND_SET.has(street.kind)) {
      add(issues, `${path}.kind`, 'must be a supported street kind.');
    } else if (street.kind !== 'civic-avenue' && (edges.length === 0 || edgeBindings.length === 0)) {
      add(issues, `${path}.edges`, 'and edgeBindings may be empty only for a civic-avenue.');
    } else if (street.kind === 'civic-avenue' && (edges.length > 0 || edgeBindings.length > 0)) {
      add(issues, path, 'a civic-avenue must not claim repository edge bindings.');
    }
    if (edges.length !== edgeBindings.length) {
      add(issues, path, 'must keep edges and edgeBindings in a one-to-one relationship.');
    }
  }
  return streets;
}

function inspectBuildings(value, width, height, issues) {
  const buildings = inspectArray(value, 'worldPlan.buildings', issues);
  collectIds(buildings, 'worldPlan.buildings', issues);
  const roomFiles = new Set();
  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index];
    const path = `worldPlan.buildings[${index}]`;
    if (!inspectObject(building, path, [
      'id', 'assetId', 'files', 'class', 'footprint', 'entrance', 'rooms',
      'overlays', 'interaction'
    ], ['facilityKind'], issues)) continue;
    requireNonemptyString(building.id, `${path}.id`, issues);
    requireNonemptyString(building.assetId, `${path}.assetId`, issues);
    const files = inspectStringArray(building.files, `${path}.files`, issues);
    const fileSet = new Set(files.filter(isNonemptyString));
    if (fileSet.size !== files.length) add(issues, `${path}.files`, 'must not contain duplicate file paths.');
    if (!BUILDING_CLASS_SET.has(building.class)) {
      add(issues, `${path}.class`, 'must be a supported building class.');
    }
    if (Object.hasOwn(building, 'facilityKind')) {
      requireNonemptyString(building.facilityKind, `${path}.facilityKind`, issues);
    }
    inspectRectangle(building.footprint, `${path}.footprint`, width, height, issues);
    if (inspectObject(building.entrance, `${path}.entrance`, ['x', 'y', 'dir'], [], issues)) {
      inspectCoordinate(building.entrance.x, building.entrance.y, `${path}.entrance`, width, height, issues);
      if (!FACING_SET.has(building.entrance.dir)) {
        add(issues, `${path}.entrance.dir`, 'must be north, east, south, or west.');
      }
    }
    const rooms = inspectArray(building.rooms, `${path}.rooms`, issues);
    const buildingRoomFiles = new Set();
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
      const room = rooms[roomIndex];
      const roomPath = `${path}.rooms[${roomIndex}]`;
      if (!inspectObject(room, roomPath, [
        'file', 'state', 'npcId', 'props', 'floorNavNodeIds'
      ], [], issues)) continue;
      requireNonemptyString(room.file, `${roomPath}.file`, issues);
      if (isNonemptyString(room.file)) {
        if (!fileSet.has(room.file)) add(issues, `${roomPath}.file`, 'must also appear in the building files list.');
        buildingRoomFiles.add(room.file);
        if (roomFiles.has(room.file)) add(issues, `${roomPath}.file`, `duplicates room file "${room.file}".`);
        roomFiles.add(room.file);
      }
      if (!ROOM_STATE_SET.has(room.state)) add(issues, `${roomPath}.state`, 'must be a supported room state.');
      if (room.npcId !== null && !isNonemptyString(room.npcId)) {
        add(issues, `${roomPath}.npcId`, 'must be null or a nonempty string.');
      }
      inspectStringArray(room.props, `${roomPath}.props`, issues);
      inspectStringArray(room.floorNavNodeIds, `${roomPath}.floorNavNodeIds`, issues, { allowEmpty: false });
    }
    for (const file of fileSet) {
      if (!buildingRoomFiles.has(file)) add(issues, `${path}.rooms`, `must contain exactly one room for building file "${file}".`);
    }
    if (buildingRoomFiles.size !== fileSet.size) {
      add(issues, `${path}.rooms`, 'must map one-to-one with the building files list.');
    }
    inspectStringArray(building.overlays, `${path}.overlays`, issues);
    const interaction = building.interaction;
    if (inspectObject(interaction, `${path}.interaction`, ['anchor', 'verb', 'factRefs'], [], issues)) {
      const anchor = interaction.anchor;
      if (inspectObject(anchor, `${path}.interaction.anchor`, ['x', 'y'], [], issues)) {
        inspectCoordinate(anchor.x, anchor.y, `${path}.interaction.anchor`, width, height, issues);
      }
      requireNonemptyString(interaction.verb, `${path}.interaction.verb`, issues);
      inspectStringArray(interaction.factRefs, `${path}.interaction.factRefs`, issues);
    }
  }
  return { buildings, roomFiles };
}

function inspectNpcs(value, width, height, issues) {
  const npcs = inspectArray(value, 'worldPlan.npcs', issues);
  collectIds(npcs, 'worldPlan.npcs', issues);
  for (let index = 0; index < npcs.length; index += 1) {
    const npc = npcs[index];
    const path = `worldPlan.npcs[${index}]`;
    if (!inspectObject(npc, path, ['id', 'assetId', 'role', 'home', 'patrol', 'factRefs'], [], issues)) continue;
    requireNonemptyString(npc.id, `${path}.id`, issues);
    requireNonemptyString(npc.assetId, `${path}.assetId`, issues);
    requireNonemptyString(npc.role, `${path}.role`, issues);
    requireNonemptyString(npc.home, `${path}.home`, issues);
    const patrol = inspectArray(npc.patrol, `${path}.patrol`, issues);
    if (patrol.length === 0) add(issues, `${path}.patrol`, 'must not be empty.');
    for (let pointIndex = 0; pointIndex < patrol.length; pointIndex += 1) {
      inspectTupleCoordinate(patrol[pointIndex], `${path}.patrol[${pointIndex}]`, width, height, issues);
    }
    inspectStringArray(npc.factRefs, `${path}.factRefs`, issues);
  }
  return npcs;
}

function inspectProps(value, width, height, issues) {
  const props = inspectArray(value, 'worldPlan.props', issues);
  collectIds(props, 'worldPlan.props', issues);
  for (let index = 0; index < props.length; index += 1) {
    const prop = props[index];
    const path = `worldPlan.props[${index}]`;
    if (!inspectObject(prop, path, ['id', 'assetId', 'kind', 'x', 'y'], ['factRef', 'navEdgeId'], issues)) continue;
    requireNonemptyString(prop.id, `${path}.id`, issues);
    requireNonemptyString(prop.assetId, `${path}.assetId`, issues);
    requireNonemptyString(prop.kind, `${path}.kind`, issues);
    inspectCoordinate(prop.x, prop.y, path, width, height, issues);
    if (Object.hasOwn(prop, 'factRef')) requireNonemptyString(prop.factRef, `${path}.factRef`, issues);
    const isTransition = prop.kind === 'bridge' || prop.kind === 'stairs';
    if (isTransition) requireNonemptyString(prop.navEdgeId, `${path}.navEdgeId`, issues);
    else if (Object.hasOwn(prop, 'navEdgeId')) {
      add(issues, `${path}.navEdgeId`, 'is allowed only for a bridge or stairs transition prop.');
    }
  }
  return props;
}

function inspectLights(value, width, height, issues) {
  const lights = inspectArray(value, 'worldPlan.lights', issues);
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index];
    const path = `worldPlan.lights[${index}]`;
    if (!inspectObject(light, path, ['x', 'y', 'assetId', 'kind', 'on'], ['roomRef'], issues)) continue;
    inspectCoordinate(light.x, light.y, path, width, height, issues);
    requireNonemptyString(light.assetId, `${path}.assetId`, issues);
    if (!LIGHT_KIND_SET.has(light.kind)) add(issues, `${path}.kind`, 'must be window, lantern, or hearth.');
    if (typeof light.on !== 'boolean') add(issues, `${path}.on`, 'must be a boolean.');
    if (Object.hasOwn(light, 'roomRef')) requireNonemptyString(light.roomRef, `${path}.roomRef`, issues);
  }
  return lights;
}

function inspectFacts(value, issues) {
  const facts = inspectArray(value, 'worldPlan.facts', issues);
  collectIds(facts, 'worldPlan.facts', issues);
  const evidenceClassByKey = new Map();
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    const path = `worldPlan.facts[${index}]`;
    if (!inspectObject(fact, path, ['id', 'type', 'params', 'evidence', 'sayings'], [], issues)) continue;
    requireNonemptyString(fact.id, `${path}.id`, issues);
    if (!FACT_TYPE_SET.has(fact.type)) add(issues, `${path}.type`, 'must be a supported fact type.');
    if (!isPlainObject(fact.params)) add(issues, `${path}.params`, 'must be a plain object.');
    const evidence = fact.evidence;
    if (!inspectObject(evidence, `${path}.evidence`, EVIDENCE_FIELDS, [], issues)) continue;
    for (const field of EVIDENCE_FIELDS) {
      const keys = inspectStringArray(evidence[field], `${path}.evidence.${field}`, issues);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex];
        if (!isNonemptyString(key)) continue;
        if (!MACHINE_EVIDENCE_KEY.test(key)) {
          add(issues, `${path}.evidence.${field}[${keyIndex}]`, 'must be a machine evidence key.');
        }
        const prior = evidenceClassByKey.get(key);
        if (prior && prior !== field) {
          add(issues, `${path}.evidence.${field}[${keyIndex}]`, `reclassifies evidence key "${key}" from ${prior}.`);
        } else {
          evidenceClassByKey.set(key, field);
        }
      }
    }
    if (inspectObject(fact.sayings, `${path}.sayings`, ['primary', 'reflect'], [], issues)) {
      requireNonemptyString(fact.sayings.primary, `${path}.sayings.primary`, issues);
      inspectStringArray(fact.sayings.reflect, `${path}.sayings.reflect`, issues);
    }
  }
  return facts;
}

function inspectNav(value, width, height, issues) {
  if (!inspectObject(value, 'worldPlan.nav', ['nodes', 'edges'], [], issues)) {
    return { nodes: [], edges: [] };
  }
  const nodes = inspectArray(value.nodes, 'worldPlan.nav.nodes', issues);
  const edges = inspectArray(value.edges, 'worldPlan.nav.edges', issues);
  collectIds(nodes, 'worldPlan.nav.nodes', issues);
  collectIds(edges, 'worldPlan.nav.edges', issues);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const path = `worldPlan.nav.nodes[${index}]`;
    if (!inspectObject(node, path, ['id', 'x', 'y', 'elevation', 'space'], ['buildingId', 'roomRef'], issues)) continue;
    requireNonemptyString(node.id, `${path}.id`, issues);
    inspectCoordinate(node.x, node.y, path, width, height, issues);
    requireInteger(node.elevation, `${path}.elevation`, issues, { minimum: 0 });
    if (!NAV_SPACE_SET.has(node.space)) add(issues, `${path}.space`, 'must be outdoor or interior.');
    if (node.space === 'outdoor') {
      if (Object.hasOwn(node, 'buildingId') || Object.hasOwn(node, 'roomRef')) {
        add(issues, path, 'an outdoor node must not claim an interior building or room.');
      }
    } else {
      requireNonemptyString(node.buildingId, `${path}.buildingId`, issues);
      if (Object.hasOwn(node, 'roomRef')) requireNonemptyString(node.roomRef, `${path}.roomRef`, issues);
    }
  }
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const path = `worldPlan.nav.edges[${index}]`;
    if (!inspectObject(edge, path, ['id', 'from', 'to', 'kind'], [], issues)) continue;
    requireNonemptyString(edge.id, `${path}.id`, issues);
    requireNonemptyString(edge.from, `${path}.from`, issues);
    requireNonemptyString(edge.to, `${path}.to`, issues);
    if (!NAV_EDGE_KIND_SET.has(edge.kind)) add(issues, `${path}.kind`, 'must be walk, bridge, stairs, or door.');
  }
  return { nodes, edges };
}

function inspectPlayerStart(value, width, height, issues) {
  if (!inspectObject(value, 'worldPlan.playerStart', ['x', 'y', 'facing', 'navNodeId'], [], issues)) return;
  inspectCoordinate(value.x, value.y, 'worldPlan.playerStart', width, height, issues);
  if (!FACING_SET.has(value.facing)) {
    add(issues, 'worldPlan.playerStart.facing', 'must be north, east, south, or west.');
  }
  requireNonemptyString(value.navNodeId, 'worldPlan.playerStart.navNodeId', issues);
}

function inspectEmbeddedValidation(value, issues) {
  if (!inspectObject(value, 'worldPlan.validation', ['ok', 'issues'], [], issues)) return;
  if (typeof value.ok !== 'boolean') add(issues, 'worldPlan.validation.ok', 'must be a boolean.');
  inspectArray(value.issues, 'worldPlan.validation.issues', issues);
}

function inspectReferences({ districts, buildings, npcs, props, lights, facts, nav, roomFiles, playerStart }, issues) {
  const buildingIds = new Set(buildings.filter(isPlainObject).map(({ id }) => id).filter(isNonemptyString));
  const npcIds = new Set(npcs.filter(isPlainObject).map(({ id }) => id).filter(isNonemptyString));
  const propIds = new Set(props.filter(isPlainObject).map(({ id }) => id).filter(isNonemptyString));
  const factIds = new Set(facts.filter(isPlainObject).map(({ id }) => id).filter(isNonemptyString));
  const nodeIds = new Set(nav.nodes.filter(isPlainObject).map(({ id }) => id).filter(isNonemptyString));
  const navEdgeIds = new Set(nav.edges.filter(isPlainObject).map(({ id }) => id).filter(isNonemptyString));
  const landmarkIds = new Set([...buildingIds, ...propIds]);

  for (let index = 0; index < districts.length; index += 1) {
    const district = districts[index];
    if (isPlainObject(district)) {
      requireReference(district.landmarkId, `worldPlan.districts[${index}].landmarkId`, landmarkIds, 'landmark', issues);
    }
  }
  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index];
    if (!isPlainObject(building)) continue;
    const rooms = Array.isArray(building.rooms) ? building.rooms : [];
    for (let roomIndex = 0; roomIndex < rooms.length; roomIndex += 1) {
      const room = rooms[roomIndex];
      if (!isPlainObject(room)) continue;
      const path = `worldPlan.buildings[${index}].rooms[${roomIndex}]`;
      if (room.npcId !== null) requireReference(room.npcId, `${path}.npcId`, npcIds, 'npc', issues);
      requireReferences(room.props, `${path}.props`, propIds, 'prop', issues);
      requireReferences(room.floorNavNodeIds, `${path}.floorNavNodeIds`, nodeIds, 'nav node', issues);
    }
    if (isPlainObject(building.interaction)) {
      requireReferences(
        building.interaction.factRefs,
        `worldPlan.buildings[${index}].interaction.factRefs`,
        factIds,
        'fact',
        issues
      );
    }
  }
  for (let index = 0; index < npcs.length; index += 1) {
    const npc = npcs[index];
    if (!isPlainObject(npc)) continue;
    requireReference(npc.home, `worldPlan.npcs[${index}].home`, buildingIds, 'building', issues);
    requireReferences(npc.factRefs, `worldPlan.npcs[${index}].factRefs`, factIds, 'fact', issues);
  }
  for (let index = 0; index < props.length; index += 1) {
    const prop = props[index];
    if (isPlainObject(prop) && Object.hasOwn(prop, 'factRef')) {
      requireReference(prop.factRef, `worldPlan.props[${index}].factRef`, factIds, 'fact', issues);
    }
    if (isPlainObject(prop) && Object.hasOwn(prop, 'navEdgeId')) {
      requireReference(prop.navEdgeId, `worldPlan.props[${index}].navEdgeId`, navEdgeIds, 'nav edge', issues);
    }
  }
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index];
    if (isPlainObject(light) && Object.hasOwn(light, 'roomRef')) {
      requireReference(light.roomRef, `worldPlan.lights[${index}].roomRef`, roomFiles, 'room', issues);
    }
  }
  for (let index = 0; index < nav.edges.length; index += 1) {
    const edge = nav.edges[index];
    if (!isPlainObject(edge)) continue;
    requireReference(edge.from, `worldPlan.nav.edges[${index}].from`, nodeIds, 'nav node', issues);
    requireReference(edge.to, `worldPlan.nav.edges[${index}].to`, nodeIds, 'nav node', issues);
  }
  for (let index = 0; index < nav.nodes.length; index += 1) {
    const node = nav.nodes[index];
    if (!isPlainObject(node) || node.space !== 'interior') continue;
    requireReference(node.buildingId, `worldPlan.nav.nodes[${index}].buildingId`, buildingIds, 'building', issues);
    if (Object.hasOwn(node, 'roomRef')) {
      requireReference(node.roomRef, `worldPlan.nav.nodes[${index}].roomRef`, roomFiles, 'room', issues);
    }
  }
  if (isPlainObject(playerStart)) {
    requireReference(playerStart.navNodeId, 'worldPlan.playerStart.navNodeId', nodeIds, 'nav node', issues);
  }
}

function inspectWorldPlan(plan) {
  const issues = [];
  if (!isAcyclicJsonTree(plan)) {
    add(issues, 'worldPlan', 'must be an acyclic JSON-shaped plain-data tree.');
    return issues;
  }
  if (!inspectObject(plan, 'worldPlan', WORLD_PLAN_TOP_LEVEL_FIELDS, [], issues)) return issues;

  if (plan.schemaVersion !== WORLD_PLAN_VERSION) {
    add(issues, 'worldPlan.schemaVersion', `must equal ${WORLD_PLAN_VERSION}.`);
  }
  requireNonemptyString(plan.seed, 'worldPlan.seed', issues);
  if (typeof plan.inspectionDigest !== 'string' || !SHA256_HEX.test(plan.inspectionDigest)) {
    add(issues, 'worldPlan.inspectionDigest', 'must be a lowercase SHA-256 digest.');
  }
  if (plan.generatorVersion !== WORLD_GENERATOR_VERSION) {
    add(issues, 'worldPlan.generatorVersion', `must equal "${WORLD_GENERATOR_VERSION}".`);
  }

  if (inspectObject(plan.generation, 'worldPlan.generation', ['mode', 'attempt'], [], issues)) {
    if (!GENERATION_MODE_SET.has(plan.generation.mode)) {
      add(issues, 'worldPlan.generation.mode', 'must be primary, retry, or flat-fallback.');
    }
    requireInteger(plan.generation.attempt, 'worldPlan.generation.attempt', issues, { minimum: 0, maximum: 3 });
  }

  let width = 0;
  let height = 0;
  if (inspectObject(plan.world, 'worldPlan.world', ['widthTiles', 'heightTiles', 'tileSize'], [], issues)) {
    if (requireInteger(plan.world.widthTiles, 'worldPlan.world.widthTiles', issues, { minimum: 1 })) width = plan.world.widthTiles;
    if (requireInteger(plan.world.heightTiles, 'worldPlan.world.heightTiles', issues, { minimum: 1 })) height = plan.world.heightTiles;
    if (plan.world.tileSize !== 64) add(issues, 'worldPlan.world.tileSize', 'must equal 64.');
  }

  inspectTerrain(plan.terrain, width, height, issues);
  const districts = inspectDistricts(plan.districts, width, height, issues);
  inspectStreets(plan.streets, width, height, issues);
  const { buildings, roomFiles } = inspectBuildings(plan.buildings, width, height, issues);
  const npcs = inspectNpcs(plan.npcs, width, height, issues);
  const props = inspectProps(plan.props, width, height, issues);
  const lights = inspectLights(plan.lights, width, height, issues);
  const facts = inspectFacts(plan.facts, issues);
  const nav = inspectNav(plan.nav, width, height, issues);
  inspectPlayerStart(plan.playerStart, width, height, issues);
  inspectEmbeddedValidation(plan.validation, issues);
  inspectReferences({
    districts, buildings, npcs, props, lights, facts, nav, roomFiles,
    playerStart: plan.playerStart
  }, issues);
  return issues;
}

/**
 * Crash-free structural validation for a candidate WorldPlan v2.
 *
 * This does not mutate or freeze the candidate. It returns a fresh, deeply
 * frozen verdict whose issues all use the STRUCTURE code and a deterministic
 * code-unit ordering.
 *
 * @param {unknown} plan
 * @returns {Readonly<{ok: boolean, issues: ReadonlyArray<Readonly<{code: 'STRUCTURE', message: string, severity: 'error'}>>}>}
 */
export function validateWorldPlanShape(plan) {
  let issues;
  try {
    issues = inspectWorldPlan(plan);
  } catch {
    issues = [structureIssue('worldPlan could not be inspected safely as plain data.')];
  }
  issues.sort((left, right) => (
    compareStrings(left.code, right.code)
      || compareStrings(left.message, right.message)
      || compareStrings(left.severity, right.severity)
  ));
  return deepFreeze({ ok: issues.length === 0, issues });
}
