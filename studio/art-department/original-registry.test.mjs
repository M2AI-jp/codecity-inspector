import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ORIGINAL_REGISTRY,
  OriginalCustodyError,
  assertFactoryWritePath,
  assertOriginalRegistry,
  findOriginal,
  getOriginalRegistry,
  verifyOriginalRegistry,
  writeCandidate,
  writeReport
} from './index.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('MASTER registry contains 22 immutable originals and current bytes pass the custody gate', () => {
  assert.equal(ORIGINAL_REGISTRY.count, 22);
  assert.equal(ORIGINAL_REGISTRY.originals.length, 22);
  assert.equal(Object.isFrozen(ORIGINAL_REGISTRY), true);
  assert.equal(Object.isFrozen(ORIGINAL_REGISTRY.originals), true);
  assert.equal(getOriginalRegistry(), ORIGINAL_REGISTRY);
  const report = assertOriginalRegistry({ repositoryRoot });
  assert.equal(report.ok, true);
  assert.equal(report.checked, 22);
  assert.deepEqual(report.failures, []);
  assert.equal(findOriginal('character_style_authority_20260722_v1.png').sha256, '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932');
  assert.equal(findOriginal('original-22').file, 'ui_inspection_report_sheet.png');
});

test('registry gate reports a tampered copy without touching the originals', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-art-department-'));
  const tempDirectory = path.join(tempRoot, 'art/references/user-provided');
  fs.mkdirSync(tempDirectory, { recursive: true });
  const sourceDirectory = path.join(repositoryRoot, 'art/references/user-provided');
  for (const entry of ORIGINAL_REGISTRY.originals) {
    fs.copyFileSync(path.join(sourceDirectory, entry.file), path.join(tempDirectory, entry.file));
  }
  const tampered = path.join(tempDirectory, ORIGINAL_REGISTRY.originals[0].file);
  fs.appendFileSync(tampered, Buffer.from([0]));
  const report = verifyOriginalRegistry({ repositoryRoot: tempRoot });
  assert.equal(report.ok, false);
  assert.equal(report.checked, 22);
  assert.ok(report.failures.some(({ code }) => code === 'SHA256_MISMATCH'));
  assert.throws(() => assertOriginalRegistry({ repositoryRoot: tempRoot }), OriginalCustodyError);
});

test('unexpected originals and missing originals are hard custody failures', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-art-department-set-'));
  const tempDirectory = path.join(tempRoot, 'art/references/user-provided');
  fs.mkdirSync(tempDirectory, { recursive: true });
  const sourceDirectory = path.join(repositoryRoot, 'art/references/user-provided');
  const first = ORIGINAL_REGISTRY.originals[0];
  fs.copyFileSync(path.join(sourceDirectory, first.file), path.join(tempDirectory, first.file));
  fs.copyFileSync(path.join(sourceDirectory, first.file), path.join(tempDirectory, 'unlisted.png'));
  const report = verifyOriginalRegistry({ repositoryRoot: tempRoot });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some(({ code }) => code === 'UNEXPECTED_ORIGINAL'));
  assert.ok(report.failures.some(({ code }) => code === 'ORIGINAL_MISSING'));
});

test('factory writes are limited to candidates and reports; no promotion surface exists', async () => {
  const factoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-art-department-write-'));
  const candidate = writeCandidate(factoryRoot, 'candidates/char_innkeeper/candidate.json', '{"state":"candidate"}');
  const report = writeReport(factoryRoot, 'reports/lineage.json', '{"state":"observed"}');
  assert.equal(fs.readFileSync(candidate.path, 'utf8'), '{"state":"candidate"}');
  assert.equal(fs.readFileSync(report.path, 'utf8'), '{"state":"observed"}');
  assert.equal(assertFactoryWritePath(factoryRoot, 'candidates/x.png', 'candidate'), path.join(factoryRoot, 'candidates/x.png'));
  assert.equal(assertFactoryWritePath(factoryRoot, 'reports/x.json', 'report'), path.join(factoryRoot, 'reports/x.json'));
  for (const [relativePath, kind] of [
    ['masters/char.png', 'candidate'],
    ['ship/50-art/char.png', 'report'],
    ['candidates/../masters/char.png', 'candidate'],
    ['reports/../ship/char.json', 'report']
  ]) {
    assert.throws(() => assertFactoryWritePath(factoryRoot, relativePath, kind), TypeError);
  }
  assert.equal('promoteAsset' in await import('./index.mjs'), false);
});

test('factory root and write path cannot traverse symlinks', (context) => {
  const actualRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-art-department-real-'));
  const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-art-department-link-'));
  const linkedRoot = path.join(linkParent, 'factory');
  try {
    fs.symlinkSync(actualRoot, linkedRoot, 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      context.skip('symlink creation is not permitted on this platform');
      return;
    }
    throw error;
  }
  assert.throws(
    () => writeCandidate(linkedRoot, 'candidates/escape.json', '{}'),
    /factory root must not be a symlink/
  );
  assert.equal(fs.existsSync(path.join(actualRoot, 'candidates/escape.json')), false);
});
