import { generateWorldPlan } from '../../../ship/40-worldgen/index.mjs';

const FACILITY_KINDS = [
  'inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well', 'workshop',
  'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate'
];

function evidence() {
  return { observed: [], inferred: [], unknown: [] };
}

function fixtureTown() {
  return {
    schemaVersion: 1,
    repository: { name: 'Scene compiler fixture', identity: 'scene-compiler-test-only' },
    inspectionDigest: 'a'.repeat(64),
    facilities: FACILITY_KINDS.map((kind, index) => ({
      kind,
      label: kind,
      role: kind === 'shop' ? 'repair' : 'role',
      variant: kind === 'shop' ? 'repair' : 'default',
      presence: index === 0 ? 'not-applicable' : 'present',
      condition: 'active',
      blocksProgress: false,
      sourceFileIds: [],
      evidence: evidence()
    })),
    facts: Array.from({ length: 9 }, (_, index) => ({
      id: `fact-${index}`,
      kind: 'capability',
      subject: `subject-${index}`,
      state: 'unknown',
      evidence: evidence()
    })),
    habitability: { level: 1, label: 'habitable', knownCapabilities: [], unknownCapabilities: [], evidence: evidence() },
    evidence: {
      observed: ['observed:repository:name', 'repository.inspection.completed'],
      inferred: ['inferred:repository:identity', 'inferred:repository:project-kind'],
      unknown: ['repository.inspection.runtime.unknown', 'unknown:git-metadata', 'unknown:graph:entrypoints'],
    },
    guild: {
      tabs: Array.from({ length: 5 }, (_, index) => ({ id: `tab-${index}`, label: 'tab', entries: [], evidence: evidence() })),
      representativeConnections: [],
      connections: []
    },
    investigations: {
      priority: ['entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery'],
      candidates: [
        {
          id: 'investigation.persistence', capability: 'persistence', facilityKind: 'warehouse', role: 'persistence', variant: null,
          subject: '倉庫の台帳', statement: '倉庫に記録が残る', state: 'unknown',
          evidence: { observed: ['repository.inspection.completed'], inferred: [], unknown: ['test-only.persistence.unknown'] },
        },
        {
          id: 'investigation.configuration', capability: 'configuration', facilityKind: 'well', role: 'configuration', variant: null,
          subject: '井戸の水', statement: '井戸から水が使える', state: 'unknown',
          evidence: { observed: ['repository.inspection.completed'], inferred: [], unknown: ['test-only.configuration.unknown'] },
        },
        {
          id: 'investigation.test', capability: 'test', facilityKind: 'dojo', role: 'verification', variant: null,
          subject: '道場の検査', statement: '道場に検査済みの印がある', state: 'unknown',
          evidence: { observed: ['repository.inspection.completed'], inferred: [], unknown: ['test-only.test.unknown'] },
        },
      ],
    },
    rewards: {
      bindings: [{
        id: 'repository_inspected', event: 'repository_inspected', transition: 'repository_inspected',
        facilityKind: 'town_hall', effect: 'town_hall_lantern_lit',
      }],
      transitions: [{
        id: 'transition.repository_inspected',
        event: 'repository_inspected',
        bindingId: 'repository_inspected',
        facilityKind: 'town_hall',
        effect: 'town_hall_lantern_lit',
        state: 'observed',
        evidence: { observed: ['repository.inspection.completed'], inferred: [], unknown: [] },
      }],
    }
  };
}

/** Hand-authored test-only input; generated output is never product data. */
export function createTestOnlyWorldPlan(options = {}) {
  return structuredClone(generateWorldPlan({ town: fixtureTown(options) }));
}
