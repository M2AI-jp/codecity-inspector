// Keep pixel operations together so all sheets receive the same in-memory transformations.
export function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// Removes leftover magenta key fringe in memory: strongly magenta-tinted pixels on the
// silhouette edge become transparent; the rare interior ones are neutralised to a dark tone.
export function cleanMagenta(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const isMag = (i) => {
    if (d[i + 3] === 0) return false;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const mn = r < b ? r : b;
    return mn - g >= 20 && g < 0.6 * mn;
  };
  let removed = 0, neutral = 0;
  for (let pass = 0; pass < 3; pass++) {
    const kill = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!isMag(i)) continue;
        let edge = false;
        if (x === 0 || d[i - 4 + 3] === 0) edge = true;
        else if (x === w - 1 || d[i + 4 + 3] === 0) edge = true;
        else if (y === 0 || d[i - w * 4 + 3] === 0) edge = true;
        else if (y === h - 1 || d[i + w * 4 + 3] === 0) edge = true;
        if (edge) kill.push(i);
      }
    }
    if (!kill.length) break;
    for (const i of kill) { d[i + 3] = 0; removed++; }
  }
  for (let i = 0; i < d.length; i += 4) {
    if (!isMag(i)) continue;
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    d[i] = v * 0.9; d[i + 1] = v * 0.75; d[i + 2] = v * 0.7;
    neutral++;
  }
  ctx.putImageData(id, 0, 0);
  return { removed, neutral };
}

export function flipCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.translate(src.width, 0); g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}
