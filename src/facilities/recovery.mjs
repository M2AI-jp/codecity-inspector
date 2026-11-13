import {
  DOC_EXT,
  RECOVERY_SCAN_BYTES,
  SCAN_FILE_MAX,
  SCAN_FILES,
  SKIP_DIR,
  automationPath,
  migrationPath,
  pickWithinBudget,
} from './scan.mjs';

// 修理小屋は、単語がどこかに出ただけでは建てない。
// パス名・強い復旧コマンド・DBの down 手順・手順書の見出しだけを証拠にする。
export const RECOVERY_NAME = /(^|[\/._-])(rollback|roll-back|revert|restore|recovery|disaster-recovery|backup|backups)([\/._-]|$)/i;
const RECOVERY_HEADING = /(?:^|\n)\s{0,3}(?:#{1,6}\s*)?(?:rollback|roll-back|revert|restore|recovery|disaster recovery|backup|ロールバック|切り戻し|復旧|バックアップ)(?:\s|:|：|$)/im;

export const hasPgDumpAndRestore = (s) => /\bpg_dump\b/i.test(s) && /\bpg_restore\b/i.test(s);

export const hasFlyDeployImageBack = (s) => {
  for (const line of s.split('\n')) {
    const m = /\bfly(?:ctl)?\s+deploy\b/i.exec(line);
    if (!m) continue;
    const rest = line.slice(m.index + m[0].length);
    if (/--image\b/i.test(rest) && /rollback|revert|previous|old|restore|戻|切り戻/i.test(rest)) return true;
  }
  return false;
};

const RECOVERY_COMMANDS = [
  { kind: 'deployment', re: /\bwrangler\s+rollback\b/i, detail: 'wrangler rollback' },
  { kind: 'deployment', re: /\bvercel\s+rollback\b/i, detail: 'vercel rollback' },
  { kind: 'deployment', re: /\bkubectl\s+rollout\s+undo\b/i, detail: 'kubectl rollout undo' },
  { kind: 'deployment', re: /\bhelm\s+rollback\b/i, detail: 'helm rollback' },
  { kind: 'deployment', re: /\bfly(?:ctl)?\s+releases?\s+rollback\b/i, detail: 'fly releases rollback' },
  { kind: 'deployment', re: /\bheroku\s+rollback\b/i, detail: 'heroku rollback' },
  { kind: 'deployment', re: /\bfirebase\s+hosting:rollback\b/i, detail: 'firebase hosting:rollback' },
  { kind: 'deployment', re: /\baws\b[^\n]{0,180}\brollback\b/i, detail: 'aws ... rollback' },
  { kind: 'deployment', re: /\bgcloud\b[^\n]{0,220}--to-revision(?:=|\s)/i, detail: 'gcloud ... --to-revision' },
  { kind: 'deployment', re: /(?:\b(?:deploy|deployment|release|production|本番)[^\n]{0,180}\bgit\s+revert\b|\bgit\s+revert\b[^\n]{0,180}\b(?:deploy|deployment|release|production|本番))/i, detail: 'git revert（デプロイの戻し）' },
  { kind: 'deployment', re: { test: (s) => hasFlyDeployImageBack(s) }, detail: 'flyctl deploy --image（戻し）' },
  { kind: 'database', re: /\b(?:migrate|migration)\s*(?::|\s+)(?:down|rollback)\b/i, detail: 'migrate down / rollback' },
  { kind: 'database', re: /\bprisma\s+migrate\s+resolve\s+--rolled-back\b/i, detail: 'prisma migrate resolve --rolled-back' },
  { kind: 'database', re: /\bknex\s+migrate:rollback\b/i, detail: 'knex migrate:rollback' },
  { kind: 'database', re: /\brails\s+db:rollback\b/i, detail: 'rails db:rollback' },
  { kind: 'backup', re: { test: (s) => hasPgDumpAndRestore(s) }, detail: 'pg_dump と pg_restore' },
];

// CODE_EXT の通常ソースは、運用の置き場・手順書・migration でない限り、
// パス名に rollback / restore などがあるだけでは証拠にしない。
const recoveryNameEligible = (path) => automationPath(path) || DOC_EXT.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase()) || migrationPath(path);

export function detectRecovery({ files, workflows, chosen, read }) {
  // 修理小屋の候補。通常のソース走査に入らない shell・workflow・手順書も読むが、
  // fixtures・tests・vendor などは除く。一般の docs/ 配下も、復旧手順書なら対象にする。
  const recoveryProd = (p) => !SKIP_DIR.test(p) &&
    !/(^|\/)(examples?|demos?|samples?|fixtures?|tests?|__tests__|specs?|e2e|cypress|playwright|benchmarks?)\//i.test(p);
  const recoveryPaths = files.filter((f) => {
    if (f.binary || f.bytes > SCAN_FILE_MAX || !recoveryProd(f.path)) return false;
    const recoveryNamed = RECOVERY_NAME.test(f.path);
    const runbookNamed = /(^|\/)(runbook|playbook|operations?|ops|deploy|release|migration|migrations?)([-_.\/]|$)/i.test(f.path);
    return automationPath(f.path) || migrationPath(f.path) ||
      (DOC_EXT.has(f.ext) && (recoveryNamed || runbookNamed));
  }).map((f) => f.path);
  const bytesByPath = new Map(files.map((f) => [f.path, f.bytes || 0]));
  const recoveryAll = [...new Set([
    ...recoveryPaths,
    ...workflows,
    ...chosen.filter((p) => RECOVERY_NAME.test(p) && recoveryNameEligible(p)),
  ])];
  // 上限を超えるときは、名前に rollback・restore などがあるファイルを先に選ぶ。読む順（＝証拠の並び）は元のまま。
  const recoveryPicked = new Set(pickWithinBudget(
    [...recoveryAll].sort((a, b) => RECOVERY_NAME.test(b) - RECOVERY_NAME.test(a)),
    (p) => bytesByPath.get(p) || 0, SCAN_FILES, RECOVERY_SCAN_BYTES));
  const recoveryTexts = read(recoveryAll.filter((p) => recoveryPicked.has(p)));

  const hits = { deployment: [], database: [], backup: [], runbook: [] };
  const seen = new Set();
  const addRecovery = (kind, path, detail) => {
    const key = `${kind}\0${path}\0${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits[kind].push({ path, detail });
  };
  const kindFromName = (path) => {
    if (DOC_EXT.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())) return 'runbook';
    const word = (path.match(/rollback|roll-back|revert|restore|recovery|disaster-recovery|backup|backups/i) || [])[0]?.toLowerCase() || '';
    if (/rollback|roll-back|revert/.test(word)) return 'deployment';
    if (/restore|recovery|disaster|backup/.test(word)) return 'backup';
    return 'runbook';
  };
  for (const [path, text] of recoveryTexts) {
    if (RECOVERY_NAME.test(path) && recoveryNameEligible(path)) {
      const word = (path.match(/rollback|roll-back|revert|restore|recovery|disaster-recovery|backup|backups/i) || ['recovery'])[0];
      addRecovery(kindFromName(path), path, `ファイル名に「${word}」がある`);
    }
    if (automationPath(path)) {
      for (const command of RECOVERY_COMMANDS) {
        if (command.re.test(text)) addRecovery(command.kind, path, `「${command.detail}」`);
      }
      if (hasPgDumpAndRestore(text)) {
        addRecovery('backup', path, '「pg_dump」と「pg_restore」の両方がある');
      }
    }
    if (migrationPath(path) && /\.down\.sql$/i.test(path)) {
      addRecovery('database', path, 'down migration');
    }
    if (DOC_EXT.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase()) && RECOVERY_HEADING.test(text)) {
      addRecovery('runbook', path, 'ロールバック・復旧の節がある');
    }
  }
  const found = Object.values(hits).flat();
  if (!found.length) return null;
  const order = ['deployment', 'database', 'backup', 'runbook'];
  const evidence = order.flatMap((kind) => hits[kind].map((hit) => hit.path));
  const parts = [];
  if (hits.deployment.length) parts.push(`デプロイを戻す手段 ${hits.deployment.length} 件`);
  if (hits.database.length) parts.push(`DB を戻す手段 ${hits.database.length} 件`);
  if (hits.backup.length) parts.push(`バックアップの手段 ${hits.backup.length} 件`);
  if (hits.runbook.length) parts.push(`復旧の手順書 ${hits.runbook.length} 件`);
  return {
    reason: `戻すための証拠がある（${parts.join('、')}）`,
    evidence,
    facts: {
      deployment: hits.deployment.slice(0, 8),
      database: hits.database.slice(0, 8),
      backup: hits.backup.slice(0, 8),
      runbook: hits.runbook.slice(0, 8),
    },
  };
}
