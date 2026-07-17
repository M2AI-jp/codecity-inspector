import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertSafeOutputPath, writeOutputAtomic } from '../src/generate-town.mjs';

test('town output accepts an ordinary path outside the inspected repository', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codecity-output-'));
  const repo = path.join(workspace, 'repo');
  const output = path.join(workspace, 'reports', 'town.layout.json');
  await mkdir(repo);
  await mkdir(path.dirname(output));
  assert.equal(await assertSafeOutputPath(repo, output), path.join(await realpath(path.dirname(output)), path.basename(output)));
});

test('town output refuses lexical paths inside the inspected repository', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'codecity-output-repo-'));
  const output = path.join(repo, 'reports', 'town.layout.json');
  await assert.rejects(assertSafeOutputPath(repo, output), /inside the inspected repository/);
  await assert.rejects(lstat(path.join(repo, 'reports')), /ENOENT/);
});

test('town output refuses a symlinked parent that redirects back into the inspected repository', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codecity-output-link-'));
  const repo = path.join(workspace, 'repo');
  const apparentOutside = path.join(workspace, 'outside-link');
  await mkdir(repo);
  await symlink(repo, apparentOutside);
  await assert.rejects(
    assertSafeOutputPath(repo, path.join(apparentOutside, 'town.layout.json')),
    /inside the inspected repository/
  );
});

test('town output refuses an existing symbolic-link destination', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codecity-output-target-'));
  const repo = path.join(workspace, 'repo');
  const realOutput = path.join(workspace, 'real.json');
  const linkedOutput = path.join(workspace, 'linked.json');
  await mkdir(repo);
  await writeFile(realOutput, '{}\n');
  await symlink(realOutput, linkedOutput);
  await assert.rejects(assertSafeOutputPath(repo, linkedOutput), /must not be a symbolic link/);
});

test('atomic town output replaces an external hard-link entry without modifying the inspected repository inode', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codecity-output-hardlink-'));
  const repo = path.join(workspace, 'repo');
  const protectedFile = path.join(repo, 'protected.txt');
  const outsideOutput = path.join(workspace, 'town.layout.json');
  await mkdir(repo);
  await writeFile(protectedFile, 'PROTECTED\n');
  await link(protectedFile, outsideOutput);

  const safeOutput = await assertSafeOutputPath(repo, outsideOutput);
  writeOutputAtomic(safeOutput, '{"town":true}\n');

  assert.equal(await readFile(protectedFile, 'utf8'), 'PROTECTED\n');
  assert.equal(await readFile(outsideOutput, 'utf8'), '{"town":true}\n');
});
