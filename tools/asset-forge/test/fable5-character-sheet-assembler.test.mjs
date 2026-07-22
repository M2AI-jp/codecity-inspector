import test from 'node:test';
import assert from 'node:assert/strict';

import sharp from 'sharp';

import { assembleFable5CharacterSheet, assembleFable5CharacterSheetFromStrips } from '../src/fable5-character-sheet-assembler.mjs';
import { inspectFable5PrefabCharacterCandidate } from '../src/fable5-prefab-character-intake.mjs';

async function syntheticSource({ columns = 10, rows = 4 } = {}) {
  const width = columns * 30 + 20;
  const height = rows * 42 + 20;
  const composites = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const fill = `#${(40 + row * 25).toString(16).padStart(2, '0')}${(55 + column * 9).toString(16).padStart(2, '0')}aa`;
    const sprite = await sharp({ create: { width: 18 + (column % 3), height: 32 + (row % 2), channels: 4, background: fill } })
      .composite([{ input: { create: { width: 4 + (column % 2), height: 5, channels: 4, background: '#f2e8d5' } }, left: 5, top: 27 }])
      .png().toBuffer();
    composites.push({ input: sprite, left: 10 + column * 30, top: 5 + row * 42 });
  }
  return sharp({ create: { width, height, channels: 4, background: '#00000000' } }).composite(composites).png().toBuffer();
}

async function fragmentedStrip() {
  const columns = 10;
  const width = columns * 56 + 20;
  const composites = [];
  for (let column = 0; column < columns; column += 1) {
    const left = 10 + column * 56;
    composites.push({
      input: await sharp({ create: { width: 24, height: 34, channels: 4, background: `#${(70 + column).toString(16).padStart(2, '0')}66aa` } }).png().toBuffer(),
      left,
      top: 8
    });
    composites.push({
      input: await sharp({ create: { width: 6, height: 8, channels: 4, background: '#f2e8d5' } }).png().toBuffer(),
      left: left + 33,
      top: 26
    });
  }
  return sharp({ create: { width, height: 62, channels: 4, background: '#00000000' } }).composite(composites).png().toBuffer();
}

test('assembles a separated 4x10 source into deterministic mechanically valid Fable5 bytes', async () => {
  const source = await syntheticSource();
  const first = await assembleFable5CharacterSheet(source);
  const second = await assembleFable5CharacterSheet(source);
  assert.deepEqual(first.output, second.output);
  assert.equal(first.report.placements.length, 40);
  assert.deepEqual(first.report.output.frame, { width: 64, height: 128, rows: 4, columns: 10, pivotX: 32, pivotY: 120 });
  const inspection = await inspectFable5PrefabCharacterCandidate(first.output, { width: 640, height: 512 });
  assert.equal(inspection.ok, true, inspection.problems.join('\n'));
});

test('rejects a source that is not exactly forty separated sprites', async () => {
  await assert.rejects(
    assembleFable5CharacterSheet(await syntheticSource({ columns: 9 })),
    /expected exactly 40 separated sprite components, found 36/
  );
});

test('assembles an explicitly declared uniform 4x10 grid when sprites contain detached pixel islands', async () => {
  const source = await syntheticSource();
  const assembled = await assembleFable5CharacterSheet(source, { sourceLayout: 'uniform-grid' });
  assert.equal(assembled.report.source.layout, 'uniform-grid');
  assert.equal(assembled.report.placements.length, 40);
  const inspection = await inspectFable5PrefabCharacterCandidate(assembled.output, { width: 640, height: 512 });
  assert.equal(inspection.ok, true, inspection.problems.join('\n'));
});

test('assembles four independently generated direction strips in supplied row order', async () => {
  const strips = await Promise.all(Array.from({ length: 4 }, () => syntheticSource({ columns: 10, rows: 1 })));
  const assembled = await assembleFable5CharacterSheetFromStrips(strips);
  assert.equal(assembled.report.source.strips.length, 4);
  assert.ok(assembled.report.source.strips.every((strip) => strip.components === 10));
  const inspection = await inspectFable5PrefabCharacterCandidate(assembled.output, { width: 640, height: 512 });
  assert.equal(inspection.ok, true, inspection.problems.join('\n'));
});

test('rejects a direction strip that does not contain ten sprites', async () => {
  const strips = await Promise.all([
    syntheticSource({ columns: 9, rows: 1 }),
    ...Array.from({ length: 3 }, () => syntheticSource({ columns: 10, rows: 1 }))
  ]);
  await assert.rejects(assembleFable5CharacterSheetFromStrips(strips), /strip 0 must contain exactly 10 separated sprite groups/);
});

test('groups detached held-prop islands into their one intended direction-strip sprite', async () => {
  const strips = await Promise.all([fragmentedStrip(), ...Array.from({ length: 3 }, () => syntheticSource({ columns: 10, rows: 1 }))]);
  const assembled = await assembleFable5CharacterSheetFromStrips(strips);
  assert.equal(assembled.report.source.strips[0].components, 20);
  assert.equal(assembled.report.source.strips[0].groups, 10);
  const inspection = await inspectFable5PrefabCharacterCandidate(assembled.output, { width: 640, height: 512 });
  assert.equal(inspection.ok, true, inspection.problems.join('\n'));
});
