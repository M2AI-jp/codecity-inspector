import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import {
  JUNIT_RECORD_MAX,
  TEST_RECORD_MAX,
  repoPath,
} from './scan.mjs';

// ---------- テスト実行の記録（道場がある街だけ） ----------
// codecity はテストを走らせない。作業フォルダに残った、決まった場所の小さな記録だけを読む。
const failedState = new Set(['fail', 'failed', 'error', 'errors', 'broken']);
const failureCount = (value) => {
  if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
};
const resultState = (value) => String(value ?? '').toLowerCase();

function recordFile(root, file) {
  try {
    const abs = repoPath(root, file, 'file');
    if (!abs) return null;
    const s = lstatSync(abs);
    if (!s.isFile() || s.size > TEST_RECORD_MAX) return null;
    return { file, abs, mtimeMs: s.mtimeMs, mtime: new Date(s.mtimeMs).toISOString() };
  } catch { return null; }
}

function jsonAt(meta) {
  try { return JSON.parse(readFileSync(meta.abs, 'utf8')); } catch { return null; }
}

function publicRecord(meta, tool, failures) {
  return { tool, file: meta.file, mtime: meta.mtime, passed: failures === 0, failures, _mtimeMs: meta.mtimeMs };
}

function vitestFailureCount(data) {
  const files = Array.isArray(data?.results) ? data.results
    : Array.isArray(data?.testResults) ? data.testResults
      : Array.isArray(data?.files) ? data.files
        : data?.results && typeof data.results === 'object' ? Object.values(data.results) : null;
  const failedResult = (value) => {
    if (value === true) return true;
    if (Array.isArray(value)) return value[1] === true;
    if (!value || typeof value !== 'object') return false;
    if (value.failed === true) return true;
    const state = resultState(value.state ?? value.status ?? value.result?.state ?? value.result?.status);
    const assertions = Array.isArray(value.assertionResults) ? value.assertionResults
      : Array.isArray(value.tests) ? value.tests : [];
    return failedState.has(state) || assertions.some((t) => failedState.has(resultState(t?.status ?? t?.state ?? t?.result)));
  };
  if (files) {
    let failures = files.reduce((n, f) => n + (failedResult(f) ? 1 : 0), 0);
    if (!failures && Number.isFinite(data?.numFailedTestSuites)) failures = Math.max(0, Math.floor(data.numFailedTestSuites));
    if (!failures && Number.isFinite(data?.failedFiles)) failures = Math.max(0, Math.floor(data.failedFiles));
    if (!failures && data?.success === false) failures = 1;
    return failures;
  }
  if (data?.failed === true) return 1;
  if (Number.isFinite(data?.numFailedTestSuites)) return Math.max(0, Math.floor(data.numFailedTestSuites));
  if (Number.isFinite(data?.numFailedFiles)) return Math.max(0, Math.floor(data.numFailedFiles));
  if (Number.isFinite(data?.numFailedTests)) return Math.max(0, Math.floor(data.numFailedTests));
  if (data && typeof data.success === 'boolean') return data.success ? 0 : 1;
  return null;
}

function junitFailureCount(text) {
  const suites = [...text.matchAll(/<testsuite\b[^>]*>/gi)];
  if (suites.length) {
    let counted = false;
    const total = suites.reduce((n, m) => {
      const failures = /\bfailures\s*=\s*["'](\d+)["']/i.exec(m[0]);
      const errors = /\berrors\s*=\s*["'](\d+)["']/i.exec(m[0]);
      if (failures || errors) counted = true;
      return n + (failures ? Number(failures[1]) : 0) + (errors ? Number(errors[1]) : 0);
    }, 0);
    if (counted) return total;
  }
  if (/<testsuites?\b/i.test(text)) {
    const root = /<testsuites\b[^>]*>/i.exec(text)?.[0] || '';
    const failures = /\bfailures\s*=\s*["'](\d+)["']/i.exec(root);
    const errors = /\berrors\s*=\s*["'](\d+)["']/i.exec(root);
    if (failures || errors) return (failures ? Number(failures[1]) : 0) + (errors ? Number(errors[1]) : 0);
    return (text.match(/<failure\b/gi) || []).length + (text.match(/<error\b/gi) || []).length;
  }
  return null;
}

function junitFiles(root) {
  const found = [];
  const add = (dir, re) => {
    if (found.length >= JUNIT_RECORD_MAX) return;
    const abs = repoPath(root, dir, 'directory');
    if (!abs) return;
    try {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (found.length >= JUNIT_RECORD_MAX) return;
        if (!e.isFile() || !re.test(e.name)) continue;
        const file = dir === '.' ? e.name : `${dir}/${e.name}`;
        if (repoPath(root, file, 'file')) found.push(file);
      }
    } catch { /* 記録の置き場が無い街もある */ }
  };
  add('test-results', /\.xml$/i);
  add('reports', /^junit.*\.xml$/i);
  add('.', /^junit.*\.xml$/i);
  add('test-reports', /\.xml$/i);
  return [...new Set(found)].sort().slice(0, JUNIT_RECORD_MAX);
}

function isTrackedRecord(root, file, extra) {
  if (!extra?.isGit || typeof extra.git !== 'function') return false;
  return !!extra.git(['ls-files', '--error-unmatch', '--', file])?.trim();
}

function readTestRecords(root, extra) {
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

function dirtyMtime(root, extra, recordPaths) {
  const paths = Array.isArray(extra.dirtyPaths) ? extra.dirtyPaths : [];
  if (!paths.length) return { latest: 0, unknown: (extra.dirty || 0) > 0 };
  const changed = paths.filter((p) => !recordPaths.has(p));
  if (!changed.length) return { latest: 0, unknown: false };
  let latest = 0, unknown = false;
  for (const p of changed) {
    try {
      const abs = repoPath(root, p, 'file');
      if (!abs) { unknown = true; continue; }
      const s = lstatSync(abs);
      if (s.isFile()) latest = Math.max(latest, s.mtimeMs);
      else unknown = true;
    } catch { unknown = true; } // 削除された変更は、記録より新しいか確かめられない
  }
  return { latest, unknown };
}

export function dojoState(root, refTime, extra) {
  const records = readTestRecords(root, extra);
  const latest = records[0] || null;
  const dirty = dirtyMtime(root, extra, new Set(records.map((r) => r.file)));
  const fresh = !!latest && refTime > 0 && latest._mtimeMs > refTime && !dirty.unknown && latest._mtimeMs > dirty.latest;
  const state = fresh ? (latest.failures === 0 ? 'passed' : 'failed') : 'unverified';
  const clean = (r) => r ? { tool: r.tool, file: r.file, mtime: r.mtime, passed: r.passed, failures: r.failures } : null;
  return { state, records: records.map(clean), latestRecord: clean(latest) };
}
