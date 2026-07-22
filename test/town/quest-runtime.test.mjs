import assert from 'node:assert/strict';
import test from 'node:test';
import { CLUE_INTERACTIONS } from '../../public/fable5-v2/world-runtime.mjs';
import {
  chooseInvestigationQuestion,
  createInvestigationState,
  FABLE5_QUEST_CLUE_IDS,
  FABLE5_QUEST_QUESTION_IDS,
  FABLE5_QUEST_SCHEMA_VERSION,
  recordInvestigationClue,
  restoreInvestigationState,
  serializeInvestigationState,
  startInnDialogue,
  submitTownHallReport
} from '../../public/fable5-v2/quest-runtime.mjs';

function accepted(result) {
  assert.equal(result.ok, true, result.code ?? 'expected accepted transition');
  return result.state;
}

function rejected(result, code) {
  assert.deepEqual(result, { ok: false, code, state: null });
}

function investigating(questionId = 'observed') {
  return accepted(chooseInvestigationQuestion(accepted(startInnDialogue(createInvestigationState())), questionId));
}

function reportable() {
  let state = investigating();
  for (const clueId of FABLE5_QUEST_CLUE_IDS) {
    state = accepted(recordInvestigationClue(state, clueId, [`fact:${clueId}`]));
  }
  return state;
}

test('exports the exact existing clue IDs and evidence classes from world runtime', () => {
  assert.deepEqual(FABLE5_QUEST_CLUE_IDS, CLUE_INTERACTIONS.map(({ id }) => id));
  assert.deepEqual(FABLE5_QUEST_QUESTION_IDS, ['observed', 'inferred', 'unknown']);
  assert.deepEqual(CLUE_INTERACTIONS.map(({ evidenceClass }) => evidenceClass), FABLE5_QUEST_QUESTION_IDS);
});

test('creates an immutable schema-versioned new state', () => {
  const state = createInvestigationState();
  assert.deepEqual(state, {
    schemaVersion: FABLE5_QUEST_SCHEMA_VERSION,
    phase: 'new',
    questionId: null,
    clues: [],
    submission: null
  });
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.clues));
});

test('starts only from a new state and does not mutate the prior snapshot', () => {
  const initial = createInvestigationState();
  const started = accepted(startInnDialogue(initial));
  assert.equal(started.phase, 'inn-dialogue');
  assert.equal(initial.phase, 'new');
  rejected(startInnDialogue(started), 'invalid-transition');
  rejected(startInnDialogue({}), 'invalid-state');
});

test('requires an inn dialogue and one known question before investigation begins', () => {
  const initial = createInvestigationState();
  rejected(chooseInvestigationQuestion(initial, 'observed'), 'invalid-transition');

  const dialogue = accepted(startInnDialogue(initial));
  rejected(chooseInvestigationQuestion(dialogue, 'invented-question'), 'invalid-question');
  const investigatingState = accepted(chooseInvestigationQuestion(dialogue, 'inferred'));
  assert.deepEqual({ phase: investigatingState.phase, questionId: investigatingState.questionId }, {
    phase: 'investigating', questionId: 'inferred'
  });
  rejected(chooseInvestigationQuestion(investigatingState, 'unknown'), 'invalid-transition');
});

test('rejects clues before question selection and rejects unknown clue IDs', () => {
  const dialogue = accepted(startInnDialogue(createInvestigationState()));
  rejected(recordInvestigationClue(dialogue, FABLE5_QUEST_CLUE_IDS[0], []), 'invalid-transition');
  rejected(recordInvestigationClue(investigating(), 'clue-invented', []), 'invalid-clue');
});

test('records each existing clue once, preserves caller evidence references exactly, and maps its fixed class', () => {
  let state = investigating('unknown');
  const supplied = {
    'clue-streetlamp': ['fact.entrypoint', 'source:src/main.mjs'],
    'clue-well': [],
    'clue-east-shop': ['fact.runtime-unknown']
  };
  const order = ['clue-east-shop', 'clue-streetlamp', 'clue-well'];
  for (const clueId of order) state = accepted(recordInvestigationClue(state, clueId, supplied[clueId]));

  assert.equal(state.phase, 'reportable');
  assert.deepEqual(state.clues, [
    { id: 'clue-east-shop', evidenceClass: 'unknown', evidenceRefs: ['fact.runtime-unknown'] },
    { id: 'clue-streetlamp', evidenceClass: 'observed', evidenceRefs: ['fact.entrypoint', 'source:src/main.mjs'] },
    { id: 'clue-well', evidenceClass: 'inferred', evidenceRefs: [] }
  ]);
  assert.deepEqual(Object.keys(state.clues[0]).sort(), ['evidenceClass', 'evidenceRefs', 'id']);
  assert.ok(Object.isFrozen(state.clues[0]));
  assert.ok(Object.isFrozen(state.clues[0].evidenceRefs));
});

test('rejects duplicate clues without changing the valid prior snapshot', () => {
  const once = accepted(recordInvestigationClue(investigating(), 'clue-well', ['fact.cycle']));
  rejected(recordInvestigationClue(once, 'clue-well', ['fact.another-cycle']), 'duplicate-clue');
  assert.deepEqual(once.clues, [
    { id: 'clue-well', evidenceClass: 'inferred', evidenceRefs: ['fact.cycle'] }
  ]);
});

test('becomes reportable only after all three distinct existing clues', () => {
  let state = investigating();
  for (let index = 0; index < FABLE5_QUEST_CLUE_IDS.length - 1; index += 1) {
    state = accepted(recordInvestigationClue(state, FABLE5_QUEST_CLUE_IDS[index]));
    assert.equal(state.phase, 'investigating');
  }
  state = accepted(recordInvestigationClue(state, FABLE5_QUEST_CLUE_IDS.at(-1)));
  assert.equal(state.phase, 'reportable');
  assert.deepEqual(new Set(state.clues.map(({ id }) => id)), new Set(FABLE5_QUEST_CLUE_IDS));
});

test('does not permit report submission until all three clues are recorded', () => {
  const partial = accepted(recordInvestigationClue(investigating(), 'clue-streetlamp'));
  rejected(submitTownHallReport(partial, { answer: 'static survey', result: 'saved' }), 'invalid-transition');
});

test('submits only a caller-supplied answer/result at town hall and reaches completed', () => {
  const ready = reportable();
  const answer = { selected: 'record-observed-inferred-unknown', confidence: 'bounded' };
  const result = { outcome: 'ledger-recorded', followUp: ['keep-runtime-unknown-open'] };
  const completed = accepted(submitTownHallReport(ready, { answer, result }));

  assert.equal(completed.phase, 'completed');
  assert.deepEqual(completed.submission, { location: 'town-hall', answer, result });
  assert.equal(ready.phase, 'reportable');
  rejected(submitTownHallReport(ready, { answer: '', result: 'saved' }), 'invalid-submission');
  rejected(submitTownHallReport(ready, { answer: 'answer', result: null }), 'invalid-submission');
  rejected(recordInvestigationClue(completed, 'clue-well'), 'invalid-transition');
  rejected(submitTownHallReport(completed, { answer: 'again', result: 'again' }), 'invalid-transition');
});

test('copies input evidence and submission data instead of retaining caller-owned mutable objects', () => {
  const refs = ['fact.cycle'];
  let state = accepted(recordInvestigationClue(investigating(), 'clue-well', refs));
  refs.push('fact.mutated-after-record');
  assert.deepEqual(state.clues[0].evidenceRefs, ['fact.cycle']);

  state = accepted(recordInvestigationClue(state, 'clue-streetlamp'));
  state = accepted(recordInvestigationClue(state, 'clue-east-shop'));
  const answer = { answer: 'bounded' };
  const result = { result: 'recorded' };
  const completed = accepted(submitTownHallReport(state, { answer, result }));
  answer.answer = 'mutated';
  result.result = 'mutated';
  assert.deepEqual(completed.submission, {
    location: 'town-hall', answer: { answer: 'bounded' }, result: { result: 'recorded' }
  });
});

test('serializes to a JSON-safe DTO and restores both DTO and JSON-string forms', () => {
  const completed = accepted(submitTownHallReport(reportable(), {
    answer: 'record the three evidence classes',
    result: 'town hall accepted the bounded report'
  }));
  const serialized = serializeInvestigationState(completed);
  assert.equal(serialized.ok, true);
  assert.doesNotThrow(() => JSON.stringify(serialized.state));
  assert.notEqual(serialized.state, completed);
  assert.deepEqual(serialized.state, completed);

  const fromDto = restoreInvestigationState(serialized.state);
  const fromJson = restoreInvestigationState(JSON.stringify(serialized.state));
  assert.equal(fromDto.ok, true);
  assert.equal(fromJson.ok, true);
  assert.deepEqual(fromDto.state, completed);
  assert.deepEqual(fromJson.state, completed);
});

test('restore fails closed for malformed, impossible, and schema-mismatched state payloads', () => {
  const base = serializeInvestigationState(createInvestigationState()).state;
  const malformed = [
    '{broken json',
    null,
    [],
    { ...base, schemaVersion: 2 },
    { ...base, phase: 'invented' },
    { ...base, questionId: 'observed' },
    {
      ...base,
      phase: 'reportable',
      questionId: 'observed',
      clues: [{ id: 'clue-streetlamp', evidenceClass: 'observed', evidenceRefs: [] }]
    },
    {
      ...base,
      phase: 'investigating',
      questionId: 'observed',
      clues: [
        { id: 'clue-well', evidenceClass: 'inferred', evidenceRefs: [] },
        { id: 'clue-well', evidenceClass: 'inferred', evidenceRefs: [] }
      ]
    },
    {
      ...base,
      phase: 'investigating',
      questionId: 'observed',
      clues: [{ id: 'clue-well', evidenceClass: 'observed', evidenceRefs: [] }]
    },
    {
      ...base,
      phase: 'completed',
      questionId: 'observed',
      clues: FABLE5_QUEST_CLUE_IDS.map((id) => ({
        id,
        evidenceClass: CLUE_INTERACTIONS.find((clue) => clue.id === id).evidenceClass,
        evidenceRefs: []
      })),
      submission: null
    }
  ];
  const codes = ['invalid-payload', 'invalid-state', 'invalid-state', 'schema-mismatch', 'invalid-state', 'invalid-state', 'invalid-state', 'invalid-state', 'invalid-state', 'invalid-state'];

  malformed.forEach((payload, index) => {
    assert.doesNotThrow(() => restoreInvestigationState(payload));
    rejected(restoreInvestigationState(payload), codes[index]);
  });
});

test('rejects lossy/cyclic/accessor state and evidence payloads without throwing', () => {
  const cyclic = createInvestigationState();
  const malformedState = { ...cyclic, extra: undefined };
  const evidenceAccessor = [];
  Object.defineProperty(evidenceAccessor, '0', { enumerable: true, get() { return 'fact.nope'; } });
  const cycle = { value: 'cycle' };
  cycle.self = cycle;

  rejected(restoreInvestigationState(malformedState), 'invalid-state');
  rejected(recordInvestigationClue(investigating(), 'clue-well', evidenceAccessor), 'invalid-evidence');
  rejected(submitTownHallReport(reportable(), { answer: cycle, result: 'recorded' }), 'invalid-submission');
});
