import { readTestRecords } from './read.mjs';
import { dirtyMtime } from './dirty.mjs';

// 記録と変更の時刻を比べ、内部の時刻値を facts へ出さずに状態を返す。
export function dojoState(root, refTime, extra) {
  const records = readTestRecords(root, extra);
  const latest = records[0] || null;
  const dirty = dirtyMtime(root, extra, new Set(records.map((r) => r.file)));
  const fresh = !!latest && refTime > 0 && latest._mtimeMs > refTime && !dirty.unknown && latest._mtimeMs > dirty.latest;
  const state = fresh ? (latest.failures === 0 ? 'passed' : 'failed') : 'unverified';
  const clean = (r) => r ? { tool: r.tool, file: r.file, mtime: r.mtime, passed: r.passed, failures: r.failures } : null;
  return { state, records: records.map(clean), latestRecord: clean(latest) };
}
