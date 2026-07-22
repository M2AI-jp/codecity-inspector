// Pure Fable5 4 x 10 character-sheet playback.  This module deliberately
// knows nothing about URLs, asset approval, canvas, or the DOM: callers may
// bind an image only after the asset-forge approval route has completed.

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 128;
const SHEET_WIDTH = 640;
const SHEET_HEIGHT = 512;
const FOOT_PIVOT_X = 32;
const FOOT_PIVOT_Y = 120;

const DIRECTIONS = Object.freeze(['south', 'west', 'east', 'north']);

function freezeContract(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeContract(child);
  return Object.freeze(value);
}

export const FABLE5_CHARACTER_SHEET_CONTRACT = freezeContract({
  png: { w: SHEET_WIDTH, h: SHEET_HEIGHT },
  nativeScale: 1,
  logicalTileSize: 64,
  pivot: { x: FOOT_PIVOT_X, y: FOOT_PIVOT_Y },
  footprint: { w: 1, h: 1 },
  sheet: {
    rows: 4,
    cols: 10,
    frameW: FRAME_WIDTH,
    frameH: FRAME_HEIGHT,
    anims: {
      rowOrder: [...DIRECTIONS],
      idle: { cols: [0, 1], fps: 4 },
      walk: { cols: [2, 3, 4, 5, 6, 7], fps: 10 },
      interact: { cols: [8, 9], fps: 6 }
    }
  }
});

export const FABLE5_CHARACTER_FRAME = Object.freeze({
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  footPivotX: FOOT_PIVOT_X,
  footPivotY: FOOT_PIVOT_Y,
  // This selector supplies source rectangles only.  The canvas renderer owns
  // the world-space transform from an actor foot to this point in the frame.
  // Keeping the placement adjustment at zero prevents applying the pivot
  // once here and again in drawCharacterFrame().
  placementOffsetX: 0,
  placementOffsetY: 0
});

const ANIMATIONS = Object.freeze({
  idle: Object.freeze({ columns: Object.freeze([0, 1]), fps: 4 }),
  walk: Object.freeze({ columns: Object.freeze([2, 3, 4, 5, 6, 7]), fps: 10 }),
  interact: Object.freeze({ columns: Object.freeze([8, 9]), fps: 6 })
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactNumber(actual, expected, label, problems) {
  if (actual !== expected) problems.push(`${label} must be ${expected}`);
}

function exactArray(actual, expected, label, problems) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    problems.push(`${label} must be [${expected.join(', ')}]`);
  }
}

/**
 * Return the deterministic, runtime-relevant subset of the Fable5 prefab
 * character contract.  This validates metadata only; it cannot approve an
 * image, prove provenance, or inspect whether east was independently drawn.
 */
export function fable5CharacterSheetContractProblems(contract) {
  const problems = [];
  if (!isRecord(contract)) return ['character contract must be an object'];

  const { png, pivot, footprint, sheet } = contract;
  if (!isRecord(png)) problems.push('png must be an object');
  else {
    exactNumber(png.w, SHEET_WIDTH, 'png.w', problems);
    exactNumber(png.h, SHEET_HEIGHT, 'png.h', problems);
  }
  exactNumber(contract.nativeScale, 1, 'nativeScale', problems);
  exactNumber(contract.logicalTileSize, 64, 'logicalTileSize', problems);
  if (!isRecord(pivot)) problems.push('pivot must be an object');
  else {
    exactNumber(pivot.x, FOOT_PIVOT_X, 'pivot.x', problems);
    exactNumber(pivot.y, FOOT_PIVOT_Y, 'pivot.y', problems);
  }
  if (!isRecord(footprint)) problems.push('footprint must be an object');
  else {
    exactNumber(footprint.w, 1, 'footprint.w', problems);
    exactNumber(footprint.h, 1, 'footprint.h', problems);
  }
  if (!isRecord(sheet)) {
    problems.push('sheet must be an object');
    return problems;
  }
  exactNumber(sheet.rows, 4, 'sheet.rows', problems);
  exactNumber(sheet.cols, 10, 'sheet.cols', problems);
  exactNumber(sheet.frameW, FRAME_WIDTH, 'sheet.frameW', problems);
  exactNumber(sheet.frameH, FRAME_HEIGHT, 'sheet.frameH', problems);

  const anims = sheet.anims;
  if (!isRecord(anims)) {
    problems.push('sheet.anims must be an object');
    return problems;
  }
  exactArray(anims.rowOrder, DIRECTIONS, 'sheet.anims.rowOrder', problems);
  for (const [name, expected] of Object.entries(ANIMATIONS)) {
    const animation = anims[name];
    if (!isRecord(animation)) {
      problems.push(`sheet.anims.${name} must be an object`);
      continue;
    }
    exactArray(animation.cols, expected.columns, `sheet.anims.${name}.cols`, problems);
    exactNumber(animation.fps, expected.fps, `sheet.anims.${name}.fps`, problems);
  }
  return problems;
}

export function isFable5CharacterSheetContract(contract) {
  return fable5CharacterSheetContractProblems(contract).length === 0;
}

function safeTimestamp(value) {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}

function animationStart(actor, animation) {
  const names = animation === 'interact'
    ? ['interactStartedAt', 'interactionStartedAt', 'interactingSince']
    : animation === 'walk'
      ? ['walkStartedAt', 'moveStartedAt', 'movingSince']
      : ['idleStartedAt', 'idleSince'];
  const supplied = names.filter((name) => Object.hasOwn(actor, name));
  if (supplied.length === 0) return animation === 'idle' ? 0 : null;
  // Multiple aliases are permitted only when each one is a safe time.  The
  // first name is the documented/preferred spelling and wins deterministically.
  for (const name of supplied) {
    if (safeTimestamp(actor[name]) === null) return null;
  }
  return actor[supplied[0]];
}

function stableSouthIdle() {
  return frameFor('south', 'idle', 0, 0);
}

function frameFor(facing, animation, startedAt, timestamp) {
  const definition = ANIMATIONS[animation];
  const elapsed = Math.max(0, timestamp - startedAt);
  const elapsedFrames = Math.floor((elapsed * definition.fps) / 1000);
  const column = definition.columns[elapsedFrames % definition.columns.length];
  const row = DIRECTIONS.indexOf(facing);
  return Object.freeze({
    sx: column * FRAME_WIDTH,
    sy: row * FRAME_HEIGHT,
    sw: FRAME_WIDTH,
    sh: FRAME_HEIGHT,
    // Compatibility fields match the existing spriteFrame() contract.  They
    // are deliberately *not* derived from the pivot: site-runtime already
    // draws each frame at (foot.x - 32, foot.y - 120).
    offsetX: 0,
    offsetY: 0,
    column,
    row,
    animation
  });
}

/**
 * Select one immutable source frame for a Fable5 640 x 512 character sheet.
 * `FABLE5_CHARACTER_FRAME.footPivot*` describes the source-frame geometry;
 * this function does not convert it into a world-space offset.  Renderers
 * must apply the pivot exactly once when positioning the selected rectangle.
 *
 * Actor input is intentionally small and DOM-free:
 * `{ facing, moving, interacting, idleStartedAt, walkStartedAt,
 * interactStartedAt }`, where times are milliseconds on the same monotonic
 * clock as `timestamp`.  `interactionStartedAt` and `moveStartedAt` are
 * accepted compatibility aliases.  Interaction takes precedence over walk.
 * Any unknown facing, non-finite clock value, or active animation without a
 * valid start time fails closed to the stable south idle frame.
 */
export function selectFable5CharacterFrame(actor, timestamp) {
  if (!isRecord(actor) || safeTimestamp(timestamp) === null) return stableSouthIdle();
  if (!DIRECTIONS.includes(actor.facing)) return stableSouthIdle();

  const animation = actor.interacting === true ? 'interact' : actor.moving === true ? 'walk' : 'idle';
  const startedAt = animationStart(actor, animation);
  if (startedAt === null) return stableSouthIdle();
  return frameFor(actor.facing, animation, startedAt, timestamp);
}
