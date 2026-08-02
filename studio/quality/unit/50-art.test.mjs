import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AssetContractError,
  isValidatedAssetManifest,
  resolveAsset,
  readPngMetadata,
  validateAssetManifest
} from '../../../ship/50-art/index.mjs';

// A tiny valid RGBA PNG used only in a temporary contract-test directory. Originals in
// art/references/user-provided remain untouched.
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function tempAssetRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-'));
  fs.writeFileSync(path.join(root, 'innkeeper.png'), ONE_BY_ONE_PNG);
  return root;
}

function goldenManifest(root) {
  const sha256 = crypto.createHash('sha256').update(ONE_BY_ONE_PNG).digest('hex');
  return {
    format: 'codecity.asset-manifest',
    schemaVersion: 1,
    manifestVersion: '1.0.0',
    fallbackPolicy: 'none',
    assets: [{
      id: 'char_innkeeper_idle_v1',
      version: '1.0.0',
      status: 'accepted',
      accepted: true,
      path: 'innkeeper.png',
      url: '/assets/innkeeper.png',
      sha256,
      dimensions: { width: 1, height: 1 },
      pivot: { x: 0, y: 0 },
      usage: {
        kind: 'character',
        layer: 'actor',
        frame: { width: 1, height: 1, columns: 1, rows: 1 },
        collision: { kind: 'none' },
        animations: { idle: { south: { frames: [0], fps: 1 } } }
      },
      license: { spdx: 'CC0-1.0', holder: 'CodeCity owner' },
      provenance: {
        kind: 'derived',
        source: 'art/references/user-provided/character_style_authority_20260722_v1.png',
        sourceSha256: '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932',
        custody: 'user-direct',
        evidence: 'observed'
      },
      approval: {
        recordId: 'approval-innkeeper-v1',
        actorType: 'human',
        authority: 'owner',
        approvedBy: 'human-owner',
        approvedAt: '2026-08-02T00:00:00.000Z',
        decision: 'accepted',
        assetId: 'char_innkeeper_idle_v1',
        assetSha256: sha256,
        sourceSha256: '446080b87192f13acd67f7410cfbfeb152830d93571edd5a9198406cef0b6932'
      }
    }]
  };
}

test('golden versioned manifest validates and resolves an exact PNG binding', () => {
  const root = tempAssetRoot();
  const manifest = validateAssetManifest(goldenManifest(root), { assetRoot: root });
  assert.equal(manifest.manifestVersion, '1.0.0');
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.assets[0]), true);
  assert.deepEqual(readPngMetadata(root, 'innkeeper.png'), {
    width: 1,
    height: 1,
    byteLength: ONE_BY_ONE_PNG.length
  });
  const binding = resolveAsset(manifest, 'char_innkeeper_idle_v1', { assetRoot: root });
  assert.equal(binding.path, 'innkeeper.png');
  assert.equal(binding.url, '/assets/innkeeper.png');
  assert.equal(binding.sha256.length, 64);
  assert.equal(Object.prototype.hasOwnProperty.call(binding, 'absolutePath'), false);
  assert.equal(binding.usage.kind, 'character');
  assert.deepEqual(binding.usage.animations.idle.south.frames, [0]);
});

test('missing acceptance evidence is a hard error', () => {
  const root = tempAssetRoot();
  const manifest = goldenManifest(root);
  delete manifest.assets[0].approval;
  assert.throws(
    () => validateAssetManifest(manifest, { verifyFiles: false }),
    (error) => error instanceof AssetContractError &&
      error.issues.some(({ code }) => code === 'MISSING_APPROVAL')
  );
});

test('source bytes and local delivery are mandatory provenance boundaries', () => {
  const root = tempAssetRoot();
  const missingSourceHash = goldenManifest(root);
  delete missingSourceHash.assets[0].provenance.sourceSha256;
  assert.throws(
    () => validateAssetManifest(missingSourceHash, { verifyFiles: false }),
    (error) => error instanceof AssetContractError &&
      error.issues.some(({ path: field, code }) => field.endsWith('.sourceSha256') && code === 'INVALID_HASH')
  );

  for (const remoteUrl of ['https://example.test/innkeeper.png', '//example.test/innkeeper.png']) {
    const remote = goldenManifest(root);
    remote.assets[0].url = remoteUrl;
    assert.throws(
      () => validateAssetManifest(remote, { verifyFiles: false }),
      (error) => error instanceof AssetContractError &&
        error.issues.some(({ code }) => code === 'REMOTE_URL_FORBIDDEN')
    );
  }
});

test('fallback fields are rejected instead of silently selected', () => {
  const root = tempAssetRoot();
  const manifest = goldenManifest(root);
  manifest.assets[0].fallback = 'other-asset';
  assert.throws(
    () => validateAssetManifest(manifest, { verifyFiles: false }),
    (error) => error instanceof AssetContractError &&
      error.issues.some(({ code }) => code === 'FALLBACK_FORBIDDEN')
  );
  const valid = validateAssetManifest(goldenManifest(root), { verifyFiles: false });
  assert.throws(
    () => resolveAsset(valid, 'missing', { fallbackAssetId: 'char_innkeeper_idle_v1' }),
    (error) => error instanceof AssetContractError && error.code === 'FALLBACK_FORBIDDEN'
  );
  assert.throws(
    () => resolveAsset(valid, 'missing'),
    (error) => error instanceof AssetContractError && error.code === 'ASSET_NOT_FOUND'
  );
});

test('hash, dimensions, path, and PNG signature mismatches fail closed', () => {
  const root = tempAssetRoot();
  const manifest = goldenManifest(root);
  manifest.assets[0].sha256 = '0'.repeat(64);
  manifest.assets[0].approval.assetSha256 = manifest.assets[0].sha256;
  assert.throws(
    () => validateAssetManifest(manifest, { assetRoot: root }),
    (error) => error instanceof AssetContractError && error.code === 'ASSET_FILE_MISMATCH'
  );

  const dimensionsManifest = goldenManifest(root);
  dimensionsManifest.assets[0].dimensions.width = 2;
  dimensionsManifest.assets[0].usage.frame.width = 2;
  assert.throws(
    () => validateAssetManifest(dimensionsManifest, { assetRoot: root }),
    (error) => error instanceof AssetContractError && error.code === 'ASSET_FILE_MISMATCH'
  );

  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-bad-'));
  fs.writeFileSync(path.join(badRoot, 'innkeeper.png'), Buffer.from('not-png'));
  const badManifest = goldenManifest(badRoot);
  assert.throws(
    () => validateAssetManifest(badManifest, { assetRoot: badRoot }),
    (error) => error instanceof AssetContractError && error.code === 'PNG_SIGNATURE_INVALID'
  );

  const traversal = goldenManifest(root);
  traversal.assets[0].path = '../innkeeper.png';
  assert.throws(
    () => validateAssetManifest(traversal, { verifyFiles: false }),
    (error) => error instanceof AssetContractError &&
      error.issues.some(({ code }) => code === 'UNSAFE_PATH')
  );
});

test('runtime usage rejects non-tiling sheets, invalid collision rectangles, and bad animation frames', () => {
  const root = tempAssetRoot();
  const sheet = goldenManifest(root);
  sheet.assets[0].usage.frame.columns = 2;
  assert.throws(
    () => validateAssetManifest(sheet, { verifyFiles: false }),
    (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'FRAME_TILING_MISMATCH')
  );

  const collision = goldenManifest(root);
  collision.assets[0].usage.collision = { kind: 'rect', x: 1, y: 0, width: 1, height: 1 };
  assert.throws(
    () => validateAssetManifest(collision, { verifyFiles: false }),
    (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'RECT_OUT_OF_BOUNDS')
  );

  const animation = goldenManifest(root);
  animation.assets[0].usage.animations.idle.south.frames = [1];
  assert.throws(
    () => validateAssetManifest(animation, { verifyFiles: false }),
    (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'ANIMATION_FRAME_OUT_OF_RANGE')
  );
});

test('building usage requires a bounded entrance rectangle', () => {
  const root = tempAssetRoot();
  const manifest = goldenManifest(root);
  const usage = manifest.assets[0].usage;
  usage.kind = 'building';
  usage.layer = 'object';
  delete usage.animations;
  assert.throws(
    () => validateAssetManifest(manifest, { verifyFiles: false }),
    (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'MISSING_ENTRANCE')
  );

  usage.entrance = { x: 1, y: 0, width: 1, height: 1 };
  assert.throws(
    () => validateAssetManifest(manifest, { verifyFiles: false }),
    (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'RECT_OUT_OF_BOUNDS')
  );
});

test('approved assets cannot resolve through symlinks', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-link-'));
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-target-'));
  const target = path.join(targetRoot, 'innkeeper.png');
  fs.writeFileSync(target, ONE_BY_ONE_PNG);
  try {
    fs.symlinkSync(target, path.join(root, 'innkeeper.png'));
  } catch (error) {
    if (error.code === 'EPERM') {
      context.skip('symlink creation is not permitted on this platform');
      return;
    }
    throw error;
  }
  assert.throws(
    () => validateAssetManifest(goldenManifest(root), { assetRoot: root }),
    (error) => error instanceof AssetContractError &&
      error.issues.some(({ code }) => code === 'ASSET_SYMLINK_FORBIDDEN')
  );
});

test('validated state cannot be copied onto a forged manifest', () => {
  const root = tempAssetRoot();
  const validated = validateAssetManifest(goldenManifest(root), { verifyFiles: false });
  assert.equal(isValidatedAssetManifest(validated), true);
  assert.deepEqual(Object.getOwnPropertySymbols(validated), []);
  const forged = structuredClone(validated);
  forged.assets[0].path = '../../etc/passwd.png';
  forged.assets[0].url = '\thttps://evil.test/asset.png';
  assert.equal(isValidatedAssetManifest(forged), false);
  assert.throws(() => resolveAsset(forged, forged.assets[0].id), (error) => error instanceof AssetContractError && error.code === 'ASSET_MANIFEST_INVALID');
});

test('asset URLs are canonical and bound to the verified source path', () => {
  const root = tempAssetRoot();
  for (const url of ['\thttps://evil.test/a.png', '/assets/../../secret.png', '/%2e%2e/secret.png', '/assets/other.png', '/api/render']) {
    const manifest = goldenManifest(root);
    manifest.assets[0].url = url;
    assert.throws(() => validateAssetManifest(manifest, { verifyFiles: false }), (error) => error instanceof AssetContractError && error.issues.some(({ code }) => ['REMOTE_URL_FORBIDDEN', 'URL_PATH_MISMATCH'].includes(code)), url);
  }
});

test('approval record is bound to exact accepted and source bytes', () => {
  const root = tempAssetRoot();
  const staleAsset = goldenManifest(root);
  staleAsset.assets[0].approval.assetSha256 = '0'.repeat(64);
  assert.throws(() => validateAssetManifest(staleAsset, { verifyFiles: false }), (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'APPROVAL_BINDING_MISMATCH'));
  const staleSource = goldenManifest(root);
  staleSource.assets[0].approval.sourceSha256 = '0'.repeat(64);
  assert.throws(() => validateAssetManifest(staleSource, { verifyFiles: false }), (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'APPROVAL_BINDING_MISMATCH'));
});

test('non-plain and unknown typed inputs fail as contract errors before cloning', () => {
  const root = tempAssetRoot();
  const source = goldenManifest(root);
  const inherited = Object.assign(Object.create(source), { assets: source.assets });
  assert.throws(() => validateAssetManifest(inherited, { verifyFiles: false }), (error) => error instanceof AssetContractError);
  const typed = goldenManifest(root);
  typed.debug = new Uint8Array([1]);
  assert.throws(() => validateAssetManifest(typed, { verifyFiles: false }), (error) => error instanceof AssetContractError);

  const proxied = new Proxy(goldenManifest(root), {});
  assert.throws(() => validateAssetManifest(proxied, { verifyFiles: false }), (error) => error instanceof AssetContractError);
});

test('rooted helpers and resolved bindings never expose a later-openable path', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-parent-link-'));
  const outside = tempAssetRoot();
  try {
    fs.symlinkSync(outside, path.join(root, 'linked'));
  } catch (error) {
    if (error.code === 'EPERM') {
      context.skip('symlink creation is not permitted on this platform');
      return;
    }
    throw error;
  }
  assert.throws(
    () => readPngMetadata(root, 'linked/innkeeper.png'),
    (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'ASSET_SYMLINK_FORBIDDEN')
  );
});

test('animation and nesting budgets reject direct-object resource attacks', () => {
  const root = tempAssetRoot();
  const frames = goldenManifest(root);
  frames.assets[0].usage.animations.idle.south.frames = Array.from({ length: 65 }, () => 0);
  assert.throws(
    () => validateAssetManifest(frames, { verifyFiles: false }),
    (error) => error instanceof AssetContractError && error.issues.some(({ code }) => code === 'ANIMATIONS_TOO_LARGE')
  );

  const deep = goldenManifest(root);
  let current = deep.assets[0].license;
  for (let index = 0; index < 24; index += 1) current.extra = current = {};
  assert.throws(
    () => validateAssetManifest(deep, { verifyFiles: false }),
    (error) => error instanceof AssetContractError && error.code === 'MANIFEST_TOO_COMPLEX'
  );
});

test('CRC-valid but undecodable empty image data is rejected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-empty-data-'));
  const emptyIdat = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000004944415435af061e0000000049454e44ae426082', 'hex');
  fs.writeFileSync(path.join(root, 'innkeeper.png'), emptyIdat);
  const manifest = goldenManifest(root);
  manifest.assets[0].sha256 = crypto.createHash('sha256').update(emptyIdat).digest('hex');
  manifest.assets[0].approval.assetSha256 = manifest.assets[0].sha256;
  assert.throws(
    () => validateAssetManifest(manifest, { assetRoot: root }),
    (error) => error instanceof AssetContractError && error.code === 'PNG_DATA_INVALID'
  );
});

test('PNG trailing data and oversized files fail before acceptance', () => {
  const trailingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-trailing-'));
  const trailing = Buffer.concat([ONE_BY_ONE_PNG, Buffer.from([0])]);
  fs.writeFileSync(path.join(trailingRoot, 'innkeeper.png'), trailing);
  const trailingManifest = goldenManifest(trailingRoot);
  trailingManifest.assets[0].sha256 = crypto.createHash('sha256').update(trailing).digest('hex');
  trailingManifest.assets[0].approval.assetSha256 = trailingManifest.assets[0].sha256;
  assert.throws(() => validateAssetManifest(trailingManifest, { assetRoot: trailingRoot }), (error) => error instanceof AssetContractError && error.code === 'PNG_TRAILING_DATA');

  const largeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-asset-contract-large-'));
  const large = Buffer.alloc((4 * 1024 * 1024) + 1);
  fs.writeFileSync(path.join(largeRoot, 'innkeeper.png'), large);
  const largeManifest = goldenManifest(largeRoot);
  largeManifest.assets[0].sha256 = crypto.createHash('sha256').update(large).digest('hex');
  largeManifest.assets[0].approval.assetSha256 = largeManifest.assets[0].sha256;
  assert.throws(() => validateAssetManifest(largeManifest, { assetRoot: largeRoot }), (error) => error instanceof AssetContractError && error.code === 'ASSET_FILE_TOO_LARGE');
});
