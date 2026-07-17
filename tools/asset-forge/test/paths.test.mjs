import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { atomicReplaceJson, atomicWriteFile, readJson } from '../src/fs-safe.mjs';
import {
  assertExistingFileWithin, assertExistingPendingCandidate, assertExistingStateFile,
  resolveWithin, validateAssetId
} from '../src/paths.mjs';

test('asset ids and contained relative paths reject traversal and absolute paths', () => {
  assert.equal(validateAssetId('character.player'), 'character.player');
  assert.throws(() => validateAssetId('../player'));
  assert.throws(() => resolveWithin('/tmp/root', '../escape'));
  assert.throws(() => resolveWithin('/tmp/root', '/absolute'));
  assert.throws(() => resolveWithin('/tmp/root', 'a\\b'));
  assert.throws(() => resolveWithin('/tmp/root', 'a//b'));
  assert.throws(() => resolveWithin('/tmp/root', 'a\0b'));
});

test('existing inputs reject symlink escape', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-path-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'forge-outside-'));
  await writeFile(path.join(outside, 'secret.png'), 'not-an-image');
  await symlink(outside, path.join(root, 'link'));
  await assert.rejects(() => assertExistingFileWithin(root, 'link/secret.png'), /Symbolic links/);
});

test('state helpers bind a direct PNG to its declared category and lifecycle state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-state-path-'));
  const pending = path.join(root, 'generated', 'fields', 'pending', 'candidate.png');
  await mkdir(path.dirname(pending), { recursive: true });
  await writeFile(pending, 'fixture');
  const actualPending = await realpath(pending);
  assert.equal(await assertExistingStateFile(root, 'field', 'pending', 'generated/fields/pending/candidate.png'), actualPending);
  assert.equal(await assertExistingPendingCandidate(root, 'field', 'generated/fields/pending/candidate.png'), actualPending);
  await assert.rejects(
    () => assertExistingStateFile(root, 'field', 'pending', 'generated/fields/pending/../approved/candidate.png'),
    /direct PNG/
  );
  await assert.rejects(
    () => assertExistingPendingCandidate(root, 'building', 'generated/fields/pending/candidate.png'),
    /does not match/
  );
});

test('output writers reject a symlinked parent and do not touch the outside directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-output-link-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'forge-output-outside-'));
  await symlink(outside, path.join(root, 'pending'));
  await assert.rejects(
    () => atomicWriteFile(root, path.join(root, 'pending', 'candidate.bin'), Buffer.from('bad')),
    /Symbolic links/
  );
  await assert.rejects(() => readFile(path.join(outside, 'candidate.bin')), /ENOENT/);
  await assert.rejects(
    () => atomicWriteFile(root, path.join(root, 'pending', 'nested', 'candidate.bin'), Buffer.from('bad')),
    /Symbolic links/
  );
  await assert.rejects(() => access(path.join(outside, 'nested')), /ENOENT/);
});

test('atomic writes are contained and never overwrite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-write-'));
  await mkdir(path.join(root, 'pending'));
  const target = path.join(root, 'pending', 'candidate.bin');
  await atomicWriteFile(root, target, Buffer.from('first'));
  await assert.rejects(() => atomicWriteFile(root, target, Buffer.from('second')), /overwrite/);
  await assert.rejects(() => atomicWriteFile(root, path.join(root, '..', 'escape'), Buffer.from('bad')), /escapes/);
});

test('concurrent no-overwrite writers have exactly one commit winner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-write-race-'));
  const target = path.join(root, 'pending', 'candidate.bin');
  const settled = await Promise.allSettled([
    atomicWriteFile(root, target, Buffer.from('alpha')),
    atomicWriteFile(root, target, Buffer.from('beta'))
  ]);
  assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((result) => result.status === 'rejected').length, 1);
  assert.ok(['alpha', 'beta'].includes(await readFile(target, 'utf8')));
});

test('locked replace is canonical and malformed JSON is reported explicitly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-json-'));
  const target = path.join(root, 'state.json');
  await atomicReplaceJson(root, target, { z: 1, a: 2 });
  assert.equal(await readFile(target, 'utf8'), '{\n  "a": 2,\n  "z": 1\n}\n');
  await writeFile(target, '{bad json');
  await assert.rejects(() => readJson(target), /Malformed JSON/);
});
