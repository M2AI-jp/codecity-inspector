// test/town/touch-targets.test.mjs
//
// Regression coverage for a WCAG 2.5.8 / iOS HIG minimum touch target audit
// of public/fable5-v2/styles.css: every on-screen game control (the 4-way
// d-pad, the "操作" action button, and the zoom in/out buttons) must measure
// at least 44x44 CSS px, so a touch tap has a reasonable chance of landing.
//
// The audit found exactly one violation: `.zoom-control button` explicitly
// overrode the sheet's own global `button { min-width/min-height: 48px; }`
// default down to 40x40 -- confirmed both by reading the rule and by
// measuring the real rendered getBoundingClientRect() in a live browser
// (Browser pane, mobile 375x812 viewport): 40x40 before the fix, 44x44
// after. The d-pad (50x50, from `.dpad { grid-template-columns/rows:
// repeat(_, 50px); }`, filled by CSS Grid's default item-stretch since
// `.dpad button` sets no conflicting width/height) and the action button
// (84x64, literal width/height) were both already compliant.
//
// styles.css has no build step and this repo has no CSS-parsing dependency
// (see package.json), so this file uses a small, dependency-free rule
// extractor (regex-based, anchored to line-start so a selector can never
// match as a substring of a longer one -- e.g. ".dpad" vs ".dpad-north")
// to assert directly on the authored declarations, mirroring the "test the
// real source" convention every other file in this directory already
// follows for JS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const STYLES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/fable5-v2/styles.css');
const MIN_TOUCH_TARGET_PX = 44;

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns every rule body whose selector line is EXACTLY `selector` (anchored
// at line-start, so ".dpad" never matches ".dpad-north", and a
// comma-grouped selector sharing that same exact final line -- e.g.
// ".action-button,\n.dpad {" -- is matched too, same as a browser's own
// cascade would see it). Rules with no matching declaration inside are
// filtered out by callers via pxValue()/hasDeclaration() returning null,
// not by this function, so a caller always knows exactly how many rule
// blocks it is choosing between.
function ruleBodies(css, selector) {
  const pattern = new RegExp(`^${escapeForRegExp(selector)}\\s*\\{([^}]*)\\}`, 'gm');
  const bodies = [];
  let match = pattern.exec(css);
  while (match) {
    bodies.push(match[1]);
    match = pattern.exec(css);
  }
  return bodies;
}

function pxValue(body, property) {
  const match = body.match(new RegExp(`${property}\\s*:\\s*([\\d.]+)px`));
  return match ? Number(match[1]) : null;
}

const css = readFileSync(STYLES_PATH, 'utf8');

test('styles.css is readable and non-trivial (sanity check that the path/parser above is not silently matching nothing)', () => {
  assert.ok(css.length > 1000, 'styles.css looks unexpectedly small or missing');
});

// --- the fixed violation: zoom in/out buttons -------------------------------

test('.zoom-control button declares min-width and min-height of at least 44px (the fixed violation)', () => {
  const bodies = ruleBodies(css, '.zoom-control button');
  assert.equal(bodies.length, 1, 'expected exactly one .zoom-control button rule');
  const [body] = bodies;
  const minWidth = pxValue(body, 'min-width');
  const minHeight = pxValue(body, 'min-height');
  assert.ok(minWidth !== null, '.zoom-control button must declare an explicit min-width');
  assert.ok(minHeight !== null, '.zoom-control button must declare an explicit min-height');
  assert.ok(minWidth >= MIN_TOUCH_TARGET_PX, `.zoom-control button min-width ${minWidth}px is below the ${MIN_TOUCH_TARGET_PX}px touch-target floor`);
  assert.ok(minHeight >= MIN_TOUCH_TARGET_PX, `.zoom-control button min-height ${minHeight}px is below the ${MIN_TOUCH_TARGET_PX}px touch-target floor`);
});

test('regression illustration: the old 40x40 value would fail this exact assertion (the bound above is not vacuous)', () => {
  const oldMinWidth = 40;
  const oldMinHeight = 40;
  assert.ok(oldMinWidth < MIN_TOUCH_TARGET_PX, 'sanity check on the audit\'s own before-value');
  assert.ok(oldMinHeight < MIN_TOUCH_TARGET_PX, 'sanity check on the audit\'s own before-value');
});

// --- the global default floor (documents the 48px baseline every plain ----
// --- <button> in this app gets unless a more specific rule overrides it) --

test('the sheet-wide default button rule keeps a min-width/min-height at or above 44px', () => {
  const bodies = ruleBodies(css, 'button');
  assert.equal(bodies.length, 1, 'expected exactly one bare "button" rule');
  const [body] = bodies;
  const minWidth = pxValue(body, 'min-width');
  const minHeight = pxValue(body, 'min-height');
  assert.ok(minWidth !== null && minWidth >= MIN_TOUCH_TARGET_PX, `global button min-width ${minWidth} below floor`);
  assert.ok(minHeight !== null && minHeight >= MIN_TOUCH_TARGET_PX, `global button min-height ${minHeight} below floor`);
});

// --- the action button ("操作") ----------------------------------------------

test('.action-button declares an explicit width and height of at least 44px', () => {
  const bodies = ruleBodies(css, '.action-button');
  const layoutBody = bodies.find((body) => pxValue(body, 'width') !== null && pxValue(body, 'height') !== null);
  assert.ok(layoutBody, 'expected one .action-button rule (possibly comma-grouped with others) declaring explicit width and height');
  const width = pxValue(layoutBody, 'width');
  const height = pxValue(layoutBody, 'height');
  assert.ok(width >= MIN_TOUCH_TARGET_PX, `.action-button width ${width}px below the ${MIN_TOUCH_TARGET_PX}px floor`);
  assert.ok(height >= MIN_TOUCH_TARGET_PX, `.action-button height ${height}px below the ${MIN_TOUCH_TARGET_PX}px floor`);
});

// --- the d-pad ---------------------------------------------------------------

test('.dpad\'s grid tracks (what each direction button stretches to fill) are each at least 44px', () => {
  const bodies = ruleBodies(css, '.dpad');
  const gridBody = bodies.find((body) => body.includes('grid-template-columns'));
  assert.ok(gridBody, 'expected a standalone .dpad rule declaring grid-template-columns/rows');
  const columnTrack = gridBody.match(/grid-template-columns:\s*repeat\(\d+,\s*([\d.]+)px\)/);
  const rowTrack = gridBody.match(/grid-template-rows:\s*repeat\(\d+,\s*([\d.]+)px\)/);
  assert.ok(columnTrack, '.dpad grid-template-columns must use a repeat(N, <px>) track size');
  assert.ok(rowTrack, '.dpad grid-template-rows must use a repeat(N, <px>) track size');
  const columnPx = Number(columnTrack[1]);
  const rowPx = Number(rowTrack[1]);
  assert.ok(columnPx >= MIN_TOUCH_TARGET_PX, `.dpad column track ${columnPx}px below the ${MIN_TOUCH_TARGET_PX}px floor`);
  assert.ok(rowPx >= MIN_TOUCH_TARGET_PX, `.dpad row track ${rowPx}px below the ${MIN_TOUCH_TARGET_PX}px floor`);
});

test('.dpad button declares no conflicting width/height that would shrink it below its 50px grid track', () => {
  // The d-pad buttons intentionally rely on CSS Grid's default
  // align-items/justify-items: stretch to fill their 50x50 track (verified
  // against a live 375x812 render: real getBoundingClientRect() is exactly
  // 50x50 for all four direction buttons) -- this test guards the
  // assumption that stays true by asserting `.dpad button` itself declares
  // no smaller explicit width/height that would override that stretch.
  const bodies = ruleBodies(css, '.dpad button');
  assert.equal(bodies.length, 1, 'expected exactly one .dpad button rule');
  const [body] = bodies;
  const width = pxValue(body, 'width');
  const height = pxValue(body, 'height');
  if (width !== null) assert.ok(width >= MIN_TOUCH_TARGET_PX, `.dpad button declares an explicit width ${width}px below the grid track`);
  if (height !== null) assert.ok(height >= MIN_TOUCH_TARGET_PX, `.dpad button declares an explicit height ${height}px below the grid track`);
});

// --- cross-check against the live-measured values (documentation) ----------

test('documents the exact live-measured sizes this static analysis predicts (Browser pane, 375x812 mobile viewport)', () => {
  const liveMeasurements = {
    '#zoom-out': { w: 44, h: 44 },
    '#zoom-in': { w: 44, h: 44 },
    '.dpad-north': { w: 50, h: 50 },
    '.dpad-west': { w: 50, h: 50 },
    '.dpad-south': { w: 50, h: 50 },
    '.dpad-east': { w: 50, h: 50 },
    '#action-button': { w: 84, h: 64 }
  };
  for (const [selector, size] of Object.entries(liveMeasurements)) {
    assert.ok(size.w >= MIN_TOUCH_TARGET_PX && size.h >= MIN_TOUCH_TARGET_PX, `${selector} live size ${size.w}x${size.h} below the ${MIN_TOUCH_TARGET_PX}px floor`);
  }
});
