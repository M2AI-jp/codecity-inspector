#!/usr/bin/env node
// 画像生成した石畳を、ゲームの画素の大きさの丸石に詰め直す（継ぎ目なしの地面 texture を作る）。
// 基準 art/references/user-provided/target-town.png の通りの石は、ゲームの画素で幅 6〜8・高さ 3〜4 の横長の丸い石。
// 画像生成の石畳をそのまま縮めると、石の形がつぶれて砂粒の模様になる（pixelize.mjs で 96px にした試し）。
// そこで、石の形はこの道具が画素の大きさで組み、石の色と粒は画像生成の絵から取る:
//   1. 石の中心をランダムに詰める（縦を伸ばした距離で詰めるので石は横長。大きい石から置くので大小が混ざり、列はそろわない）
//   2. いちばん近い中心（石の大きさで重みを付ける）で石を分け、隣の石との境を 1 画素の目地にする
//   3. 石は、隣の石までの距離の --fill 倍の楕円に収める（角が丸くなり、石のあいだの隙間に目地がたまる）
//   4. 出力の 1 画素 = 元の絵の 1 区画の平均。石の色はその石の区画の平均、粒は区画ごとの差、目地の色は元の絵の暗い所
//   5. 石の上の端を明るく、下の端を暗く、左上寄りに光る点
// 使い方: node tools/cobble-pack.mjs 元の絵.png 出力.png [--size 160x96] [--stone 6.8x4.0] [--var 0.3] [--fill 0.54] [--seed 7]
import { readPNG, writePNG, createImage } from './png.mjs';

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [srcPath, out] = pos;
if (!srcPath || !out) { console.error('使い方: node tools/cobble-pack.mjs 元の絵.png 出力.png [--size 160x96] [--stone 6.8x4.0] [--var 0.3] [--fill 0.54] [--seed 7]'); process.exit(1); }
const [W, H] = opt('size', '160x96').split('x').map(Number);
const [SW, SH] = opt('stone', '6.8x4.0').split('x').map(Number);
const VAR = +opt('var', 0.3), FILL = +opt('fill', 0.54), TV = +opt('tone', 1.4), GRAIN = +opt('grain', 0.45);
let s = +opt('seed', 7) * 9301 + 49297;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const AY = SW / SH;                      // 縦を AY 倍した空間で、石は丸い
const R = SW * 0.92;                     // その空間での中心どうしの最小距離（石の大きさ 1 のとき）
const wd = (ax, ay, bx, by) => { let dx = Math.abs(ax - bx); dx = Math.min(dx, W - dx); let dy = Math.abs(ay - by); dy = Math.min(dy, H - dy); dy *= AY; return dx * dx + dy * dy; };

// 1. 詰める
const pts = [];
for (let tries = 0; tries < 80000; tries++) {
  const t = tries / 80000, sz = 1 + VAR * (1 - 2 * t) + 0.12 * (rnd() - 0.5);
  const x = rnd() * W, y = rnd() * H;
  if (pts.every((p) => Math.sqrt(wd(p.x, p.y, x, y)) >= R * (p.sz + sz) / 2)) {
    rnd(); rnd();                        // （乱数の並びを試しのときと同じにするための空引き）
    pts.push({ x, y, sz, hi: rnd() });
  }
}
// 2. 石を分ける
const label = new Int32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let best = -1, bd = 1e9;
  for (let k = 0; k < pts.length; k++) { const d = wd(pts[k].x, pts[k].y, x + 0.5, y + 0.5) / (pts[k].sz * pts[k].sz); if (d < bd) { bd = d; best = k; } }
  label[y * W + x] = best;
}
const L = (x, y) => label[((y + H) % H) * W + ((x + W) % W)];
// 3. 目地と楕円
const rad = pts.map((p, k) => { let m = 1e9; pts.forEach((q, j) => { if (j !== k) m = Math.min(m, Math.sqrt(wd(p.x, p.y, q.x, q.y)) * 2 * p.sz / (p.sz + q.sz)); }); return m * FILL; });
const mortar = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const l = L(x, y);
  if (L(x + 1, y) !== l || L(x, y + 1) !== l || wd(pts[l].x, pts[l].y, x + 0.5, y + 0.5) > rad[l] * rad[l]) mortar[y * W + x] = 1;
}
const wrap = (d, n) => (d > n / 2 ? d - n : d < -n / 2 ? d + n : d);
const top = new Float64Array(pts.length).fill(1e9), bot = new Float64Array(pts.length).fill(-1e9);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (mortar[y * W + x]) continue;
  const k = label[y * W + x], dy = wrap(y + 0.5 - pts[k].y, H);
  top[k] = Math.min(top[k], dy); bot[k] = Math.max(bot[k], dy);
}
// 4. 色と粒は元の絵から
const SRC = readPNG(srcPath);
const lumOf = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const BLK = new Float64Array(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const x0 = Math.floor(x * SRC.width / W), x1 = Math.max(x0 + 1, Math.floor((x + 1) * SRC.width / W));
  const y0 = Math.floor(y * SRC.height / H), y1 = Math.max(y0 + 1, Math.floor((y + 1) * SRC.height / H));
  let r = 0, g = 0, b = 0, n = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * SRC.width + xx) * 4; r += SRC.data[o]; g += SRC.data[o + 1]; b += SRC.data[o + 2]; n++; }
  const i = (y * W + x) * 3; BLK[i] = r / n; BLK[i + 1] = g / n; BLK[i + 2] = b / n;
}
const order = []; for (let i = 0; i < W * H; i++) order.push([lumOf([BLK[i * 3], BLK[i * 3 + 1], BLK[i * 3 + 2]]), i]);
order.sort((a, b) => a[0] - b[0]);
const JMAT = [0, 0, 0]; { const n = Math.floor(0.15 * order.length); for (let j = 0; j < n; j++) { const i = order[j][1]; for (let c = 0; c < 3; c++) JMAT[c] += BLK[i * 3 + c] / n; } }
const SMEAN = pts.map(() => [0, 0, 0, 0]);
for (let i = 0; i < W * H; i++) if (!mortar[i]) { const m = SMEAN[label[i]]; for (let c = 0; c < 3; c++) m[c] += BLK[i * 3 + c]; m[3]++; }
SMEAN.forEach((m) => { if (m[3]) for (let c = 0; c < 3; c++) m[c] /= m[3]; });
const ML = SMEAN.map((m) => lumOf(m)).sort((a, b) => a - b)[SMEAN.length >> 1];   // 石の明るさの中央値
const STONE_L = lumOf([130, 121, 112]), JOINT_L = lumOf([62, 56, 50]);             // 石と目地の明るさ（夜の色調は src/ground.mjs が付ける）
const JC = JMAT.map((v) => v * JOINT_L / lumOf(JMAT));
// 5. 塗る
const img = createImage(W, H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, o = i * 4, k = label[i], p = pts[k];
  let c;
  if (mortar[i]) {
    const j = 0.9 + 0.2 * rnd();
    c = JC.map((v) => v * j);
  } else {
    const m = SMEAN[k], t = Math.pow(lumOf(m) / ML, TV);
    const base = m.map((v, ci) => (v + GRAIN * (BLK[i * 3 + ci] - v)) * STONE_L / lumOf(m) * t);
    const v = (wrap(y + 0.5 - p.y, H) - top[k]) / Math.max(1, bot[k] - top[k]);    // 0 = 石の上の端, 1 = 下の端
    let kk = v < 0.2 ? 1.16 : v > 0.8 ? 0.8 : 1 - 0.1 * (v - 0.5);
    const dx = wrap(x + 0.5 - p.x, W);
    if (p.hi > 0.35 && v < 0.45 && dx > -SW * 0.3 && dx < -SW * 0.05) kk *= 1.12;   // 左上寄りの光る点
    kk *= 0.97 + 0.06 * rnd();
    c = base.map((v2) => v2 * kk);
  }
  for (let ci = 0; ci < 3; ci++) img.data[o + ci] = Math.max(0, Math.min(255, Math.round(c[ci])));
  img.data[o + 3] = 255;
}
writePNG(out, img);
console.log(`${out}: ${W}x${H}, 石 ${pts.length}`);
