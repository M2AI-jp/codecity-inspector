import { STREET } from '../constants.mjs';

export function placeHarbourProps(S) {
  const { quay, extra, propArt, rng, has, crop, g, id, props, reserved, lampAt, tryProp, foot } = S;
  // 水辺: 桟橋（水の上の歩ける板）と、もやった舟。岸の通りから南へ
  if (quay && extra.dock) {
    const dk = extra.dock;
    const piers = ['pier', 'pier-2'].filter((t) => propArt[t]?.deck);
    const doorX = dk.doorCol ?? dk.x + Math.floor(dk.w / 2);
    const spots = [doorX + 2 + (rng() < 0.5 ? 0 : 1), doorX - 4 - Math.floor(rng() * 2), doorX + 9 + Math.floor(rng() * 3)];
    const used = [];
    let boatDone = !has('boat');
    for (let i = 0; i < spots.length && used.filter((u) => u[2]).length < 2 && piers.length; i++) {
      const look = piers[used.filter((u) => u[2]).length % piers.length];
      const d = propArt[look].deck;
      // 板は岸壁の石の上の 4px を見せて始める（歩けるつながりは web/world.js が岸の行につなぐ）
      const qb = quay.qt[spots[i]] + 1;                // その列の岸の通りの下の行
      const fx = spots[i] * 16 + 8, fy = (qb + 1) * 16 + 4 - d[1];
      const dx0 = Math.floor((fx + d[0]) / 16), dx1 = Math.floor((fx + d[0] + d[2] - 1) / 16);
      const dy1 = Math.floor((fy + d[1] + d[3] - 1) / 16);
      if (dy1 > crop.y1 - 1 || dx0 < crop.x0 + 1 || dx1 > crop.x1 - 1) continue;
      let ok = true;
      for (let x = dx0 - 1; x <= dx1 + 1 && ok; x++) if (quay.qt[x] + 1 !== qb || g[id(x, qb)] !== STREET || used.some(([a, b]) => x >= a - 1 && x <= b + 1)) ok = false;
      if (!ok) continue;
      used.push([dx0, dx1, true]);
      props.push({ type: 'pier', x: fx / 16, y: fy / 16, look });
      for (let x = dx0; x <= dx1; x++) reserved[id(x, qb)] = 1;
      lampAt([[dx0 - 1, qb], [dx1 + 1, qb]], 3);
      // 舟: 最初の桟橋の杭にぴったりもやう（板の中ほどの高さ）
      if (!boatDone) {
        const bs = propArt.boat?.solid || [-24, -17, 48, 18];
        const side = spots[1] < spots[0] ? 1 : -1;                    // 次の桟橋と反対の側
        const half = Math.round(propArt[look].deck[2] / 2) + 7;        // 板の幅の半分 + 杭
        // 舟の絵の船体は絵の幅より細いので、杭に少しかかるまで寄せる
        const bx = side < 0 ? fx - half - (bs[0] + bs[2]) + 9 : fx + half - bs[0] - 9;
        const by = fy + d[1] + Math.round(d[3] * 0.55) - (bs[1] + Math.round(bs[3] / 2));
        const bl = Math.floor((bx + bs[0]) / 16), br = Math.floor((bx + bs[0] + bs[2] - 1) / 16);
        if (bl >= crop.x0 + 1 && br <= crop.x1 - 1 && by / 16 <= crop.y1 + 0.7) {
          props.push({ type: 'boat', x: bx / 16, y: by / 16 });
          used.push([bl, br, false]);
          boatDone = true;
        }
      }
    }
    // 岸の通りにも荷物を寄せる。桟橋の間隔を空け、歩く列は残す。
    const clutter = ['barrel', 'crate', 'sacks'].filter((type) => has(type));
    for (let x = quay.keep[0] + 2, i = 0; x <= quay.keep[1] - 2 && clutter.length; x += 4, i++) {
      const qt = Number.isFinite(quay.qt[x]) ? quay.qt[x] : quay.top;
      tryProp(clutter[i % clutter.length], x, qt + 1);
    }
    // 水際 frontage に建物を並べきれない列は、森ではなく荷物で埋める。
    // 建物の扉列（footprint直下の歩行列）は reserved のまま残す。
    const frontage = clutter.length ? clutter : (has('fence') ? ['fence'] : []);
    for (let x = quay.keep[0] + 1, i = 0; x <= quay.keep[1] - 1 && frontage.length; x += 3, i++) {
      const y = quay.top - 1;
      if (foot[id(x, y)] >= 0) continue;
      for (const type of [frontage[i % frontage.length], ...frontage]) {
        if (tryProp(type, x, y)) break;
      }
    }
    // 岸の通りの街灯: 桟橋から離れた所に少しだけ
    if (quay.keep) for (let x = quay.keep[0] + 3; x <= quay.keep[1] - 3; x += 3) lampAt([[x, quay.qt[x] + 1]], 18);
  }
}
