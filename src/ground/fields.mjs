// 格子の補間・ぼかし・距離。画素の分類と色が同じ場を使うための処理。
// 粗い格子（cell px ごと）の値を双線形で引く場。低周波のノイズと、tile の所属をぼかしたもの。
export function lattice(W, H, cell, fn) {
  const fw = Math.ceil(W / cell) + 2, fh = Math.ceil(H / cell) + 2, a = new Float32Array(fw * fh);
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) a[j * fw + i] = fn(i * cell + cell / 2, j * cell + cell / 2);
  return { a, fw, fh, cell, inv: 1 / cell };
}
export function samp(F, x, y) {
  let u = (x + 0.5) * F.inv - 0.5, v = (y + 0.5) * F.inv - 0.5;
  if (u < 0) u = 0; if (v < 0) v = 0;
  const i = u | 0, j = v | 0, fu = u - i, fv = v - j, w = F.fw, a = F.a, o = j * w + i;
  const t = a[o] + (a[o + 1] - a[o]) * fu, b = a[o + w] + (a[o + w + 1] - a[o + w]) * fu;
  return t + (b - t) * fv;
}
export function boxBlur(F, r) {
  const { fw, fh } = F, src = F.a, tmp = new Float32Array(fw * fh), out = new Float32Array(fw * fh), n = 2 * r + 1;
  for (let y = 0; y < fh; y++) {
    const row = y * fw; let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(fw - 1, Math.max(0, k))];
    for (let x = 0; x < fw; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(fw - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < fw; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(fh - 1, Math.max(0, k)) * fw + x];
    for (let y = 0; y < fh; y++) { out[y * fw + x] = acc / n; acc += tmp[Math.min(fh - 1, y + r + 1) * fw + x] - tmp[Math.max(0, y - r) * fw + x]; }
  }
  F.a = out;
  return F;
}

// チェス盤距離（上限255）。src[i] が 0 以外の pixel からの距離と、いちばん近い src の値。
export function chess(W, H, src) {
  const d = new Uint8Array(W * H), tag = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (src[i]) { tag[i] = src[i]; } else d[i] = 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let m = d[i]; if (!m) continue; let t = tag[i];
    if (x > 0 && d[i - 1] + 1 < m) { m = d[i - 1] + 1; t = tag[i - 1]; }
    if (y > 0) {
      const u = i - W;
      if (d[u] + 1 < m) { m = d[u] + 1; t = tag[u]; }
      if (x > 0 && d[u - 1] + 1 < m) { m = d[u - 1] + 1; t = tag[u - 1]; }
      if (x < W - 1 && d[u + 1] + 1 < m) { m = d[u + 1] + 1; t = tag[u + 1]; }
    }
    d[i] = m; tag[i] = t;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let m = d[i]; if (!m) continue; let t = tag[i];
    if (x < W - 1 && d[i + 1] + 1 < m) { m = d[i + 1] + 1; t = tag[i + 1]; }
    if (y < H - 1) {
      const u = i + W;
      if (d[u] + 1 < m) { m = d[u] + 1; t = tag[u]; }
      if (x < W - 1 && d[u + 1] + 1 < m) { m = d[u + 1] + 1; t = tag[u + 1]; }
      if (x > 0 && d[u - 1] + 1 < m) { m = d[u - 1] + 1; t = tag[u - 1]; }
    }
    d[i] = m; tag[i] = t;
  }
  return { d, tag };
}
