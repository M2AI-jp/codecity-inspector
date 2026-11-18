import { lstatSync } from 'node:fs';
import { repoPath } from '../scan.mjs';

// 実行記録自身を変更から除き、状態判定に必要な最新時刻と不明を保つ。
export function dirtyMtime(root, extra, recordPaths) {
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
