import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FABLE5_CHARACTER_FRAME,
  FABLE5_CHARACTER_SHEET_CONTRACT,
  fable5CharacterSheetContractProblems,
  isFable5CharacterSheetContract,
  selectFable5CharacterFrame
} from '../../public/fable5-v2/fable5-character-runtime.mjs';

const SOUTH_IDLE = Object.freeze({
  sx: 0, sy: 0, sw: 64, sh: 128, offsetX: 0, offsetY: 0,
  column: 0, row: 0, animation: 'idle'
});

function frame(actor, timestamp) {
  const result = selectFable5CharacterFrame(actor, timestamp);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.sw, FABLE5_CHARACTER_FRAME.width);
  assert.equal(result.sh, FABLE5_CHARACTER_FRAME.height);
  assert.equal(result.offsetX, FABLE5_CHARACTER_FRAME.placementOffsetX);
  assert.equal(result.offsetY, FABLE5_CHARACTER_FRAME.placementOffsetY);
  return result;
}

test('selector exposes foot geometry without reapplying it as a placement offset', () => {
  const selected = frame({ facing: 'north', moving: true, walkStartedAt: 0 }, 0);
  const foot = { x: 517, y: 293 };

  // This is the established site-runtime placement equation.  It must shift
  // the image by one pivot, not twice, regardless of selected animation.
  assert.deepEqual({
    x: foot.x - FABLE5_CHARACTER_FRAME.footPivotX + selected.offsetX,
    y: foot.y - FABLE5_CHARACTER_FRAME.footPivotY + selected.offsetY
  }, { x: 485, y: 173 });
  assert.equal(selected.offsetX, 0);
  assert.equal(selected.offsetY, 0);
});

test('Fable5 sheet contract exactly matches the 640x512 / 4x10 / fixed-pivot runtime agreement', async () => {
  assert.equal(Object.isFrozen(FABLE5_CHARACTER_SHEET_CONTRACT), true);
  assert.equal(isFable5CharacterSheetContract(FABLE5_CHARACTER_SHEET_CONTRACT), true);
  assert.deepEqual(fable5CharacterSheetContractProblems(FABLE5_CHARACTER_SHEET_CONTRACT), []);

  const draft = JSON.parse(await readFile(
    new URL('../../tools/asset-forge/contracts/fable5-prefab/character.player.contract-draft.json', import.meta.url),
    'utf8'
  ));
  assert.deepEqual(fable5CharacterSheetContractProblems(draft), []);
  const wrongPivot = structuredClone(draft);
  wrongPivot.pivot.y = 119;
  assert.match(fable5CharacterSheetContractProblems(wrongPivot).join('\n'), /pivot\.y must be 120/);
  const wrongFrames = structuredClone(draft);
  wrongFrames.sheet.anims.walk.cols[5] = 8;
  assert.match(fable5CharacterSheetContractProblems(wrongFrames).join('\n'), /walk\.cols must be \[2, 3, 4, 5, 6, 7\]/);
});

test('idle selection maps every facing to its row at 4fps and wraps its two columns', () => {
  const expectedRows = { south: 0, west: 1, east: 2, north: 3 };
  for (const [facing, row] of Object.entries(expectedRows)) {
    assert.deepEqual(frame({ facing, idleStartedAt: 100 }, 100), {
      ...SOUTH_IDLE, sy: row * 128, row
    });
    assert.deepEqual(frame({ facing, idleStartedAt: 100 }, 349), {
      ...SOUTH_IDLE, sx: 0, sy: row * 128, column: 0, row
    });
    assert.deepEqual(frame({ facing, idleStartedAt: 100 }, 350), {
      ...SOUTH_IDLE, sx: 64, sy: row * 128, column: 1, row
    });
    assert.deepEqual(frame({ facing, idleStartedAt: 100 }, 600), {
      ...SOUTH_IDLE, sy: row * 128, row
    });
  }
});

test('walk selection starts at columns 2–7, uses 10fps, and wraps six frames', () => {
  const actor = { facing: 'west', moving: true, walkStartedAt: 1_000 };
  assert.deepEqual(frame(actor, 1_000), {
    ...SOUTH_IDLE, sx: 128, sy: 128, column: 2, row: 1, animation: 'walk'
  });
  assert.deepEqual(frame(actor, 1_499), {
    ...SOUTH_IDLE, sx: 384, sy: 128, column: 6, row: 1, animation: 'walk'
  });
  assert.deepEqual(frame(actor, 1_500), {
    ...SOUTH_IDLE, sx: 448, sy: 128, column: 7, row: 1, animation: 'walk'
  });
  assert.deepEqual(frame(actor, 1_600), {
    ...SOUTH_IDLE, sx: 128, sy: 128, column: 2, row: 1, animation: 'walk'
  });
});

test('interaction has priority over movement, uses columns 8–9, and wraps at 6fps', () => {
  const actor = {
    facing: 'east', moving: true, walkStartedAt: 0,
    interacting: true, interactStartedAt: 2_000
  };
  assert.deepEqual(frame(actor, 2_000), {
    ...SOUTH_IDLE, sx: 512, sy: 256, column: 8, row: 2, animation: 'interact'
  });
  assert.deepEqual(frame(actor, 2_166), {
    ...SOUTH_IDLE, sx: 512, sy: 256, column: 8, row: 2, animation: 'interact'
  });
  assert.deepEqual(frame(actor, 2_167), {
    ...SOUTH_IDLE, sx: 576, sy: 256, column: 9, row: 2, animation: 'interact'
  });
  assert.deepEqual(frame(actor, 2_334), {
    ...SOUTH_IDLE, sx: 512, sy: 256, column: 8, row: 2, animation: 'interact'
  });
});

test('future starts are clamped to their first frame instead of producing negative coordinates', () => {
  assert.deepEqual(frame({ facing: 'north', moving: true, walkStartedAt: 9_999 }, 1), {
    ...SOUTH_IDLE, sx: 128, sy: 384, column: 2, row: 3, animation: 'walk'
  });
});

test('unknown facing, bad clocks, missing active starts, and malformed actors fail closed to finite south idle', () => {
  const unsafe = [
    [null, 0],
    [{ facing: 'diagonal', idleStartedAt: 0 }, 0],
    [{ facing: 'north', moving: true }, 0],
    [{ facing: 'north', moving: true, walkStartedAt: Number.NaN }, 0],
    [{ facing: 'north', interacting: true, interactStartedAt: Infinity }, 0],
    [{ facing: 'north', idleStartedAt: 0 }, Number.NEGATIVE_INFINITY],
    [{ facing: 'north', idleStartedAt: Number.MAX_SAFE_INTEGER + 1 }, 0]
  ];
  for (const [actor, timestamp] of unsafe) assert.deepEqual(frame(actor, timestamp), SOUTH_IDLE);
});

test('only boolean active flags opt into moving or interaction playback', () => {
  assert.deepEqual(frame({ facing: 'south', moving: 'yes', idleStartedAt: 0 }, 250), {
    ...SOUTH_IDLE, sx: 64, column: 1
  });
  assert.deepEqual(frame({ facing: 'south', interacting: 1, idleStartedAt: 0 }, 0), SOUTH_IDLE);
});
