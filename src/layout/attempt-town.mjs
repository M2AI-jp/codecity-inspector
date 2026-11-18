import { CH, CROWD_CAP, RECENT_DAYS, clamp } from './constants.mjs';
import { cmp, hash32 } from './util.mjs';

// 格子座標を町の座標へ移し、Town の配列・プロパティの書き出し順を保つ。
export function writeAttemptTown(S) {
  const { F, P, variantOf, repo, goalSpec, opts, plot, canal, placedProps, unplaced, spawn } = S;
  const { x0, y0, x1, y1 } = F.crop;
  const ground = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += CH[F.g[P.id(x, y)]];
    ground.push(s);
  }
  const buildings = P.placed.filter((p) => !p.spec.goalSite).map((p) => ({
    id: p.spec.id,
    archetype: p.spec.archetype,
    ...(variantOf.get(p) ? { variant: variantOf.get(p).id } : {}),
    x: p.x - x0, y: p.y - y0, w: p.w, h: p.h,
    // 扉の列は版の絵で決まる（footprint の下の2行は端から端まで歩けるようにしてある）
    door: { x: p.x - x0 + clamp(variantOf.get(p)?.doorX ?? p.spec.doorDx, 0, p.w - 1), y: p.yb - y0 },
    district: p.spec.district,
    module: p.spec.module,
    ...(p.spec.facility ? { facility: p.spec.facility } : {}),
  })).sort((a, b) => cmp(a.id[0], b.id[0]) || Number(a.id.slice(1)) - Number(b.id.slice(1)));

  // 住人: コミットの多い順に最大24人。家は、その人がよく触ったモジュールの建物
  const idOf = new Map();
  for (const b of buildings) {
    if (!b.facility) idOf.set(b.module.path, b.id);
    for (const m of b.module.merged || []) idOf.set(m, b.id);
  }
  const residents = (repo.contributors || []).slice(0, 24).map((c, i) => {
    const homes = [];
    for (const m of c.modules || []) {
      const hid = idOf.get(m);
      if (hid && !homes.includes(hid)) homes.push(hid);
      if (homes.length >= 3) break;
    }
    return { id: `r${i + 1}`, name: c.name, commits: c.commits, homes, look: hash32(c.name) % 16, lastCommit: c.lastCommit ?? null };
  });

  // 常連（街を歩くモブ）: 建物ごとに0〜2人。最近（最新コミットまでの90日）よく手が入る所ほど多い。廃屋には来ない
  const active = buildings.filter((b) => b.module.kind !== 'ruin' && b.module.recent > 0);
  const top = Math.max(1, ...active.map((b) => b.module.recent));
  const slotsC = [];
  for (const b of active) {
    slotsC.push({ b, k: 0 });
    if (b.module.recent / top >= 0.35 && b.module.recent >= 3) slotsC.push({ b, k: 1 });
  }
  slotsC.sort((p, q) => p.k - q.k || q.b.module.recent - p.b.module.recent || cmp(p.b.id, q.b.id));
  const crowd = slotsC.slice(0, CROWD_CAP).sort((p, q) => cmp(p.b.id, q.b.id) || p.k - q.k)
    .map(({ b, k }, i) => ({ id: `c${i + 1}`, home: b.id, look: hash32(`crowd:${b.id}:${k}`) % 16, fact: k }));

  const shift = (o) => ({ ...o, x: o.x - x0, y: o.y - y0 });
  const town = {
    version: 1,
    repo: { name: repo.name, head: repo.head ?? null, branch: repo.branch ?? null, readme: repo.readme ?? null,
      latestCommitDate: repo.latestCommitDate ?? null, recentDays: RECENT_DAYS },
    tile: 16,
    cols: x1 - x0 + 1,
    rows: y1 - y0 + 1,
    ground,
    ...(goalSpec && P.placed.some((p) => p.spec.goalSite) ? {
      goalSite: (() => {
        const p = P.placed.find((p) => p.spec.goalSite);
        return { look: opts.goalLook, x: p.x - x0 + 1 + plot.w / 2, y: p.y - y0 + plot.h };
      })(),
    } : {}),
    ...(canal?.cells?.length ? {
      canal: {
        cells: canal.cells.map(([x, y]) => [x - x0, y - y0]),
        from: canal.from,
        past: canal.past,
        to: canal.to,
        crossings: canal.crossings.map((c) => ({ ...c, x: c.x - x0, y: c.y - y0 })),
      },
    } : {}),
    buildings,
    props: placedProps.props.map(shift).sort((a, b) => a.y - b.y || a.x - b.x || cmp(a.type, b.type)),
    landmarks: placedProps.landmarks.map((l) => ({ ...shift(l), keeper: shift(l.keeper) })),
    ...(unplaced.length ? { unplaced } : {}),
    // 段: 上の面（歩ける）は x..x+w-1 × y..y+h-1、前の壁は y+h 行（階段の所だけ歩ける）
    terraces: P.terraces.map((t) => ({ x: t.x - x0, y: t.y - y0, w: t.w, h: t.h })),
    stairs: P.terraces.map((t) => ({ x: t.stair.x - x0, y: t.y + t.h - y0, w: t.stair.w })),
    residents,
    crowd,
    spawn: { x: spawn.x - x0, y: spawn.y - y0 },
  };
  Object.assign(S, { buildings, town });
}
