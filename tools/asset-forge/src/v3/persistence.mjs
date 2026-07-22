import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { FORGE_ROOT } from '../config.mjs';
import { atomicReplaceJson, withFileLock } from '../fs-safe.mjs';
import { canonicalJson, sha256 } from '../hashing.mjs';
import { assertExistingFileWithin } from '../paths.mjs';
import { assertBundleLedger } from './bundle-ledger.mjs';

const LEDGER_RELATIVE = 'data/v3/bundle-approvals.json';
const LOCK_RELATIVE = 'data/v3/.bundle-approvals.lock';
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const ACTIVE_CANONICAL_SNAPSHOTS = new WeakMap();

export function bundleLedgerPaths(root = FORGE_ROOT) {
  const resolved = path.resolve(root);
  return Object.freeze({
    ledger: path.join(resolved, ...LEDGER_RELATIVE.split('/')),
    lock: path.join(resolved, ...LOCK_RELATIVE.split('/'))
  });
}

async function readStableLedgerBytes(root) {
  const source = await assertExistingFileWithin(root, LEDGER_RELATIVE);
  const before = await lstat(source, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_LEDGER_BYTES)) {
    throw new Error('V3 bundle ledger is empty or exceeds 8 MiB');
  }
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeNs !== before.mtimeNs || opened.ctimeNs !== before.ctimeNs) {
      throw new Error('V3 bundle ledger changed while opening');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
      || BigInt(bytes.length) !== opened.size) {
      throw new Error('V3 bundle ledger changed while reading');
    }
    return {
      bytes,
      identity: {
        dev: opened.dev.toString(),
        ino: opened.ino.toString(),
        size: opened.size.toString(),
        mtimeNs: opened.mtimeNs.toString(),
        ctimeNs: opened.ctimeNs.toString()
      }
    };
  } finally {
    await handle.close();
  }
}

async function readBundleLedgerState(root) {
  const { bytes, identity } = await readStableLedgerBytes(root);
  let ledger;
  try {
    ledger = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('Malformed v3 bundle ledger JSON', { cause: error });
  }
  assertBundleLedger(ledger);
  if (!bytes.equals(Buffer.from(canonicalJson(ledger)))) {
    throw new Error('V3 bundle ledger must use exact canonical JSON encoding');
  }
  return { ledger, identity };
}

async function readBundleLedgerUnlocked(root) {
  return (await readBundleLedgerState(root)).ledger;
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function bundleLedgerDigest(ledger) {
  assertBundleLedger(ledger);
  return sha256(canonicalJson(ledger));
}

export async function readBundleLedger({ root = FORGE_ROOT } = {}) {
  return readBundleLedgerUnlocked(path.resolve(root));
}

function assertAppendOnly(previous, next) {
  if (previous.schemaVersion !== next.schemaVersion || previous.requiredSetId !== next.requiredSetId) {
    throw new Error('V3 bundle ledger identity is immutable');
  }
  if (next.approvals.length < previous.approvals.length
    || next.supersessions.length < previous.supersessions.length
    || next.waveApprovals.length < previous.waveApprovals.length) {
    throw new Error('V3 bundle ledger transaction cannot delete history');
  }
  if (!isDeepStrictEqual(next.approvals.slice(0, previous.approvals.length), previous.approvals)
    || !isDeepStrictEqual(next.supersessions.slice(0, previous.supersessions.length), previous.supersessions)
    || !isDeepStrictEqual(next.waveApprovals.slice(0, previous.waveApprovals.length), previous.waveApprovals)) {
    throw new Error('V3 bundle ledger transaction cannot rewrite or reorder history');
  }
}

export async function withBundleLedgerSnapshot(operation, { root = FORGE_ROOT } = {}) {
  const actualRoot = path.resolve(root);
  const { lock } = bundleLedgerPaths(actualRoot);
  return withFileLock(actualRoot, lock, async () => {
    const ledger = await readBundleLedgerUnlocked(actualRoot);
    const snapshot = structuredClone(ledger);
    const digest = bundleLedgerDigest(snapshot);
    ACTIVE_CANONICAL_SNAPSHOTS.set(snapshot, digest);
    try {
      return await operation(snapshot, digest);
    } finally {
      ACTIVE_CANONICAL_SNAPSHOTS.delete(snapshot);
    }
  });
}

export function assertActiveCanonicalBundleLedgerSnapshot(ledger, expectedDigest) {
  const activeDigest = ACTIVE_CANONICAL_SNAPSHOTS.get(ledger);
  if (!activeDigest || activeDigest !== expectedDigest || bundleLedgerDigest(ledger) !== expectedDigest) {
    throw new Error('V3 export write requires an active canonical persisted ledger snapshot');
  }
}

export async function transactBundleLedger(operation, {
  root = FORGE_ROOT,
  expectedLedgerDigest,
  hooks = {}
} = {}) {
  const actualRoot = path.resolve(root);
  const { ledger: ledgerPath, lock } = bundleLedgerPaths(actualRoot);
  return withFileLock(actualRoot, lock, async () => {
    const previousState = await readBundleLedgerState(actualRoot);
    const previous = previousState.ledger;
    const previousDigest = bundleLedgerDigest(previous);
    if (expectedLedgerDigest && expectedLedgerDigest !== previousDigest) {
      throw new Error('V3 bundle ledger changed after preview');
    }
    const operationResult = await operation(structuredClone(previous));
    const next = operationResult?.ledger ?? operationResult;
    assertBundleLedger(next);
    assertAppendOnly(previous, next);
    if (isDeepStrictEqual(previous, next)) throw new Error('V3 bundle ledger transaction made no append');
    const nextDigest = bundleLedgerDigest(next);
    if (hooks.beforeWrite) await hooks.beforeWrite(structuredClone(next));
    const liveState = await readBundleLedgerState(actualRoot);
    if (bundleLedgerDigest(liveState.ledger) !== previousDigest
      || !isDeepStrictEqual(liveState.identity, previousState.identity)) {
      throw new Error('V3 bundle ledger changed immediately before atomic commit');
    }
    await atomicReplaceJson(actualRoot, ledgerPath, next);
    await syncDirectory(path.dirname(ledgerPath));
    if (hooks.afterWrite) await hooks.afterWrite(structuredClone(next));
    const persisted = await readBundleLedgerUnlocked(actualRoot);
    if (!isDeepStrictEqual(persisted, next) || bundleLedgerDigest(persisted) !== nextDigest) {
      throw new Error('Persisted v3 bundle ledger does not match the atomic transaction');
    }
    return {
      ledger: persisted,
      ledgerDigestBefore: previousDigest,
      ledgerDigest: nextDigest,
      value: operationResult?.ledger ? operationResult.value : undefined
    };
  });
}
