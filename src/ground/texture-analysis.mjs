// texture の統計と石・草の切り分け。読み込んだ画素の下ごしらえをまとめる。
// ---------------------------------------------------------------- texture の下ごしらえ（artDir ごとに1回）
export const lumOf = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
export function stats(img) {
  const m = [0, 0, 0], s = [0, 0, 0], n = img.width * img.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) m[c] += img.data[i * 4 + c];
  for (let c = 0; c < 3; c++) m[c] /= n;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) s[c] += (img.data[i * 4 + c] - m[c]) ** 2;
  for (let c = 0; c < 3; c++) s[c] = Math.sqrt(s[c] / n);
  return { m, s };
}
export function otsu(img) {
  const hist = new Array(256).fill(0), n = img.width * img.height;
  for (let i = 0; i < n; i++) hist[Math.round(lumOf(img.data, i * 4))]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}
// 石と目地を分ける: 明るい連結成分 = 石（端をまたいで連結）。各 pixel から石の重心までのずれを持つ。
export function segment(img, thrBias = 0) {
  const w = img.width, h = img.height, thr = otsu(img) + thrBias;
  const label = new Int32Array(w * h).fill(-1), dcx = new Float32Array(w * h), dcy = new Float32Array(w * h);
  const isStone = (i) => lumOf(img.data, i * 4) >= thr;
  let nl = 0;
  for (let s = 0; s < w * h; s++) {
    if (label[s] !== -1 || !isStone(s)) continue;
    const q = [[s % w, (s / w) | 0]], pix = []; label[s] = nl;
    while (q.length) {
      const [ux, uy] = q.pop(); pix.push([ux, uy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ux + dx, ny = uy + dy, i = (((ny % h) + h) % h) * w + (((nx % w) + w) % w);
        if (label[i] === -1 && isStone(i)) { label[i] = nl; q.push([nx, ny]); }
      }
    }
    let cx = 0, cy = 0; for (const [x, y] of pix) { cx += x; cy += y; } cx /= pix.length; cy /= pix.length;
    for (const [x, y] of pix) {
      const i = (((y % h) + h) % h) * w + (((x % w) + w) % w);
      dcx[i] = cx - x; dcy[i] = cy - y;
      if (pix.length < 4) label[i] = -2;
    }
    nl++;
  }
  for (let i = 0; i < w * h; i++) if (label[i] === -2) label[i] = -1;   // 小さすぎる粒は目地
  return { label, dcx, dcy, count: nl };
}

// 詰め込んだ丸石の texture は、石どうしの隙間が細く、明るさのしきい値によっては隣の石とつながって大きな塊になる。
// つながった塊が無くなる（いちばん大きい石が 360px 以下になる）まで、しきい値を少しずつ上げる。
export function segmentSeparated(img, thrBias = 0) {
  let s = segment(img, thrBias);
  for (let b = thrBias + 3; b <= thrBias + 36; b += 3) {
    const area = new Int32Array(s.count);
    for (let i = 0; i < s.label.length; i++) if (s.label[i] >= 0) area[s.label[i]]++;
    if (Math.max(0, ...area) <= 360) break;
    s = segment(img, b);
  }
  return s;
}

// 草の texture から、葉の株（明るい葉のかたまり）を切り出し、株を消した下地をつくる。
// 株は街の上で blue-noise に撒き直す（texture の繰り返しをそのまま見せない）。
export function prepareGrass(img) {
  const W = img.width, H = img.height, N = W * H, d = img.data;
  const wrap = (x, y) => (((y % H) + H) % H) * W + (((x % W) + W) % W);
  const bright = new Uint8Array(N);
  for (let i = 0; i < N; i++) bright[i] = lumOf(d, i * 4) >= 62 ? 1 : 0;
  const reg = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!bright[y * W + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reg[wrap(x + dx, y + dy)] = 1;
  }
  const lab = new Int32Array(N).fill(-1), sprites = [];
  for (let s = 0; s < N; s++) {
    if (lab[s] >= 0 || !reg[s]) continue;
    const q = [[s % W, (s / W) | 0]], pix = []; lab[s] = 1;
    while (q.length) {
      const [x, y] = q.pop(); pix.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = wrap(x + dx, y + dy);
        if (lab[j] < 0 && reg[j]) { lab[j] = 1; q.push([x + dx, y + dy]); }
      }
    }
    let nb = 0, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pix) { if (bright[wrap(x, y)]) nb++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (nb < 10 || w > 44 || h > 34) continue;
    const xs = new Int16Array(pix.length), ys = new Int16Array(pix.length), col = new Uint8Array(pix.length * 3);
    pix.forEach(([x, y], k) => { xs[k] = x - x0; ys[k] = y - y0; const o = wrap(x, y) * 4; col[k * 3] = d[o]; col[k * 3 + 1] = d[o + 1]; col[k * 3 + 2] = d[o + 2]; });
    sprites.push({ w, h, xs, ys, col, n: pix.length, big: nb >= 40 });
  }
  // 地の草は texture をそのまま使う（株を抜いて暗い所で埋めると、株の塊が消えて 1 画素の粒の絨毯に見えた）。株はその上に撒く
  return { sprites };
}
