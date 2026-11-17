import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opaqueInBox } from '../web/render.js';

test('屋根の矩形に触れても、透明な角と薄い影だけなら人物を透過描画しない', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  pixels[(3 * 8 + 4) * 4 + 3] = 255;
  pixels[(2 * 8 + 1) * 4 + 3] = 40;
  assert.equal(opaqueInBox(pixels, 8, 8, -2, -2, 3, 8), false);
  assert.equal(opaqueInBox(pixels, 8, 8, 3, 2, 5, 4), true);
  assert.equal(opaqueInBox(pixels, 8, 8, 5, 0, 10, 8), false);
  assert.equal(opaqueInBox(pixels, 8, 8, 0, 4, 8, 10), false);
});
