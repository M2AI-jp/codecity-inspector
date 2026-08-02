import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import {
  buildCodeCity,
  main,
  parseCliArgs,
  runCodeCity,
} from '../../../ship/90-cli/index.mjs';
import { requiredAssetSelectors } from '../../../ship/60-scene-compiler/index.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

// One transparent 192x256 sheet is generated only for contract composition
// tests. It is not product art and never enters the approval factory.
function testSheetPng() {
  const width = 192;
  const height = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const TEST_SHEET_PNG = testSheetPng();

const DIRECTIONS = ['north', 'south', 'east', 'west'];

function directionalAnimation(frameCount, fps) {
  return Object.fromEntries(DIRECTIONS.map((direction, row) => [
    direction,
    { frames: Array.from({ length: frameCount }, (_, index) => (row * 6) + index), fps },
  ]));
}

function usageForSelector(selector) {
  if (selector === 'player:default') return {
    kind: 'character', layer: 'actor',
    frame: { width: 32, height: 32, columns: 6, rows: 8 },
    collision: { kind: 'rect', x: 10, y: 24, width: 12, height: 7 },
    animations: {
      idle: directionalAnimation(2, 4),
      walk: directionalAnimation(4, 8),
      run: directionalAnimation(6, 12),
    },
  };
  if (selector.startsWith('npc:')) return {
    kind: 'character', layer: 'actor',
    frame: { width: 32, height: 32, columns: 6, rows: 8 },
    collision: { kind: 'rect', x: 10, y: 24, width: 12, height: 7 },
    animations: {
      idle: directionalAnimation(2, 4),
      walk: directionalAnimation(4, 8),
    },
  };
  const prefix = selector.split(':', 1)[0];
  const compatibility = {
    terrain: ['terrain', 'ground'], water: ['water', 'ground'], road: ['road', 'ground'],
    plot: ['terrain', 'ground'], building: ['building', 'object'], room: ['room', 'object'],
    prop: ['prop', 'object'], light: ['light', 'foreground'], quest: ['quest', 'foreground'],
    effect: ['effect', 'effect'], ui: ['ui', 'ui'],
  }[prefix];
  const usage = {
    kind: compatibility[0], layer: compatibility[1],
    frame: { width: 192, height: 256, columns: 1, rows: 1 },
    collision: { kind: 'none' },
  };
  if (prefix === 'building') usage.entrance = { x: 80, y: 192, width: 32, height: 64 };
  return usage;
}

async function fixtureRepository() {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'codecity-cli-repository-'));
  const root = path.join(workspace, 'repository');
  await fsp.mkdir(path.join(root, 'src'), { recursive: true });
  // The CLI must inspect these files without running them. If a package
  // manager or source evaluator is accidentally invoked, these throw.
  await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'inert-codecity-fixture',
    version: '1.0.0',
    scripts: { preinstall: 'throw new Error("must never run")' },
  }));
  await fsp.writeFile(path.join(root, 'src', 'index.mjs'), 'throw new Error("must never execute");\n');
  return root;
}

async function validInputs(worldPlan) {
  const assetRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'codecity-cli-assets-'));
  const pngPath = path.join(assetRoot, 'sheet.png');
  await fsp.writeFile(pngPath, TEST_SHEET_PNG);
  const sha256 = crypto.createHash('sha256').update(TEST_SHEET_PNG).digest('hex');
  const selectors = requiredAssetSelectors(worldPlan);
  const assets = selectors.map((selector, index) => ({
    id: `approved-${index}`,
    version: '1.0.0',
    status: 'accepted',
    accepted: true,
    path: 'sheet.png',
    url: 'sheet.png',
    sha256,
    dimensions: { width: 192, height: 256 },
    pivot: selector === 'player:default' || selector.startsWith('npc:')
      ? { x: 16, y: 31 }
      : selector.startsWith('building:') || selector.startsWith('room:')
        ? { x: 96, y: 255 }
        : { x: 0, y: 0 },
    usage: usageForSelector(selector),
    license: { spdx: 'CC0-1.0', holder: 'CodeCity test owner' },
    provenance: {
      kind: 'test',
      source: 'test/fixture.png',
      sourceSha256: '0'.repeat(64),
      custody: 'test',
      evidence: 'observed',
    },
    approval: {
      recordId: `test-approval-${index}`,
      actorType: 'human',
      authority: 'owner',
      approvedBy: 'test-owner',
      approvedAt: '2026-08-02T00:00:00.000Z',
      decision: 'accepted',
      assetId: `approved-${index}`,
      assetSha256: sha256,
      sourceSha256: '0'.repeat(64),
    },
  }));
  const assetManifest = {
    format: 'codecity.asset-manifest',
    schemaVersion: 1,
    manifestVersion: '1.0.0',
    fallbackPolicy: 'none',
    assets,
  };
  const sceneBindings = {
    format: 'codecity.scene-bindings',
    schemaVersion: 1,
    selectors: Object.fromEntries(selectors.map((selector, index) => [selector, `approved-${index}`])),
  };
  return {
    assetRoot,
    assetManifest,
    sceneBindings,
  };
}

async function removeTemporary(...roots) {
  for (const root of roots) {
    if (root) {
      const parent = path.dirname(root);
      const cleanupRoot = path.basename(root) === 'repository' && path.basename(parent).startsWith('codecity-cli-repository-') ? parent : root;
      await fsp.rm(cleanupRoot, { recursive: true, force: true });
    }
  }
}

test('CLI parses one repository path and the supported flags, without subcommands', () => {
  assert.deepEqual(parseCliArgs(['/tmp/repository', '--no-open', '--port', '4173', '--text']), {
    repositoryPath: '/tmp/repository',
    noOpen: true,
    port: 4173,
    shot: false,
    text: true,
    help: false,
  });
  assert.throws(() => parseCliArgs(['build', '/tmp/repository']), { code: 'INVALID_ARGS' });
  assert.throws(() => parseCliArgs(['/tmp/repository', '--unknown']), { code: 'INVALID_ARGS' });
  assert.throws(() => parseCliArgs(['/tmp/repository', '--port', '65536']), { code: 'INVALID_PORT' });
  assert.throws(() => parseCliArgs(['/tmp/repository', '--port', '4173', '--port', '4174']), { code: 'INVALID_ARGS' });
});

test('CLI uses a stable loopback port by default so browser-local revisit state survives restarts', () => {
  assert.equal(parseCliArgs(['/tmp/repository']).port, 4173);
});

test('text mode reports evidence states and does not require assets or start a server', async () => {
  const repositoryRoot = await fixtureRepository();
  const before = await fsp.readdir(repositoryRoot);
  const output = [];
  try {
    const result = await runCodeCity({ repositoryPath: repositoryRoot, text: true, write: (line) => output.push(line) });
    assert.equal(result.origin, null);
    assert.equal(result.server, null);
    assert.match(output.join('\n'), /観測[\s\S]*推定[\s\S]*未確認/);
    assert.match(output.join('\n'), /127\.0\.0\.1/);
    assert.match(output.join('\n'), /次の一歩/);
    assert.deepEqual(await fsp.readdir(repositoryRoot), before);
  } finally {
    await removeTemporary(repositoryRoot);
  }
});

test('full run serves immutable allowlisted bytes without writing a distribution', async () => {
  const repositoryRoot = await fixtureRepository();
  const output = [];
  let result;
  let inputs;
  try {
    const built = await buildCodeCity({ repositoryPath: repositoryRoot, seed: 'cli-test-seed' });
    inputs = await validInputs(built.worldPlan);
    const opened = [];
    result = await runCodeCity({
      repositoryPath: repositoryRoot,
      seed: 'cli-test-seed',
      ...inputs,
      port: 0,
      openBrowser: (url) => opened.push(url),
      write: (line) => output.push(line),
    });
    assert.equal(opened.length, 1);
    assert.equal(opened[0], result.browserUrl);
    assert.match(result.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.deepEqual(result.artifactEntries, ['app.mjs', 'index.html', 'index.mjs', 'state.mjs', 'styles.css']);
    assert.deepEqual(result.assetEntries, ['sheet.png']);
    const html = await fetch(`${result.origin}/index.html`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<canvas id="game-canvas"/u);
    const scene = await fetch(`${result.origin}/scene.json`);
    assert.equal(scene.status, 200);
    assert.equal((await scene.json()).format, 'codecity.scene-bundle');
    const asset = await fetch(`${result.origin}/sheet.png`);
    assert.equal(asset.status, 200);
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), TEST_SHEET_PNG);
    const notAllowlisted = await fetch(`${result.origin}/package.json`);
    assert.equal(notAllowlisted.status, 404);
    assert.deepEqual(await fsp.readdir(repositoryRoot), ['package.json', 'src']);
    assert.equal(fs.existsSync(path.join(repositoryRoot, 'scene.json')), false);
    assert.equal(result.distributionRoot, null);
    assert.equal(result.server.root, null);
    assert.match(output.join('\n'), /127\.0\.0\.1/);
  } finally {
    await result?.close?.();
    await removeTemporary(repositoryRoot, inputs?.assetRoot);
  }
});

test('composition root ships the real browser entry artifacts by default', async () => {
  const repositoryRoot = await fixtureRepository();
  let result;
  let inputs;
  try {
    const built = await buildCodeCity({ repositoryPath: repositoryRoot, seed: 'cli-browser-defaults' });
    inputs = await validInputs(built.worldPlan);
    result = await runCodeCity({
      repositoryPath: repositoryRoot,
      seed: 'cli-browser-defaults',
      ...inputs,
      port: 0,
      noOpen: true,
      write: () => {},
    });
    assert.deepEqual(result.artifactEntries, ['app.mjs', 'index.html', 'index.mjs', 'state.mjs', 'styles.css']);
    const html = await fetch(`${result.origin}/index.html`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<canvas id="game-canvas"/);
    const app = await fetch(`${result.origin}/app.mjs`);
    assert.equal(app.status, 200);
    const appSource = await app.text();
    assert.match(appSource, /SCENE_PATH = '\.\/scene\.json'/);
    assert.match(appSource, /request\(sceneUrl\.href/);
    const scene = await fetch(`${result.origin}/scene.json`);
    assert.equal(scene.status, 200);
    assert.equal((await scene.json()).format, 'codecity.scene-bundle');
  } finally {
    await result?.close?.();
    await removeTemporary(repositoryRoot, inputs?.assetRoot);
  }
});

test('missing approved manifest fails closed and never creates a distribution', async () => {
  const repositoryRoot = await fixtureRepository();
  const output = [];
  try {
    await assert.rejects(
      () => runCodeCity({ repositoryPath: repositoryRoot, assetManifestPath: path.join(repositoryRoot, 'missing-manifest.json'), noOpen: true, write: (line) => output.push(line) }),
      (error) => error?.code === 'ASSET_MANIFEST_REQUIRED'
    );
    assert.deepEqual(await fsp.readdir(repositoryRoot), ['package.json', 'src']);
    assert.equal(output.some((line) => String(line).includes('127.0.0.1')), false);
  } finally {
    await removeTemporary(repositoryRoot);
  }
});

test('success creates no distribution directory', async () => {
  const repositoryRoot = await fixtureRepository();
  let result;
  let inputs;
  try {
    const built = await buildCodeCity({ repositoryPath: repositoryRoot, seed: 'cleanup-test' });
    inputs = await validInputs(built.worldPlan);
    result = await runCodeCity({
      repositoryPath: repositoryRoot,
      seed: 'cleanup-test',
      ...inputs,
      port: 0,
      noOpen: true,
      write: () => {},
    });
    assert.equal(result.distributionRoot, null);
    assert.equal(result.server.root, null);
    assert.deepEqual(result.artifactEntries, ['app.mjs', 'index.html', 'index.mjs', 'state.mjs', 'styles.css']);
    assert.deepEqual(await fsp.readdir(repositoryRoot), ['package.json', 'src']);
    await result.close();
    result = null;
  } finally {
    await result?.close?.();
    await removeTemporary(repositoryRoot, inputs?.assetRoot);
  }
});

test('composition failure creates no distribution bytes', async () => {
  const repositoryRoot = await fixtureRepository();
  let inputs;
  try {
    const built = await buildCodeCity({ repositoryPath: repositoryRoot, seed: 'cleanup-failure-test' });
    inputs = await validInputs(built.worldPlan);
    await assert.rejects(
      () => runCodeCity({
        repositoryPath: repositoryRoot,
        seed: 'cleanup-failure-test',
        ...inputs,
        maxArtifactFileBytes: 1,
        port: 0,
        noOpen: true,
        write: () => {},
      }),
      (error) => error?.code === 'ARTIFACT_TOO_LARGE'
    );
    assert.deepEqual(await fsp.readdir(repositoryRoot), ['package.json', 'src']);
  } finally {
    await removeTemporary(repositoryRoot, inputs?.assetRoot);
  }
});

test('caller-controlled distribution and runtime roots are rejected explicitly', async () => {
  await assert.rejects(
    () => runCodeCity({ repositoryPath: process.cwd(), distributionRoot: process.cwd(), text: true, write: () => {} }),
    (error) => error?.code === 'COMPOSITION_INPUT_FORBIDDEN'
  );
  await assert.rejects(
    () => runCodeCity({ repositoryPath: process.cwd(), runtimeArtifactRoot: process.cwd(), text: true, write: () => {} }),
    (error) => error?.code === 'COMPOSITION_INPUT_FORBIDDEN'
  );
});

test('bindings files cannot escape the approved asset root', async () => {
  const repositoryRoot = await fixtureRepository();
  let inputs;
  try {
    const built = await buildCodeCity({ repositoryPath: repositoryRoot, seed: 'bindings-root-test' });
    inputs = await validInputs(built.worldPlan);
    await assert.rejects(
      () => runCodeCity({
        repositoryPath: repositoryRoot,
        seed: 'bindings-root-test',
        ...inputs,
        sceneBindings: undefined,
        sceneBindingsPath: path.join(repositoryRoot, 'package.json'),
        port: 0,
        noOpen: true,
        write: () => {},
      }),
      (error) => error?.code === 'SCENE_BINDINGS_OUTSIDE_ASSET_ROOT'
    );
  } finally {
    await removeTemporary(repositoryRoot, inputs?.assetRoot);
  }
});

test('main reports an honest shot gate and Japanese next step', async () => {
  const repositoryRoot = await fixtureRepository();
  const output = [];
  try {
    const code = await main(['--shot', repositoryRoot], { write: (line) => output.push(line) });
    assert.equal(code, 1);
    assert.match(output.join('\n'), /SHOT_UNAVAILABLE/);
    assert.match(output.join('\n'), /次の一歩/);
  } finally {
    await removeTemporary(repositoryRoot);
  }
});
