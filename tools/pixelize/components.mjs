// components: Share the same eight-neighbour traversal between source figures and output islands.

// Connected components (8-conn) over a boolean mask restricted to a rectangle. Returns label array + sizes.
export function components(mask, W, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, lab = new Int32Array(w * h).fill(-1), sizes = [], stack = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lab[y * w + x] !== -1 || !mask[(y + y0) * W + x + x0]) continue;
    const id = sizes.length; let n = 0;
    stack.push(y * w + x); lab[y * w + x] = id;
    while (stack.length) {
      const p = stack.pop(), px = p % w, py = (p / w) | 0; n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (lab[q] === -1 && mask[(qy + y0) * W + qx + x0]) { lab[q] = id; stack.push(q); }
      }
    }
    sizes.push(n);
  }
  return { lab, sizes, w, h };
}
