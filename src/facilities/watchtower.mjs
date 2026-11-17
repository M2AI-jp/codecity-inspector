import { sortPaths, uniq } from './common.mjs';
import { SKIP_DIR } from './scan.mjs';
import { MONITOR } from './sdk-names.mjs';

export function detectWatchtower({ files, depHits }) {
  // ---------- 見張り台: logs・monitoring ----------
  const mon = depHits(MONITOR);
  const logFiles = files.filter((f) => !SKIP_DIR.test(f.path) && /(^|\/)logs?\//.test(f.path)).map((f) => f.path);
  const logDirs = uniq(logFiles.map((p) => p.slice(0, p.search(/(^|\/)logs?\//) + (p.match(/(^|\/)logs?\//)[0].length) - 1)));
  const cfg = files.filter((f) => !SKIP_DIR.test(f.path) && /^(prometheus\.ya?ml|alertmanager\.ya?ml|\.sentryclirc|sentry\.(client|server|edge)\.config\.[cm]?[jt]s|newrelic\.(js|yml)|datadog\.ya?ml|otel-collector[\w.\-]*\.ya?ml|loki[\w.\-]*\.ya?ml|grafana[\w.\-]*\.(json|ya?ml))$/i.test(f.path.slice(f.path.lastIndexOf('/') + 1))).map((f) => f.path);
  const tools = [...mon.keys()];
  if (!(tools.length || logDirs.length || cfg.length)) return null;
  const parts = [];
  if (tools.length) parts.push(`記録・見張りの道具: ${tools.slice(0, 4).join('、')}`);
  if (logDirs.length) parts.push(`記録（ログ）の置き場「${logDirs[0]}」`);
  if (cfg.length) parts.push(`監視の設定「${cfg[0]}」`);
  return {
    reason: parts.join('、'),
    evidence: [...cfg, ...[...mon.values()].flatMap((s) => [...s]), ...sortPaths(logFiles)],
    facts: { tools, logDirs: logDirs.slice(0, 4), configs: cfg.slice(0, 4) },
  };
}
