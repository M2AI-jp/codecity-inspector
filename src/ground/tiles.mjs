// tile の種別と近傍。通りの向き・建物・水路を後続の共通入力にする。
import { T, TG, TS, TD, TP, TW, TO, TILE_OF } from './constants.mjs';

export function prepareTiles(S) {
  const { town, cols, rows } = S;
  // ---- tile の表
  const tc = new Uint8Array(cols * rows), footT = new Int32Array(cols * rows).fill(-1);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tc[y * cols + x] = TILE_OF[town.ground[y]?.[x]] ?? TO;
  (town.buildings || []).forEach((b, k) => {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < cols && y < rows) footT[y * cols + x] = k;
  });
  const cx_ = (x) => (x < 0 ? 0 : x >= cols ? cols - 1 : x), cy_ = (y) => (y < 0 ? 0 : y >= rows ? rows - 1 : y);
  const tcl = (x, y) => tc[cy_(y) * cols + cx_(x)];
  const footAt = (x, y) => footT[cy_(y) * cols + cx_(x)] >= 0;
  // 水路のセルは town.canal.cells を正本にする（ground の '~' と一致する入力だけを描く）。
  // Set と tile mask の両方を持ち、座標判定は描画ループで配列を使って軽くする。
  const canalCells = new Set();
  for (const cell of town.canal?.cells || []) {
    if (!Array.isArray(cell) || cell.length < 2) continue;
    const [x, y] = cell;
    if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < cols && y < rows) canalCells.add(`${x},${y}`);
  }
  const canalTile = new Uint8Array(cols * rows);
  for (const key of canalCells) {
    const [x, y] = key.split(',').map(Number);
    if (tc[y * cols + x] === TW) canalTile[y * cols + x] = 1;
  }
  const canalAtPx = (x, y) => canalTile[((y / T) | 0) * cols + ((x / T) | 0)] !== 0;
  // 通りの向き: 縦に長く続く通り（南北の大通り）は石の列も縦に揃える
  const orient = new Uint8Array(cols * rows), runAlong = new Int32Array(cols * rows);
  const crossStart = new Int32Array(cols * rows), crossLen = new Int32Array(cols * rows);
  {
    const hl = new Int32Array(cols * rows), vl = new Int32Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols;) {
      if (tc[y * cols + x] !== TS) { x++; continue; }
      let e = x; while (e < cols && tc[y * cols + e] === TS) e++;
      for (let k = x; k < e; k++) hl[y * cols + k] = e - x;
      x = e;
    }
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows;) {
      if (tc[y * cols + x] !== TS) { y++; continue; }
      let e = y; while (e < rows && tc[e * cols + x] === TS) e++;
      for (let k = y; k < e; k++) vl[k * cols + x] = e - y;
      y = e;
    }
    for (let i = 0; i < cols * rows; i++) if (tc[i] === TS) { orient[i] = vl[i] > hl[i] ? 1 : 0; runAlong[i] = orient[i] ? vl[i] : hl[i]; }
    // 轍のための横断方向の範囲（同じ向きの通り tile が続く範囲）
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows;) {
      const i = y * cols + x;
      if (tc[i] !== TS || orient[i] !== 0) { y++; continue; }
      let e = y; while (e < rows && tc[e * cols + x] === TS && orient[e * cols + x] === 0) e++;
      for (let k = y; k < e; k++) { crossStart[k * cols + x] = y * T; crossLen[k * cols + x] = (e - y) * T; }
      y = e;
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols;) {
      const i = y * cols + x;
      if (tc[i] !== TS || orient[i] !== 1) { x++; continue; }
      let e = x; while (e < cols && tc[y * cols + e] === TS && orient[y * cols + e] === 1) e++;
      for (let k = x; k < e; k++) { crossStart[y * cols + k] = x * T; crossLen[y * cols + k] = (e - x) * T; }
      x = e;
    }
  }
  // 周り8 tile のうち条件に合うもの（N S W E NW NE SW SE の bit）
  const nmask = (tx, ty, pred) =>
    (pred(tx, ty - 1) ? 1 : 0) | (pred(tx, ty + 1) ? 2 : 0) | (pred(tx - 1, ty) ? 4 : 0) | (pred(tx + 1, ty) ? 8 : 0) |
    (pred(tx - 1, ty - 1) ? 16 : 0) | (pred(tx + 1, ty - 1) ? 32 : 0) | (pred(tx - 1, ty + 1) ? 64 : 0) | (pred(tx + 1, ty + 1) ? 128 : 0);
  // 縁石は街の外と水の縁だけ。草地との境は縁石を置かず、石が草へ不ぞろいに消えていく（基準 target-town.png の通りの縁）
  const kerbable = (x, y) => { const t = tcl(x, y); return (t === TO || t === TW) && !footAt(x, y); };
  const isGrassT = (x, y) => tcl(x, y) === TG && !footAt(x, y);
  const notPlaza = (x, y) => tcl(x, y) !== TP;
  const isDirt = (x, y) => tcl(x, y) === TD;
  const isStreet = (x, y) => tcl(x, y) === TS && !footAt(x, y);
  const isWater = (x, y) => tcl(x, y) === TW;
  const kerbM = new Uint8Array(cols * rows), plazaM = new Uint8Array(cols * rows), dirtM = new Uint8Array(cols * rows);
  const streetM = new Uint8Array(cols * rows), waterM = new Uint8Array(cols * rows), grassM = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (tc[i] === TS) kerbM[i] = nmask(x, y, kerbable);
    if (tc[i] === TP) plazaM[i] = nmask(x, y, notPlaza);
    dirtM[i] = nmask(x, y, isDirt); streetM[i] = nmask(x, y, isStreet); waterM[i] = nmask(x, y, isWater); grassM[i] = nmask(x, y, isGrassT);
  }
  Object.assign(S, { tc, footT, cx_, cy_, tcl, footAt, canalCells, canalTile, canalAtPx, orient, runAlong, crossStart, crossLen, kerbM, plazaM, dirtM, streetM, waterM, grassM });
}
