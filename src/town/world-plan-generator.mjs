// Deterministic WorldPlan v2 generator.
//
// The generator deliberately uses three small, fixed LOD strategies instead of
// a general city-planning framework. Every scanned file is retained exactly once
// as either a building or a rowhouse room, and every observed static local edge
// is retained as a street binding. It consumes already-inspected plain data only;
// it never reads or executes the target repository.

import { buildWorldFacts } from './world-facts.mjs';
import { inspectionDigest, worldSeed as deriveWorldSeed } from './world-identity.mjs';
import { deepFreeze, FACILITY_KINDS } from './schema.mjs';
import { WORLD_GENERATOR_VERSION, WORLD_PLAN_VERSION } from './world-plan-schema.mjs';

const BIOMES = Object.freeze(['old-town', 'harbor', 'snow', 'woodland']);
const BIOME_RANK = new Map(BIOMES.map((biome, index) => [biome, index]));
const FACILITY_RANK = new Map([
  'gate', 'town_hall', 'dojo', 'house', 'inn', 'warehouse', 'dock', 'guild',
  'pub', 'shop', 'workshop', 'watchtower', 'well', 'ruin'
].map((kind, index) => [kind, index]));

const FACILITY_ASSETS = Object.freeze({
  gate: 'building.gate',
  town_hall: 'building.town_hall',
  dojo: 'building.dojo',
  inn: 'building.inn',
  warehouse: 'building.warehouse',
  dock: 'building.dock',
  guild: 'building.guild',
  pub: 'building.pub',
  shop: 'building.shop',
  workshop: 'building.workshop',
  watchtower: 'building.watchtower',
  well: 'structure.well',
  house: 'building.house_m',
  ruin: 'building.ruin'
});

const FACILITY_CLASSES = Object.freeze({
  gate: 'S', town_hall: 'XL', dojo: 'L', inn: 'L', warehouse: 'L', dock: 'L',
  guild: 'L', pub: 'L', shop: 'M', workshop: 'L', watchtower: 'tower', well: 'S',
  house: 'M', ruin: 'M'
});

const FOOTPRINTS = Object.freeze({
  S: Object.freeze({ w: 2, h: 2 }),
  M: Object.freeze({ w: 3, h: 3 }),
  L: Object.freeze({ w: 4, h: 4 }),
  XL: Object.freeze({ w: 5, h: 4 }),
  rowhouse_s: Object.freeze({ w: 6, h: 3 }),
  rowhouse_l: Object.freeze({ w: 8, h: 4 }),
  tower: Object.freeze({ w: 3, h: 4 })
});

const VERBS = Object.freeze({
  town_hall: 'receive-journal',
  gate: 'inspect-entry-tags',
  dojo: 'watch-forms',
  house: 'talk-neighbor',
  survey_tower: 'use-telescope'
});

const WITNESS_FACT_TYPES = Object.freeze({
  operate: Object.freeze(['entrypoint', 'truncation', 'runtime_unknown', 'survey_scope', 'facility_present', 'facility_absent']),
  talk: Object.freeze(['unverified', 'test_association', 'unreached', 'survey_scope', 'facility_present', 'facility_absent']),
  inspect: Object.freeze(['unresolved', 'cycle', 'runtime_unknown', 'unreached', 'survey_scope', 'facility_present', 'facility_absent']),
  spatial: Object.freeze(['entrypoint', 'unresolved', 'external', 'survey_scope', 'facility_present', 'facility_absent']),
  observe: Object.freeze(['cycle', 'test_association', 'unverified', 'survey_scope', 'facility_present', 'facility_absent']),
  ledger: Object.freeze(['facility_present', 'facility_absent', 'survey_scope'])
});

const KEEPER_ASSETS = Object.freeze({
  town_hall: 'character.town_clerk',
  gate: 'character.gatekeeper',
  dojo: 'character.dojo_inspector'
});

const FIRST_BUILDING_X = 7;
const DISTRICT_SPINE_X = 1;
const CELL_STRIDE_X = 9;
const ROW_STRIDE_Y = 7;
const MAX_FOOTPRINT_HEIGHT = 4;
const DISTRICT_GAP = 2;

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

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function shortDigest(value) {
  return inspectionDigest(value).slice(0, 16);
}

function canonicalDir(filePath) {
  const parts = String(filePath ?? '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

function groupingDir(filePath, lod) {
  const parts = String(filePath ?? '').split('/').filter(Boolean);
  if (parts.length <= 1) return '';
  if (lod === 'L2') return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
  return parts.slice(0, -1).join('/');
}

function edgeTarget(edge) {
  if (edge?.status === 'resolved') return nonemptyString(edge.to);
  if (edge?.status === 'unresolved') return nonemptyString(edge.targetHint);
  return null;
}

function edgeBinding(edge) {
  const from = nonemptyString(edge?.from);
  const target = edgeTarget(edge);
  return from && target ? `${from}→${target}` : null;
}

function normalizeFiles(inspection) {
  const graphByPath = new Map(arrayOf(inspection?.graph?.nodes)
    .filter((node) => nonemptyString(node?.path))
    .map((node) => [node.path, node]));
  const cityByPath = new Map(arrayOf(inspection?.city?.buildings)
    .filter((building) => nonemptyString(building?.path))
    .map((building) => [building.path, building]));
  const paths = [...new Set([...graphByPath.keys(), ...cityByPath.keys()])].sort(compareStrings);
  return paths.map((filePath) => {
    const graph = graphByPath.get(filePath) ?? {};
    const city = cityByPath.get(filePath) ?? {};
    return {
      path: filePath,
      dir: canonicalDir(filePath),
      bytes: Math.max(0, safeInteger(city.bytes ?? graph.bytes)),
      kind: nonemptyString(city.kind ?? graph.kind) ?? 'module',
      isTest: city.isTest === true || graph.isTest === true,
      state: nonemptyString(city.state) ?? 'mapped',
      evidence: {
        unresolvedLinks: Math.max(0, safeInteger(city.evidence?.unresolvedLinks)),
        cycle: city.evidence?.cycle === true,
        associatedTest: city.evidence?.associatedTest === true,
        reachability: nonemptyString(city.evidence?.reachability)
      }
    };
  });
}

function normalizeEdges(inspection) {
  const normalized = [];
  for (const edge of arrayOf(inspection?.graph?.edges)) {
    const binding = edgeBinding(edge);
    if (!binding) continue;
    normalized.push({
      from: edge.from,
      to: edge.status === 'resolved' ? edge.to : null,
      targetHint: edge.status === 'unresolved' ? edge.targetHint : null,
      kind: nonemptyString(edge.kind) ?? 'import',
      status: edge.status,
      binding
    });
  }
  return normalized.sort((left, right) => (
    compareStrings(left.binding, right.binding)
      || compareStrings(left.status, right.status)
      || compareStrings(left.kind, right.kind)
  ));
}

function normalizeFacilities(model) {
  const byKind = new Map(arrayOf(model?.facilities)
    .filter((facility) => nonemptyString(facility?.kind))
    .map((facility) => [facility.kind, facility]));
  return FACILITY_KINDS.map((kind) => {
    const facility = byKind.get(kind) ?? {};
    return {
      kind,
      present: kind === 'town_hall' || facility.present === true,
      count: Math.max(0, safeInteger(facility.count)),
      evidence: facility.evidence ?? { observed: [], inferred: [], unknown: [] }
    };
  });
}

export function worldPlanLodForFileCount(fileCount) {
  const count = Math.max(0, safeInteger(fileCount));
  if (count <= 120) return 'L0';
  if (count <= 600) return 'L1';
  return 'L2';
}

function roomState(file) {
  if (file.evidence.unresolvedLinks > 0 || file.state === 'unresolved-link') return 'warning';
  if (file.evidence.cycle === true || file.state === 'structural-warning') return 'scaffold';
  if (file.evidence.reachability === 'not-reached-from-known-entrypoints') return 'ivy';
  if (file.evidence.associatedTest === true) return 'lit';
  return 'dark';
}

function fileClass(file) {
  if (file.bytes < 2 * 1024) return 'S';
  if (file.bytes < 32 * 1024) return 'M';
  return 'L';
}

function fileAsset(file, buildingClass) {
  const state = roomState(file);
  if (state === 'ivy' || state === 'warning') return 'building.house_old';
  if (file.isTest) return 'building.hut';
  return buildingClass === 'S' ? 'building.house_s' : 'building.house_m';
}

function candidateMatches(kind, file, entrypointSet) {
  const path = file.path.toLowerCase();
  if (kind === 'gate') return entrypointSet.has(file.path);
  if (kind === 'dojo') return file.isTest;
  if (kind === 'house') return file.kind === 'module' && !file.isTest;
  if (kind === 'ruin') return file.evidence.reachability === 'not-reached-from-known-entrypoints';
  if (kind === 'inn') return file.kind === 'service' || /(?:server|route|service)/.test(path);
  if (kind === 'warehouse') return file.kind === 'data' || /(?:data|storage|model|db)/.test(path);
  if (kind === 'well') return file.kind === 'configuration' || /(?:config|env)/.test(path);
  if (kind === 'shop') return file.kind === 'interface' || /(?:component|view|ui)/.test(path);
  if (kind === 'dock') return /(?:deploy|release|package|publish)/.test(path);
  if (kind === 'workshop') return /(?:build|script|workflow|ci)/.test(path);
  if (kind === 'watchtower') return /(?:log|monitor|alert)/.test(path);
  if (kind === 'pub' || kind === 'guild') return /(?:api|route|client|webhook)/.test(path);
  return false;
}

function oldTownDir(files, inspection) {
  const filePaths = new Set(files.map(({ path }) => path));
  const entry = arrayOf(inspection?.graph?.entrypoints)
    .map(({ path }) => path)
    .filter((filePath) => filePaths.has(filePath))
    .sort(compareStrings)[0];
  return entry ? canonicalDir(entry) : files[0]?.dir ?? '';
}

function factIndex(facts) {
  const byFile = new Map();
  const byFacility = new Map();
  const add = (filePath, factId) => {
    if (!nonemptyString(filePath)) return;
    const ids = byFile.get(filePath) ?? new Set();
    ids.add(factId);
    byFile.set(filePath, ids);
  };
  for (const fact of facts) {
    if (fact.type === 'facility_present' || fact.type === 'facility_absent') {
      if (nonemptyString(fact.params?.kind)) byFacility.set(fact.params.kind, fact.id);
    }
    add(fact.params?.path, fact.id);
    add(fact.params?.from, fact.id);
    add(fact.params?.source, fact.id);
    add(fact.params?.test, fact.id);
    for (const member of arrayOf(fact.params?.members)) add(member, fact.id);
  }
  return { byFile, byFacility };
}

function refsFor(files, facilityKind, indexes) {
  const refs = new Set();
  if (facilityKind && indexes.byFacility.has(facilityKind)) refs.add(indexes.byFacility.get(facilityKind));
  for (const file of files) {
    for (const factId of indexes.byFile.get(file.path) ?? []) refs.add(factId);
  }
  return [...refs].sort(compareStrings);
}

function interactionFamily(entity) {
  const identity = `${entity.id} ${entity.facilityKind ?? ''} ${entity.assetId ?? ''} ${entity.verb ?? entity.interaction?.verb ?? ''}`.toLowerCase();
  if (/town.?hall|civic|guild/.test(identity)) return 'ledger';
  if (/gate|bridge|harbor|dock/.test(identity)) return 'spatial';
  if (/dojo|school|archive|library/.test(identity)) return 'observe';
  if (/house|home|inn|residen|rowhouse/.test(identity)) return 'talk';
  if (/tower|survey|observatory|workshop/.test(identity)) return 'operate';
  return 'inspect';
}

function preferredFactId(facts, family, facilityKind = null) {
  if (facilityKind) {
    const facilityFact = facts.find((fact) => fact.params?.kind === facilityKind);
    if (facilityFact) return facilityFact.id;
  }
  const preferredTypes = WITNESS_FACT_TYPES[family] ?? [];
  for (const type of preferredTypes) {
    const candidates = facts.filter((fact) => fact.type === type);
    if (type === 'survey_scope') {
      const dimension = family === 'talk' ? 'files'
        : family === 'inspect' || family === 'spatial' ? 'static_dependencies'
          : 'repository';
      const scoped = candidates.find((fact) => fact.params?.dimension === dimension);
      if (scoped) return scoped.id;
    }
    if (candidates[0]) return candidates[0].id;
  }
  return facts[0]?.id ?? null;
}

function hydrateInteractionFacts(specs, facts) {
  return specs.map((spec) => {
    if (spec.factRefs.length > 0) return spec;
    const factId = preferredFactId(facts, interactionFamily(spec), spec.facilityKind);
    return factId ? { ...spec, factRefs: [factId] } : spec;
  });
}

function ensureWitnessSpecs(specs, facts, oldDir) {
  const result = [...specs];
  const families = new Set(['operate']); // building.survey_tower is permanent.
  for (const spec of result) {
    if (spec.factRefs.length > 0) families.add(interactionFamily(spec));
  }
  const fallbacks = [
    {
      key: 'witness:resident',
      id: 'building.witness.resident',
      dir: oldDir,
      assetId: 'building.hut',
      class: 'S',
      files: [],
      verb: 'talk-neighbor',
      family: 'talk'
    },
    {
      key: 'witness:field-station',
      id: 'building.witness.field_station',
      dir: oldDir,
      assetId: 'building.hut',
      class: 'S',
      files: [],
      verb: 'inspect-field-notice',
      family: 'inspect'
    }
  ];
  for (const fallback of fallbacks) {
    if ([...families].filter((family) => family !== 'ledger').length >= 3) break;
    if (families.has(fallback.family)) continue;
    const factId = preferredFactId(facts, fallback.family);
    if (!factId) continue;
    result.push({ ...fallback, factRefs: [factId] });
    families.add(fallback.family);
  }
  return result;
}

function facilitySpecs(files, facilities, inspection, oldDir, indexes) {
  const entrypointSet = new Set(arrayOf(inspection?.graph?.entrypoints).map(({ path }) => path));
  const used = new Set();
  const specs = [];
  const ordered = [...facilities].filter(({ present }) => present).sort((left, right) => (
    (FACILITY_RANK.get(left.kind) ?? 999) - (FACILITY_RANK.get(right.kind) ?? 999)
      || compareStrings(left.kind, right.kind)
  ));
  for (const facility of ordered) {
    let chosen = null;
    if (facility.kind !== 'town_hall') {
      chosen = files.find((file) => !used.has(file.path) && candidateMatches(facility.kind, file, entrypointSet)) ?? null;
    }
    if (chosen) used.add(chosen.path);
    const assignedFiles = chosen ? [chosen] : [];
    const buildingClass = FACILITY_CLASSES[facility.kind] ?? 'M';
    specs.push({
      key: `facility:${facility.kind}`,
      id: `building.facility.${facility.kind}`,
      dir: chosen?.dir ?? oldDir,
      assetId: FACILITY_ASSETS[facility.kind] ?? 'building.house_m',
      class: buildingClass,
      facilityKind: facility.kind,
      files: assignedFiles,
      factRefs: refsFor(assignedFiles, facility.kind, indexes),
      verb: VERBS[facility.kind] ?? 'read-away-sign'
    });
  }
  return { specs, used };
}

function degreeFaces(files, edges) {
  const degree = new Map(files.map(({ path }) => [path, 0]));
  for (const edge of edges) {
    if (edge.status !== 'resolved') continue;
    if (degree.has(edge.from)) degree.set(edge.from, degree.get(edge.from) + 1);
    if (degree.has(edge.to)) degree.set(edge.to, degree.get(edge.to) + 1);
  }
  const ranked = [...degree].sort((left, right) => right[1] - left[1] || compareStrings(left[0], right[0]));
  return new Set(ranked.slice(0, Math.ceil(ranked.length * 0.2)).filter(([, value]) => value > 0).map(([path]) => path));
}

function individualSpec(file, indexes) {
  const buildingClass = fileClass(file);
  return {
    key: `file:${file.path}`,
    id: `building.file.${shortDigest(file.path)}`,
    dir: file.dir,
    assetId: fileAsset(file, buildingClass),
    class: buildingClass,
    files: [file],
    factRefs: refsFor([file], null, indexes),
    verb: 'talk-neighbor'
  };
}

function rowhouseSpec(groupKey, chunk, lod, indexes) {
  const small = lod === 'L1' && chunk.length <= 8;
  return {
    key: `rowhouse:${groupKey}:${chunk[0].path}`,
    id: `building.rowhouse.${shortDigest(chunk.map(({ path }) => path))}`,
    dir: chunk[0].dir,
    assetId: small ? 'building.rowhouse_s' : 'building.rowhouse_l',
    class: small ? 'rowhouse_s' : 'rowhouse_l',
    files: chunk,
    factRefs: refsFor(chunk, null, indexes),
    verb: 'talk-neighbor'
  };
}

function remainingSpecs(files, used, lod, edges, indexes) {
  const remaining = files.filter(({ path }) => !used.has(path));
  if (lod === 'L0') return remaining.map((file) => individualSpec(file, indexes));
  const highDegree = degreeFaces(files, edges);
  const faces = [];
  const grouped = new Map();
  for (const file of remaining) {
    const hasWarning = file.evidence.unresolvedLinks > 0 || file.evidence.cycle === true
      || file.evidence.reachability === 'not-reached-from-known-entrypoints';
    if (file.isTest || hasWarning || highDegree.has(file.path)) {
      faces.push(individualSpec(file, indexes));
      continue;
    }
    const key = groupingDir(file.path, lod);
    const values = grouped.get(key) ?? [];
    values.push(file);
    grouped.set(key, values);
  }
  const rowhouses = [];
  const chunkSize = lod === 'L2' ? 24 : 12;
  for (const [key, values] of [...grouped].sort(([left], [right]) => compareStrings(left, right))) {
    values.sort((left, right) => compareStrings(left.path, right.path));
    for (let index = 0; index < values.length; index += chunkSize) {
      rowhouses.push(rowhouseSpec(key, values.slice(index, index + chunkSize), lod, indexes));
    }
  }
  return [...faces, ...rowhouses];
}

function directoryScoresByDir(dirs, files) {
  const scores = new Map(dirs.map((dir) => [dir, { harbor: 0, snow: 0, woodland: 0 }]));
  for (const file of files) {
    const score = scores.get(file.dir);
    if (!score) continue;
    if (file.kind === 'service' || file.kind === 'interface'
      || /(?:api|route|service|deploy)/i.test(file.path)) score.harbor += 1;
    if (file.kind === 'configuration' || file.kind === 'data'
      || /(?:config|env|data|model)/i.test(file.path)) score.snow += 1;
    if (file.evidence.reachability === 'not-reached-from-known-entrypoints'
      || roomState(file) === 'dark' || roomState(file) === 'ivy') score.woodland += 1;
  }
  return scores;
}

function districtDefinitions(specs, files, oldDir) {
  const dirs = [...new Set([...files.map(({ dir }) => dir), ...specs.map(({ dir }) => dir)])].sort(compareStrings);
  if (!dirs.includes(oldDir)) dirs.unshift(oldDir);
  const scores = directoryScoresByDir(dirs, files);
  const assignments = new Map([[oldDir, 'old-town']]);
  const unassigned = dirs.filter((dir) => dir !== oldDir);
  for (const biome of ['harbor', 'snow', 'woodland']) {
    if (unassigned.length === 0) break;
    const best = [...unassigned].sort((left, right) => (
      (scores.get(right)?.[biome] ?? 0) - (scores.get(left)?.[biome] ?? 0)
        || compareStrings(left, right)
    ))[0];
    assignments.set(best, biome);
    unassigned.splice(unassigned.indexOf(best), 1);
  }
  for (let index = 0; index < unassigned.length; index += 1) {
    assignments.set(unassigned[index], BIOMES[index % BIOMES.length]);
  }
  const presentBiomes = new Set(assignments.values());
  for (const biome of BIOMES) {
    if (presentBiomes.has(biome)) continue;
    const environmentDir = `@environment/${biome}`;
    assignments.set(environmentDir, biome);
  }
  return [...assignments].map(([dir, biome]) => ({
    id: `district.${shortDigest({ dir, biome })}`,
    dir,
    biome
  })).sort((left, right) => (
    (BIOME_RANK.get(left.biome) ?? 999) - (BIOME_RANK.get(right.biome) ?? 999)
      || compareStrings(left.dir, right.dir)
  ));
}

function sortSpecs(specs) {
  return [...specs].sort((left, right) => (
    (FACILITY_RANK.get(left.facilityKind) ?? 999) - (FACILITY_RANK.get(right.facilityKind) ?? 999)
      || compareStrings(left.files[0]?.path ?? left.key, right.files[0]?.path ?? right.key)
  ));
}

function overlayIds(spec, biome) {
  const states = new Set(spec.files.map(roomState));
  const overlays = [];
  if (states.has('warning')) overlays.push('overlay.tarp');
  if (states.has('scaffold')) overlays.push(spec.class === 'S' ? 'overlay.scaffold.s' : 'overlay.scaffold.m');
  if (states.has('ivy')) overlays.push(spec.class === 'S' ? 'overlay.ivy.s' : spec.class === 'L' ? 'overlay.ivy.l' : 'overlay.ivy.m');
  if (biome === 'snow') overlays.push(spec.class === 'S' ? 'overlay.snowcap.s'
    : spec.class === 'L' ? 'overlay.snowcap.l' : spec.class === 'XL' ? 'overlay.snowcap.xl' : 'overlay.snowcap.m');
  return [...new Set(overlays)].sort(compareStrings);
}

function navOutdoorId(x, y) {
  return `nav.o.${x}.${y}`;
}

function navOutdoorEdgeId(fromX, fromY, toX, toY) {
  return `nav.e.${shortDigest([fromX, fromY, toX, toY])}`;
}

function navInteriorId(buildingId, roomIndex = 'common') {
  return `nav.i.${buildingId}.${roomIndex}`;
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

function interiorFloorLayout(building) {
  const start = interiorEntrancePoint(building);
  const layout = [{ ...start, parentIndex: null }];
  const visited = new Set([coordKey(start.x, start.y)]);
  for (let head = 0; head < layout.length; head += 1) {
    const current = layout[head];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = current.x + dx;
      const y = current.y + dy;
      const key = coordKey(x, y);
      if (visited.has(key) || x < building.footprint.x || x >= building.footprint.x + building.footprint.w
        || y < building.footprint.y || y >= building.footprint.y + building.footprint.h) continue;
      visited.add(key);
      layout.push({ x, y, parentIndex: head });
    }
  }
  return layout;
}

function buildingFromSpec(spec, district, x, baseY) {
  const footprintSize = FOOTPRINTS[spec.class] ?? FOOTPRINTS.M;
  const footprint = {
    x,
    y: baseY + (MAX_FOOTPRINT_HEIGHT - footprintSize.h),
    w: footprintSize.w,
    h: footprintSize.h
  };
  const entrance = { x: x + Math.floor(footprintSize.w / 2), y: baseY + MAX_FOOTPRINT_HEIGHT, dir: 'south' };
  return {
    id: spec.id,
    assetId: spec.assetId,
    files: spec.files.map(({ path }) => path),
    class: spec.class,
    ...(spec.facilityKind ? { facilityKind: spec.facilityKind } : {}),
    footprint,
    entrance,
    rooms: spec.files.map((file, roomIndex) => ({
      file: file.path,
      state: roomState(file),
      npcId: null,
      props: [],
      floorNavNodeIds: [spec.class === 'S'
        ? navOutdoorId(entrance.x, entrance.y)
        : navInteriorId(spec.id, roomIndex)]
    })),
    overlays: overlayIds(spec, district.biome),
    interaction: {
      anchor: { x: entrance.x, y: entrance.y },
      verb: spec.verb,
      factRefs: [...spec.factRefs]
    }
  };
}

function environmentLandmark(district, x, y) {
  const assetId = district.biome === 'harbor' ? 'structure.searoute_marker'
    : district.biome === 'snow' ? 'structure.stone_lantern'
      : district.biome === 'woodland' ? 'structure.tree.c' : 'prop.notice_board';
  return {
    id: `prop.landmark.${shortDigest(district.id)}`,
    assetId,
    kind: 'landmark',
    x,
    y
  };
}

function placeDistricts(definitions, specs, lod) {
  const columnCap = lod === 'L2' ? 8 : 6;
  const specsByDir = new Map();
  for (const spec of specs) {
    const members = specsByDir.get(spec.dir) ?? [];
    members.push(spec);
    specsByDir.set(spec.dir, members);
  }
  const largestDistrict = Math.max(1, ...definitions.map(({ dir }) => (specsByDir.get(dir)?.length ?? 0)));
  const columns = Math.min(columnCap, Math.max(2, Math.ceil(Math.sqrt(largestDistrict))));
  const width = FIRST_BUILDING_X + columns * CELL_STRIDE_X + 2;
  const buildings = [];
  const districts = [];
  const props = [];
  let nextY = 0;
  let surveyTower = null;

  for (let districtIndex = 0; districtIndex < definitions.length; districtIndex += 1) {
    const definition = definitions[districtIndex];
    const members = sortSpecs(specsByDir.get(definition.dir) ?? []);
    const rows = Math.max(1, Math.ceil(members.length / columns));
    const height = members.length === 0 ? 4 : Math.max(6, rows * ROW_STRIDE_Y);
    const bounds = { x: 0, y: nextY, w: width, h: height };

    if (districtIndex === 0) {
      surveyTower = {
        id: 'building.survey_tower',
        assetId: 'building.survey_tower',
        files: [],
        class: 'tower',
        footprint: { x: 2, y: nextY + 1, w: 3, h: 4 },
        entrance: { x: 3, y: nextY + 5, dir: 'south' },
        rooms: [],
        overlays: definition.biome === 'snow' ? ['overlay.snowcap.l'] : [],
        interaction: { anchor: { x: 3, y: nextY + 5 }, verb: VERBS.survey_tower, factRefs: [] }
      };
      buildings.push(surveyTower);
    }

    for (let index = 0; index < members.length; index += 1) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const x = FIRST_BUILDING_X + column * CELL_STRIDE_X;
      const baseY = nextY + 1 + row * ROW_STRIDE_Y;
      buildings.push(buildingFromSpec(members[index], definition, x, baseY));
    }

    let landmarkId = members.length > 0 ? members.find(({ facilityKind }) => facilityKind === 'town_hall')?.id ?? members[0].id : null;
    if (!landmarkId) {
      const landmark = environmentLandmark(definition, 3, nextY + Math.floor(height / 2));
      props.push(landmark);
      landmarkId = landmark.id;
    }
    districts.push({ ...definition, bounds, landmarkId });
    nextY += height + DISTRICT_GAP;
  }

  return {
    width,
    height: Math.max(8, nextY - DISTRICT_GAP + 1),
    buildings,
    districts,
    props,
    surveyTower
  };
}

function coordKey(x, y) {
  return `${x},${y}`;
}

function horizontalPath(fromX, toX, y) {
  const points = [];
  const direction = Math.sign(toX - fromX);
  let x = fromX;
  while (true) {
    points.push([x, y]);
    if (x === toX) break;
    x += direction;
  }
  return points;
}

function pathViaSpine(from, to) {
  const points = horizontalPath(from.x, DISTRICT_SPINE_X, from.y);
  const verticalDirection = Math.sign(to.y - from.y);
  let y = from.y;
  while (y !== to.y) {
    y += verticalDirection;
    points.push([DISTRICT_SPINE_X, y]);
  }
  for (const point of horizontalPath(DISTRICT_SPINE_X, to.x, to.y).slice(1)) points.push(point);
  return points;
}

function transitionDefinitions(districts) {
  return districts.slice(1).map((district, index) => {
    const y = district.bounds.y - 1;
    const kind = index % 2 === 0 ? 'bridge' : 'stairs';
    return {
      id: `transition.${kind}.${y}`,
      x: DISTRICT_SPINE_X,
      y,
      kind,
      boundaryAssetId: kind === 'bridge' ? 'terrain.water' : 'terrain.cliff',
      navEdgeId: navOutdoorEdgeId(DISTRICT_SPINE_X, y - 1, DISTRICT_SPINE_X, y)
    };
  });
}

function buildElevationProfile(height, transitions) {
  const stairsByY = new Set(transitions
    .filter(({ kind }) => kind === 'stairs')
    .map(({ y }) => y));
  const elevations = new Array(height);
  let elevation = 0;
  for (let y = 0; y < height; y += 1) {
    if (stairsByY.has(y)) elevation += 1;
    elevations[y] = elevation;
  }
  return elevations;
}

function buildNavigation(buildings, districts, landmarkProps, transitions, elevations) {
  const transitionsByY = new Map(transitions.map((transition) => [transition.y, transition]));
  const outdoor = new Set();
  const anchors = [
    ...buildings.map(({ entrance }) => entrance),
    ...landmarkProps.map(({ x, y }) => ({ x, y })),
    ...districts.map(({ bounds }) => ({ x: DISTRICT_SPINE_X, y: bounds.y + Math.floor(bounds.h / 2) }))
  ];
  const minY = Math.min(...anchors.map(({ y }) => y));
  const maxY = Math.max(...anchors.map(({ y }) => y));
  for (let y = minY; y <= maxY; y += 1) outdoor.add(coordKey(DISTRICT_SPINE_X, y));
  for (const anchor of anchors) {
    for (const [x, y] of horizontalPath(DISTRICT_SPINE_X, anchor.x, anchor.y)) outdoor.add(coordKey(x, y));
  }

  const nodes = [...outdoor].map((key) => key.split(',').map(Number))
    .sort((left, right) => left[1] - right[1] || left[0] - right[0])
    .map(([x, y]) => ({ id: navOutdoorId(x, y), x, y, elevation: elevations[y], space: 'outdoor' }));
  const outdoorSet = new Set(outdoor);
  const edges = [];
  for (const node of nodes) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nextKey = coordKey(node.x + dx, node.y + dy);
      if (!outdoorSet.has(nextKey)) continue;
      const nextY = node.y + dy;
      const transition = node.x === DISTRICT_SPINE_X && dx === 0
        ? transitionsByY.get(Math.max(node.y, nextY))
        : null;
      edges.push({
        id: navOutdoorEdgeId(node.x, node.y, node.x + dx, nextY),
        from: node.id,
        to: navOutdoorId(node.x + dx, nextY),
        kind: transition?.kind ?? 'walk'
      });
    }
  }

  for (const building of buildings) {
    if (building.class === 'S') continue;
    const floorCount = Math.max(1, building.rooms.length);
    const floorLayout = interiorFloorLayout(building);
    const floorNodes = [];
    for (let index = 0; index < floorCount; index += 1) {
      const { x, y } = floorLayout[index];
      const room = building.rooms[index] ?? null;
      const interior = {
        id: navInteriorId(building.id, room ? index : 'common'),
        x,
        y,
        elevation: elevations[building.entrance.y],
        space: 'interior',
        buildingId: building.id,
        ...(room ? { roomRef: room.file } : {})
      };
      floorNodes.push(interior);
      nodes.push(interior);
    }
    edges.push({
      id: `nav.door.${shortDigest(building.id)}`,
      from: navOutdoorId(building.entrance.x, building.entrance.y),
      to: floorNodes[0].id,
      kind: 'door'
    });
    for (let index = 1; index < floorNodes.length; index += 1) {
      edges.push({
        id: `nav.interior.${shortDigest([building.id, index])}`,
        from: floorNodes[floorLayout[index].parentIndex].id,
        to: floorNodes[index].id,
        kind: 'walk'
      });
    }
  }
  nodes.sort((left, right) => compareStrings(left.id, right.id));
  edges.sort((left, right) => compareStrings(left.id, right.id));
  return { nav: { nodes, edges }, outdoor, transitions };
}

function buildingByFile(buildings) {
  const result = new Map();
  for (const building of buildings) for (const filePath of building.files) result.set(filePath, building);
  return result;
}

function buildStreets(edges, buildings, civicTiles) {
  const byFile = buildingByFile(buildings);
  const streets = [{
    id: 'street.civic',
    tiles: [...civicTiles].map((key) => key.split(',').map(Number))
      .sort((left, right) => left[1] - right[1] || left[0] - right[0]),
    width: 3,
    edges: [],
    edgeBindings: [],
    kind: 'civic-avenue'
  }];
  const occurrences = new Map();
  for (const edge of edges) {
    const from = byFile.get(edge.from);
    const to = edge.status === 'resolved' ? byFile.get(edge.to) : null;
    if (!from) continue;
    const identity = [edge.from, edge.to ?? '', edge.targetHint ?? '', edge.kind, edge.status].join('\0');
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const tiles = to ? pathViaSpine(from.entrance, to.entrance) : [[from.entrance.x, from.entrance.y]];
    streets.push({
      id: `street.import.${shortDigest([identity, occurrence])}`,
      tiles,
      width: edge.status === 'unresolved' ? 1 : 2,
      edges: [edge.binding],
      edgeBindings: [{
        from: edge.from,
        to: edge.status === 'resolved' ? edge.to : null,
        targetHint: edge.status === 'unresolved' ? edge.targetHint : null,
        kind: edge.kind,
        status: edge.status
      }],
      kind: 'street'
    });
  }
  return streets;
}

function terrainBase(biome) {
  if (biome === 'snow') return 'terrain.snow';
  if (biome === 'harbor') return 'terrain.deck';
  if (biome === 'old-town') return 'terrain.cobble';
  return 'terrain.grass';
}

function buildDistrictProfile(height, districts) {
  const profile = new Array(height).fill(districts.at(-1));
  for (const district of districts) {
    const end = Math.min(height, district.bounds.y + district.bounds.h);
    for (let y = Math.max(0, district.bounds.y); y < end; y += 1) profile[y] = district;
  }
  return profile;
}

function buildTerrain(width, height, districts, buildings, outdoor, transitions, elevations, seed) {
  const terrain = [];
  const seedOffset = Number.parseInt(shortDigest(seed).slice(0, 8), 16) || 0;
  const districtProfile = buildDistrictProfile(height, districts);
  for (let y = 0; y < height; y += 1) {
    const district = districtProfile[y];
    for (let x = 0; x < width; x += 1) {
      terrain.push({
        assetId: terrainBase(district?.biome),
        variant: `base-${Math.abs(seedOffset + x * 7 + y * 11) % 3}`,
        elevation: elevations[y],
        walkable: false
      });
    }
  }
  const set = (x, y, values) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    Object.assign(terrain[y * width + x], values);
  };
  for (const transition of transitions) {
    for (let x = 0; x < width; x += 1) {
      set(x, transition.y, {
        assetId: transition.kind === 'bridge' ? 'terrain.water' : 'terrain.cliff',
        variant: 'boundary-0',
        walkable: false
      });
    }
  }
  for (const building of buildings) {
    for (let y = building.footprint.y; y < building.footprint.y + building.footprint.h; y += 1) {
      for (let x = building.footprint.x; x < building.footprint.x + building.footprint.w; x += 1) {
        set(x, y, { walkable: false });
      }
    }
  }
  for (const key of outdoor) {
    const [x, y] = key.split(',').map(Number);
    set(x, y, { assetId: 'terrain.road', variant: 'connected-0', walkable: true });
  }
  return terrain;
}

function buildActors(buildings) {
  const npcs = [];
  let genericIndex = 0;
  for (const building of buildings) {
    if (building.id === 'building.survey_tower') continue;
    const isWitnessResident = building.id === 'building.witness.resident';
    if (!building.facilityKind && building.files.length === 0 && !isWitnessResident) continue;
    const interiorFloors = building.class === 'S' ? [] : interiorFloorLayout(building);
    const residents = !building.facilityKind && building.rooms.length > 0
      ? building.rooms
      : [building.rooms[0] ?? null];
    for (let roomIndex = 0; roomIndex < residents.length; roomIndex += 1) {
      const room = residents[roomIndex];
      const id = `npc.${shortDigest([building.id, room?.file ?? 'keeper'])}`;
      const assetId = KEEPER_ASSETS[building.facilityKind]
        ?? (genericIndex++ % 2 === 0 ? 'character.mob.townsfolk_female' : 'character.mob.townsfolk_male');
      const interiorFloor = interiorFloors[room ? roomIndex : 0];
      const floor = interiorFloor
        ? [interiorFloor.x, interiorFloor.y]
        : [building.entrance.x, building.entrance.y];
      npcs.push({
        id,
        assetId,
        role: building.facilityKind ? `keeper.${building.facilityKind}` : isWitnessResident ? 'witness' : 'resident',
        home: building.id,
        patrol: [floor],
        factRefs: [...building.interaction.factRefs]
      });
      if (room) room.npcId = id;
    }
  }
  const dojo = buildings.find(({ facilityKind }) => facilityKind === 'dojo');
  if (dojo) {
    const dojoFloor = dojo.class === 'S' ? null : interiorFloorLayout(dojo)[0];
    npcs.push({
      id: 'npc.dojo_student',
      assetId: 'character.dojo_student',
      role: 'dojo-student',
      home: dojo.id,
      patrol: [[dojoFloor?.x ?? dojo.entrance.x, dojoFloor?.y ?? dojo.entrance.y]],
      factRefs: [...dojo.interaction.factRefs]
    });
  }
  return npcs.sort((left, right) => compareStrings(left.id, right.id));
}

function buildFactProps(facts, buildings, baseProps, transitions) {
  const byFile = buildingByFile(buildings);
  const props = [...baseProps];
  for (const transition of transitions) {
    props.push({
      id: `prop.${transition.id}`,
      assetId: transition.kind === 'bridge' ? 'structure.bridge_stone' : 'structure.stairs_stone',
      kind: transition.kind,
      x: transition.x,
      y: transition.y,
      navEdgeId: transition.navEdgeId
    });
  }
  for (const fact of facts) {
    let building = null;
    let assetId = null;
    let kind = null;
    if (fact.type === 'unresolved') {
      building = byFile.get(fact.params?.from);
      assetId = 'prop.lantern_warning';
      kind = 'unresolved-warning';
    } else if (fact.type === 'cycle') {
      building = arrayOf(fact.params?.members).map((member) => byFile.get(member)).find(Boolean) ?? null;
      assetId = 'structure.cycle_wellcurb';
      kind = 'cycle-marker';
    }
    if (!building || !assetId) continue;
    const prop = {
      id: `prop.fact.${shortDigest(fact.id)}`,
      assetId,
      kind,
      x: building.entrance.x,
      y: building.entrance.y,
      factRef: fact.id
    };
    props.push(prop);
    if (building.rooms[0]) building.rooms[0].props.push(prop.id);
  }
  const fieldStation = buildings.find(({ id }) => id === 'building.witness.field_station');
  const noticeFactId = fieldStation?.interaction?.factRefs?.[0];
  if (fieldStation && noticeFactId) {
    props.push({
      id: 'prop.witness.survey_notice',
      assetId: 'prop.notice_board',
      kind: 'survey-notice',
      x: fieldStation.entrance.x,
      y: fieldStation.entrance.y,
      factRef: noticeFactId
    });
  }
  return props.sort((left, right) => compareStrings(left.id, right.id));
}

function buildLights(buildings) {
  const lights = [];
  for (const building of buildings) {
    for (let index = 0; index < building.rooms.length; index += 1) {
      const room = building.rooms[index];
      if (room.state !== 'lit') continue;
      lights.push({
        x: building.footprint.x + (index % building.footprint.w),
        y: building.footprint.y + Math.floor(index / building.footprint.w) % building.footprint.h,
        assetId: 'effect.window_glow',
        kind: 'window',
        roomRef: room.file,
        on: true
      });
    }
  }
  return lights;
}

function normalizedDigestInput(inspection, files, edges, facilities, facts) {
  return {
    repository: { name: nonemptyString(inspection?.repository?.name) ?? '' },
    files,
    edges,
    facilities: facilities.map(({ kind, present, count }) => ({ kind, present, count })),
    facts
  };
}

/**
 * Generate an unannotated, shape-valid WorldPlan v2. Semantic validation is a
 * separate fail-closed step in world-plan-validator.mjs.
 */
export function generateWorldPlan({ inspection, model, seed } = {}) {
  const source = inspection && typeof inspection === 'object' ? inspection : {};
  const files = normalizeFiles(source);
  const edges = normalizeEdges(source);
  const facilities = normalizeFacilities(model);
  const facts = buildWorldFacts(source, model);
  const indexes = factIndex(facts);
  const lod = worldPlanLodForFileCount(files.length);
  const oldDir = oldTownDir(files, source);
  const assigned = facilitySpecs(files, facilities, source, oldDir, indexes);
  const baseSpecs = hydrateInteractionFacts([
    ...assigned.specs,
    ...remainingSpecs(files, assigned.used, lod, edges, indexes)
  ], facts);
  const specs = ensureWitnessSpecs(baseSpecs, facts, oldDir);
  const definitions = districtDefinitions(specs, files, oldDir);
  const placement = placeDistricts(definitions, specs, lod);
  const surveyFactId = preferredFactId(facts, 'operate');
  if (surveyFactId) placement.surveyTower.interaction.factRefs = [surveyFactId];
  const transitions = transitionDefinitions(placement.districts);
  const elevations = buildElevationProfile(placement.height, transitions);
  const navigation = buildNavigation(
    placement.buildings,
    placement.districts,
    placement.props,
    transitions,
    elevations
  );
  const streets = buildStreets(edges, placement.buildings, navigation.outdoor);
  const actualSeed = typeof seed === 'string' && seed.length > 0 ? seed : deriveWorldSeed(source);
  const props = buildFactProps(facts, placement.buildings, placement.props, transitions);
  const npcs = buildActors(placement.buildings);
  const lights = buildLights(placement.buildings);
  const gate = placement.buildings.find(({ facilityKind }) => facilityKind === 'gate');
  const townHall = placement.buildings.find(({ facilityKind }) => facilityKind === 'town_hall');
  const start = gate?.entrance ?? townHall?.entrance ?? placement.surveyTower.entrance;

  const plan = {
    schemaVersion: WORLD_PLAN_VERSION,
    seed: actualSeed,
    inspectionDigest: inspectionDigest(normalizedDigestInput(source, files, edges, facilities, facts)),
    generatorVersion: WORLD_GENERATOR_VERSION,
    generation: { mode: 'primary', attempt: 0 },
    world: { widthTiles: placement.width, heightTiles: placement.height, tileSize: 64 },
    terrain: buildTerrain(
      placement.width,
      placement.height,
      placement.districts,
      placement.buildings,
      navigation.outdoor,
      transitions,
      elevations,
      actualSeed
    ),
    districts: placement.districts,
    streets,
    buildings: placement.buildings,
    npcs,
    props,
    lights,
    facts,
    nav: navigation.nav,
    playerStart: {
      x: start.x,
      y: start.y,
      facing: 'east',
      navNodeId: navOutdoorId(start.x, start.y)
    },
    validation: { ok: false, issues: [] }
  };
  return deepFreeze(plan);
}
