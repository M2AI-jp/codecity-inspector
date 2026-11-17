import { basename } from 'node:path';
import { byName, sortPaths, uniq } from './common.mjs';
import { PROMPT_FILE, SPEC_FILE, receptions } from './gate-inn.mjs';
import { SKIP_DIR } from './scan.mjs';
import { SDK } from './sdk-names.mjs';
import { isKeyName, keyFor } from './env.mjs';

export function detectPub({ files, depHits, hostsSeen, webhooks, prod, envNames, exampleSet, examples, routeList }) {
  // ---------- 酒場: API・外部接続・LLM・webhook ----------
  const sdk = depHits(SDK);
  const connectors = new Map();   // name -> { via: 'dep'|'url', paths:Set }
  for (const [n, ps] of sdk) connectors.set(n, { via: 'dep', paths: ps });
  for (const [n, ps] of hostsSeen) if (!connectors.has(n)) connectors.set(n, { via: 'url', paths: ps });
  const hooks = uniq(webhooks.map((w) => w.route)).slice(0, 6);
  // 取り決めの書類（OpenAPI・GraphQL など）と、AI への頼み方の書き置き（prompt のファイル）
  const specs = sortPaths(files.filter((f) => !SKIP_DIR.test(f.path) && !/(^|\/)(tests?|__tests__|fixtures?|spec)\//.test(f.path) && SPEC_FILE.test(basename(f.path))).map((f) => f.path));
  const prompts = sortPaths(files.filter((f) => !f.binary && prod(f.path) && !/(^|\/)\./.test(f.path) &&
    (PROMPT_FILE.test(basename(f.path)) || (/(^|\/)prompts?\//i.test(f.path) && /\.(md|txt|ya?ml|json|j2|jinja2?|hbs|mustache|tmpl|tpl)$/i.test(f.path)))).map((f) => f.path));
  const apiSpecs = specs.filter((p) => !/\.proto$/i.test(p));
  if (!(connectors.size || hooks.length || apiSpecs.length)) return null;
  // 既知の名前（依存・有名な住所）を先に、知らない住所はその後に
  const names = [...connectors.keys()].sort((a, b) => (a.includes('.') - b.includes('.')) || (connectors.get(b).paths.size - connectors.get(a).paths.size) || (a < b ? -1 : 1));
  const parts = [];
  if (names.length) parts.push(`外とつながる相手: ${names.slice(0, 5).join('、')}${names.length > 5 ? ` ほか ${names.length - 5}` : ''}`);
  if (hooks.length) parts.push(`webhook の受け口「${hooks[0]}」`);
  if (!parts.length) parts.push(`API の取り決めの書類「${apiSpecs[0]}」`);
  const evidence = [...names.flatMap((n) => sortPaths([...connectors.get(n).paths]).slice(0, 3)), ...webhooks.map((w) => w.path), ...apiSpecs];
  const routes = receptions(routeList);
  const known = names;
  const keys = envNames.filter(isKeyName).slice(0, 20).map((n) => ({ name: n, for: keyFor(n, known), example: exampleSet.has(n) }));
  return {
    reason: parts.join('、'),
    evidence,
    facts: {
      connectors: names.map((n) => ({ name: n, via: connectors.get(n).via, paths: byName(n, [...connectors.get(n).paths]).slice(0, 3) })).slice(0, 12),
      webhooks: hooks,
      routes: routes.slice(0, 30), routesTotal: routes.length,
      keys, envExamples: examples.slice(0, 3),
      specs: specs.slice(0, 10),
      prompts: prompts.slice(0, 10), promptsTotal: prompts.length,
    },
  };
}
