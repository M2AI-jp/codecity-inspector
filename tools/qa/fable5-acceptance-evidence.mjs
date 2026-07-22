/**
 * Validate a final Fable5 acceptance-evidence packet without producing any
 * browser evidence or deciding whether a declared hard gate is true.
 *
 * Usage:
 *   node tools/qa/fable5-acceptance-evidence.mjs --dir \
 *     art/production/vertical-slice/qa/acceptance/<full-head>
 *
 * The packet layout is the fixed layout in
 * docs/qa/fable5-current-acceptance-baseline.md §3. Every required top-level
 * file must exist and have an entry in 02-evidence-index.json, except the
 * index itself: a file cannot contain a stable SHA-256 of its own final bytes.
 * The validator hashes bytes, checks identity/session binding, and checks that
 * 91-hard-gate-verdicts.json explicitly records HG-01 through HG-10. It only
 * reports *declared* gate states; `acceptance.accepted` is always false because
 * structural validation cannot replace browser observation or owner judgment.
 *
 * Input contract (schemaVersion 1):
 *   00-revision-identity.json
 *     { schemaVersion: 1, kind: "fable5-acceptance-revision-identity",
 *       immutable: true, head, url, viewport: { width, height }, dpr,
 *       capturedAt, sessionId }
 *   02-evidence-index.json
 *     { schemaVersion: 1, kind: "fable5-acceptance-evidence-index",
 *       identitySha256, sessionId, artifacts: [{ path, sha256, bytes,
 *       sessionId, capturedAt, command, reviewer, verdict }] }
 *   91-hard-gate-verdicts.json
 *     { schemaVersion: 1, kind: "fable5-hard-gate-verdicts",
 *       identitySha256, sessionId, gates: [{ id, state, reviewer, rationale,
 *       evidencePaths }] }
 *   92-owner-play-approval.md
 *     Identity-SHA-256: <identity file SHA-256>
 *     Session-ID: <identity sessionId>
 *     Owner: <named owner>
 *     Decision: APPROVED
 *     Approved-At: <ISO-8601 UTC timestamp>
 */

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const IDENTITY_FILENAME = '00-revision-identity.json';
export const EVIDENCE_INDEX_FILENAME = '02-evidence-index.json';
export const HARD_GATE_FILENAME = '91-hard-gate-verdicts.json';
export const OWNER_APPROVAL_FILENAME = '92-owner-play-approval.md';

export const REQUIRED_ARTIFACT_FILENAMES = Object.freeze([
  IDENTITY_FILENAME,
  '01-scope-and-authority-decisions.md',
  EVIDENCE_INDEX_FILENAME,
  '10-approved-runtime-asset-set.json',
  '11-asset-contract-n1-n9-report.json',
  '12-asset-forge-provenance-index.json',
  '20-prefab-reconstruction-report.json',
  '21-prefab-reconstruction.png',
  '22-prefab-reconstruction-diff.png',
  '23-prefab-coordinate-comparison.json',
  '30-browser-session.json',
  '31-network.har',
  '32-console.json',
  '33-browser-errors.json',
  '40-viewport-1920x1080.png',
  '41-viewport-1280x720.png',
  '42-crops-character-building-seam-door.png',
  '43-cutaway.png',
  '44-dialogue.png',
  '45-golden-route-60fps.webm',
  '46-frame-pivot-overlay.png',
  '47-collision-nav-overlay.png',
  '48-dialogue-slice-and-stress.json',
  '49-resize-reload-reset-failure-log.json',
  '50-three-repository-comparison.json',
  '90-rubric-scorecard.json',
  HARD_GATE_FILENAME,
  OWNER_APPROVAL_FILENAME
]);

export const INDEXED_ARTIFACT_FILENAMES = Object.freeze(
  REQUIRED_ARTIFACT_FILENAMES.filter((filename) => filename !== EVIDENCE_INDEX_FILENAME)
);

export const HARD_GATE_IDS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `HG-${String(index + 1).padStart(2, '0')}`)
);

export const DECLARED_VERDICT_STATES = Object.freeze(['PASS', 'FAIL', 'UNKNOWN', 'UNMET']);

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const UTC_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value) {
  return typeof value === 'string' && UTC_ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function addError(errors, code, message, filename = undefined) {
  errors.push(Object.freeze({
    code,
    ...(filename ? { filename } : {}),
    message
  }));
}

function parseJson(record, errors) {
  if (!record) return null;
  try {
    return JSON.parse(record.bytes.toString('utf8'));
  } catch {
    addError(errors, 'JSON_PARSE_ERROR', 'File is not valid JSON.', record.filename);
    return null;
  }
}

function validateSchema(document, kind, filename, errors) {
  if (!isObject(document)) {
    addError(errors, 'JSON_OBJECT_REQUIRED', 'Document must be a JSON object.', filename);
    return false;
  }
  let valid = true;
  if (document.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    addError(errors, 'SCHEMA_VERSION_INVALID', `Expected schemaVersion ${EVIDENCE_SCHEMA_VERSION}.`, filename);
    valid = false;
  }
  if (document.kind !== kind) {
    addError(errors, 'DOCUMENT_KIND_INVALID', `Expected kind ${kind}.`, filename);
    valid = false;
  }
  return valid;
}

function validateLoopbackUrl(urlValue, errors) {
  if (!isNonEmptyString(urlValue)) {
    addError(errors, 'IDENTITY_URL_REQUIRED', 'Identity URL must be a non-empty string.', IDENTITY_FILENAME);
    return;
  }
  try {
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
      addError(errors, 'IDENTITY_URL_NOT_LOOPBACK', 'Identity URL must use http(s) on localhost, 127.0.0.1, or ::1.', IDENTITY_FILENAME);
    }
  } catch {
    addError(errors, 'IDENTITY_URL_INVALID', 'Identity URL is not parseable.', IDENTITY_FILENAME);
  }
}

function validateIdentity(identity, errors) {
  if (!validateSchema(identity, 'fable5-acceptance-revision-identity', IDENTITY_FILENAME, errors)) return;
  if (identity.immutable !== true) {
    addError(errors, 'IDENTITY_NOT_IMMUTABLE', 'Identity must declare immutable: true.', IDENTITY_FILENAME);
  }
  if (typeof identity.head !== 'string' || !GIT_HEAD.test(identity.head)) {
    addError(errors, 'IDENTITY_HEAD_INVALID', 'Identity head must be a full lowercase 40- or 64-hex Git revision.', IDENTITY_FILENAME);
  }
  validateLoopbackUrl(identity.url, errors);
  if (!isObject(identity.viewport)
    || !Number.isSafeInteger(identity.viewport.width) || identity.viewport.width <= 0
    || !Number.isSafeInteger(identity.viewport.height) || identity.viewport.height <= 0) {
    addError(errors, 'IDENTITY_VIEWPORT_INVALID', 'Identity viewport must contain positive integer width and height.', IDENTITY_FILENAME);
  }
  if (!Number.isFinite(identity.dpr) || identity.dpr <= 0 || identity.dpr > 8) {
    addError(errors, 'IDENTITY_DPR_INVALID', 'Identity dpr must be a finite value greater than 0 and no more than 8.', IDENTITY_FILENAME);
  }
  if (!isTimestamp(identity.capturedAt)) {
    addError(errors, 'IDENTITY_TIME_INVALID', 'Identity capturedAt must be an ISO-8601 UTC timestamp.', IDENTITY_FILENAME);
  }
  if (!isNonEmptyString(identity.sessionId)) {
    addError(errors, 'IDENTITY_SESSION_REQUIRED', 'Identity sessionId must be a non-empty string.', IDENTITY_FILENAME);
  }
}

function validateEvidenceIndex(index, records, identityDigest, identity, errors) {
  if (!validateSchema(index, 'fable5-acceptance-evidence-index', EVIDENCE_INDEX_FILENAME, errors)) return;
  if (index.identitySha256 !== identityDigest) {
    addError(errors, 'INDEX_IDENTITY_MISMATCH', 'Evidence index identitySha256 does not match the raw identity file.', EVIDENCE_INDEX_FILENAME);
  }
  if (!identity || index.sessionId !== identity.sessionId) {
    addError(errors, 'INDEX_SESSION_MISMATCH', 'Evidence index sessionId does not match the identity sessionId.', EVIDENCE_INDEX_FILENAME);
  }
  if (!Array.isArray(index.artifacts)) {
    addError(errors, 'INDEX_ARTIFACTS_REQUIRED', 'Evidence index artifacts must be an array.', EVIDENCE_INDEX_FILENAME);
    return;
  }

  const expected = new Set(INDEXED_ARTIFACT_FILENAMES);
  const seen = new Set();
  for (const entry of index.artifacts) {
    if (!isObject(entry)) {
      addError(errors, 'INDEX_ARTIFACT_INVALID', 'Every evidence-index artifact must be an object.', EVIDENCE_INDEX_FILENAME);
      continue;
    }
    const filename = entry.path;
    if (!expected.has(filename)) {
      addError(errors, 'INDEX_ARTIFACT_PATH_INVALID', 'Evidence-index artifact path is not a required top-level filename.', EVIDENCE_INDEX_FILENAME);
      continue;
    }
    if (seen.has(filename)) {
      addError(errors, 'INDEX_ARTIFACT_DUPLICATE', `Evidence-index artifact ${filename} appears more than once.`, EVIDENCE_INDEX_FILENAME);
      continue;
    }
    seen.add(filename);
    if (!SHA256_HEX.test(entry.sha256 ?? '')) {
      addError(errors, 'INDEX_ARTIFACT_SHA256_INVALID', `Artifact ${filename} needs a lowercase SHA-256 record.`, EVIDENCE_INDEX_FILENAME);
    }
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
      addError(errors, 'INDEX_ARTIFACT_BYTES_INVALID', `Artifact ${filename} needs a positive integer byte count.`, EVIDENCE_INDEX_FILENAME);
    }
    if (!identity || entry.sessionId !== identity.sessionId) {
      addError(errors, 'INDEX_ARTIFACT_SESSION_MISMATCH', `Artifact ${filename} is not bound to the identity session.`, EVIDENCE_INDEX_FILENAME);
    }
    if (!isTimestamp(entry.capturedAt)) {
      addError(errors, 'INDEX_ARTIFACT_TIME_INVALID', `Artifact ${filename} needs an ISO-8601 UTC capturedAt.`, EVIDENCE_INDEX_FILENAME);
    }
    if (!isNonEmptyString(entry.command) || !isNonEmptyString(entry.reviewer)) {
      addError(errors, 'INDEX_ARTIFACT_PROVENANCE_INCOMPLETE', `Artifact ${filename} needs command and reviewer fields.`, EVIDENCE_INDEX_FILENAME);
    }
    if (!DECLARED_VERDICT_STATES.includes(entry.verdict)) {
      addError(errors, 'INDEX_ARTIFACT_VERDICT_INVALID', `Artifact ${filename} needs an explicit declared verdict state.`, EVIDENCE_INDEX_FILENAME);
    }
    const record = records.get(filename);
    if (!record) {
      addError(errors, 'INDEX_ARTIFACT_UNREADABLE', `Indexed artifact ${filename} is missing, empty, or unreadable.`, EVIDENCE_INDEX_FILENAME);
    } else if (entry.sha256 !== record.sha256 || entry.bytes !== record.bytes.length) {
      addError(errors, 'INDEX_ARTIFACT_HASH_MISMATCH', `Artifact ${filename} does not match its recorded bytes or SHA-256.`, EVIDENCE_INDEX_FILENAME);
    }
  }
  for (const filename of expected) {
    if (!seen.has(filename)) {
      addError(errors, 'INDEX_ARTIFACT_MISSING', `Evidence index has no record for ${filename}.`, EVIDENCE_INDEX_FILENAME);
    }
  }
}

function validateHardGates(gatesDocument, identityDigest, identity, errors) {
  const declaredStates = {};
  if (!validateSchema(gatesDocument, 'fable5-hard-gate-verdicts', HARD_GATE_FILENAME, errors)) return declaredStates;
  if (gatesDocument.identitySha256 !== identityDigest) {
    addError(errors, 'GATES_IDENTITY_MISMATCH', 'Hard-gate identitySha256 does not match the raw identity file.', HARD_GATE_FILENAME);
  }
  if (!identity || gatesDocument.sessionId !== identity.sessionId) {
    addError(errors, 'GATES_SESSION_MISMATCH', 'Hard-gate sessionId does not match the identity sessionId.', HARD_GATE_FILENAME);
  }
  if (!Array.isArray(gatesDocument.gates)) {
    addError(errors, 'GATES_REQUIRED', 'Hard-gate document gates must be an array.', HARD_GATE_FILENAME);
    return declaredStates;
  }

  const expected = new Set(HARD_GATE_IDS);
  const seen = new Set();
  for (const gate of gatesDocument.gates) {
    if (!isObject(gate)) {
      addError(errors, 'GATE_INVALID', 'Every hard-gate record must be an object.', HARD_GATE_FILENAME);
      continue;
    }
    if (!expected.has(gate.id)) {
      addError(errors, 'GATE_ID_INVALID', 'Hard-gate id must be HG-01 through HG-10.', HARD_GATE_FILENAME);
      continue;
    }
    if (seen.has(gate.id)) {
      addError(errors, 'GATE_DUPLICATE', `Hard gate ${gate.id} appears more than once.`, HARD_GATE_FILENAME);
      continue;
    }
    seen.add(gate.id);
    if (!DECLARED_VERDICT_STATES.includes(gate.state)) {
      addError(errors, 'GATE_STATE_INVALID', `Hard gate ${gate.id} needs an explicit declared state.`, HARD_GATE_FILENAME);
    } else {
      declaredStates[gate.id] = gate.state;
    }
    if (!isNonEmptyString(gate.reviewer) || !isNonEmptyString(gate.rationale)) {
      addError(errors, 'GATE_REVIEW_INCOMPLETE', `Hard gate ${gate.id} needs reviewer and rationale fields.`, HARD_GATE_FILENAME);
    }
    if (!Array.isArray(gate.evidencePaths) || gate.evidencePaths.length === 0
      || gate.evidencePaths.some((entry) => !INDEXED_ARTIFACT_FILENAMES.includes(entry))) {
      addError(errors, 'GATE_EVIDENCE_INCOMPLETE', `Hard gate ${gate.id} needs one or more indexed evidence paths.`, HARD_GATE_FILENAME);
    }
  }
  for (const id of expected) {
    if (!seen.has(id)) addError(errors, 'GATE_MISSING', `Hard gate ${id} is missing.`, HARD_GATE_FILENAME);
  }
  return declaredStates;
}

function parseApprovalHeaders(record, errors) {
  if (!record) return new Map();
  const headers = new Map();
  for (const line of record.bytes.toString('utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (headers.has(key)) {
      addError(errors, 'OWNER_APPROVAL_HEADER_DUPLICATE', `Owner approval repeats ${match[1]}.`, OWNER_APPROVAL_FILENAME);
      continue;
    }
    headers.set(key, match[2]);
  }
  return headers;
}

function validateOwnerApproval(record, identityDigest, identity, errors) {
  const headers = parseApprovalHeaders(record, errors);
  const identitySha256 = headers.get('identity-sha-256');
  const sessionId = headers.get('session-id');
  const owner = headers.get('owner');
  const decision = headers.get('decision');
  const approvedAt = headers.get('approved-at');

  if (identitySha256 !== identityDigest) {
    addError(errors, 'OWNER_APPROVAL_IDENTITY_MISMATCH', 'Owner approval Identity-SHA-256 does not match the raw identity file.', OWNER_APPROVAL_FILENAME);
  }
  if (!identity || sessionId !== identity.sessionId) {
    addError(errors, 'OWNER_APPROVAL_SESSION_MISMATCH', 'Owner approval Session-ID does not match the identity sessionId.', OWNER_APPROVAL_FILENAME);
  }
  if (!isNonEmptyString(owner)) {
    addError(errors, 'OWNER_APPROVAL_OWNER_REQUIRED', 'Owner approval needs a non-empty Owner header.', OWNER_APPROVAL_FILENAME);
  }
  if (decision !== 'APPROVED') {
    addError(errors, 'OWNER_APPROVAL_DECISION_INVALID', 'Owner approval Decision must be the explicit word APPROVED.', OWNER_APPROVAL_FILENAME);
  }
  if (!isTimestamp(approvedAt)) {
    addError(errors, 'OWNER_APPROVAL_TIME_INVALID', 'Owner approval Approved-At must be an ISO-8601 UTC timestamp.', OWNER_APPROVAL_FILENAME);
  }
}

async function readRequiredFiles(root, errors) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    addError(errors, 'EVIDENCE_DIRECTORY_UNREADABLE', 'Evidence directory is missing or unreadable.');
    return new Map();
  }
  const actualNames = new Set(entries.map((entry) => entry.name));
  const required = new Set(REQUIRED_ARTIFACT_FILENAMES);
  for (const entry of entries) {
    if (!required.has(entry.name)) {
      addError(errors, 'EVIDENCE_FILE_UNEXPECTED', 'Evidence directory contains a file not in the fixed acceptance layout.', entry.name);
    } else if (!entry.isFile() || entry.isSymbolicLink()) {
      addError(errors, 'EVIDENCE_FILE_TYPE_INVALID', 'Required evidence entry must be a regular non-symlink file.', entry.name);
    }
  }

  const records = new Map();
  for (const filename of REQUIRED_ARTIFACT_FILENAMES) {
    if (!actualNames.has(filename)) {
      addError(errors, 'EVIDENCE_FILE_MISSING', 'Required evidence artifact is missing.', filename);
      continue;
    }
    const absolute = path.join(root, filename);
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const bytes = await readFile(absolute);
      if (bytes.length === 0) {
        addError(errors, 'EVIDENCE_FILE_EMPTY', 'Required evidence artifact must not be empty.', filename);
        continue;
      }
      records.set(filename, Object.freeze({ filename, bytes, sha256: sha256(bytes) }));
    } catch {
      addError(errors, 'EVIDENCE_FILE_UNREADABLE', 'Required evidence artifact could not be read.', filename);
    }
  }
  return records;
}

/**
 * Validate an already-captured evidence directory. This function is read-only:
 * it does not create files, invoke a browser, or infer acceptance.
 */
export async function validateFable5AcceptanceEvidence(evidenceDirectory) {
  const errors = [];
  if (!isNonEmptyString(evidenceDirectory)) {
    addError(errors, 'EVIDENCE_DIRECTORY_REQUIRED', 'A non-empty evidence directory path is required.');
    return reportFor({ directory: null, errors, records: new Map(), declaredStates: {} });
  }
  const directory = path.resolve(evidenceDirectory);
  const records = await readRequiredFiles(directory, errors);
  const identityRecord = records.get(IDENTITY_FILENAME);
  const identity = parseJson(identityRecord, errors);
  validateIdentity(identity, errors);
  const identityDigest = identityRecord?.sha256 ?? null;

  const index = parseJson(records.get(EVIDENCE_INDEX_FILENAME), errors);
  validateEvidenceIndex(index, records, identityDigest, identity, errors);

  const gates = parseJson(records.get(HARD_GATE_FILENAME), errors);
  const declaredStates = validateHardGates(gates, identityDigest, identity, errors);

  validateOwnerApproval(records.get(OWNER_APPROVAL_FILENAME), identityDigest, identity, errors);
  return reportFor({ directory, errors, records, identity, identityDigest, declaredStates });
}

function reportFor({ directory, errors, records, identity = null, identityDigest = null, declaredStates }) {
  const orderedStates = Object.fromEntries(HARD_GATE_IDS.flatMap((id) => (
    Object.hasOwn(declaredStates, id) ? [[id, declaredStates[id]]] : []
  )));
  return Object.freeze({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: 'fable5-acceptance-evidence-validation-report',
    directory,
    valid: errors.length === 0,
    acceptance: Object.freeze({
      accepted: false,
      reason: 'This read-only structural validator does not establish browser evidence, hard-gate truth, or final owner acceptance.'
    }),
    identity: identity && identityDigest ? Object.freeze({
      head: identity.head,
      url: identity.url,
      viewport: identity.viewport,
      dpr: identity.dpr,
      capturedAt: identity.capturedAt,
      sessionId: identity.sessionId,
      sha256: identityDigest
    }) : null,
    requiredArtifactCount: REQUIRED_ARTIFACT_FILENAMES.length,
    readableArtifactCount: records.size,
    declaredHardGateStates: Object.freeze(orderedStates),
    errors: Object.freeze([...errors])
  });
}

function usage() {
  return 'Usage: node tools/qa/fable5-acceptance-evidence.mjs --dir <acceptance-evidence-directory>\n';
}

export async function main(argv = process.argv.slice(2), io = process) {
  if (argv.length === 1 && argv[0] === '--help') {
    io.stdout.write(usage());
    return 0;
  }
  if (argv.length !== 2 || argv[0] !== '--dir' || !isNonEmptyString(argv[1])) {
    io.stderr.write(usage());
    return 2;
  }
  const report = await validateFable5AcceptanceEvidence(argv[1]);
  io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.valid ? 0 : 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      kind: 'fable5-acceptance-evidence-validation-report',
      valid: false,
      acceptance: { accepted: false },
      errors: [{ code: 'UNEXPECTED_VALIDATOR_FAILURE', message: String(error?.message ?? error) }]
    })}\n`);
    process.exitCode = 1;
  });
}
