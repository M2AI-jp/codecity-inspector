import { basename } from 'node:path';
import { CODE_EXT, SCAN_BYTES, SCAN_FILE_MAX, SCAN_FILES } from '../scan.mjs';
import { detectRecovery } from '../recovery.mjs';
import { scanWebSources } from '../gate-inn.mjs';

// ソースの走査。優先順と予算を保ち、修理小屋・Web・設定の証拠を共有する。
export function scanSources(S) {
  const { files, workflows, read, prod } = S;
  // ソースの走査（製品のコードだけ。名前の分かりやすいものから、上限まで）
  const PRIORITY = /(server|app|index|main|api|client|http|route|webhook|service|integration|github|slack|openai|llm|ai|db|database|store|storage|log|monitor|deploy)/i;
  const scanList = files.filter((f) => CODE_EXT.has(f.ext) && !f.binary && f.bytes <= SCAN_FILE_MAX && prod(f.path) && !/\.min\.js$/.test(f.path))
    .sort((a, b) => (PRIORITY.test(basename(b.path)) - PRIORITY.test(basename(a.path))) || a.path.split('/').length - b.path.split('/').length || (a.path < b.path ? -1 : 1));
  const chosen = [];
  let budget = SCAN_BYTES;
  for (const f of scanList) {
    if (chosen.length >= SCAN_FILES || budget - f.bytes < 0) break;
    chosen.push(f.path); budget -= f.bytes;
  }
  const sources = read(chosen);
  const recovery = detectRecovery({ files, workflows, chosen, read });
  const web = scanWebSources({ sources, files, prod });
  const { servers, hostsSeen, webhooks, sqliteSrc, envInCode, loaderSrc, routeList } = web;

  Object.assign(S, { recovery, servers, hostsSeen, webhooks, sqliteSrc, envInCode, loaderSrc, routeList });
}
