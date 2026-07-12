import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeUnfilteredRgbaPng, inspectPng } from '../src/png-core.mjs';
import { createMockPng } from '../src/providers/mock-provider.mjs';

const contract = { width: 80, height: 96, kind: 'spritesheet' };

test('mock PNG is valid, dimensioned, pixel-bearing, and byte deterministic', () => {
  const input = {
    assetId: 'character.player',
    seed: 's',
    promptHash: 'p',
    referenceImageHashes: ['a'.repeat(64)],
    outputContract: contract
  };
  const a = createMockPng(input);
  const b = createMockPng(input);
  assert.deepEqual(a, b);
  assert.deepEqual(inspectPng(a), { format: 'png', width: 80, height: 96, channels: 4, frames: 1, bytes: a.length });
  const decoded = decodeUnfilteredRgbaPng(a);
  assert.ok(decoded.pixels.some((value, index) => index % 4 === 3 && value === 255));
  assert.ok(decoded.pixels.some((value, index) => index % 4 === 3 && value === 0));
  assert.notDeepEqual(a, createMockPng({ ...input, seed: 'other' }));
  assert.notDeepEqual(a, createMockPng({ ...input, referenceImageHashes: ['b'.repeat(64)] }));
});

test('PNG inspection rejects invalid magic and oversized dimensions before decoding', () => {
  assert.throws(() => inspectPng(Buffer.from('<svg></svg>')), /Invalid PNG/);
  const png = createMockPng({ assetId: 'field.grass', outputContract: { width: 16, height: 16 } });
  const forged = Buffer.from(png);
  forged.writeUInt32BE(8193, 16);
  assert.throws(() => inspectPng(forged), /dimensions exceed limits/);
});
