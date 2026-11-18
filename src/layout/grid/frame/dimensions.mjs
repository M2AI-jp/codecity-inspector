import { MARGIN } from '../../constants.mjs';
import { makeRng } from '../../util.mjs';

// 寸法と乱数: 広場・港の余白を先に決め、後段へ同じ乱数生成器を渡す。
export function createFrameContext(C, scale) {
  const { groups, maxH, need, seed, fac } = C;
  const rng = makeRng(seed);
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const chance = (p) => rng() < p;
  const harbour = fac.dock ? C.harbour : null;
  // 建物の数に対して仮想格子を広げすぎない。面を順に埋めるので、
  // 旧来の大きな余白（2.4係数・固定1200）を残すと通りだけが増える。
  const harbourArea = harbour ? (C.count > 40 ? 0.16 : 0.15) : 0.22;
  const area = Math.max(140, need * (maxH + 8) * harbourArea + 100) * scale;
  const margin = C.count <= 10 ? 4 : MARGIN;
  // 面積は保ったまま横長を抑え、建物を近い列へ積める格子にする。
  const cols = Math.round(Math.sqrt(area)) + 2 * margin - (harbour ? 0 : 1) + (C.widthExtra || 0);
  // 広場を深くした分だけ縦の格子を先に確保する。後段の scale を上げて
  // 街全体を拡大すると空いた街区まで増えるため、追加分は行だけにする。
  const PR = Math.max(7, maxH + 2) + (chance(0.35) ? 1 : 0);
  const shallowPR = Math.max(4, maxH - 1);
  // 北南の門の絵は footprint より約6行高い。港以外では外縁の3行を
  // 門の候補に残す（届かない草地は finalize が街の外にする）。
  const baseRows = Math.round(Math.sqrt(area)) + 2 * margin + maxH + 4 + Math.max(0, PR - shallowPR);
  let rows = baseRows + (C.gateRows && !harbour ? 5 : 0);
  // 本線と同じ深さの広場にする。役場の段の下から南の段の壁まで歩ける面を
  // 9行前後に保ち、井戸小屋を広場の中央へ戻せる奥行きを確保する。
  const PW = fac.hall ? 12 : 10 + 2 * ri(0, 1);                       // 広場の幅（小さく、まわりを建物の正面が囲む）
  // 水辺: 大通りの南は街区 1〜3 段、その下に岸の通りと水。北へ広げる分、格子を縦に足す
  let southRows = 0, hTop;
  if (harbour) {
    const n = C.count;
    // 船着場までの南側は2〜3段の街区に収める。旧来の17〜19行は
    // 建物のない芝生と長い通りを水際まで残していたので、港の街を縦に引き延ばす。
    southRows = n <= 22 ? ri(8, 9) : n <= 70 ? ri(11, 13) : ri(22, 24);
    // 港までの水深は quay.water が確保する。余分な倍率で南北の芝生を
    // 増やすと、建物を詰めても街の内側だけが広がってしまうため、
    // 岸の通りと水面を含む最小限の余白にとどめる。
    rows = Math.round(rows * 1.1);
    hTop = rows - 1 - harbour.water - 2 - southRows - 3;
  } else hTop = Math.floor(baseRows / 2) + Math.floor(PR / 2);
  const N = cols * rows;
  const id = (x, y) => y * cols + x;
  const inG = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const cx = Math.floor(cols / 2);

  return { C, scale, groups, maxH, need, seed, fac, rng, ri, chance, harbour, margin, PR, PW, southRows, hTop, cols, rows, N, id, inG, cx };
}
