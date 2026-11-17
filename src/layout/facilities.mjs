import { CAP } from './constants.mjs';
import { absorb, cmp, parentOf, sizeOf } from './util.mjs';
import { moduleGroup } from '../group-components.mjs';

export function aggregate(modules, cap = CAP) {
  // orig: path が元の RepoModel のモジュールのパスそのものか
  let list = modules.map((m) => ({
    ...m,
    orig: true,
    baseReason: m.reason,
    _parts: [{
      path: m.path,
      kind: m.kind,
      reason: m.reason,
      recent: m.recent || 0,
    }],
  }));
  const bySize = (a, b) => sizeOf(a) - sizeOf(b) || cmp(a.path, b.path);
  while (list.length > cap) {
    const deep = list.filter((m) => m.path.includes('/')).sort(bySize);
    if (!deep.length) {
      // 最上位ばかりのとき: いちばん小さいものを次に小さいものへ
      const flat = list.filter((m) => m.path !== '.').sort(bySize);
      const small = flat.find((m, i) => flat.slice(i + 1).some((p) => moduleGroup(p) === moduleGroup(m)));
      if (!small) break; // group の境界を守れない場合は cap より group の保持を優先する。
      const big = flat.find((m) => m !== small && moduleGroup(m) === moduleGroup(small));
      absorb(big, small);
      list = list.filter((m) => m !== small);
      continue;
    }
    const m = deep[0];
    const parent = parentOf(m.path);
    const p = list.find((x) => x.path === parent && moduleGroup(x) === moduleGroup(m));
    if (p) { absorb(p, m); list = list.filter((x) => x !== m); continue; }
    const sib = list.filter((x) => x !== m && parentOf(x.path) === parent && moduleGroup(x) === moduleGroup(m)).sort(bySize)[0];
    if (sib) {
      const [big, small] = sizeOf(sib) >= sizeOf(m) ? [sib, m] : [m, sib];
      const agg = { ...big, path: parent, orig: false, merged: [...(big.orig ? [big.path] : []), ...(big.merged || [])] };
      absorb(agg, small);
      list = list.filter((x) => x !== m && x !== sib);
      list.push(agg);
    } else {
      m.merged = [...(m.orig ? [m.path] : []), ...(m.merged || [])];
      m.orig = false;
      m.path = parent;
    }
  }
  return list.map(({ orig, baseReason, _parts, _aggregateReason, ...rest }) => {
    const reason = _aggregateReason || baseReason || rest.reason;
    if (rest.merged?.length) {
      const n = rest.merged.length;
      rest.reason = `${reason}。小さなモジュール ${n} 件をまとめた（${rest.merged.slice(0, 3).join('、')}${n > 3 ? ' ほか' : ''}）`;
    } else if (_aggregateReason) {
      rest.reason = reason;
    }
    return rest;
  }).sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : cmp(a.path, b.path)));
}


// ---------- 建物の大きさ ----------
export function archetypes(mods) {
  const out = new Map();
  const houses = mods.filter((m) => m.kind === 'house').sort((a, b) => sizeOf(a) - sizeOf(b) || cmp(a.path, b.path));
  houses.forEach((m, i) => {
    const r = houses.length > 1 ? i / (houses.length - 1) : 0.5;
    const s = sizeOf(m);
    out.set(m, s < 300 ? 'house_s' : s > 6000 && r >= 0.5 ? 'house_l' : r < 0.35 ? 'house_s' : r >= 0.8 ? 'house_l' : 'house_m');
  });
  for (const m of mods) if (m.kind !== 'house') out.set(m, m.kind);
  return out;
}
