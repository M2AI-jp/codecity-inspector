// 段と階段。岸壁・運河の上に共通の石垣と踏み石を重ねる。
import { T } from './constants.mjs';
import { lumOf } from './texture-analysis.mjs';

export function paintTerraces(S) {
  const { town, masonry } = S;
  const { PMEAN, PLZ } = S.X;
  // ---- 4d. 段（town.terraces / town.stairs）: 一段高い面の南の行（y+h）は石垣の前面、両端に柱。
  //      前面は 16px: 笠石 5px（光る上の縁・明るい上面・前の面・下の影）と、切り石 2 段（1 個ずつ、左上が明るく右下が暗い）、足もとの影。
  //      階段の列は石段 4 段（踏み面・段鼻・蹴上げ）と両脇の袖柱。東西の縁は笠石の縁石で、東の低い地面へ影を落とす。
  //      石の地の色と粒は wall.png（無ければ広場の石）。どの地面の文字の上でも描く（歩けるかどうかは web/world.js）。
  if ((town.terraces || []).length) {
    const { inMap, mul, put, blockAt, STONE, MORTAR, grimeAt } = masonry;
    // 前面の 1 画素（ly 0..15）
    const wallPx = (x, y, ly) => {
      if (ly <= 4) {                                                            // 笠石
        const b = blockAt(x * 0.62, 9);
        if (b.lx === 0 && ly <= 3) { put(x, y, MORTAR, 1.2); return; }
        const k = ly === 0 ? 1.42 : ly <= 2 ? 1.22 : ly === 3 ? 0.72 : 0.26;
        STONE(x, y, b.key + 900, k * (b.lx === 1 && ly < 3 ? 1.08 : 1));
        return;
      }
      if (ly === 15) { STONE(x, y, 5, 0.34); return; }                          // 足もとの暗い線
      const course = ly < 10 ? 0 : 1, r = ly - (course ? 10 : 5);              // 段の中の行 0..4
      const b = blockAt(x, course);
      if (r === 4 || b.lx === 0) { put(x, y, MORTAR, grimeAt(x, y)); return; }  // 目地
      let k = 1.0;
      if (r === 0) k = 1.32;                                                    // 上の縁
      else if (r === 3) k = 0.86;                                               // 下の縁
      if (b.lx === 1) k *= 1.18;                                                // 左の縁
      else if (b.lx === b.len - 1) k *= 0.82;                                   // 右の縁
      STONE(x, y, b.key, k * (course ? 0.92 : 1.0));
    };
    // 石段の 1 画素: 石垣から手前へ 8px 張り出す 4 段。ly は 0..23。
    // gridhub の試作 r4 と同じ 6px 周期（明るい踏み面 3px・段鼻 1px・暗い蹴上げ 2px）。
    const SD = 24;
    const plazaL = 0.299 * PMEAN[0] + 0.587 * PMEAN[1] + 0.114 * PMEAN[2];
    const stairPx = (x, y, ly, sx0, sx1) => {
      const step = Math.floor(ly / 6), row = ly % 6;
      const bx = (x - sx0) * 0.3 + step * 5, b = blockAt(bx, 20 + step);
      let k = [1.55, 1.72, 1.67, 1.9, 0.66, 0.5][row];
      if (row < 3 && b.key !== blockAt(bx - 0.3, 20 + step).key) k *= 0.87;       // 横長の踏み石の継ぎ目は 1px
      if (x - sx0 < 2) k *= 0.82;
      if (sx1 - x < 5) k *= 0.65;                                              // 東の袖に沿う連続した影
      // 壁の積み石模様を踏み面に持ち込まず、広場の粒だけを弱めて使う。色・石ごとの明暗は STONE のまま。
      const q = (((y + step * 11) % PLZ.height) * PLZ.width + (x % PLZ.width)) * 4;
      const surfaceGrain = 0.9 + 0.18 * Math.min(1.5, lumOf(PLZ.data, q) / Math.max(1, plazaL));
      STONE(x, y, b.key + 400, k * (1 - 0.015 * step), surfaceGrain);
    };
    // 柱: 上に 4px 突き出た笠石、左の面は明るく右の面は暗い
    const post = (px0, w, fy) => {
      const key = px0 * 13 + 3;
      for (let y = fy - 4; y < fy + T; y++) for (let i = 0; i < w; i++) {
        const x = px0 + i, ly = y - fy;
        let k;
        if (ly < 0) k = (ly === -4 ? 1.45 : ly === -1 ? 0.9 : 1.26) * (i === 0 ? 1.06 : i === w - 1 ? 0.84 : 1);
        else if (ly === 0) k = 0.42;
        else if (ly === 15) k = 0.34;
        else { k = i === 0 ? 1.28 : i === w - 1 ? 0.6 : 1.04; if (ly === 7 || ly === 11) k *= 0.5; }
        if ((i === w - 1 && ly < 0) || (i === w - 1 && ly > 0)) k *= 0.85;
        STONE(x, y, key, k);
      }
      for (let y = fy - 3; y < fy + T; y++) mul(px0 + w, y, 0.66);         // 柱の右の影
    };
    const STAIRS = town.stairs || [];
    for (const t of town.terraces) {
      const fy = (t.y + t.h) * T, x0 = t.x * T, x1 = (t.x + t.w) * T;
      // 東西の縁（一段高い面の内側 3px の縁石）と、外の低い地面の影（光は左上から: 東へ落ちる）
      for (let y = t.y * T; y < fy + T; y++) {
        if (y < fy) for (let j = 0; j < 3; j++) {
          const bw = blockAt(y * 0.8, 30), be = blockAt(y * 0.8, 31);
          if (bw.lx === 0) put(x0 + j, y, MORTAR, 1.3); else STONE(x0 + j, y, bw.key + 700, [1.36, 1.2, 1.0][j]);
          if (be.lx === 0) put(x1 - 1 - j, y, MORTAR, 1.3); else STONE(x1 - 1 - j, y, be.key + 800, [0.62, 0.95, 1.15][j]);
        }
        mul(x0 - 1, y, 0.82);
        for (let d = 0; d < 4; d++) mul(x1 + d, y, [0.56, 0.66, 0.78, 0.9][d]);
      }
      // 前面の行
      const stairsHere = STAIRS.filter((s) => s.y === t.y + t.h && s.x < t.x + t.w && s.x + s.w > t.x);
      for (let x = x0; x < x1; x++) {
        const s = stairsHere.find((q) => x >= q.x * T && x < (q.x + q.w) * T);
        for (let ly = 0; ly < (s ? SD : T); ly++) {
          const y = fy + ly;
          if (!inMap(x, y)) continue;
          if (s) stairPx(x, y, ly, s.x * T, (s.x + s.w) * T); else wallPx(x, y, ly);
        }
        // 足もとの影（低い地面）
        const fb = fy + (s ? SD : T);
        mul(x, fb, 0.55); mul(x, fb + 1, 0.72); mul(x, fb + 2, 0.88);
      }
      for (let x = x1; x < x1 + 3; x++) { mul(x, fy + T, 0.55); mul(x, fy + T + 1, 0.72); mul(x, fy + T + 2, 0.88); }
      // 張り出した石段の右の影
      for (const s of stairsHere) for (let y = fy + T; y < fy + SD + 2; y++) { mul((s.x + s.w) * T, y, 0.6); mul((s.x + s.w) * T + 1, y, 0.8); }
      // 柱: 前面の両端と、階段の両脇
      post(x0, 5, fy);
      post(x1 - 5, 5, fy);
      for (const s of stairsHere) {
        const sx0 = s.x * T, sx1 = (s.x + s.w) * T;
        if (sx0 - 5 >= x0) post(sx0 - 5, 5, fy);
        if (sx1 + 5 <= x1) post(sx1, 5, fy);
        // 両脇の袖石を最下段まで伸ばし、上面・側面と東側の落ち影で階段の奥行きを示す。
        for (let ly = 0; ly < SD; ly++) for (let d = 0; d < 4; d++) {
          const k = d === 0 ? 1.52 : d === 1 ? 1.24 : 0.65, course = Math.floor(ly / 6);
          if (sx0 - 5 >= x0) STONE(sx0 - 4 + d, fy + ly, 1800 + course, k);
          if (sx1 + 5 <= x1) {
            STONE(sx1 + d, fy + ly, 1900 + course, k * 0.88);
            if (d < 2) mul(sx1 + 4 + d, fy + ly, d === 0 ? 0.52 : 0.76);
          }
        }
      }
    }
  }

}
