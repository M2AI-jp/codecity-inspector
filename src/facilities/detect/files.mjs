import { basename } from 'node:path';
import { uniq } from '../common.mjs';
import { NOT_PRODUCT, READ_BATCH_MAX, READ_FILE_MAX, SKIP_DIR, makeReader } from '../scan.mjs';

// 読込と索引の準備。同じキャッシュを全段階で使い、読込順と一括読込の単位を保つ。
export function prepareFiles(S) {
  const { files, extra } = S;
  const { root, isGit, head } = extra;
  // 同じファイルは1度だけ読む（git なら cat-file --batch の1回にまとめる）
  const rawRead = makeReader(root, isGit && !!head, !!extra.bare);
  const cache = new Map();
  const fileInfo = new Map(files.map((f) => [f.path, f]));
  const read = (paths) => {
    const miss = uniq(paths.filter((p) => !cache.has(p)));
    if (miss.length) {
      let budget = READ_BATCH_MAX;
      const allowed = [];
      for (const p of miss) {
        const f = fileInfo.get(p);
        const bytes = Number(f?.bytes);
        if (!f || f.binary || !Number.isFinite(bytes) || bytes < 0 || bytes > READ_FILE_MAX) continue;
        const cost = Math.max(1, bytes);
        if (cost > budget) continue;
        budget -= cost;
        allowed.push(p);
      }
      const got = allowed.length ? rawRead(allowed) : new Map();
      for (const p of miss) cache.set(p, got.has(p) ? got.get(p) : null);
    }
    const out = new Map();
    for (const p of paths) { const t = cache.get(p); if (t != null) out.set(p, t); }
    return out;
  };
  const prod = (p) => !SKIP_DIR.test(p) && !NOT_PRODUCT.test(p);
  const byBase = new Map();
  for (const f of files) {
    const b = basename(f.path).toLowerCase();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f.path);
  }
  const named = (re) => files.filter((f) => !SKIP_DIR.test(f.path) && re.test(basename(f.path))).map((f) => f.path);

  Object.assign(S, { read, prod, byBase, named });
}
