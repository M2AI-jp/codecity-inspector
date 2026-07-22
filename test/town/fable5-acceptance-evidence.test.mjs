import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EVIDENCE_INDEX_FILENAME,
  HARD_GATE_FILENAME,
  HARD_GATE_IDS,
  IDENTITY_FILENAME,
  INDEXED_ARTIFACT_FILENAMES,
  OWNER_APPROVAL_FILENAME,
  REQUIRED_ARTIFACT_FILENAMES,
  main,
  validateFable5AcceptanceEvidence
} from '../../tools/qa/fable5-acceptance-evidence.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const CAPTURED_AT = '2026-07-22T08:30:00.000Z';
const SESSION_ID = 'browser-session-20260722-a';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function artifactBytes(filename) {
  if (filename.endsWith('.json')) return Buffer.from(JSON.stringify({ artifact: filename, captured: true }, null, 2));
  return Buffer.from(`captured evidence: ${filename}\n`);
}

async function readJson(root, filename) {
  return JSON.parse(await readFile(path.join(root, filename), 'utf8'));
}

async function writeJson(root, filename, value) {
  await writeFile(path.join(root, filename), `${JSON.stringify(value, null, 2)}\n`);
}

async function createPacket(t, { gateStates = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fable5-acceptance-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const identity = {
    schemaVersion: 1,
    kind: 'fable5-acceptance-revision-identity',
    immutable: true,
    head: HEAD,
    url: 'http://127.0.0.1:4173/fable5-v2/',
    viewport: { width: 1920, height: 1080 },
    dpr: 1,
    capturedAt: CAPTURED_AT,
    sessionId: SESSION_ID
  };
  const identityBytes = Buffer.from(`${JSON.stringify(identity, null, 2)}\n`);
  const identitySha256 = digest(identityBytes);
  const contents = new Map([[IDENTITY_FILENAME, identityBytes]]);

  for (const filename of REQUIRED_ARTIFACT_FILENAMES) {
    if (filename === IDENTITY_FILENAME || filename === EVIDENCE_INDEX_FILENAME
      || filename === HARD_GATE_FILENAME || filename === OWNER_APPROVAL_FILENAME) continue;
    contents.set(filename, artifactBytes(filename));
  }

  const gates = {
    schemaVersion: 1,
    kind: 'fable5-hard-gate-verdicts',
    identitySha256,
    sessionId: SESSION_ID,
    gates: HARD_GATE_IDS.map((id, index) => ({
      id,
      state: gateStates?.[index] ?? 'UNKNOWN',
      reviewer: 'QA reviewer',
      rationale: `Declared ${id} state is evidence-backed but not promoted by this validator.`,
      evidencePaths: [IDENTITY_FILENAME]
    }))
  };
  contents.set(HARD_GATE_FILENAME, Buffer.from(`${JSON.stringify(gates, null, 2)}\n`));
  contents.set(OWNER_APPROVAL_FILENAME, Buffer.from([
    '# Owner play approval',
    `Identity-SHA-256: ${identitySha256}`,
    `Session-ID: ${SESSION_ID}`,
    'Owner: Product Owner',
    'Decision: APPROVED',
    `Approved-At: ${CAPTURED_AT}`,
    ''
  ].join('\n')));

  const index = {
    schemaVersion: 1,
    kind: 'fable5-acceptance-evidence-index',
    identitySha256,
    sessionId: SESSION_ID,
    artifacts: INDEXED_ARTIFACT_FILENAMES.map((filename) => {
      const bytes = contents.get(filename);
      return {
        path: filename,
        sha256: digest(bytes),
        bytes: bytes.length,
        sessionId: SESSION_ID,
        capturedAt: CAPTURED_AT,
        command: 'captured by a recorded external browser session',
        reviewer: 'QA reviewer',
        verdict: 'UNKNOWN'
      };
    })
  };
  contents.set(EVIDENCE_INDEX_FILENAME, Buffer.from(`${JSON.stringify(index, null, 2)}\n`));

  for (const filename of REQUIRED_ARTIFACT_FILENAMES) {
    await writeFile(path.join(root, filename), contents.get(filename));
  }
  return { root, identity, identitySha256 };
}

function errorCodes(report) {
  return report.errors.map(({ code }) => code);
}

test('validates the complete fixed packet and reports declared states without claiming acceptance or PASS', async (t) => {
  const { root, identitySha256 } = await createPacket(t, {
    gateStates: ['UNKNOWN', 'UNMET', 'FAIL', 'PASS', 'UNKNOWN', 'UNMET', 'FAIL', 'PASS', 'UNKNOWN', 'UNMET']
  });
  const report = await validateFable5AcceptanceEvidence(root);

  assert.equal(report.valid, true);
  assert.equal(report.acceptance.accepted, false, 'structural validation must never become an acceptance claim');
  assert.equal(report.requiredArtifactCount, REQUIRED_ARTIFACT_FILENAMES.length);
  assert.equal(report.readableArtifactCount, REQUIRED_ARTIFACT_FILENAMES.length);
  assert.equal(report.identity.sha256, identitySha256);
  assert.deepEqual(Object.keys(report.declaredHardGateStates), HARD_GATE_IDS);
  assert.deepEqual(report.declaredHardGateStates, {
    'HG-01': 'UNKNOWN', 'HG-02': 'UNMET', 'HG-03': 'FAIL', 'HG-04': 'PASS', 'HG-05': 'UNKNOWN',
    'HG-06': 'UNMET', 'HG-07': 'FAIL', 'HG-08': 'PASS', 'HG-09': 'UNKNOWN', 'HG-10': 'UNMET'
  });
  assert.equal(report.errors.length, 0);
});

test('fails closed for a missing artifact and for an unexpected file outside the fixed packet layout', async (t) => {
  const { root } = await createPacket(t);
  await rm(path.join(root, '45-golden-route-60fps.webm'));
  await writeFile(path.join(root, 'untracked-browser-note.txt'), 'not indexed');

  const report = await validateFable5AcceptanceEvidence(root);
  assert.equal(report.valid, false);
  assert.ok(errorCodes(report).includes('EVIDENCE_FILE_MISSING'));
  assert.ok(errorCodes(report).includes('EVIDENCE_FILE_UNEXPECTED'));
  assert.ok(errorCodes(report).includes('INDEX_ARTIFACT_UNREADABLE'), 'an indexed-but-missing artifact cannot remain trusted');
});

test('re-hashes raw bytes and rejects artifact tampering even when the filename remains present', async (t) => {
  const { root } = await createPacket(t);
  await writeFile(path.join(root, '40-viewport-1920x1080.png'), 'tampered browser evidence');

  const report = await validateFable5AcceptanceEvidence(root);
  assert.equal(report.valid, false);
  assert.ok(errorCodes(report).includes('INDEX_ARTIFACT_HASH_MISMATCH'));
});

test('requires every unique HG-01 through HG-10 record to carry an explicit allowed state and evidence link', async (t) => {
  const { root } = await createPacket(t);
  const gates = await readJson(root, HARD_GATE_FILENAME);
  gates.gates = [
    { ...gates.gates[0], state: 'MAYBE', evidencePaths: [] },
    { ...gates.gates[0], state: 'PASS' },
    ...gates.gates.slice(2)
  ];
  await writeJson(root, HARD_GATE_FILENAME, gates);

  const report = await validateFable5AcceptanceEvidence(root);
  assert.equal(report.valid, false);
  assert.ok(errorCodes(report).includes('GATE_STATE_INVALID'));
  assert.ok(errorCodes(report).includes('GATE_EVIDENCE_INCOMPLETE'));
  assert.ok(errorCodes(report).includes('GATE_DUPLICATE'));
  assert.ok(errorCodes(report).includes('GATE_MISSING'));
});

test('binds index, gates, and owner approval to the exact immutable identity bytes and one session', async (t) => {
  const { root } = await createPacket(t);
  const index = await readJson(root, EVIDENCE_INDEX_FILENAME);
  index.sessionId = 'different-session';
  await writeJson(root, EVIDENCE_INDEX_FILENAME, index);

  const gates = await readJson(root, HARD_GATE_FILENAME);
  gates.identitySha256 = 'f'.repeat(64);
  await writeJson(root, HARD_GATE_FILENAME, gates);

  const owner = await readFile(path.join(root, OWNER_APPROVAL_FILENAME), 'utf8');
  await writeFile(path.join(root, OWNER_APPROVAL_FILENAME), owner.replace('Decision: APPROVED', 'Decision: PENDING'));

  const report = await validateFable5AcceptanceEvidence(root);
  assert.equal(report.valid, false);
  assert.ok(errorCodes(report).includes('INDEX_SESSION_MISMATCH'));
  assert.ok(errorCodes(report).includes('GATES_IDENTITY_MISMATCH'));
  assert.ok(errorCodes(report).includes('OWNER_APPROVAL_DECISION_INVALID'));
});

test('rejects incomplete or non-loopback revision identity instead of treating it as current browser proof', async (t) => {
  const { root } = await createPacket(t);
  const identity = await readJson(root, IDENTITY_FILENAME);
  identity.immutable = false;
  identity.head = 'short-head';
  identity.url = 'https://example.com/fable5-v2/';
  identity.viewport = { width: 0, height: 720 };
  identity.dpr = Infinity;
  identity.capturedAt = 'sometime';
  identity.sessionId = '';
  await writeJson(root, IDENTITY_FILENAME, identity);

  const report = await validateFable5AcceptanceEvidence(root);
  assert.equal(report.valid, false);
  for (const code of [
    'IDENTITY_NOT_IMMUTABLE', 'IDENTITY_HEAD_INVALID', 'IDENTITY_URL_NOT_LOOPBACK',
    'IDENTITY_VIEWPORT_INVALID', 'IDENTITY_DPR_INVALID', 'IDENTITY_TIME_INVALID', 'IDENTITY_SESSION_REQUIRED'
  ]) assert.ok(errorCodes(report).includes(code), code);
});

test('fails closed for malformed index paths and performs no browser automation or file creation', async (t) => {
  const { root } = await createPacket(t);
  const before = await readFile(path.join(root, '30-browser-session.json'));
  const index = await readJson(root, EVIDENCE_INDEX_FILENAME);
  index.artifacts[0].path = '../outside.json';
  await writeJson(root, EVIDENCE_INDEX_FILENAME, index);

  const report = await validateFable5AcceptanceEvidence(root);
  assert.equal(report.valid, false);
  assert.ok(errorCodes(report).includes('INDEX_ARTIFACT_PATH_INVALID'));
  assert.deepEqual(await readFile(path.join(root, '30-browser-session.json')), before, 'validator only reads supplied evidence');
});

test('CLI main emits a machine-readable report and returns nonzero for invalid input without throwing', async (t) => {
  const { root } = await createPacket(t);
  const output = [];
  const errors = [];
  const io = {
    stdout: { write(value) { output.push(value); } },
    stderr: { write(value) { errors.push(value); } }
  };

  assert.equal(await main(['--dir', root], io), 0);
  const report = JSON.parse(output.join(''));
  assert.equal(report.kind, 'fable5-acceptance-evidence-validation-report');
  assert.equal(report.acceptance.accepted, false);

  assert.equal(await main(['--bad-option'], io), 2);
  assert.match(errors.join(''), /Usage:/);
});
