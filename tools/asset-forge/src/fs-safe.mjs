import { link, lstat, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { uptime } from 'node:os';
import { randomBytes } from 'node:crypto';
import { canonicalJson } from './hashing.mjs';
import { assertNoSymlinkPath, containedBy } from './paths.mjs';

export async function readJson(filePath, { allowMissing = false, fallback } = {}) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return structuredClone(fallback);
    if (error instanceof SyntaxError) throw new Error(`Malformed JSON: ${filePath}`, { cause: error });
    throw error;
  }
}

async function ensureDirectoryPath(root, directory) {
  const absoluteRoot = path.resolve(root);
  const absoluteDirectory = path.resolve(directory);
  if (!containedBy(absoluteRoot, absoluteDirectory)) throw new Error('Write escapes allowed root');
  const rootStat = await lstat(absoluteRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Allowed root must be a real directory');
  let current = absoluteRoot;
  for (const segment of path.relative(absoluteRoot, absoluteDirectory).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
      if (!stat.isDirectory()) throw new Error('Expected a directory in output path');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) throw new Error('Unsafe directory appeared during creation');
    }
  }
}

async function prepareDestination(root, destination) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(destination);
  if (!containedBy(absoluteRoot, target)) throw new Error('Write escapes allowed root');
  await ensureDirectoryPath(absoluteRoot, path.dirname(target));
  await assertNoSymlinkPath(absoluteRoot, path.dirname(target));
  return { absoluteRoot, target };
}

async function writeSyncedTemp(target, data) {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try { await lstat(target); throw new Error('Refusing to overwrite an existing file'); }
  catch (error) {
    if (error?.code !== 'ENOENT') {
      await handle.close().catch(() => {});
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }
  try {
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return temp;
}

export async function atomicWriteFile(root, destination, data) {
  const { target } = await prepareDestination(root, destination);
  const temp = await writeSyncedTemp(target, data);
  try {
    // link() is the no-replace commit point: unlike rename(), it cannot silently
    // replace a destination created by a concurrent writer.
    await link(temp, target);
    await unlink(temp);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    if (error?.code === 'EEXIST') throw new Error('Refusing to overwrite an existing file', { cause: error });
    throw error;
  }
  return target;
}

export const atomicWriteJson = (root, destination, value) => atomicWriteFile(root, destination, canonicalJson(value));

export async function atomicReplaceFile(root, destination, data) {
  const { target } = await prepareDestination(root, destination);
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Refusing to replace an unsafe destination');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(12).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return target;
}

export const atomicReplaceJson = (root, destination, value) => atomicReplaceFile(root, destination, canonicalJson(value));

async function isStaleLock(target) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Concurrent writer lock path is unsafe');
  // Some managed/sandboxed hosts deny the native uptime syscall. Uptime is
  // only an extra stale-lock signal; failure must not make a lock look stale
  // or prevent all writers from performing the stronger owner/PID checks.
  let bootedAt = null;
  try {
    const seconds = uptime();
    if (Number.isFinite(seconds) && seconds >= 0) bootedAt = Date.now() - seconds * 1000;
  } catch {
    // Fail closed: do not reclaim a lock merely because boot time is unknown.
  }
  let owner;
  try {
    owner = await readJson(path.join(target, 'owner.json'));
  } catch (error) {
    if (error?.code === 'ENOENT'
      && ((bootedAt !== null && stat.mtimeMs < bootedAt) || Date.now() - stat.mtimeMs > 30_000)) return true;
    if ((error instanceof Error && error.message.startsWith('Malformed JSON:')) && Date.now() - stat.mtimeMs > 30_000) return true;
    return false;
  }
  if (!owner || !Number.isInteger(owner.pid) || owner.pid < 1 || typeof owner.acquiredAt !== 'string') return false;
  const acquiredAt = Date.parse(owner.acquiredAt);
  if (Number.isNaN(acquiredAt)) return false;
  if (bootedAt !== null && acquiredAt < bootedAt) return true;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

async function acquireLock(root, target) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(target);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (!await isStaleLock(target)) throw new Error(`Concurrent writer lock is held: ${target}`, { cause: error });
      const quarantine = path.join(path.dirname(target), `.${path.basename(target)}.stale.${randomBytes(12).toString('hex')}`);
      try {
        await rename(target, quarantine);
      } catch (renameError) {
        if (renameError?.code === 'ENOENT') continue;
        throw renameError;
      }
      await rm(quarantine, { recursive: true, force: true });
    }
  }
  throw new Error(`Concurrent writer lock could not be acquired: ${target}`);
}

export async function withFileLock(root, lockPath, operation) {
  const { target } = await prepareDestination(root, lockPath);
  await acquireLock(root, target);
  try {
    await atomicWriteJson(root, path.join(target, 'owner.json'), {
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    });
    return await operation();
  } finally {
    await rm(target, { recursive: true, force: true });
  }
}
