import { DIRT, GRASS } from '../constants.mjs';
import { LAWN_MAX, largestRectangle, limitLawns } from '../../lawn.mjs';
import { cmp, hash32 } from '../util.mjs';

export function finishProps(S) {
  const { placed, crop, inC, isGrass, blocked, id, foot, tryProp, N, cols, P, reserved, g, roofZ, bridgeCells, canalCells, front, plazaM, out, propArt, props } = S;
  const canalSide = new Set();
  for (const [x, y] of canalCells) for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
    if (inC(nx, ny)) canalSide.add(id(nx, ny));
  }
  // 建物の裏に続く見える芝生は1行を目安にする。屋根の cover の外側で、
  // 2行以上の裸の草地が残る列には、木・茂み・鉢を1つ置いて帯を分ける。
  // 置ける場所だけを選ぶため、通路を塞いだときは tryProp の到達性検査で戻す。
  for (const p of placed) {
    for (let dx = 0; dx < p.w; dx++) {
      const cover = p.cover?.[dx] ?? p.spec.roofRows ?? 2;
      const x = p.x + dx;
      const run = [];
      for (let y = p.y - cover - 1; y >= crop.y0; y--) {
        if (!inC(x, y) || !isGrass(x, y) || blocked[id(x, y)] || foot[id(x, y)] >= 0) break;
        run.push(y);
      }
      if (run.length < 2) continue;
      const targets = [...new Set([run[1], run[0], run[Math.floor(run.length / 2)]])];
      let placedBack = false;
      for (const y of targets) {
        for (const type of ['tree', 'bush', 'planter', 'flowerpot']) {
          if (tryProp(type, x, y)) { placedBack = true; break; }
        }
        if (placedBack) break;
      }
    }
  }

  const nearBuilding = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inC(x + dx, y + dy) && foot[id(x + dx, y + dy)] >= 0) return true; return false; };
  const GROUPS = {
    house: [['barrel', 'flowerpot', 'bush'], ['planter', 'bush', 'crate'], ['bush', 'flowerpot', 'barrel'], ['sacks', 'planter', 'bush']],
    open: [['bush', 'flowerpot', 'bush'], ['tree', 'bush', 'planter'], ['bush', 'planter', 'flowerpot'], ['tree', 'bush', 'bush']],
  };
  const SHAPES = [[[0, 0], [1, 0], [0, 1]], [[0, 0], [-1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [-1, 1]]];
  const lawnCells = (best) => {
    const mx = (best.x0 + best.x1) / 2, my = (best.y0 + best.y1) / 2;
    const cells = [];
    for (let y = best.y0; y <= best.y1; y++) for (let x = best.x0; x <= best.x1; x++) cells.push([Math.abs(x - mx) + Math.abs(y - my) + (hash32(`lawn:${x},${y}`) % 100) / 1000, x, y]);
    cells.sort((a, b) => a[0] - b[0]);
    return cells;
  };
  const placeLawnGroup = (cells) => {
    let got = 0;
    for (const [, x, y] of cells) {
      const h = hash32(`lawng:${x},${y}`);
      const set = (nearBuilding(x, y) ? GROUPS.house : GROUPS.open)[h % 4];
      const shape = SHAPES[(h >>> 3) % SHAPES.length];
      const n = 2 + ((h >>> 6) % 2);
      for (let k = 0; k < n; k++) {
        const [dx, dy] = shape[k], type = set[k];
        const px = x + dx, py = y + dy;
        if (!isGrass(px, py)) continue;
        if (tryProp(type, px, py) || (type !== 'bush' && tryProp('bush', px, py))) got++;
        else if (k === 0) break;                        // 組の最初が置けなければ次のマスへ
      }
      if (got) break;
    }
    return got;
  };

  // 何も無い芝生を割る: 基準 target-town.png の町の緑はほとんどが茂み・花・木・樽で埋まり、何も無い芝生はいちばん大きい所でも 7 マスほど。
  // 見える芝生（草地で、物が無く、建物の絵の屋根の陰（版の cover）でない所）の中で、何も無い長方形（縦横とも2マス以上）の
  // いちばん大きいものが LAWN_MAX を超えるあいだ、その長方形のまん中に2〜3個の組（建物の近くは樽・鉢・茂み、離れた所は茂み・花・木）を置く
  {
    const shade = new Uint8Array(N);
    for (const p of placed) for (let tx = 0; tx < p.w; tx++) {
      const k = p.cover ? p.cover[tx] : 2;
      for (let j = 1; j <= k; j++) if (inC(p.x + tx, p.y - j)) shade[id(p.x + tx, p.y - j)] = 1;
    }
    const skip = new Uint8Array(N);
    const lawnM = new Uint8Array(N);
    for (let iter = 0; iter < 3000; iter++) {
      for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) {
        const t = id(x, y);
        lawnM[t] = isGrass(x, y) && !blocked[t] && !shade[t] && !skip[t] ? 1 : 0;
      }
      // いちばん大きい何も無い長方形（縦横とも2マス以上）
      const best = largestRectangle(lawnM, cols, P.rows, crop);
      if (!best || best.a <= LAWN_MAX) break;
      // まん中に近いマスから、組を置ける所を探す
      const cells = lawnCells(best);
      const got = placeLawnGroup(cells);
      if (!got) {
        // 小物が歩行面を切断する細い袋小路では、無理に物を置かず
        // 1マスだけ土の小道にして芝生の帯を分ける（DIRTは歩ける）。
        let cut = false;
        for (let y = best.y0; y <= best.y1 && !cut; y++) for (let x = best.x0; x <= best.x1; x++) {
          if (!isGrass(x, y) || blocked[id(x, y)] || reserved[id(x, y)] || foot[id(x, y)] >= 0 || canalSide.has(id(x, y))) continue;
          g[id(x, y)] = DIRT;
          cut = true;
          break;
        }
        if (!cut) for (let y = best.y0; y <= best.y1; y++) for (let x = best.x0; x <= best.x1; x++) skip[id(x, y)] = 1;   // 予約地は最後の finishLawn でもう一度測る
      }
    }
  }
  // 従来の土道の見た目を保つため、この補助処理の対象と64回は変えない。
  // 小物の占有を含めた最終上限は、Town を組み立てた後の finishLawn で保証する。
  {
    const lawnM = new Uint8Array(N);
    const bare = (x, y) => inC(x, y) && g[id(x, y)] === GRASS && foot[id(x, y)] < 0 && !roofZ[id(x, y)];
    for (let iter = 0; iter < 64; iter++) {
      for (let y = crop.y0; y <= crop.y1; y++) for (let x = crop.x0; x <= crop.x1; x++) lawnM[id(x, y)] = bare(x, y) ? 1 : 0;
      const best = largestRectangle(lawnM, cols, P.rows, crop);
      if (!best || best.a <= LAWN_MAX) break;
      let x = Math.floor((best.x0 + best.x1) / 2), y = Math.floor((best.y0 + best.y1) / 2);
      if (canalSide.has(id(x, y))) {
        const safe = lawnCells(best).find(([, xx, yy]) => bare(xx, yy) && !canalSide.has(id(xx, yy)));
        if (!safe) break;
        [, x, y] = safe;
      }
      if (!bare(x, y)) break;
      g[id(x, y)] = DIRT;
    }
  }
  // 裸芝生を割るための土の小道が、水路の脇へあとから戻らないようにする。
  // 橋の deck の取り付け道は除外する。
  const bridgeCellSet = new Set(bridgeCells.map(([x, y]) => id(x, y)));
  for (const [x, y] of canalCells) {
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inC(nx, ny)) continue;
      const k = id(nx, ny);
      if (!bridgeCellSet.has(k) && g[k] === DIRT && P.road[k] < 0 && foot[k] < 0 && !front[k] && !plazaM[k]) g[k] = GRASS;
    }
  }

  // 切り出し・水路脇の草地復元も済んだ最終 Town を、CLI と同じ定義で検査する。
  // 既に8以下なら Town に一切書き込まない。小物は従来の予約・到達性検査を通す。
  out.finishLawn = (town, art) => {
    limitLawns(town, art, propArt, (rect) => {
      const cells = lawnCells({
        x0: rect.x0 + crop.x0, x1: rect.x1 + crop.x0,
        y0: rect.y0 + crop.y0, y1: rect.y1 + crop.y0,
      });
      const before = props.length;
      if (placeLawnGroup(cells)) {
        town.props.push(...props.slice(before).map((p) => ({ ...p, x: p.x - crop.x0, y: p.y - crop.y0 })));
        town.props.sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.type, b.type));
        return;
      }
      // 扉前など reserved でも、草→土は歩ける面を変えない。水路の脇に道は作らない。
      for (const [, x, y] of cells) {
        if (canalSide.has(id(x, y))) continue;
        const tx = x - crop.x0, ty = y - crop.y0;
        g[id(x, y)] = DIRT;
        town.ground[ty] = town.ground[ty].slice(0, tx) + ':' + town.ground[ty].slice(tx + 1);
        return;
      }
      // 進捗が無ければ limitLawns が理由を付けて失敗させる（上限超過を黙って返さない）。
    });
  };
  return out;
}
