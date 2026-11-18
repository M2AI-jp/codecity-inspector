import { readFileSync } from 'node:fs';
import { recordFile, jsonAt, junitFiles, isTrackedRecord } from './files.mjs';
import { vitestFailureCount } from './vitest.mjs';
import { junitFailureCount } from './junit.mjs';

// 形式ごとの読み取りを元の順で呼び、同時刻の記録も同じ順に揃える。
// ---------- テスト実行の記録（道場がある街だけ） ----------
// codecity はテストを走らせない。作業フォルダに残った、決まった場所の小さな記録だけを読む。
const failureCount = (value) => {
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
};

function publicRecord(meta, tool, failures) {
  return { tool, file: meta.file, mtime: meta.mtime, passed: failures === 0, failures, _mtimeMs: meta.mtimeMs };
}

export function readTestRecords(root, extra) {
  const records = [];
  const add = (tool, file, parser) => {
    if (isTrackedRecord(root, file, extra)) return;
    const meta = recordFile(root, file);
    if (!meta) return;
    let failures;
    try { failures = parser(meta); } catch { failures = null; }
    if (!Number.isFinite(failures)) return;
    records.push(publicRecord(meta, tool, Math.max(0, Math.floor(failures))));
  };
  add('Playwright', 'test-results/.last-run.json', (meta) => {
    const data = jsonAt(meta);
    if (!data || !['passed', 'failed'].includes(data.status)) return null;
    const listed = failureCount(data.failedTests);
    return data.status === 'failed' ? Math.max(1, listed) : listed;
  });
  add('pytest', '.pytest_cache/v/cache/lastfailed', (meta) => {
    const data = jsonAt(meta);
    return data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).length : null;
  });
  for (const file of ['node_modules/.vitest/results.json', 'node_modules/.vite/vitest/results.json']) {
    add('Vitest', file, (meta) => vitestFailureCount(jsonAt(meta)));
  }
  for (const file of junitFiles(root)) {
    add('JUnit XML', file, (meta) => {
      try { return junitFailureCount(readFileSync(meta.abs, 'utf8')); } catch { return null; }
    });
  }
  return records.sort((a, b) => b._mtimeMs - a._mtimeMs || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
