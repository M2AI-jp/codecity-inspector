import { CAP, DEFAULT_FOOT, DOOR_DX, FACILITY_NAME, LANDMARK, clamp } from './constants.mjs';
import { aggregate, archetypes } from './facilities.mjs';
import { loadArt, loadGround, loadProps } from './manifest.mjs';
import { cmp, hash32 } from './util.mjs';
import { moduleGroup } from '../group-components.mjs';

// 施設の吸収先と絵の寸法を先に確定し、後の候補すべてで同じ仕様を使う。
export function prepareAttemptSpecs(S) {
  const { repo, opts } = S;
  const seed = hash32(opts.seed ?? `${repo.name}@${repo.head ?? 'worktree'}`);
  const art = opts.art ?? loadArt();
  const propArt = opts.props ?? loadProps();
  const water = (opts.ground ?? loadGround()).includes('water');
  // 施設: 絵のあるものだけ（船着場は水の絵もあるときだけ）。施設が丸ごと覆うモジュールは、その施設の建物にまとめる（家は建てない）
  const facs = (repo.facilities || []).filter((f) => FACILITY_NAME[f.archetype] && art[f.archetype]?.footprint && (f.archetype !== 'dock' || water));
  // 外に立つ施設（井戸）: 小物の絵があるときだけ
  const lms = (repo.facilities || []).filter((f) => LANDMARK[f.archetype] && propArt[LANDMARK[f.archetype].prop]);
  const byPath = new Map((repo.modules || []).map((m) => [m.path, m]));
  const mergePaths = (f) => {
    const paths = f.merged || [];
    const groups = new Set(paths.map((p) => moduleGroup(byPath.get(p))));
    // 複数担当の施設は共有施設。担当付きモジュールは吸収せず、それぞれの地区に残す。
    return groups.size > 1 ? paths.filter((p) => moduleGroup(byPath.get(p)) === undefined) : paths;
  };
  const covered = new Set([...facs, ...lms].flatMap(mergePaths));
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
    return { id: `b${i + 1}`, archetype: a, w, h, doorDx, roofRows: coverRowsOf(art[a]), module: m,
      district: moduleGroup(m) ?? (m.path === '.' ? '.' : m.path.split('/')[0]) };
  });
  const facModule = (f) => {
    const paths = mergePaths(f);
    const merged = paths.map((p) => byPath.get(p)).filter(Boolean);
    const group = merged.length && merged.every((m) => moduleGroup(m) === moduleGroup(merged[0])) ? moduleGroup(merged[0]) : undefined;
    const languages = Object.create(null);
    let lines = 0, bytes = 0, dirty = 0;
    const top = [];
    for (const m of merged) {
      lines += m.lines; bytes += m.bytes; top.push(...(m.topFiles || []));
      dirty += m.works?.dirty || 0;
      for (const [k, v] of Object.entries(m.languages || {})) languages[k] = (languages[k] || 0) + v;
    }
    return {
      path: paths.length ? paths[0] : f.archetype === 'town_hall' ? '.' : (f.evidence[0] || '.'),
      ...(group !== undefined ? { group } : {}),
      kind: f.archetype, reason: f.reason,
      files: merged.length ? merged.reduce((t, m) => t + m.files, 0) : f.evidenceCount, lines, bytes,
      languages: Object.fromEntries(Object.entries(languages).sort((p, q) => q[1] - p[1] || cmp(p[0], q[0]))),
      lastCommit: f.lastCommit || null, commits: f.commits || 0, recent: f.recent || 0, authors: f.authors || [],
      topFiles: top.sort((p, q) => q.lines - p.lines || cmp(p.path, q.path)).slice(0, 8),
      ...(paths.length ? { merged: [...paths] } : {}),
      ...(dirty > 0 ? { works: { dirty } } : {}),
    };
  };
  const facilityOf = (f, name) => ({ archetype: f.archetype, name, reason: f.reason, evidence: f.evidence,
    evidenceCount: f.evidenceCount, facts: f.facts || {}, merged: mergePaths(f) });
  const facSpecs = facs.map((f, i) => {
    const a = art[f.archetype];
    const [w, h] = a.footprint;
    const module = facModule(f);
    return { id: `f${i + 1}`, archetype: f.archetype, w, h, doorDx: clamp(a.doorX ?? Math.floor((w - 1) / 2), 0, w - 1),
      module, facility: facilityOf(f, FACILITY_NAME[f.archetype]), sourceFacility: f,
      district: moduleGroup(module) ?? '\u0000facility', roofRows: coverRowsOf(a) };
  });
  const landmarks = lms.map((f, i) => ({ sourceFacility: f, prop: LANDMARK[f.archetype].prop, data: {
    id: `f${facSpecs.length + i + 1}`, archetype: f.archetype, name: LANDMARK[f.archetype].name, prop: LANDMARK[f.archetype].prop,
    facility: facilityOf(f, LANDMARK[f.archetype].name), module: facModule(f) } }));
  Object.assign(S, { seed, art, propArt, water, lms, byPath, specs, facSpecs, landmarks });
}
