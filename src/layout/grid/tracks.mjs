import { STREET } from '../constants.mjs';
import { hash32 } from '../util.mjs';

export function createTracks(S) {
  const { C, N, isRoad, inG, plazaM, id, leaves, cx, seed, road, pieces, hall, cols, need, maxH, harbour, quay, rows, addPiece, dockAt, plaza, kx0, kx1, px0, px1, fac } = S;
  // ---- 建物を置く面（街区の下の端）
  const foot = new Int32Array(N).fill(-1), roofZ = new Uint8Array(N), front = new Uint8Array(N);
  const walkRoad = (x, y) => isRoad(x, y) || (inG(x, y) && plazaM[id(x, y)]);
  const tracks = [];
  for (const L of leaves) {
    if (L.green) continue;
    const sd = new Int16Array(L.x1 - L.x0 + 1).fill(-1);
    let any = false;
    // 列ごとに、街区の中（小さな広場）か下の端の先にある最初の通り
    for (let x = L.x0; x <= L.x1; x++) {
      for (let y = Math.min(L.y1 + 1, L.y0 + 6); y <= L.y1 + 4; y++) {
        if (!inG(x, y)) break;
        if (walkRoad(x, y)) { sd[x - L.x0] = y; any = true; break; }
      }
    }
    if (!any) continue;
    const dir = L.flank ? L.flank : (L.x0 + L.x1) / 2 < cx ? -1 : 1;
    // 並びのはじめを 0〜2 マスずらす（上下に重なる街区で家と路地が同じ列にそろわないように）
    const off = L.flank ? 0 : hash32(`start:${seed}:${L.x0},${L.y0}`) % 2;
    tracks.push({ L, sd, dir, x0: L.x0, x1: L.x1, cursor: dir < 0 ? L.x1 - off : L.x0 + off, items: [], high: false });
  }
  for (const t of tracks) {
    // H に面しているか（宿屋の場所）: 面のどこかの下が大通り
    t.high = false;
    for (let x = t.x0; x <= t.x1; x++) { const y = t.sd[x - t.x0]; if (y >= 0 && road[id(x, y)] >= 0 && pieces[road[id(x, y)]].kind === 'high') { t.high = true; break; } }
  }
  const green = new Uint8Array(N);
  for (const L of leaves) if (L.green) for (let y = L.y0; y <= L.y1; y++) for (let x = L.x0; x <= L.x1; x++) green[id(x, y)] = 1;

  // 広場の北側に、建物を続けて置くための長い frontage を用意する。
  // BSP の小さな面を順に選ぶだけでは建物が街全体へ散るため、役場の上側に
  // 数本の決まった通りを引き、通常の面選択より先にこの列を埋める。
  const denseTracks = [];
  if (hall) {
    const denseX0 = Math.min(3, cols - 2), denseX1 = Math.max(denseX0, cols - 4);
    const denseWidth = denseX1 - denseX0 + 1;
    const rowCount = Math.max(2, Math.ceil((need + 5) / Math.max(12, denseWidth - 10)));
    const rowStep = Math.max(8, maxH + 3);
    const addDenseRow = (yb, flags = {}) => {
      const streetY = yb + 1;
      if (harbour && yb >= quay.top) return false;
      if (streetY < 2 || yb - maxH - 5 < 1 || streetY > rows - 2) return false;
      addPiece('h', denseX0, streetY, denseX1, streetY, STREET, 'dense');
      const L = { x0: denseX0, x1: denseX1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true };
      const sd = new Int16Array(L.x1 - L.x0 + 1).fill(streetY);
      denseTracks.push({ L, sd, dir: 1, x0: L.x0, x1: L.x1, cursor: L.x0, items: [], high: false, dense: true, ...flags });
      return true;
    };
    let made = 0;
    // 船着場がある街では、その手前の建物列も先に一列埋める。
    // 水辺だけが遠くに孤立して、占有領域を広げるのを防ぐ。
    if (dockAt && addDenseRow(dockAt.y - rowStep)) made++;
    for (let i = 0; i < rowCount && made < rowCount; i++) {
      if (addDenseRow(hall.yb - rowStep - i * rowStep)) made++;
    }
    // 北側が上端に届いた小さな街では、広場の南側にも同じ面を続ける。
    // 役場の左右を崩さず、残りの建物だけを別の長い通りへ受け渡す。
    for (let i = 0; made < rowCount && i < rowCount; i++) {
      if (addDenseRow(plaza.y1 + rowStep + i * rowStep)) made++;
    }
  } else {
    // 役場のない街も広場の北辺から建物を続けて置く。
    // 通常のBSP面だけに任せると、修理小屋・見張り台を外縁へ置いたあと
    // 広場の四辺が草地になり、小さな街でも空いた街区が長く残る。
    const yb = plaza.y0 - 1, streetY = plaza.y0;
    const x0 = Math.max(1, kx0), x1 = Math.min(cols - 2, kx1);
    if (x1 >= x0 && yb - maxH - 5 >= 1) {
      const L = { x0, x1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: true, dense: true, plaza: true };
      const sd = new Int16Array(x1 - x0 + 1).fill(streetY);
      denseTracks.push({ L, sd, dir: 1, x0, x1, cursor: x0, items: [], high: false, dense: true, plaza: true });
    }
    const addCompactRow = (rowYb, flags = {}) => {
      const rowStreet = rowYb + 1;
      if (rowStreet < 2 || rowYb - maxH - 2 < 0 || rowStreet > rows - 2) return false;
      addPiece('h', x0, rowStreet, x1, rowStreet, STREET, 'dense');
      const L = { x0, x1, y0: Math.max(1, rowYb - maxH - 8), y1: rowYb, closedTop: false, dense: true };
      const sd = new Int16Array(x1 - x0 + 1).fill(rowStreet);
      denseTracks.push({ L, sd, dir: 1, x0, x1, cursor: x0, items: [], high: false, dense: true, ...flags });
      return true;
    };
    const rowStep = C.count <= 10 ? Math.max(5, maxH) : Math.max(6, maxH + 1);
    const rowCount = Math.max(1, Math.ceil((need + 5) / Math.max(12, x1 - x0 + 1 - 10)));
    for (let i = 0; i < rowCount; i++) addCompactRow(plaza.y0 - 1 - rowStep * (i + 1), i === 0 ? { compactOuter: true } : {});
    addCompactRow(plaza.y1 + rowStep, { compactOuter: true });
  }
  // 港では、船着場と同じ岸の通りに向く一列を最優先で埋める。
  // BSPの面を先に選ぶと南の街区が森の前へ散るため、岸の両端から
  // 建物を続けて置き、船着場の左右も同じ frontage に渡す。
  if (harbour && quay) {
    const x0 = 1, x1 = cols - 2, yb = quay.top - 1, streetY = quay.top;
    const L = { x0, x1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true, harbour: true };
    const sd = new Int16Array(x1 - x0 + 1).fill(streetY);
    denseTracks.unshift({
      L, sd, dir: 1, x0, x1, cursor: x0, items: [], high: false, dense: true, harbour: true,
    });
  }
  // 広場の東西にも短い dense track を置く。南向きの扉は広場の外側へ向けたまま、
  // footprint の側面が広場に接するので、広場を挟んだ上下の列だけで街を広げない。
  if (!harbour) {
    const sideTracks = [];
    const addPlazaSide = (side, offset = 0) => {
      let sx0 = side < 0 ? 1 : Math.min(cols - 2, px1 + 1);
      let sx1 = side < 0 ? Math.min(cols - 2, px0 - 1) : cols - 2;
      // 宿屋を compact frontage に置く街では、入口側の7マスを先に空ける。
      // 通常の家並みがその予約を埋めないので、宿屋を広場の直近へ置ける。
      if (offset === 0 && fac.inn && side === fac.innSide) {
        if (side < 0) sx1 -= fac.inn.w;
        else sx0 += fac.inn.w;
      }
      if (sx1 - sx0 + 1 < 5) return;
      const yb = plaza.y1 + offset, streetY = yb + 1;
      const L = { x0: sx0, x1: sx1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true, plazaSide: side };
      const sd = new Int16Array(sx1 - sx0 + 1).fill(streetY);
      sideTracks.push({ L, sd, dir: side < 0 ? -1 : 1, x0: sx0, x1: sx1,
        cursor: side < 0 ? sx1 : sx0, items: [], high: false, dense: true, plazaSide: side });
    };
    addPlazaSide(-1);
    addPlazaSide(1);
    addPlazaSide(-1, 5);
    addPlazaSide(1, 5);
    if (fac.inn) {
      const side = fac.innSide, sx0 = side < 0 ? 1 : Math.min(cols - 2, px1 + 1), sx1 = side < 0 ? Math.min(cols - 2, px0 - 1) : cols - 2;
      if (sx1 - sx0 + 1 >= fac.inn.w) {
        const yb = plaza.y1, streetY = yb + 1;
        const L = { x0: sx0, x1: sx1, y0: Math.max(1, yb - maxH - 8), y1: yb, closedTop: false, dense: true, plazaSide: side };
        const sd = new Int16Array(sx1 - sx0 + 1).fill(streetY);
        sideTracks.unshift({ L, sd, dir: side < 0 ? -1 : 1, x0: sx0, x1: sx1,
          cursor: side < 0 ? sx1 : sx0, items: [], high: false, dense: true, plazaSide: side, innOnly: true });
      }
    }
    denseTracks.splice(Math.min(1, denseTracks.length), 0, ...sideTracks);
  }
  tracks.unshift(...denseTracks);
  Object.assign(S, { foot, roofZ, front, tracks, green, denseTracks });
}
