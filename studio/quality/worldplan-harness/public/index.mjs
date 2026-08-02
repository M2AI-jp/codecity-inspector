/**
 * Public boundary for the WorldPlan verification harness.
 *
 * The harness consumes serialized WorldPlan v1 data only.  It does not import
 * a shipping module, inspect a repository, load images, or make a network
 * request.  Coordinates remain logical cells; no pixel or renderer fields are
 * accepted.
 */

const PLAN_FORMAT = 'codecity.world-plan';
const TOWN_TYPES = new Set(['river', 'harbor', 'hill', 'valley', 'plain']);
const CLIMATES = new Set(['spring', 'summer', 'autumn', 'winter', 'mist']);
const TERRAINS = new Set(['meadow', 'coast', 'terrace', 'basin', 'plain']);
const EVIDENCE_STATES = ['observed', 'inferred', 'unknown'];
const EVIDENCE_STATE_SET = new Set(EVIDENCE_STATES);
const HASH_RE = /^[0-9a-f]{64}$/u;
const REQUIRED_ARRAYS = ['roads', 'regions', 'plots', 'plotIds', 'sightlines', 'occupancy', 'rooms', 'npcs', 'props', 'lights', 'questSites'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function issue(path, code, message, details = {}) {
  return Object.freeze({ path, code, message, ...details });
}

function typeIssue(errors, path, value, expected) {
  errors.push(issue(path, 'TYPE', `expected ${expected}`, { actual: value === null ? 'null' : typeof value }));
}

function string(errors, value, path, { nonEmpty = true } = {}) {
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) {
    typeIssue(errors, path, value, nonEmpty ? 'non-empty string' : 'string');
    return false;
  }
  return true;
}

function integer(errors, value, path, minimum = null) {
  if (!Number.isInteger(value) || (minimum !== null && value < minimum)) {
    typeIssue(errors, path, value, minimum === null ? 'integer' : `integer >= ${minimum}`);
    return false;
  }
  return true;
}

function object(errors, value, path) {
  if (!isRecord(value)) {
    typeIssue(errors, path, value, 'plain object');
    return false;
  }
  return true;
}

function array(errors, value, path) {
  if (!Array.isArray(value)) {
    typeIssue(errors, path, value, 'array');
    return false;
  }
  return true;
}

function cell(errors, value, path, grid, { allowSize = false } = {}) {
  if (!object(errors, value, path)) return false;
  let valid = integer(errors, value.x, `${path}.x`, 0) && integer(errors, value.y, `${path}.y`, 0);
  if (grid && Number.isInteger(grid.columns) && Number.isInteger(grid.rows)) {
    if (value.x >= grid.columns) errors.push(issue(`${path}.x`, 'OUT_OF_BOUNDS', 'x is outside the logical grid'));
    if (value.y >= grid.rows) errors.push(issue(`${path}.y`, 'OUT_OF_BOUNDS', 'y is outside the logical grid'));
  }
  if (allowSize) {
    valid = integer(errors, value.width, `${path}.width`, 1) && valid;
    valid = integer(errors, value.height, `${path}.height`, 1) && valid;
    if (grid && Number.isInteger(grid.columns) && Number.isInteger(grid.rows)) {
      if (Number.isInteger(value.x) && Number.isInteger(value.width) && value.x + value.width > grid.columns) errors.push(issue(path, 'OUT_OF_BOUNDS', 'plot width exceeds logical grid'));
      if (Number.isInteger(value.y) && Number.isInteger(value.height) && value.y + value.height > grid.rows) errors.push(issue(path, 'OUT_OF_BOUNDS', 'plot height exceeds logical grid'));
    }
  }
  return valid;
}

function evidenceBag(errors, value, path) {
  if (!object(errors, value, path)) return false;
  let valid = true;
  for (const state of EVIDENCE_STATES) {
    if (!Array.isArray(value[state])) {
      typeIssue(errors, `${path}.${state}`, value[state], 'array');
      valid = false;
      continue;
    }
    value[state].forEach((entry, index) => {
      if (typeof entry === 'string') {
        if (entry.trim() === '') {
          errors.push(issue(`${path}.${state}[${index}]`, 'EMPTY_EVIDENCE', 'evidence text must not be empty'));
          valid = false;
        }
      } else if (!isRecord(entry) || !string(errors, entry.claim, `${path}.${state}[${index}].claim`)) {
        if (isRecord(entry)) valid = false;
        else {
          typeIssue(errors, `${path}.${state}[${index}]`, entry, 'string or object with claim');
          valid = false;
        }
      }
    });
  }
  return valid;
}

function optionalEvidence(errors, value, path) {
  if (value === undefined) return true;
  if (!object(errors, value, path)) return false;
  if (EVIDENCE_STATE_SET.has(value.state)) return true;
  return evidenceBag(errors, value, path);
}

function validatePlan(plan) {
  const errors = [];
  if (!object(errors, plan, '$')) return errors;
  const allowed = new Set([
    'format', 'schemaVersion', 'repository', 'identity', 'seed', 'contentSeed',
    'townType', 'climate', 'terrain', 'grid', 'elevation', 'water', 'roads',
    'roadNetwork', 'topology', 'regions', 'plotIds', 'plots', 'sightlines',
    'nav', 'occupancy', 'facilityAssignments', 'rooms', 'npcs', 'props', 'lights',
    'questSites', 'rewardBindings', 'townState', 'evidence', 'l1', 'l2'
  ]);
  for (const key of Object.keys(plan)) if (!allowed.has(key)) errors.push(issue(`$.${key}`, 'UNKNOWN_FIELD', 'unknown WorldPlan v1 field'));
  if (plan.format !== PLAN_FORMAT) errors.push(issue('$.format', 'INVALID_FORMAT', `must be ${PLAN_FORMAT}`));
  if (plan.schemaVersion !== 1) errors.push(issue('$.schemaVersion', 'SCHEMA_VERSION', 'must be exactly 1'));
  if (!object(errors, plan.identity, '$.identity')) {
    // Continue to collect all independent errors.
  } else {
    string(errors, plan.identity.key, '$.identity.key');
    string(errors, plan.identity.name, '$.identity.name');
  }
  if (!string(errors, plan.seed, '$.seed') || !HASH_RE.test(plan.seed)) errors.push(issue('$.seed', 'INVALID_HASH', 'seed must be a SHA-256 hex string'));
  if (plan.contentSeed !== undefined && (!string(errors, plan.contentSeed, '$.contentSeed') || !HASH_RE.test(plan.contentSeed))) errors.push(issue('$.contentSeed', 'INVALID_HASH', 'contentSeed must be a SHA-256 hex string'));
  if (!TOWN_TYPES.has(plan.townType)) errors.push(issue('$.townType', 'ENUM', 'unknown town type'));
  if (!CLIMATES.has(plan.climate)) errors.push(issue('$.climate', 'ENUM', 'unknown climate'));
  if (!TERRAINS.has(plan.terrain)) errors.push(issue('$.terrain', 'ENUM', 'unknown terrain'));

  const hasGrid = object(errors, plan.grid, '$.grid');
  if (hasGrid) {
    integer(errors, plan.grid.columns, '$.grid.columns', 1);
    integer(errors, plan.grid.rows, '$.grid.rows', 1);
  }
  const grid = hasGrid ? plan.grid : null;
  if (object(errors, plan.elevation, '$.elevation')) {
    integer(errors, plan.elevation.levels, '$.elevation.levels', 1);
    if (array(errors, plan.elevation.bands, '$.elevation.bands') && plan.elevation.bands.length !== plan.elevation.levels) errors.push(issue('$.elevation.bands', 'LENGTH', 'must contain one band per elevation level'));
  }
  if (object(errors, plan.water, '$.water')) {
    if (plan.water.crossesMap !== true) errors.push(issue('$.water.crossesMap', 'WATER_NOT_THROUGH', 'water must cross the map'));
    if (array(errors, plan.water.path, '$.water.path')) {
      if (plan.water.path.length < 2) errors.push(issue('$.water.path', 'LENGTH', 'water path needs at least two cells'));
      plan.water.path.forEach((point, index) => cell(errors, point, `$.water.path[${index}]`, grid));
    }
  }
  for (const key of REQUIRED_ARRAYS) if (!array(errors, plan[key], `$.${key}`)) continue;

  if (object(errors, plan.townState, '$.townState')) {
    const expectedKeys = ['guild', 'habitability', 'investigations', 'rewards'];
    if (JSON.stringify(Object.keys(plan.townState).sort()) !== JSON.stringify(expectedKeys)) {
      errors.push(issue('$.townState', 'INVALID_TOWN_STATE', 'must contain guild, habitability, investigations, and rewards'));
    }
    if (object(errors, plan.townState.guild, '$.townState.guild')) {
      for (const key of ['tabs', 'representativeConnections', 'connections']) array(errors, plan.townState.guild[key], `$.townState.guild.${key}`);
      if (Array.isArray(plan.townState.guild.tabs)) {
        const labels = plan.townState.guild.tabs.map((tab) => tab?.label);
        if (JSON.stringify(labels) !== JSON.stringify(['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい'])) {
          errors.push(issue('$.townState.guild.tabs', 'INVALID_GUILD_TABS', 'must contain the five canonical tabs in order'));
        }
      }
    }
    if (object(errors, plan.townState.investigations, '$.townState.investigations')) {
      array(errors, plan.townState.investigations.priority, '$.townState.investigations.priority');
      array(errors, plan.townState.investigations.candidates, '$.townState.investigations.candidates');
    }
    if (object(errors, plan.townState.rewards, '$.townState.rewards')) {
      array(errors, plan.townState.rewards.bindings, '$.townState.rewards.bindings');
      array(errors, plan.townState.rewards.transitions, '$.townState.rewards.transitions');
    }
    object(errors, plan.townState.habitability, '$.townState.habitability');
  }

  const plotIds = new Set();
  if (Array.isArray(plan.plots)) {
    plan.plots.forEach((plot, index) => {
      const path = `$.plots[${index}]`;
      if (!object(errors, plot, path)) return;
      string(errors, plot.id, `${path}.id`);
      if (plotIds.has(plot.id)) errors.push(issue(`${path}.id`, 'DUPLICATE_ID', 'plot IDs must be unique'));
      plotIds.add(plot.id);
      string(errors, plot.region, `${path}.region`);
      cell(errors, plot.cell, `${path}.cell`, grid, { allowSize: true });
      integer(errors, plot.elevation, `${path}.elevation`, 0);
      string(errors, plot.terrain, `${path}.terrain`);
      optionalEvidence(errors, plot.evidence, `${path}.evidence`);
    });
  }
  if (Array.isArray(plan.plotIds)) {
    const expected = [...plotIds];
    if (JSON.stringify(plan.plotIds) !== JSON.stringify(expected)) errors.push(issue('$.plotIds', 'PLOT_INDEX_MISMATCH', 'must mirror stable plot order'));
  }
  if (Array.isArray(plan.roads)) {
    const roadIds = new Set();
    plan.roads.forEach((road, index) => {
      const path = `$.roads[${index}]`;
      if (!object(errors, road, path)) return;
      string(errors, road.id, `${path}.id`);
      if (roadIds.has(road.id)) errors.push(issue(`${path}.id`, 'DUPLICATE_ID', 'road IDs must be unique'));
      roadIds.add(road.id);
      string(errors, road.kind, `${path}.kind`);
      string(errors, road.fromPlotId, `${path}.fromPlotId`);
      string(errors, road.toPlotId, `${path}.toPlotId`);
      if (!plotIds.has(road.fromPlotId)) errors.push(issue(`${path}.fromPlotId`, 'UNKNOWN_PLOT', 'must reference a known plot'));
      if (!plotIds.has(road.toPlotId)) errors.push(issue(`${path}.toPlotId`, 'UNKNOWN_PLOT', 'must reference a known plot'));
      if (array(errors, road.path, `${path}.path`)) {
        if (road.path.length < 2) errors.push(issue(`${path}.path`, 'LENGTH', 'road path needs at least two cells'));
        road.path.forEach((point, pointIndex) => cell(errors, point, `${path}.path[${pointIndex}]`, grid));
      }
      optionalEvidence(errors, road.evidence, `${path}.evidence`);
    });
  }
  const referenceArrays = ['occupancy', 'rooms', 'npcs', 'props', 'lights', 'questSites'];
  for (const key of referenceArrays) {
    if (!Array.isArray(plan[key])) continue;
    plan[key].forEach((entry, index) => {
      const path = `$.${key}[${index}]`;
      if (!object(errors, entry, path)) return;
      if (key === 'rooms') {
        for (const field of ['id', 'plotId', 'facilityId', 'kind', 'state']) string(errors, entry[field], `${path}.${field}`);
      } else if (key === 'npcs') {
        for (const field of ['id', 'plotId', 'role', 'name', 'movement']) string(errors, entry[field], `${path}.${field}`);
      } else if (key === 'props') {
        for (const field of ['id', 'kind', 'roadId']) string(errors, entry[field], `${path}.${field}`);
      } else if (key === 'lights') {
        for (const field of ['id', 'plotId', 'state']) string(errors, entry[field], `${path}.${field}`);
      } else if (key === 'questSites') {
        for (const field of ['id', 'candidateId', 'plotId', 'action']) string(errors, entry[field], `${path}.${field}`);
      }
      if (own(entry, 'plotId') && (typeof entry.plotId !== 'string' || !plotIds.has(entry.plotId))) errors.push(issue(`${path}.plotId`, 'UNKNOWN_PLOT', 'must reference a known plot'));
      if (own(entry, 'cell')) cell(errors, entry.cell, `${path}.cell`, grid);
      optionalEvidence(errors, entry.evidence, `${path}.evidence`);
    });
  }
  if (Array.isArray(plan.occupancy)) {
    const occupancyPlotIds = new Set();
    plan.occupancy.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      if (occupancyPlotIds.has(entry.plotId)) errors.push(issue(`$.occupancy[${index}].plotId`, 'DUPLICATE_ID', 'one occupancy record per plot'));
      occupancyPlotIds.add(entry.plotId);
      if (!plotIds.has(entry.plotId)) errors.push(issue(`$.occupancy[${index}].plotId`, 'UNKNOWN_PLOT', 'must reference a known plot'));
      if (!['occupied', 'vacant'].includes(entry.state)) errors.push(issue(`$.occupancy[${index}].state`, 'ENUM', 'must be occupied or vacant'));
      if (!array(errors, entry.occupants, `$.occupancy[${index}].occupants`)) return;
      entry.occupants.forEach((occupant, occupantIndex) => {
        const occupantPath = `$.occupancy[${index}].occupants[${occupantIndex}]`;
        if (!object(errors, occupant, occupantPath)) return;
        string(errors, occupant.facilityId, `${occupantPath}.facilityId`);
        string(errors, occupant.plotId, `${occupantPath}.plotId`);
        string(errors, occupant.kind, `${occupantPath}.kind`);
        string(errors, occupant.name, `${occupantPath}.name`);
        string(errors, occupant.state, `${occupantPath}.state`);
        optionalEvidence(errors, occupant.evidence, `${occupantPath}.evidence`);
      });
    });
    if (occupancyPlotIds.size !== plotIds.size) errors.push(issue('$.occupancy', 'INVALID_OCCUPANCY', 'must include every plot exactly once'));
  }
  if (object(errors, plan.evidence, '$.evidence')) evidenceBag(errors, plan.evidence, '$.evidence');
  if (plan.l1 !== undefined) {
    if (!object(errors, plan.l1, '$.l1')) {
      // The top-level geometry remains the source of the view.
    } else {
      for (const key of ['townType', 'climate', 'terrain', 'grid', 'water', 'roads', 'topology', 'regions', 'plotIds', 'plots', 'sightlines', 'nav']) {
        if (JSON.stringify(plan.l1[key]) !== JSON.stringify(plan[key])) errors.push(issue(`$.l1.${key}`, 'LAYER_MISMATCH', 'L1 mirror must equal the corresponding top-level field'));
      }
    }
  }
  if (plan.l2 !== undefined) {
    if (!object(errors, plan.l2, '$.l2')) {
      // The top-level L2 arrays remain the source of the view.
    } else {
      for (const key of ['occupancy', 'facilityAssignments', 'rooms', 'npcs', 'props', 'lights', 'questSites', 'townState', 'evidence']) {
        if (JSON.stringify(plan.l2[key]) !== JSON.stringify(plan[key])) errors.push(issue(`$.l2.${key}`, 'LAYER_MISMATCH', 'L2 mirror must equal the corresponding top-level field'));
      }
    }
  }
  return errors;
}

function parse(input) {
  if (typeof input !== 'string') return { value: input, error: null };
  try {
    return { value: JSON.parse(input), error: null };
  } catch (cause) {
    return { value: null, error: issue('$', 'JSON_PARSE', 'input is not valid JSON', { cause: cause.message }) };
  }
}

/** Validate serialized WorldPlan v1 data. Invalid data is never normalized. */
export function validateWorldPlan(input) {
  const parsed = parse(input);
  if (parsed.error) return Object.freeze({ ok: false, errors: Object.freeze([parsed.error]), value: null });
  const errors = validatePlan(parsed.value);
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), value: errors.length === 0 ? parsed.value : null });
}

function evidenceEntries(value, state) {
  const entries = value?.[state];
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => typeof entry === 'string' ? { claim: entry } : { ...entry });
}

function collectEntityEvidence(target, entity, label) {
  const value = entity?.evidence;
  if (!isRecord(value)) return;
  if (EVIDENCE_STATE_SET.has(value.state)) {
    target[value.state].push({ claim: `${label}: explicit evidence state`, source: 'WorldPlan' });
    return;
  }
  for (const state of EVIDENCE_STATES) target[state].push(...evidenceEntries(value, state).map((entry) => ({ ...entry, source: entry.source ?? label })));
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** Build renderer-friendly logical data. No assets or pixel coordinates are selected. */
export function createHarnessViewModel(input) {
  const validation = validateWorldPlan(input);
  if (!validation.ok) return Object.freeze({ ok: false, errors: validation.errors, view: null });
  const plan = validation.value;
  const evidence = Object.fromEntries(EVIDENCE_STATES.map((state) => [state, evidenceEntries(plan.evidence, state)]));
  for (const key of ['plots', 'roads', 'occupancy', 'rooms', 'npcs', 'props', 'lights', 'questSites']) {
    for (const [index, entity] of (plan[key] ?? []).entries()) collectEntityEvidence(evidence, entity, `${key}[${index}]`);
  }
  const plotById = new Map(plan.plots.map((plot) => [plot.id, plot]));
  const occupancyByPlot = new Map(plan.occupancy.map((entry) => [entry.plotId, entry.state]));
  const view = {
    schemaVersion: 1,
    identity: { ...plan.identity },
    townType: plan.townType,
    climate: plan.climate,
    terrain: plan.terrain,
    grid: { ...plan.grid },
    water: plan.water.path.map((point) => ({ ...point })),
    roads: plan.roads.map((road) => ({ id: road.id, kind: road.kind, points: road.path.map((point) => ({ ...point })) })),
    plots: plan.plots.map((plot) => ({ id: plot.id, region: plot.region, cell: { ...plot.cell }, occupancy: occupancyByPlot.get(plot.id) ?? 'unknown' })),
    occupancy: plan.occupancy.flatMap((entry) => entry.occupants.map((occupant) => ({ plotId: entry.plotId, state: entry.state, name: occupant.name, kind: occupant.kind }))),
    npcs: plan.npcs.map((npc) => {
      const plot = plotById.get(npc.plotId);
      const cell = plot?.cell;
      return { id: npc.id, name: npc.name, role: npc.role, movement: npc.movement, plotId: npc.plotId, position: cell ? { x: cell.x + Math.floor(cell.width / 2), y: cell.y + Math.floor(cell.height / 2) } : null };
    }),
    quests: plan.questSites.map((site) => ({ id: site.id, action: site.action, candidateId: site.candidateId, plotId: site.plotId })),
    evidence,
    counts: {
      terrain: plan.grid.columns * plan.grid.rows,
      roads: plan.roads.length,
      plots: plan.plots.length,
      occupiedPlots: plan.occupancy.filter((entry) => entry.state === 'occupied').length,
      npcs: plan.npcs.length,
      quests: plan.questSites.length
    }
  };
  return Object.freeze({ ok: true, errors: Object.freeze([]), view: deepFreeze(view) });
}

export const HARNESS_CONTRACT = Object.freeze({
  schemaVersion: 1,
  format: PLAN_FORMAT,
  evidenceStates: Object.freeze([...EVIDENCE_STATES]),
  worldPlanFields: Object.freeze([...REQUIRED_ARRAYS])
});
