import { CLUE_INTERACTIONS } from './world-runtime.mjs';

// Pure, persistence-friendly investigation state for the Fable5 vertical
// slice. It holds caller-supplied evidence *references* only: this module
// never writes prose, interprets a reference, or invents a repository fact.

export const FABLE5_QUEST_SCHEMA_VERSION = 1;
export const FABLE5_QUEST_CLUE_IDS = Object.freeze(CLUE_INTERACTIONS.map(({ id }) => id));
export const FABLE5_QUEST_QUESTION_IDS = Object.freeze(['observed', 'inferred', 'unknown']);

const CLUE_METADATA = new Map(CLUE_INTERACTIONS.map(({ id, evidenceClass }) => [id, evidenceClass]));
const PHASES = new Set(['new', 'inn-dialogue', 'investigating', 'reportable', 'completed']);
const UNSAFE_JSON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 10_000;

/**
 * Creates the initial, immutable investigation state. The player has not yet
 * opened the inn dialogue, selected a question, or recorded a clue.
 */
export function createInvestigationState() {
  return freezeState({
    schemaVersion: FABLE5_QUEST_SCHEMA_VERSION,
    phase: 'new',
    questionId: null,
    clues: [],
    submission: null
  });
}

/**
 * Opens the initial inn dialogue. It is deliberately a separate transition so
 * a UI cannot select a question before the player has reached the innkeeper.
 */
export function startInnDialogue(state) {
  const current = normalizeState(state);
  if (!current.ok) return failure('invalid-state');
  if (current.state.phase !== 'new') return failure('invalid-transition');
  return success(withState(current.state, { phase: 'inn-dialogue' }));
}

/**
 * Selects exactly one evidence-oriented question from the inn dialogue.
 * Question IDs are intentionally identifiers rather than generated text.
 */
export function chooseInvestigationQuestion(state, questionId) {
  const current = normalizeState(state);
  if (!current.ok) return failure('invalid-state');
  if (current.state.phase !== 'inn-dialogue') return failure('invalid-transition');
  if (!FABLE5_QUEST_QUESTION_IDS.includes(questionId)) return failure('invalid-question');
  return success(withState(current.state, {
    phase: 'investigating',
    questionId
  }));
}

/**
 * Records one of the three existing world clues. Evidence references are
 * opaque non-empty strings supplied by the caller (for example fact IDs or
 * provenance IDs); an empty list is valid when no such fact was observed.
 */
export function recordInvestigationClue(state, clueId, evidenceRefs = []) {
  const current = normalizeState(state);
  if (!current.ok) return failure('invalid-state');
  if (current.state.phase !== 'investigating') return failure('invalid-transition');
  if (!CLUE_METADATA.has(clueId)) return failure('invalid-clue');
  if (current.state.clues.some((clue) => clue.id === clueId)) return failure('duplicate-clue');

  const references = normalizeEvidenceRefs(evidenceRefs);
  if (!references.ok) return failure('invalid-evidence');

  const clues = [
    ...current.state.clues,
    {
      id: clueId,
      evidenceClass: CLUE_METADATA.get(clueId),
      evidenceRefs: references.value
    }
  ];
  return success(withState(current.state, {
    phase: clues.length === FABLE5_QUEST_CLUE_IDS.length ? 'reportable' : 'investigating',
    clues
  }));
}

/**
 * Stores the caller's town-hall answer and result after all three clues have
 * been recorded. The values are copied as JSON-safe data; no conclusion is
 * synthesized from the evidence references.
 */
export function submitTownHallReport(state, { answer, result } = {}) {
  const current = normalizeState(state);
  if (!current.ok) return failure('invalid-state');
  if (current.state.phase !== 'reportable') return failure('invalid-transition');

  const answerCopy = cloneJson(answer);
  const resultCopy = cloneJson(result);
  if (!answerCopy.ok || !resultCopy.ok || !isMeaningfulSubmissionValue(answerCopy.value)
    || !isMeaningfulSubmissionValue(resultCopy.value)) {
    return failure('invalid-submission');
  }

  return success(withState(current.state, {
    phase: 'completed',
    submission: {
      location: 'town-hall',
      answer: answerCopy.value,
      result: resultCopy.value
    }
  }));
}

/**
 * Returns a JSON-safe, schema-versioned DTO suitable for the injected Fable5
 * persistence adapter. It does not stringify so the caller can keep the quest
 * alongside other saved runtime state in one persisted record.
 */
export function serializeInvestigationState(state) {
  const normalized = normalizeState(state);
  return normalized.ok
    ? success(normalized.state)
    : failure(normalized.code ?? 'invalid-state');
}

/**
 * Restores a persisted DTO (or a JSON string containing one) without throwing.
 * Invalid, impossible, or mismatched-schema values fail closed with state null.
 */
export function restoreInvestigationState(value) {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      return failure('invalid-payload');
    }
  }
  const normalized = normalizeState(candidate);
  return normalized.ok
    ? success(normalized.state)
    : failure(normalized.code ?? 'invalid-state');
}

function withState(state, changes) {
  return freezeState({
    schemaVersion: FABLE5_QUEST_SCHEMA_VERSION,
    phase: state.phase,
    questionId: state.questionId,
    clues: state.clues,
    submission: state.submission,
    ...changes
  });
}

function success(state) {
  return Object.freeze({ ok: true, state });
}

function failure(code) {
  return Object.freeze({ ok: false, code, state: null });
}

function normalizeState(candidate) {
  const copied = cloneJsonRecord(candidate);
  if (!copied.ok) return { ok: false, code: 'invalid-state' };
  const state = copied.value;
  if (state.schemaVersion !== FABLE5_QUEST_SCHEMA_VERSION) {
    return { ok: false, code: 'schema-mismatch' };
  }
  if (!hasExactKeys(state, ['schemaVersion', 'phase', 'questionId', 'clues', 'submission'])) {
    return { ok: false, code: 'invalid-state' };
  }
  if (!PHASES.has(state.phase)) return { ok: false, code: 'invalid-state' };

  const clues = normalizeClues(state.clues);
  if (!clues.ok) return { ok: false, code: 'invalid-state' };
  const hasQuestion = FABLE5_QUEST_QUESTION_IDS.includes(state.questionId);
  const submission = normalizeSubmission(state.submission);
  if (!submission.ok) return { ok: false, code: 'invalid-state' };

  if (!isValidPhaseShape({
    phase: state.phase,
    questionId: state.questionId,
    hasQuestion,
    clues: clues.value,
    submission: submission.value
  })) {
    return { ok: false, code: 'invalid-state' };
  }

  return {
    ok: true,
    state: freezeState({
      schemaVersion: FABLE5_QUEST_SCHEMA_VERSION,
      phase: state.phase,
      questionId: state.questionId,
      clues: clues.value,
      submission: submission.value
    })
  };
}

function normalizeClues(value) {
  if (!Array.isArray(value) || value.length > FABLE5_QUEST_CLUE_IDS.length) return { ok: false };
  const seen = new Set();
  const clues = [];
  for (const clue of value) {
    if (!isPlainRecord(clue) || !hasExactKeys(clue, ['id', 'evidenceClass', 'evidenceRefs'])) return { ok: false };
    if (!CLUE_METADATA.has(clue.id) || clue.evidenceClass !== CLUE_METADATA.get(clue.id) || seen.has(clue.id)) {
      return { ok: false };
    }
    const refs = normalizeEvidenceRefs(clue.evidenceRefs);
    if (!refs.ok) return { ok: false };
    seen.add(clue.id);
    clues.push({ id: clue.id, evidenceClass: clue.evidenceClass, evidenceRefs: refs.value });
  }
  return { ok: true, value: clues };
}

function normalizeEvidenceRefs(value) {
  const copied = cloneJson(value);
  if (!copied.ok || !Array.isArray(copied.value)) return { ok: false };
  if (!copied.value.every((reference) => typeof reference === 'string' && reference.trim().length > 0)) {
    return { ok: false };
  }
  return { ok: true, value: copied.value };
}

function normalizeSubmission(value) {
  if (value === null) return { ok: true, value: null };
  if (!isPlainRecord(value) || !hasExactKeys(value, ['location', 'answer', 'result']) || value.location !== 'town-hall') {
    return { ok: false };
  }
  const answer = cloneJson(value.answer);
  const result = cloneJson(value.result);
  if (!answer.ok || !result.ok || !isMeaningfulSubmissionValue(answer.value) || !isMeaningfulSubmissionValue(result.value)) {
    return { ok: false };
  }
  return {
    ok: true,
    value: { location: 'town-hall', answer: answer.value, result: result.value }
  };
}

function isMeaningfulSubmissionValue(value) {
  return value !== null && !(typeof value === 'string' && value.trim().length === 0);
}

function isValidPhaseShape({ phase, questionId, hasQuestion, clues, submission }) {
  const allCluesRecorded = clues.length === FABLE5_QUEST_CLUE_IDS.length;
  if (phase === 'new' || phase === 'inn-dialogue') {
    return questionId === null && clues.length === 0 && submission === null;
  }
  if (phase === 'investigating') return hasQuestion && clues.length < FABLE5_QUEST_CLUE_IDS.length && submission === null;
  if (phase === 'reportable') return hasQuestion && allCluesRecorded && submission === null;
  return phase === 'completed' && hasQuestion && allCluesRecorded && submission !== null;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function cloneJsonRecord(value) {
  if (!isPlainRecord(value)) return { ok: false };
  return cloneJson(value);
}

function cloneJson(value) {
  try {
    return { ok: true, value: cloneJsonValue(value, new Set(), { nodes: 0 }, 0) };
  } catch {
    return { ok: false };
  }
}

function cloneJsonValue(value, ancestors, budget, depth) {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new TypeError('JSON limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number');
    return value;
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('non-JSON value');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return cloneJsonArray(value, ancestors, budget, depth);
    if (!isPlainRecord(value)) throw new TypeError('non-plain record');
    return cloneJsonObject(value, ancestors, budget, depth);
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonArray(value, ancestors, budget, depth) {
  if (!Number.isSafeInteger(value.length) || value.length > MAX_JSON_NODES) throw new TypeError('oversized array');
  const output = new Array(value.length);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !isArrayIndex(key, value.length)) throw new TypeError('array property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('array accessor');
    output[Number(key)] = cloneJsonValue(descriptor.value, ancestors, budget, depth + 1);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError('sparse array');
  }
  return output;
}

function cloneJsonObject(value, ancestors, budget, depth) {
  const output = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || UNSAFE_JSON_KEYS.has(key)) throw new TypeError('unsafe key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('object accessor');
    output[key] = cloneJsonValue(descriptor.value, ancestors, budget, depth + 1);
  }
  return output;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isArrayIndex(key, length) {
  if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function freezeState(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeState(entry);
    Object.freeze(value);
  }
  return value;
}
