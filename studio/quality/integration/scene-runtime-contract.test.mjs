import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { compileScene, requiredAssetSelectors } from '../../../ship/60-scene-compiler/index.mjs';
import { validateSceneBundle as validateRuntimeSceneBundle } from '../../../ship/70-game-runtime/index.mjs';
import { createTestOnlyWorldPlan } from '../../../ship/60-scene-compiler/test/fixtures/worldplan-v1.test-only.mjs';

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

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function testOnlySheet() {
  const width = 192;
  const height = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(height * (1 + width * 4)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const DIRECTIONS = ['north', 'south', 'east', 'west'];
function animation(count, fps) {
  return Object.fromEntries(DIRECTIONS.map((direction, row) => [direction, { frames: Array.from({ length: count }, (_, index) => row * 6 + index), fps }]));
}

function usage(selector) {
  if (selector === 'player:default') return {
    kind: 'character', layer: 'actor', frame: { width: 32, height: 32, columns: 6, rows: 8 },
    collision: { kind: 'rect', x: 10, y: 24, width: 12, height: 7 },
    animations: { idle: animation(2, 4), walk: animation(4, 8), run: animation(6, 12) },
  };
  if (selector.startsWith('npc:')) return {
    kind: 'character', layer: 'actor', frame: { width: 32, height: 32, columns: 6, rows: 8 },
    collision: { kind: 'rect', x: 10, y: 24, width: 12, height: 7 },
    animations: { idle: animation(2, 4), walk: animation(4, 8) },
  };
  const prefix = selector.split(':', 1)[0];
  const [kind, layer] = {
    terrain: ['terrain', 'ground'], water: ['water', 'ground'], road: ['road', 'ground'], plot: ['terrain', 'ground'],
    building: ['building', 'object'], room: ['room', 'object'], prop: ['prop', 'object'], light: ['light', 'foreground'],
    quest: ['quest', 'foreground'], ui: ['ui', 'ui'], effect: ['effect', 'effect'],
  }[prefix];
  const result = {
    kind, layer,
    frame: ['building', 'room', 'ui'].includes(prefix) ? { width: 192, height: 256, columns: 1, rows: 1 } : { width: 16, height: 16, columns: 12, rows: 16 },
    collision: { kind: 'none' },
  };
  if (prefix === 'building') {
    result.collision = { kind: 'rect', x: 80, y: 224, width: 32, height: 32 };
    result.entrance = { x: 88, y: 240, width: 16, height: 16 };
  }
  return result;
}

function pivot(selector) {
  if (selector === 'player:default' || selector.startsWith('npc:')) return { x: 16, y: 31 };
  if (selector.startsWith('building:') || selector.startsWith('room:') || selector.startsWith('ui:')) return { x: 96, y: 255 };
  return { x: 8, y: 16 };
}

test('the scene compiler output is accepted unchanged by the independent browser runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-scene-runtime-integration-'));
  const bytes = testOnlySheet();
  fs.writeFileSync(path.join(root, 'sheet.png'), bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const worldPlan = createTestOnlyWorldPlan({ observedTransition: true });
  const selectors = requiredAssetSelectors(worldPlan);
  const assets = selectors.map((selector, index) => {
    const id = `integration-asset-${index}`;
    return {
      id, version: '1.0.0', status: 'accepted', accepted: true, path: 'sheet.png', url: 'sheet.png', sha256,
      dimensions: { width: 192, height: 256 }, pivot: pivot(selector), usage: usage(selector),
      license: { spdx: 'CC0-1.0', holder: 'test owner' },
      provenance: { kind: 'test-only', source: 'generated test bytes', sourceSha256: 'd'.repeat(64), evidence: 'observed' },
      approval: {
        recordId: `integration-approval-${index}`, actorType: 'human', authority: 'owner', approvedBy: 'test owner',
        approvedAt: '2026-08-02T00:00:00.000Z', decision: 'accepted', assetId: id, assetSha256: sha256, sourceSha256: 'd'.repeat(64),
      },
    };
  });
  const bundle = compileScene({
    worldPlan,
    assetRoot: root,
    assetManifest: { format: 'codecity.asset-manifest', schemaVersion: 1, manifestVersion: '1.0.0', fallbackPolicy: 'none', assets },
    bindings: { format: 'codecity.scene-bindings', schemaVersion: 1, selectors: Object.fromEntries(selectors.map((selector, index) => [selector, `integration-asset-${index}`])) },
  });
  const result = validateRuntimeSceneBundle(bundle);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(bundle.game.renderables.filter((entry) => entry.effect === 'inspection_stamp').length, 1);
});
