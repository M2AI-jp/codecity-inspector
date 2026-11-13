// RepoModel → Town（CONTRACTS.md）。同じ RepoModel（と同じ art manifest）からは常に同じ街ができる。
//
// 街のつくり（古い街並み。通りは街の端から端まで通さない）:
//   - 骨組み: 中央の広場（角に植え込み、役場の前は広場の石が通りまで張り出す）、広場の南の大通り（東西、
//     ゆるく曲がり段差がある）、広場の北の通り、広場の両わきの南北の通り、役場の脇から北へ・大通りから南へ
//     の南北の通り（北と南で位置がずれるので十字路にならない）。
//   - その外側の地区を、通りで切り分けていく（BSP）。南北・東西の切れ目は地区ごとに位置が違い、
//     通りは T 字に突き当たり、ところどころ1行ずれる。街区の深さと幅は毎回違い、深い街区には土の路地
//     （ときどき途中で行き止まり）、広い街区には南北の小路が抜ける。小さな街区のいくつかは小さな緑地。
//   - 建物は3/4見下ろしなので扉は必ず南。footprint のすぐ下の1行は端から端まで歩ける地面（通り・前庭）。
//     footprint の上は版ごとの cover だけを屋根の余白にし、同じ通りの隣は壁を接して置ける。
//   - 建物は広場に近い所から埋まり、地区（最上位ディレクトリ）は広場のまわりに扇形に並ぶ。
//     工房は広場の南の大通りの東側に集まり、廃屋は最後に（外縁に）置く。使わなかった通りは消え、
//     街のまわりは森になる。街の外へ出る道が何本か残る。
//   - 船着場（dock）があるときは、街の南の端が水辺になる: 船着場の前の岸の通り（石の岸壁）、その下の水、
//     水に突き出た桟橋（歩ける）、もやった舟。
//   - 井戸（well）は建物ではなく、広場か近くの緑地に立つ井戸小屋（town.landmarks と props の wellhouse）。
//   - 作業中の変更がある建物（module.works.dirty > 0）には足場・工事中の札・材木を置く（絵があるときだけ）。
//
// 建物の大きさは art/game/manifest.json の archetypes[key].variants[*].footprint を使い、無ければ下の表を使う。
// props の (x, y) は、その小物が立つ足元の中心（tile単位）。1×1なら (tx + 0.5, ty + 1)。
import {
  CAP, CH, CROWD_CAP, DEFAULT_FOOT, DOOR_DX, FACILITY_NAME, LANDMARK, RECENT_DAYS, WORKSHOP_ANGLE, clamp,
} from './layout/constants.mjs';
import { aggregate, archetypes } from './layout/facilities.mjs';
import { buildCanal, chooseCanalRoute } from './layout/canal.mjs';
import { finalize } from './layout/finalize.mjs';
import { generate } from './layout/grid.mjs';
import { loadArt, loadGround, loadProps, propTiles } from './layout/manifest.mjs';
import { placeProps } from './layout/props.mjs';
import { cmp, hash32, makeRng } from './layout/util.mjs';

export { FACILITY_NAME, LANDMARK, aggregate, chooseCanalRoute, loadArt, loadProps, loadGround, propTiles };

// ---------- 本体 ----------
export function layoutTown(repo, opts = {}) {
  const seed = hash32(`${repo.name}@${repo.head ?? 'worktree'}`);
  const art = opts.art ?? loadArt();
  const propArt = opts.props ?? loadProps();
  const water = (opts.ground ?? loadGround()).includes('water');
  // 施設: 絵のあるものだけ（船着場は水の絵もあるときだけ）。施設が丸ごと覆うモジュールは、その施設の建物にまとめる（家は建てない）
  const facs = (repo.facilities || []).filter((f) => FACILITY_NAME[f.archetype] && art[f.archetype]?.footprint && (f.archetype !== 'dock' || water));
  // 外に立つ施設（井戸）: 小物の絵があるときだけ
  const lms = (repo.facilities || []).filter((f) => LANDMARK[f.archetype] && propArt[LANDMARK[f.archetype].prop]);
  const byPath = new Map((repo.modules || []).map((m) => [m.path, m]));
  const covered = new Set([...facs, ...lms].flatMap((f) => f.merged || []));
  const mods = aggregate((repo.modules || []).filter((m) => !covered.has(m.path)), CAP);
  const arch = archetypes(mods);
  // 外観の版が footprint の上を隠す行数。配置・屋根陰・芝生計測で同じ値を使う。
  const coverRowsOf = (a) => {
    const vs = a?.variants || [];
    const rows = vs.flatMap((v) => Array.isArray(v.cover) ? v.cover : []);
    return rows.length ? Math.max(0, ...rows) : 2;
  };
  const specs = mods.map((m, i) => {
    const a = arch.get(m);
    const [w, h] = art[a]?.footprint ?? DEFAULT_FOOT[a];
    const doorDx = clamp(art[a]?.doorX ?? DOOR_DX[a] ?? Math.floor((w - 1) / 2), 0, w - 1);
    return { id: `b${i + 1}`, archetype: a, w, h, doorDx, roofRows: coverRowsOf(art[a]), module: m, district: m.path === '.' ? '.' : m.path.split('/')[0] };
  });
  const facModule = (f) => {
    const merged = (f.merged || []).map((p) => byPath.get(p)).filter(Boolean);
    const languages = Object.create(null);
    let lines = 0, bytes = 0, dirty = 0;
    const top = [];
    for (const m of merged) {
      lines += m.lines; bytes += m.bytes; top.push(...(m.topFiles || []));
      dirty += m.works?.dirty || 0;
      for (const [k, v] of Object.entries(m.languages || {})) languages[k] = (languages[k] || 0) + v;
    }
    return {
      path: f.merged?.length ? f.merged[0] : f.archetype === 'town_hall' ? '.' : (f.evidence[0] || '.'),
      kind: f.archetype, reason: f.reason,
      files: merged.length ? merged.reduce((t, m) => t + m.files, 0) : f.evidenceCount, lines, bytes,
      languages: Object.fromEntries(Object.entries(languages).sort((p, q) => q[1] - p[1] || cmp(p[0], q[0]))),
      lastCommit: f.lastCommit || null, commits: f.commits || 0, recent: f.recent || 0, authors: f.authors || [],
      topFiles: top.sort((p, q) => q.lines - p.lines || cmp(p.path, q.path)).slice(0, 8),
      ...(f.merged?.length ? { merged: [...f.merged] } : {}),
      ...(dirty > 0 ? { works: { dirty } } : {}),
    };
  };
  const facilityOf = (f, name) => ({ archetype: f.archetype, name, reason: f.reason, evidence: f.evidence,
    evidenceCount: f.evidenceCount, facts: f.facts || {}, merged: f.merged || [] });
  const facSpecs = facs.map((f, i) => {
    const a = art[f.archetype];
    const [w, h] = a.footprint;
    return { id: `f${i + 1}`, archetype: f.archetype, w, h, doorDx: clamp(a.doorX ?? Math.floor((w - 1) / 2), 0, w - 1),
      module: facModule(f), facility: facilityOf(f, FACILITY_NAME[f.archetype]), sourceFacility: f,
      district: '\u0000facility', roofRows: coverRowsOf(a) };
  });
  const landmarks = lms.map((f, i) => ({ sourceFacility: f, prop: LANDMARK[f.archetype].prop, data: {
    id: `f${facSpecs.length + i + 1}`, archetype: f.archetype, name: LANDMARK[f.archetype].name, prop: LANDMARK[f.archetype].prop,
    facility: facilityOf(f, LANDMARK[f.archetype].name), module: facModule(f) } }));

  // 工房はひとまとまり、それ以外は最上位ディレクトリごとの地区
  const byKey = new Map();
  const groupOf = (key) => {
    if (!byKey.has(key)) byKey.set(key, { key, items: [], ruins: [] });
    return byKey.get(key);
  };
  for (const s of specs) {
    if (s.module.kind === 'workshop') groupOf('\u0000workshops').items.push(s);
    else if (s.module.kind === 'ruin') groupOf(s.district).ruins.push(s);
    else groupOf(s.district).items.push(s);
  }
  const demand = (g) => [...g.items, ...g.ruins].reduce((t, s) => t + s.w + 1.6, 0);
  const groups = [...byKey.values()].sort((a, b) => {
    if (a.key === '\u0000workshops') return -1;
    if (b.key === '\u0000workshops') return 1;
    return demand(b) - demand(a) || cmp(a.key, b.key);
  });
  for (const g of groups) g.items.sort((a, b) => cmp(a.district, b.district) || cmp(a.module.path, b.module.path));
  const total = groups.reduce((t, g) => t + demand(g), 0) || 1;
  let a = WORKSHOP_ANGLE - (groups[0] ? (Math.PI * demand(groups[0])) / total : 0);
  groups.forEach((g, i) => {
    g.index = i;
    g.a0 = a;
    a += (2 * Math.PI * demand(g)) / total;
    g.a1 = a;
  });

  // 施設の置き場所: 役場は広場の北、酒場は広場のきわ、宿屋は大通りの入口、道場・倉庫は別々の地区、見張り台は外縁、
  // 船着場は南の岸。修理小屋は工房の近く、工房が無ければ外縁。
  const frng = makeRng(seed ^ 0x51ed270b);
  const fac = { hall: null, pub: null, inn: null, dock: null, early: [], late: [],
    hallSide: frng() < 0.5 ? -1 : 1, pubSide: frng() < 0.5 ? -1 : 1, innSide: frng() < 0.5 ? -1 : 1 };
  const slots = [-0.95, 1.2, 2.35, -2.3].map((a) => a + (frng() - 0.5) * 0.3);
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(frng() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  for (const s of facSpecs) {
    if (s.archetype === 'town_hall') fac.hall = s;
    else if (s.archetype === 'pub') fac.pub = s;
    else if (s.archetype === 'inn') fac.inn = s;
    else if (s.archetype === 'dock') fac.dock = s;
    else if (s.archetype === 'watchtower') fac.late.push({ ...s, angle: slots.pop() ?? -Math.PI / 2 });
    else if (s.archetype === 'repair') {
      const hasWorkshop = groups.some((g) => g.key === '\u0000workshops');
      if (hasWorkshop) fac.early.push({ ...s, angle: WORKSHOP_ANGLE });
      else fac.late.push({ ...s, angle: Math.PI / 2 });
    }
    else fac.early.push({ ...s, angle: slots.pop() ?? Math.PI / 2 });
  }
  // 水の深さ: 桟橋が届く行に、岸から2行ぶんの余水を足す
  let pierRows = 0;
  for (const t of ['pier', 'pier-2']) if (propArt[t]?.deck) pierRows = Math.max(pierRows, Math.ceil(propArt[t].deck[3] / 16));
  const harbour = { water: clamp(pierRows + 2, 5, 9) };
  const all = [...specs, ...facSpecs];
  const maxH = Math.max(4, ...all.filter((s) => s !== fac.hall).map((s) => s.h));
  const need = all.reduce((t, s) => t + s.w + 1.6, 0);
  const gateRows = lms.some((l) => l.archetype === 'gate') && propArt.gate
    ? Math.ceil((propArt.gate.origin?.[1] ?? 64) / 16) : 0;
  let P = null, F = null, canal = null, lastCanalAttempt = null;
  const canalRequested = (repo.facilities || []).some((f) => f.archetype === 'well' && f.facts) &&
    !!propArt['bridge-h']?.deck && !!propArt['bridge-v']?.deck;
  const C = { groups, maxH, need, seed, fac, harbour, gateRows, count: all.length };
  for (let attempt = 0, scale = 1; attempt < 14 && !P; attempt++, scale *= 1.15) {
    // 施設ごとの置き場所の列を、試すたびに作り直す（generate は列を書き換える）
    const g2 = groups.map((g) => ({ ...g, items: [...g.items], ruins: [...g.ruins] }));
    const firstP = generate({ ...C, groups: g2, fac: { ...fac, early: [...fac.early], late: [...fac.late] } }, scale);
    if (!firstP) continue;
    let firstF = finalize(firstP, maxH, { scaffold: !!(propArt.scaffold || propArt['scaffold-2']), gateRows });
    let firstCanal = buildCanal(firstP, firstF, repo, propArt);
    if (canalRequested) {
      // 水路が先に見つかった場合も、橋の deck と両端を建物が覆わないよう
      // 水路・橋の帯を予約して、同じ格子をもう一度建物へ渡す。
      // 最初の配置で水路を置けなかったときは、建物を無視した探索で帯を作る。
      let reserve = null;
      // 先に建物を無視した港行きも試す。最初の建物配置で外向きが
      // 見つかっても、港への道筋を建物の後から奪わない。
      const openHarbour = buildCanal(firstP, firstF, repo, propArt, { ignoreBuildings: true, reserveOnly: true });
      if (openHarbour?.to === 'harbour') {
        reserve = openHarbour;
      } else if (firstCanal?.cells?.length) {
        reserve = {
          reserveCells: [
            ...firstCanal.cells,
            ...(firstCanal.bridgeReserveCells || firstCanal.bridgeDeckCells || firstCanal.bridgeCells || []),
          ],
          states: firstCanal.states,
          past: firstCanal.past,
          to: firstCanal.to,
        };
      } else {
        reserve = openHarbour;
      }
      if (reserve?.reserveCells?.length) {
        const rg = groups.map((g) => ({ ...g, items: [...g.items], ruins: [...g.ruins] }));
        const reservedP = generate({
          ...C, groups: rg, canalReserve: reserve.reserveCells,
          fac: { ...fac, early: [...fac.early], late: [...fac.late] },
        }, scale);
        if (reservedP) {
          const reservedF = finalize(reservedP, maxH, { scaffold: !!(propArt.scaffold || propArt['scaffold-2']), gateRows });
          const reservedCanal = buildCanal(reservedP, reservedF, repo, propArt, {
            forcedStates: reserve.states, forcedPast: reserve.past, forcedTo: reserve.to,
          });
          if (!reservedCanal?.unplaced && (!reserve.to || reservedCanal.to === reserve.to)) {
            P = reservedP; F = reservedF; canal = reservedCanal;
            break;
          }
        }
      }
      lastCanalAttempt = { P: firstP, F: firstF, canal: firstCanal };
      continue;
    }
    P = firstP; F = firstF; canal = firstCanal;
  }
  if (!P && lastCanalAttempt) ({ P, F, canal } = lastCanalAttempt);
  if (!P) throw new Error('layoutTown: 建物を配置できなかった');
  const gateArt = landmarks.some((l) => l.data.archetype === 'gate') && propArt.gate;
  if (opts.debug) opts.debug.P = P;                  // 調べる道具のため（通り・街区の中身）
  // 出発点は段の下の広場の最初の行（段の前の壁の上には立たせない）
  const hallT = P.terraces.find((t) => t.hall);
  const spawn = { x: P.cx, y: hallT ? hallT.y + hallT.h + 1 : P.plaza.y0 + 2 };

  // 見た目の版: 近くに同じ archetype の同じ版が並ばないように選ぶ（同じ入力からは同じ選び方）
  const variantOf = new Map();
  for (const p of [...P.placed].sort((a, b) => a.yb - b.yb || a.x - b.x)) {
    const vs = art[p.spec.archetype]?.variants || [];
    if (vs.length < 2) { if (vs.length) variantOf.set(p, vs[0]); continue; }
    const near = new Map();
    for (const [q, v] of variantOf) {
      if (q.spec.archetype !== p.spec.archetype) continue;
      const dx = Math.max(0, Math.max(q.x, p.x) - Math.min(q.x + q.w, p.x + p.w));
      const dy = Math.abs(q.yb - p.yb);
      if (dx > 14 || dy > 12) continue;
      near.set(v.id, (near.get(v.id) || 0) + (dy <= 1 ? 3 : 1) * (dx <= 3 ? 2 : 1));
    }
    const start = hash32(p.spec.id) % vs.length;
    let best = null, bn = Infinity;
    for (let k = 0; k < vs.length; k++) {
      const v = vs[(start + k) % vs.length], n = near.get(v.id) || 0;
      if (n < bn) { bn = n; best = v; }
    }
    variantOf.set(p, best);
  }
  // 同じ通りで同じ幅・同じ版の家が3軒続くと、乱数が違っても
  // 一直線の量産街に見える。配置順の隣2軒が同じ組合せなら、
  // 3軒目だけ別版へ決定的に差し替える。
  const isHouse = (p) => ['house_s', 'house_m', 'house_l'].includes(p.spec.archetype);
  for (const t of P.tracks) {
    const row = t.items
      .filter(isHouse)
      .sort((a, b) => (t.dir < 0 ? b.x - a.x : a.x - b.x) || a.yb - b.yb);
    for (let i = 2; i < row.length; i++) {
      const [a, b, p] = row.slice(i - 2, i + 1);
      const va = variantOf.get(a), vb = variantOf.get(b), vp = variantOf.get(p);
      if (!va || !vb || !vp || a.w !== b.w || b.w !== p.w || va.id !== vb.id || vb.id !== vp.id) continue;
      const vs = art[p.spec.archetype]?.variants || [];
      const start = hash32(`row-variant:${p.spec.id}`) % vs.length;
      const alt = vs.map((_, k) => vs[(start + k) % vs.length]).find((v) => v.id !== va.id && v.id !== vb.id);
      if (alt) variantOf.set(p, alt);
    }
  }
  for (const p of P.placed) {
    p.doorCol = p.x + clamp(variantOf.get(p)?.doorX ?? p.spec.doorDx, 0, p.w - 1);
    p.wall = variantOf.get(p)?.wall || [0, 0];                // 絵の壁が footprint の端から内側にある幅（px、左・右）
    p.cover = variantOf.get(p)?.cover || null;                // 屋根が footprint の上にかぶさる行の数（列ごと）
  }
  // 役場の段の階段: 版の扉の前に、扉の幅（2〜3マス、1マスの扉なら3マスで真ん中）
  for (const t of P.terraces) {
    if (!t.hall) continue;
    const hp = P.placed.find((p) => p.spec.archetype === 'town_hall');
    if (!hp) { t.drop = true; continue; }
    const dw = variantOf.get(hp)?.doorW ?? 1;
    // 基準の役場の階段は人物の背丈の約1.6倍（約2.6マス）なので3マス: 1マスの扉なら扉が真ん中、2マスの扉なら広場の中心の側へ1マス広げる
    const towardRight = hp.doorCol + 1 <= P.cx + 0.5;
    t.stair = dw >= 3 ? { x: hp.doorCol, w: dw } : dw === 2 ? { x: towardRight ? hp.doorCol : hp.doorCol - 1, w: 3 } : { x: hp.doorCol - 1, w: 3 };
    if (t.stair.x < t.x) t.stair.x = t.x;
    if (t.stair.x + t.stair.w > t.x + t.w) t.stair.x = t.x + t.w - t.stair.w;
  }
  // 広場の南階段: 広場幅に応じた4〜6マス。中央の井戸小屋を置けるよう、中央より1マス西へ寄せる。
  const plazaT = P.terraces.find((t) => t.plaza);
  if (plazaT) {
    const w = clamp(Math.round(plazaT.w / 2), 4, 6);
    const centered = plazaT.x + Math.floor((plazaT.w - w) / 2);
    plazaT.stair = { x: clamp(centered - 1, plazaT.x, plazaT.x + plazaT.w - w), w };
  }
  P.terraces = P.terraces.filter((t) => !t.drop);
  const dock = P.placed.find((p) => p.spec.archetype === 'dock');
  // 南階段の足元と前2行は、水路・橋・水口を置かない。運河を優先して
  // 置いたあと、広場内で空いている別の階段位置へ寄せる。
  const plazaTerrace = P.terraces.find((t) => t.plaza);
  if (plazaTerrace?.stair && canal?.cells?.length) {
    const stairY = plazaTerrace.y + plazaTerrace.h;
    const blocked = new Set(canal.cells.map(([x, y]) => P.id(x, y)));
    for (const [x, y] of canal.bridgeCells || []) blocked.add(P.id(x, y));
    for (const p of [...(canal.mouthProps || []), ...(canal.bridgeProps || [])]) {
      for (let y = p.y; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) {
        if (P.inG(x, y)) blocked.add(P.id(x, y));
      }
    }
    const sx0 = plazaTerrace.x, sx1 = plazaTerrace.x + plazaTerrace.w - plazaTerrace.stair.w;
    const preferred = plazaTerrace.x + Math.floor((plazaTerrace.w - plazaTerrace.stair.w) / 2);
    const choices = [];
    for (let x = sx0; x <= sx1; x++) choices.push(x);
    choices.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
    const clear = (x) => {
      for (let y = stairY - 2; y <= stairY + 2; y++) {
        for (let dx = 0; dx < plazaTerrace.stair.w; dx++) if (blocked.has(P.id(x + dx, y))) return false;
      }
      return true;
    };
    const safe = choices.find(clear);
    if (safe !== undefined) plazaTerrace.stair.x = safe;
  }
  const placedProps = placeProps(P, F, makeRng(seed ^ 0x9e3779b9), spawn, {
    propArt, landmarks, dock, bridgeProps: canal?.bridgeProps || [], mouthProps: canal?.mouthProps || [], bridgeCells: canal?.bridgeCells || [],
    canalCells: canal?.cells || [],
  });
  const placedFacilitySources = new Set(P.placed.map((p) => p.spec.sourceFacility).filter(Boolean));
  const placedLandmarkIds = new Set(placedProps.landmarks.map((l) => l.id));
  const unplaced = [];
  if (canal?.unplaced) unplaced.push(canal.unplaced);
  for (const f of repo.facilities || []) {
    const facilityName = FACILITY_NAME[f.archetype] || LANDMARK[f.archetype]?.name;
    if (!facilityName) continue;
    const landmarkIndex = lms.indexOf(f);
    const landmarkId = landmarkIndex >= 0 ? `f${facSpecs.length + landmarkIndex + 1}` : null;
    const placed = LANDMARK[f.archetype]
      ? landmarkId !== null && placedLandmarkIds.has(landmarkId)
      : placedFacilitySources.has(f);
    if (placed) continue;
    let reason;
    if (LANDMARK[f.archetype]) {
      const prop = LANDMARK[f.archetype].prop;
      if (!propArt[prop]) reason = `小物 ${prop} の絵が manifest にない`;
      else if (f.archetype === 'gate' && !(F.exits || []).length) reason = '門を置ける南北の出口がない';
      else if (f.archetype === 'gate') reason = '出口ごとに門の絵・柱・土道・門番を置ける場所がない';
      else reason = '広場または緑地に井戸小屋と井戸番を置ける場所がない';
    } else if (!art[f.archetype]?.footprint) {
      reason = `施設 ${f.archetype} の絵が manifest にない`;
    } else if (f.archetype === 'dock' && !water) {
      reason = '水辺の地面がない';
    } else {
      reason = '施設を配置できる建物の場所がない';
    }
    unplaced.push({
      archetype: f.archetype,
      name: f.name || facilityName,
      reason,
      evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 20) : [],
      evidenceCount: f.evidenceCount ?? (f.evidence || []).length,
    });
  }

  const { x0, y0, x1, y1 } = F.crop;
  const ground = [];
  for (let y = y0; y <= y1; y++) {
    let s = '';
    for (let x = x0; x <= x1; x++) s += CH[F.g[P.id(x, y)]];
    ground.push(s);
  }
  const buildings = P.placed.map((p) => ({
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
  return {
    version: 1,
    repo: { name: repo.name, head: repo.head ?? null, branch: repo.branch ?? null, readme: repo.readme ?? null,
      latestCommitDate: repo.latestCommitDate ?? null, recentDays: RECENT_DAYS },
    tile: 16,
    cols: x1 - x0 + 1,
    rows: y1 - y0 + 1,
    ground,
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
}
