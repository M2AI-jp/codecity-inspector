// 門と酒場で同じ受付を使うため、重複の優先順位と並び順を共有する。
export function receptions(routeList) {
  const seen = new Map();
  for (const r of routeList) {
    const k = `${r.method || ''} ${r.route}`;
    if (seen.has(k)) continue;
    if (!r.method && [...seen.values()].some((x) => x.route === r.route)) continue;
    if (r.method) for (const [k2, x] of seen) if (!x.method && x.route === r.route) seen.delete(k2);
    seen.set(k, r);
  }
  return [...seen.values()].sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : (a.method || '') < (b.method || '') ? -1 : 1));
}
