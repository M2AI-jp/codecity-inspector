import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPNG } from '../tools/png.mjs';
import { opaqueInBox, Renderer } from '../web/render.js';

test('屋根の矩形に触れても、透明な角と薄い影だけなら人物を透過描画しない', () => {
  const pixels = new Uint8ClampedArray(8 * 8 * 4);
  pixels[(3 * 8 + 4) * 4 + 3] = 255;
  pixels[(2 * 8 + 1) * 4 + 3] = 40;
  assert.equal(opaqueInBox(pixels, 8, 8, -2, -2, 3, 8), false);
  assert.equal(opaqueInBox(pixels, 8, 8, 3, 2, 5, 4), true);
  assert.equal(opaqueInBox(pixels, 8, 8, 5, 0, 10, 8), false);
  assert.equal(opaqueInBox(pixels, 8, 8, 0, 4, 8, 10), false);
});

const manifest = JSON.parse(readFileSync(new URL('../art/game/manifest.json', import.meta.url)));
function prop(key, x = 528, y = 640) {
  const def = manifest.props[key];
  return { x, y, layer: def.layer, def: { ...def,
    image: readPNG(new URL(`../art/game/${def.src}`, import.meta.url)) } };
}

// Feed real PNG alpha to the renderer's canvas readback without requiring a browser in node:test.
function canvasReadback(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement() {
    let image;
    return { getContext() { return {
      drawImage(value) { image = value; },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
          const from = ((y + row) * image.width + x + col) * 4;
          data.set(image.data.subarray(from, from + 4), (row * w + col) * 4);
        }
        return { data };
      },
    }; } };
  } };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
}

function sceneRenderer(props) {
  const renderer = Object.create(Renderer.prototype), calls = [];
  Object.assign(renderer, {
    ctx: { fillRect() {}, drawImage() {} }, ground: { width: 1000, height: 1000 },
    items: [], drawList: [], sortFn: (a, b) => a.key - b.key || a.order - b.order,
    lighting: { render() { calls.push('lighting'); } },
    drawProp() { calls.push('prop'); }, drawCharacter() { calls.push('player'); },
    drawGhost() { calls.push('ghost'); },
  });
  return { renderer, calls, render(rx, ry) {
    calls.length = 0;
    const player = { rx, ry, sheet: {} };
    renderer.render({ vw: 1000, vh: 1000, camX: 0, camY: 0,
      world: { props, buildings: [] }, player, characters: [player] });
    return calls.includes('ghost'); // render's occluded branch, after lighting
  } };
}

test('城の裏で occluded が立ち、正面・横・透明な屋根の角では影を出さない', t => {
  canvasReadback(t);
  const { render, calls } = sceneRenderer([prop('castle-1')]);
  assert.equal(render(524, 534), true);
  assert.deepEqual(calls, ['player', 'prop', 'lighting', 'ghost']);
  assert.equal(render(528, 651), false);
  assert.deepEqual(calls, ['prop', 'player', 'lighting']);
  assert.equal(render(632, 590), false);
  assert.equal(render(440, 490), false); // inside image bounds, outside opaque towers
  assert.equal(render(528, 460), false); // transparent padding above the spire
  assert.equal(render(528, 640), false); // equal sort key: prop precedes player
});

test('井戸小屋・足場の両版・木の後ろにも、絵が重なるときだけ影を出す', t => {
  canvasReadback(t);
  for (const key of ['wellhouse', 'scaffold', 'scaffold-2', 'tree', 'tree-2', 'tree-3']) {
    const p = prop(key), { render } = sceneRenderer([p]);
    assert.equal(render(p.x, p.y + p.def.solid[1] - 3), true, key);
    assert.equal(render(p.x, p.y + 12), false, `${key}: front`);
    assert.equal(render(p.x + p.def.image.width, p.y - 30), false, `${key}: side`);
  }
});

test('樽・木箱・花壇などの低い小物と地面の小物には影を出さない', t => {
  canvasReadback(t);
  for (const key of ['barrel', 'crate', 'flowerbed', 'cart', 'bench', 'planter', 'flowerpot',
    'bush', 'bush-2', 'sacks', 'lumber', 'fence', 'lowwall', 'sign-works',
    'boat', 'bridge-h', 'bridge-v', 'pier', 'pier-2', 'canal-mouth']) {
    const p = prop(key), { render } = sceneRenderer([p]);
    for (let dy = -p.def.image.height; dy <= 4; dy += 2) {
      assert.equal(render(p.x, p.y + dy), false, `${key} at ${dy}`);
    }
  }
});

test('門の開口・梁・柱の判定と描画順は従来どおり', t => {
  canvasReadback(t);
  const p = prop('gate'), { renderer, render } = sceneRenderer([p]);
  const [ox, oy] = p.def.origin, [dx, , w] = p.def.opening;
  const top = renderer.clearance(p.def);
  let hidden = 0, visible = 0;
  for (let x = -70; x <= 70; x += 2) for (let y = -110; y <= 14; y += 2) {
    const x0 = x - 6, x1 = x + 6, y0 = y - 26, y1 = y;
    const expected = y < 0 &&
      x1 > -ox && x0 < p.def.image.width - ox && y1 > -oy && y0 < p.def.image.height - oy &&
      !(x0 >= dx && x1 <= dx + w && y0 >= top);
    assert.equal(render(p.x + x, p.y + y), expected, `gate at ${x},${y}`);
    expected ? hidden++ : visible++;
  }
  assert.ok(hidden > 0 && visible > 0);
});

test('薄い影・透明な余白を高い絵と数えず、不透明な部分だけで重なりを判定する', t => {
  canvasReadback(t);
  const image = { width: 32, height: 80, data: new Uint8ClampedArray(32 * 80 * 4) };
  image.data[(2 * 32 + 16) * 4 + 3] = 40; // tall shadow
  image.data[(65 * 32 + 16) * 4 + 3] = 255; // low object
  const p = { x: 100, y: 100, def: { origin: [16, 79], solid: [-8, -6, 16, 6], image } };
  assert.equal(sceneRenderer([p]).render(100, 86), false);
  const tall = { ...image, data: image.data.slice() };
  tall.data[(20 * 32 + 16) * 4 + 3] = 255;
  p.def = { ...p.def, image: tall };
  const { render } = sceneRenderer([p]);
  assert.equal(render(100, 50), true);
  assert.equal(render(85, 50), false); // image rectangle overlaps, opaque pixel does not
});
