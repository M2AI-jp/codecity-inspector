import { basename } from 'node:path';
import { sortPaths, uniq } from './common.mjs';
import { dojoState } from './test-records.mjs';
import { CODE_EXT, SKIP_DIR, TEST_DIR, TEST_FILE } from './scan.mjs';
import { TEST_DEP } from './sdk-names.mjs';

export function detectDojo({ files, named, depHits, read, pkgJsons, history, keyer, stats, root, refTime, extra }) {
  // ---------- 道場: test・E2E ----------
  const inTestDir = files.filter((f) => !SKIP_DIR.test(f.path) && f.path.split('/').slice(0, -1).some((s) => TEST_DIR.test(s))).map((f) => f.path);
  const testFiles = files.filter((f) => !SKIP_DIR.test(f.path) && !f.binary && (TEST_FILE.test(basename(f.path)) ||
    (CODE_EXT.has(f.ext) && f.path.split('/').slice(0, -1).some((s) => TEST_DIR.test(s))))).map((f) => f.path);
  const cfg = named(/^(vitest|jest|playwright|cypress|ava)\.config\.[cm]?[jt]s$|^karma\.conf\.[cm]?js$|^\.mocharc(\.\w+)?$|^pytest\.ini$|^\.rspec(_parallel)?$|^phpunit\.xml(\.dist)?$/);
  const runners = [...depHits(TEST_DEP).keys()];
  for (const p of cfg) {
    const b = basename(p).toLowerCase();
    const n = b.startsWith('vitest') ? 'Vitest' : b.startsWith('jest') ? 'Jest' : b.startsWith('playwright') ? 'Playwright' : b.startsWith('cypress') ? 'Cypress'
      : b.startsWith('ava') ? 'AVA' : b.startsWith('karma') ? 'Karma' : b.startsWith('.mocharc') ? 'Mocha' : b === 'pytest.ini' ? 'pytest' : b.startsWith('.rspec') ? 'RSpec' : 'PHPUnit';
    if (!runners.includes(n)) runners.push(n);
  }
  // package.json の scripts.test（node --test など）
  const pkgs = read(pkgJsons);
  for (const [, text] of pkgs) {
    try {
      const t = String(JSON.parse(text).scripts?.test || '');
      if (/\bnode\s+(--[\w-]+\s+)*--test\b/.test(t) && !runners.includes('node --test')) runners.push('node --test');
    } catch { /* 読めない package.json */ }
  }
  if (!testFiles.length) return null;
  const dirs = uniq(inTestDir.map((p) => {
    const s = p.split('/');
    const i = s.findIndex((x) => TEST_DIR.test(x));
    return s.slice(0, i + 1).join('/');
  }));
  const all = uniq([...cfg, ...testFiles, ...inTestDir]);
  const st = stats(all);
  let latest = null;
  for (const c of history) if (c.files.some((f) => f.split('/').slice(0, -1).some((s) => TEST_DIR.test(s)) || TEST_FILE.test(basename(f)))) {
    latest = { subject: c.subject, date: c.date, author: keyer.display(c.key) };
    break;
  }
  const run = dojoState(root, refTime, extra);
  return {
    reason: `テストのファイルが ${testFiles.length} 件${runners.length ? `（${runners.slice(0, 2).join('・')}）` : ''}${dirs.length ? `、稽古場「${sortPaths(dirs)[0]}」` : ''}`,
    evidence: [...cfg, ...sortPaths(dirs).map((d) => `${d}/`), ...sortPaths(testFiles)],
    all,
    extraStats: st,
    facts: { files: testFiles.length, runners, dirs: sortPaths(dirs).slice(0, 4), latest, ...run },
  };
}
