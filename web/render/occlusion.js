// Image masks stay shared across renderers; gate clearance stays cached on the prop definition.
const opacityMasks = new WeakMap();

// 外観の透明な余白や薄い影だけでは人物を隠したことにしない。
export function opaqueInBox(data, width, height, x0, y0, x1, y1) {
  const left = Math.max(0, Math.floor(x0)), right = Math.min(width, Math.ceil(x1));
  const top = Math.max(0, Math.floor(y0)), bottom = Math.min(height, Math.ceil(y1));
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    if (data[(y * width + x) * 4 + 3] >= 128) return true;
  }
  return false;
}

function opacityMask(image) {
  let mask = opacityMasks.get(image);
  if (!mask) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let first = 3;
    while (first < data.length && data[first] < 128) first += 4;
    mask = { data, top: Math.floor(first / 4 / image.width) };
    opacityMasks.set(image, mask);
  }
  return mask;
}

// Does the building exterior overlap the player with opaque pixels?
export function covers(b, p) {
  const a = b.arch;
  if (!a || !a.exterior || b.open > 0.5) return false;
  const ix = b.px - a.exteriorOrigin[0], iy = b.py - a.exteriorOrigin[1];
  const x0 = p.rx - 10, x1 = p.rx + 10, y0 = p.ry - 26, y1 = p.ry;
  const image = a.exterior;
  if (!(x1 > ix && x0 < ix + image.width && y1 > iy && y0 < iy + image.height)) return false;
  return opaqueInBox(opacityMask(image).data, image.width, image.height, x0 - ix, y0 - iy, x1 - ix, y1 - iy);
}

// Tall props use the roof test; gates preserve the clearance through their opening.
export function coversProp(renderer, p, pl) {
  const d = p.def;
  if (!d || !d.image || p.layer === 'ground' || d.layer === 'ground') return false;
  const ix = p.x - d.origin[0], iy = p.y - d.origin[1];
  const x0 = pl.rx - 6, x1 = pl.rx + 6, y0 = pl.ry - 26, y1 = pl.ry;
  if (!(x1 > ix && x0 < ix + d.image.width && y1 > iy && y0 < iy + d.image.height)) return false;
  if (!Array.isArray(d.opening)) {
    const image = d.image;
    const mask = opacityMask(image);
    const back = d.solids?.length ? Math.min(...d.solids.map(s => s[1])) : (d.solid?.[1] ?? 0);
    // Measure above the rear of the footprint, not the whole image: a deep flowerbed is low.
    // Transparent padding and faint ground shadows do not contribute to the height.
    if (d.origin[1] + back - mask.top <= 26) return false;
    return opaqueInBox(mask.data, image.width, image.height, x0 - ix, y0 - iy, x1 - ix, y1 - iy);
  }
  const o = d.opening, ox0 = p.x + o[0], ox1 = ox0 + o[2], oy0 = p.y + renderer.clearance(d);
  return !(x0 >= ox0 && x1 <= ox1 && y0 >= oy0);
}

// First opaque pixel above the foot in the middle of the gate opening.
export function clearance(d) {
  if (d.clearTop !== undefined) return d.clearTop;
  let top = d.opening[1];
  try {
    const c = document.createElement('canvas');
    c.width = d.image.width; c.height = d.image.height;
    const g = c.getContext('2d');
    g.drawImage(d.image, 0, 0);
    const cx = Math.round(d.origin[0] + d.opening[0] + d.opening[2] / 2);
    const a = g.getImageData(cx, 0, 1, c.height).data;
    let y = Math.min(c.height - 1, d.origin[1] + d.opening[1]);
    while (y > 0 && a[y * 4 + 3] < 128) y--;
    top = Math.min(top, y + 1 - d.origin[1]);
  } catch { /* unreadable image: the walkable box is all we know */ }
  d.clearTop = top;
  return top;
}
