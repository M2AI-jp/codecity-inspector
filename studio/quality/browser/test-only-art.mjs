import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { requiredAssetSelectors } from '../../../ship/60-scene-compiler/index.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});
const DIRECTIONS = ['north', 'south', 'east', 'west'];

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

function diagnosticSheet() {
  const width = 192;
  const height = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
      raw[offset] = checker ? 57 : 85;
      raw[offset + 1] = checker ? 99 : 126;
      raw[offset + 2] = checker ? 82 : 103;
      raw[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

/** Mechanical browser-QA fixture only; never product art or owner approval. */
export function createTestOnlyArt(worldPlan) {
  const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-browser-test-art-'));
  const bytes = diagnosticSheet();
  fs.writeFileSync(path.join(assetRoot, 'diagnostic-sheet.png'), bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const selectors = requiredAssetSelectors(worldPlan);
  const assets = selectors.map((selector, index) => {
    const id = `browser-test-asset-${index}`;
    return {
      id, version: '1.0.0', status: 'accepted', accepted: true,
      path: 'diagnostic-sheet.png', url: 'diagnostic-sheet.png', sha256,
      dimensions: { width: 192, height: 256 }, pivot: pivot(selector), usage: usage(selector),
      license: { spdx: 'CC0-1.0', holder: 'mechanical test fixture' },
      provenance: { kind: 'test-only', source: 'generated diagnostic bytes', sourceSha256: 'e'.repeat(64), evidence: 'observed' },
      approval: {
        recordId: `browser-test-approval-${index}`, actorType: 'human', authority: 'owner', approvedBy: 'test-fixture-not-product',
        approvedAt: '2026-08-02T00:00:00.000Z', decision: 'accepted', assetId: id, assetSha256: sha256, sourceSha256: 'e'.repeat(64),
      },
    };
  });
  return {
    assetRoot,
    assetManifest: { format: 'codecity.asset-manifest', schemaVersion: 1, manifestVersion: '0.0.0-test-only', fallbackPolicy: 'none', assets },
    sceneBindings: { format: 'codecity.scene-bindings', schemaVersion: 1, selectors: Object.fromEntries(selectors.map((selector, index) => [selector, `browser-test-asset-${index}`])) },
  };
}
