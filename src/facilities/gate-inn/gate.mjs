import { basename } from 'node:path';
import { sortPaths, uniq } from '../common.mjs';
import { AUTH_DEP, DEPLOY_TARGET, nameIn } from '../sdk-names.mjs';
import { receptions } from './receptions.mjs';

// 宿屋と同じ入口の証拠に受付と認証を添え、門の facts を組み立てる。
export function detectGate({ entry, routeList, deps, prod, servers }) {
  const routes = receptions(routeList);
  const methodRoutes = routes.filter((r) => r.method);
  if (!(entry || methodRoutes.length)) return null;
  const targets = [];
  for (const p of entry ? entry.deployAll : []) {
    if (entry.cname && p === entry.cname) continue;
    const name = nameIn(DEPLOY_TARGET, basename(p));
    targets.push({ path: p, name: name || null });
  }
  // ログインの道具: 製品の依存（docs・examples・tests の下の manifest は数えない）
  const auth = [];
  for (const { dep, path } of deps) {
    if (!prod(path)) continue;
    const n = nameIn(AUTH_DEP, dep);
    if (n && !auth.some((a) => a.name === n)) auth.push({ name: n, path });
  }
  const parts = [];
  if (entry?.domains.length) parts.push(`「${entry.cname}」に ${entry.domains[0]} という住所`);
  else if (targets.length) parts.push(`公開の設定「${targets[0].path}」${targets[0].name ? `（${targets[0].name}）` : ''}`);
  if (servers.length) parts.push(`「${servers[0].path}」が ${servers[0].how}を立てる`);
  if (routes.length) parts.push(`受付の道 ${routes.length} 本`);
  if (!parts.length && entry?.frameworks.length) parts.push(`${entry.frameworks.slice(0, 2).join('・')} を使う`);
  if (!parts.length && entry?.fwConfig.length) parts.push(`Webの骨組みの設定「${entry.fwConfig[0]}」`);
  if (auth.length) parts.push(`ログインの道具 ${auth.slice(0, 2).map((a) => a.name).join('・')}`);
  return {
    reason: parts.join('、'),
    evidence: [...(entry ? entry.evidence : []), ...(entry?.cname ? [entry.cname] : []),
      ...sortPaths(uniq(routes.map((r) => r.path))), ...auth.map((a) => a.path)],
    facts: {
      domains: entry ? entry.domains.slice(0, 4) : [],
      deploy: targets.slice(0, 6),
      servers: servers.slice(0, 4),
      frameworks: entry ? entry.frameworks.slice(0, 4) : [],
      routes: (methodRoutes.length >= 3 ? methodRoutes : routes).slice(0, 8), routesTotal: routes.length,
      auth: auth.slice(0, 4),
    },
  };
}
