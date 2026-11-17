import { OUT } from '../constants.mjs';
import { propTiles } from '../manifest.mjs';

export function adjustBridges(S) {
  const { bridgeProps, deckBounds, quay, inC, id, foot, placed, inG, road, pieces, crossings, canalCells, cols, rows, original, cellSet, paved, bridgeCells, bridgeDeckCells, addDeckTiles, mouthProps, propArt, dirs, firstState } = S;
  // 横橋の deck の片側から2セル以内を同じ通常建物が全行ふさいでいる
  // 場合だけ、その建物セルを次の建物配置で予約する。1行だけの接触は
  // 歩行可能なので予約せず、密な街の外枠を広げない。縦橋は deck の
  // 半端丸めを補正済み。
  const bridgeSideReserve = new Set();
  for (const p of bridgeProps) {
    if (p.type !== 'bridge-h') continue;
    const { x0, y0, x1, y1 } = deckBounds(p.type, p.x, p.y);
    const sideXs = quay ? [x0 - 1, x0 - 2, x1 + 1, x1 + 2] : [x0 - 1, x1 + 1];
    for (const x of sideXs) {
      const ks = [];
      for (let y = y0; y <= y1; y++) if (inC(x, y)) ks.push(id(x, y));
      if (ks.length && ks.some((k) => foot[k] >= 0 && !placed[foot[k]]?.spec.facility)) {
        for (const k of ks) bridgeSideReserve.add(k);
      }
    }
  }
  // 水路の中心が元の舗装セルでなくても、幅のある通りの両側に沿って
  // 横断している場合がある。橋の無い並走を残さないよう、その交差部に
  // deck が収まる道路行を探して橋と crossing の中心を同じ行へ寄せる。
  const touchesPerpendicularRoad = (x, y, flow) => {
    const sides = flow === 'v' ? [[x - 1, y], [x + 1, y]] : [[x, y - 1], [x, y + 1]];
    return sides.some(([nx, ny]) => {
      if (!inG(nx, ny)) return false;
      const k = id(nx, ny), r = road[k];
      return r >= 0 && pieces[r]?.kind !== 'dense';
    });
  };
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i], p = bridgeProps[i];
    if (c.road !== 'h' || !p) continue;
    const bad = canalCells.filter(([x, y]) => {
      return Math.abs(x - c.x) <= 2 && Math.abs(y - c.y) <= 5 &&
        Math.abs(x - c.x) + Math.abs(y - c.y) > 2 && touchesPerpendicularRoad(x, y, 'v');
    });
    if (!bad.length) continue;
    const choices = [];
    for (let dy = -3; dy <= 3; dy++) {
      if (!dy) continue;
      const candidatePy = p.y + dy, b = deckBounds('bridge-h', p.x, candidatePy);
      if (b.x0 < 0 || b.y0 < 0 || b.x1 >= cols || b.y1 >= rows) continue;
      let clear = true;
      for (let y = b.y0; y <= b.y1 && clear; y++) for (let x = b.x0; x <= b.x1; x++) {
        if (!inC(x, y) || original[id(x, y)] === OUT || foot[id(x, y)] >= 0) { clear = false; break; }
      }
      if (!clear) continue;
      const ysOnDeck = [];
      for (let y = b.y0; y <= b.y1; y++) {
        const k = id(c.x, y);
        if (cellSet.has(k) && paved(id(b.x0, y)) && paved(id(b.x1, y))) ysOnDeck.push(y);
      }
      for (const cy of ysOnDeck) {
        const maxDistance = Math.max(...bad.map(([x, y]) => Math.abs(x - c.x) + Math.abs(y - cy)));
        if (maxDistance > 2) continue;
        let blocked = 0;
        for (const x of [b.x0 - 1, b.x1 + 1]) for (let y = b.y0; y <= b.y1; y++) {
          if (inC(x, y) && foot[id(x, y)] >= 0) blocked++;
        }
        choices.push({ py: candidatePy, cy, maxDistance, blocked, distance: Math.abs(dy) });
      }
    }
    choices.sort((a, b) => a.maxDistance - b.maxDistance || a.blocked - b.blocked || a.distance - b.distance || a.py - b.py);
    if (choices[0]) {
      p.y = choices[0].py;
      c.y = choices[0].cy;
    }
  }
  // 補正後の deck だけを橋の予約帯として使う。
  bridgeCells.clear();
  bridgeDeckCells.clear();
  for (const p of bridgeProps) addDeckTiles(p.type, p.x, p.y);
  // 始点直下の通りに橋がかかる場合、口の絵を同じ水路の次のセルへ
  // ずらす。口は水路の端を示し続けるが、橋の deck と小物が重ならない。
  if (mouthProps.length) {
    const [mw, mh] = propTiles('canal-mouth', propArt);
    const mouthTilesAt = (p) => {
      const tx = Math.floor(p.x - mw / 2 + 0.5), ty = Math.round(p.y - mh);
      const out = [];
      for (let dy = 0; dy < mh; dy++) for (let dx = 0; dx < mw; dx++) out.push([tx + dx, ty + dy]);
      return out;
    };
    const isMouthCandidate = (p) => {
      const tiles = mouthTilesAt(p);
      return tiles.every(([x, y]) => inC(x, y) && !bridgeDeckCells.has(id(x, y)) && foot[id(x, y)] < 0) &&
        tiles.some(([x, y]) => cellSet.has(id(x, y)));
    };
    const mouth = mouthProps[0];
    if (!isMouthCandidate(mouth)) {
      const dir = dirs[firstState.d];
      const side = [-dir[1], dir[0]];
      const candidates = [];
      for (let n = 1; n <= 8; n++) {
        candidates.push({ x: mouth.x + dir[0] * n, y: mouth.y + dir[1] * n, n, side: 0 });
        candidates.push({ x: mouth.x + side[0] * n, y: mouth.y + side[1] * n, n, side: 1 });
        candidates.push({ x: mouth.x - side[0] * n, y: mouth.y - side[1] * n, n, side: 2 });
      }
      const next = candidates.find(isMouthCandidate);
      if (next) { mouth.x = next.x; mouth.y = next.y; }
    }
  }
  Object.assign(S, { bridgeSideReserve });
}
