import { generateWorldPlan } from '../../../40-worldgen/index.mjs';

const FACILITY_KINDS = [
  'inn', 'pub', 'guild', 'town_hall', 'dock', 'warehouse', 'well', 'workshop',
  'dojo', 'watchtower', 'house', 'shop', 'ruin', 'gate'
];

function evidence() {
  return { observed: [], inferred: [], unknown: [] };
}

function fixtureTown({ observedTransition = false } = {}) {
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
      condition: 'ready',
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
    guild: {
      tabs: Array.from({ length: 5 }, (_, index) => ({ id: `tab-${index}`, label: 'tab', entries: [], evidence: evidence() })),
      representativeConnections: [],
      connections: []
    },
    investigations: {
      priority: ['entrypoint', 'persistence', 'configuration', 'test', 'observability', 'recovery'],
      candidates: [{
        id: 'candidate-test-only', capability: 'entrypoint', facilityKind: 'gate', role: 'entrypoint', variant: null,
        subject: '城門と宿屋の入口', statement: '城門から人が入れる', state: 'unknown',
        evidence: { observed: [], inferred: [], unknown: ['test-only.entrypoint.unknown'] },
      }],
    },
    rewards: {
      bindings: Array.from({ length: 9 }, (_, index) => ({ id: `reward-${index}`, kind: 'reward' })),
      transitions: observedTransition ? [{
        id: 'transition.tests-passed',
        event: 'tests_passed',
        bindingId: 'reward.tests_passed',
        facilityKind: 'dojo',
        effect: 'inspection_stamp',
        state: 'observed',
        evidence: { observed: ['test-only.tests-passed.observed'], inferred: [], unknown: [] },
      }] : [],
    }
  };
}

/** Hand-authored test-only input; generated output is never product data. */
export function createTestOnlyWorldPlan(options = {}) {
  return structuredClone(generateWorldPlan({ town: fixtureTown(options) }));
}
