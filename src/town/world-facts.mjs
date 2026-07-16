// src/town/world-facts.mjs
//
// Pure, deterministic projection from the existing Inspection + TownModel into
// WorldPlan v2's structured fact table. Human-language evidence strings from
// TownModel are never copied: evidence arrays contain fixed machine keys only,
// while repository-specific values live in params.

import { inspectionDigest } from './world-identity.mjs';

const TYPE_RANK = Object.freeze({
  entrypoint: 0,
  unresolved: 1,
  cycle: 2,
  test_association: 3,
  unverified: 4,
  unreached: 5,
  runtime_unknown: 6,
  truncation: 7,
  facility_present: 8,
  facility_absent: 8
});

const SAYINGS = Object.freeze({
  entrypoint: Object.freeze({ primary: 'fact.entrypoint.primary', reflect: Object.freeze(['fact.entrypoint.reflect']) }),
  unresolved: Object.freeze({ primary: 'fact.unresolved.primary', reflect: Object.freeze(['fact.unresolved.reflect']) }),
  cycle: Object.freeze({ primary: 'fact.cycle.primary', reflect: Object.freeze(['fact.cycle.reflect']) }),
  test_association: Object.freeze({ primary: 'fact.test_association.primary', reflect: Object.freeze(['fact.test_association.reflect']) }),
  unverified: Object.freeze({ primary: 'fact.unverified.primary', reflect: Object.freeze(['fact.unverified.reflect']) }),
  unreached: Object.freeze({ primary: 'fact.unreached.primary', reflect: Object.freeze(['fact.unreached.reflect']) }),
  runtime_unknown: Object.freeze({ primary: 'fact.runtime_unknown.primary', reflect: Object.freeze(['fact.runtime_unknown.reflect']) }),
  truncation: Object.freeze({ primary: 'fact.truncation.primary', reflect: Object.freeze(['fact.truncation.reflect']) }),
  facility_present: Object.freeze({ primary: 'fact.facility_present.primary', reflect: Object.freeze(['fact.facility_present.reflect']) }),
  facility_absent: Object.freeze({ primary: 'fact.facility_absent.primary', reflect: Object.freeze(['fact.facility_absent.reflect']) })
});

/** @param {string} left @param {string} right @returns {-1|0|1} */
function compareCodeUnits(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** @param {unknown} value @returns {any[]} */
function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

/** @param {unknown} value @returns {string|null} */
function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** @param {unknown} value @returns {number} */
function countOf(value) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** @param {unknown[]} values @returns {string[]} */
function sortedUniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
    .sort(compareCodeUnits);
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  const seen = new WeakSet();
  const freeze = (node) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return node;
    seen.add(node);
    for (const key of Object.keys(node)) freeze(node[key]);
    return Object.freeze(node);
  };
  return freeze(value);
}

/**
 * @param {string} type
 * @param {object} params
 * @param {{observed?:string[], inferred?:string[], unknown?:string[]}} evidence
 * @returns {{id:string,type:string,params:object,evidence:{observed:string[],inferred:string[],unknown:string[]},sayings:{primary:string,reflect:string[]}}}
 */
function makeFact(type, params, evidence = {}) {
  const digest = inspectionDigest({ type, params });
  const saying = SAYINGS[type];
  return {
    id: `${type}.${digest.slice(0, 16)}`,
    type,
    params,
    evidence: {
      observed: sortedUniqueStrings(arrayOf(evidence.observed)),
      inferred: sortedUniqueStrings(arrayOf(evidence.inferred)),
      unknown: sortedUniqueStrings(arrayOf(evidence.unknown))
    },
    sayings: { primary: saying.primary, reflect: [...saying.reflect] }
  };
}

/** @param {any} left @param {any} right @returns {number} */
function compareFacts(left, right) {
  const leftRank = TYPE_RANK[left.type] ?? Number.MAX_SAFE_INTEGER;
  const rightRank = TYPE_RANK[right.type] ?? Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank === TYPE_RANK.facility_present) {
    const byKind = compareCodeUnits(String(left.params.kind ?? ''), String(right.params.kind ?? ''));
    if (byKind !== 0) return byKind;
  }
  const byType = compareCodeUnits(left.type, right.type);
  return byType || compareCodeUnits(left.id, right.id);
}

/** @param {unknown} raw @returns {{observed:number,inferred:number,unknown:number}} */
function evidenceCounts(raw) {
  const evidence = isPlainObject(raw) ? raw : {};
  return {
    observed: arrayOf(evidence.observed).length,
    inferred: arrayOf(evidence.inferred).length,
    unknown: arrayOf(evidence.unknown).length
  };
}

/** @param {{observed:number,inferred:number,unknown:number}} counts @param {string} state @returns {object} */
function facilityEvidence(counts, state) {
  const evidence = { observed: [], inferred: [], unknown: [] };
  if (counts.observed > 0) evidence.observed.push(`facility.${state}.observed`);
  if (counts.inferred > 0) evidence.inferred.push(`facility.${state}.inferred`);
  if (counts.unknown > 0) evidence.unknown.push(`facility.${state}.unknown`);
  return evidence;
}

/**
 * Build the canonical WorldPlan fact table. Invalid entries are ignored;
 * malformed top-level input degrades to an empty, frozen table. Every returned
 * collection is sorted with plain UTF-16 code-unit ordering and deeply frozen.
 *
 * @param {unknown} inspection
 * @param {unknown} townModel
 * @returns {ReadonlyArray<object>}
 */
export function buildWorldFacts(inspection, townModel) {
  try {
    const source = isPlainObject(inspection) ? inspection : {};
    const model = isPlainObject(townModel) ? townModel : {};
    const facts = [];

    for (const entry of arrayOf(source.graph?.entrypoints)) {
      if (!isPlainObject(entry)) continue;
      const path = nonemptyString(entry.path);
      if (!path) continue;
      facts.push(makeFact('entrypoint', {
        path,
        source: nonemptyString(entry.evidence)
      }, { observed: ['inspection.entrypoint.observed'] }));
    }

    for (const edge of arrayOf(source.inspection?.observed?.unresolvedLinks)) {
      if (!isPlainObject(edge)) continue;
      const from = nonemptyString(edge.from);
      if (!from) continue;
      facts.push(makeFact('unresolved', {
        from,
        targetHint: nonemptyString(edge.targetHint),
        kind: nonemptyString(edge.kind),
        status: nonemptyString(edge.status) ?? 'unresolved'
      }, { observed: ['inspection.unresolved.observed'] }));
    }

    for (const cycle of arrayOf(source.inspection?.inferred?.cycles)) {
      if (!isPlainObject(cycle)) continue;
      const members = sortedUniqueStrings(arrayOf(cycle.members));
      if (members.length === 0) continue;
      facts.push(makeFact('cycle', { members }, { inferred: ['inspection.cycle.inferred'] }));
    }

    for (const association of arrayOf(source.inspection?.inferred?.testAssociations)) {
      if (!isPlainObject(association)) continue;
      const sourcePath = nonemptyString(association.source);
      const testPath = nonemptyString(association.test);
      if (!sourcePath || !testPath) continue;
      facts.push(makeFact('test_association', {
        source: sourcePath,
        test: testPath,
        method: nonemptyString(association.evidence)
      }, { inferred: ['inspection.test_association.inferred'] }));
    }

    for (const building of arrayOf(source.city?.buildings)) {
      if (!isPlainObject(building)) continue;
      const path = nonemptyString(building.path);
      if (!path) continue;
      if (building.isTest !== true && building.evidence?.associatedTest !== true) {
        facts.push(makeFact('unverified', {
          path,
          kind: nonemptyString(building.kind)
        }, { unknown: ['inspection.file.unverified'] }));
      }
      const reachability = nonemptyString(building.evidence?.reachability);
      if (reachability === 'not-reached-from-known-entrypoints') {
        facts.push(makeFact('unreached', {
          path,
          reachability
        }, { inferred: ['inspection.reachability.unreached.inferred'] }));
      }
    }

    for (const edge of arrayOf(source.inspection?.unknownDependencies)) {
      if (!isPlainObject(edge) || edge.status !== 'runtime-unknown') continue;
      const from = nonemptyString(edge.from);
      if (!from) continue;
      facts.push(makeFact('runtime_unknown', {
        from,
        targetHint: nonemptyString(edge.targetHint),
        kind: nonemptyString(edge.kind),
        status: 'runtime-unknown'
      }, { unknown: ['inspection.dependency.runtime_unknown'] }));
    }

    if (source.summary?.truncated === true) {
      const truncation = isPlainObject(source.summary.truncation) ? source.summary.truncation : {};
      facts.push(makeFact('truncation', {
        omittedFiles: countOf(source.summary.omittedFiles),
        edgesOmitted: countOf(source.summary.edgesOmitted),
        limits: {
          traversal: truncation.traversal === true,
          discovery: truncation.discovery === true,
          analysis: truncation.analysis === true,
          files: truncation.files === true,
          edges: truncation.edges === true
        }
      }, {
        observed: ['inspection.truncation.observed'],
        unknown: ['inspection.truncation.omitted_scope_unknown']
      }));
    }

    const facilities = arrayOf(model.facilities)
      .filter((facility) => isPlainObject(facility) && nonemptyString(facility.kind))
      .sort((left, right) => compareCodeUnits(left.kind, right.kind));
    for (const facility of facilities) {
      const present = facility.present === true;
      const type = present ? 'facility_present' : 'facility_absent';
      const counts = evidenceCounts(facility.evidence);
      facts.push(makeFact(type, {
        kind: facility.kind,
        count: countOf(facility.count),
        evidenceCounts: counts
      }, facilityEvidence(counts, present ? 'present' : 'absent')));
    }

    const unique = new Map();
    for (const fact of facts) {
      if (!unique.has(fact.id)) unique.set(fact.id, fact);
    }
    return deepFreeze([...unique.values()].sort(compareFacts));
  } catch {
    return Object.freeze([]);
  }
}
