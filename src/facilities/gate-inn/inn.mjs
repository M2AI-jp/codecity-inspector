import { basename } from 'node:path';
import { sortPaths } from '../common.mjs';
import { SKIP_DIR } from '../scan.mjs';
import { WEB_DEP } from '../sdk-names.mjs';

// 宿屋の根拠と門へ渡す入口の証拠を、一度の読み取りで揃える。
export function detectInn({ files, byBase, named, depHits, read, prod, servers }) {
  const deployNames = /^(vercel\.json|netlify\.toml|fly\.toml|procfile|render\.yaml|wrangler\.(toml|json|jsonc)|app\.json|now\.json)$/i;
  const deploy = named(deployNames).filter(prod);
  const cname = (byBase.get('cname') || []).filter((p) => !SKIP_DIR.test(p));
  const firebase = (byBase.get('firebase.json') || []);
  const dockerfiles = files.filter((f) => /^(dockerfile|containerfile)(\..*)?$/i.test(basename(f.path)) && !SKIP_DIR.test(f.path)).map((f) => f.path);
  const fwConfig = named(/^(next|nuxt|astro|svelte|remix|vite)\.config\.[cm]?[jt]s$|^gatsby-config\.[jt]s$|^angular\.json$/).filter(prod);
  const pages = files.filter((f) => /^index\.html?$/i.test(basename(f.path)) && prod(f.path)).map((f) => f.path);
  const deps2 = depHits(WEB_DEP);
  const read2 = read([...cname, ...firebase, ...dockerfiles].slice(0, 40));
  const domains = cname.map((p) => (read2.get(p) || '').trim().split(/\s+/)[0]).filter((d) => /^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(d));
  const exposed = dockerfiles.filter((p) => /^\s*EXPOSE\s+\d+/mi.test(read2.get(p) || ''));
  const hosting = firebase.filter((p) => /"hosting"/.test(read2.get(p) || ''));
  const deployAll = sortPaths([...deploy, ...exposed, ...hosting, ...(domains.length ? cname : [])]);
  const frameworks = [...deps2.keys()];
  if (!(servers.length || deployAll.length || frameworks.length || fwConfig.length)) return null;
  const parts = [];
  if (servers.length) parts.push(`「${servers[0].path}」が ${servers[0].how}を立てる`);
  if (domains.length) parts.push(`「${cname[0]}」に ${domains[0]} という住所の札がある`);     // 公開した証拠ではない
  else if (deployAll.length) parts.push(`公開の設定「${deployAll[0]}」がある`);
  if (frameworks.length) parts.push(`${frameworks.slice(0, 2).join('・')} を使う`);
  else if (fwConfig.length && !servers.length) parts.push(`Webの骨組みの設定「${fwConfig[0]}」がある`);
  if (pages.length && parts.length < 3) parts.push(`「${sortPaths(pages)[0]}」を配る`);
  const evidence = [...servers.map((s) => s.path), ...deployAll, ...fwConfig, ...sortPaths(pages).slice(0, 4),
    ...[...deps2.values()].flatMap((s) => [...s])];
  return {
    reason: parts.join('、'),
    evidence,
    facts: {
      servers: servers.slice(0, 6), deploy: deployAll.slice(0, 6), domains, frameworks, configs: fwConfig.slice(0, 4), pages: sortPaths(pages).slice(0, 4),
    },
    entry: { deployAll, domains, cname: domains.length ? cname[0] : null, frameworks, fwConfig, evidence },
  };
}
