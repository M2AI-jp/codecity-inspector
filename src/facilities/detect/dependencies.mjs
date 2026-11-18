import { basename } from 'node:path';
import { sortPaths } from '../common.mjs';
import { SKIP_DIR } from '../scan.mjs';
import { MANIFEST, depsOf, nameIn } from '../sdk-names.mjs';
import { ENV_EXAMPLE } from '../env.mjs';

// 依存と小ファイルの読込。各施設が使うファイルを従来と同じ一括読込にまとめる。
export function readDependencies(S) {
  const { files, read, prod, byBase } = S;
  // 依存の一覧
  const manifests = files.filter((f) => MANIFEST.test(basename(f.path)) && !SKIP_DIR.test(f.path) && f.bytes < (1 << 20)).map((f) => f.path).slice(0, 300);
  const deps = [];   // { dep, path }
  // 井戸・船着場・道場が読む小さなファイル（見本の env・workflow・package.json・配布の manifest）も、ここで一緒に読んでおく
  const examples = sortPaths(files.filter((f) => !f.binary && prod(f.path) && ENV_EXAMPLE.test(basename(f.path)) && f.bytes < (256 << 10)).map((f) => f.path)).slice(0, 8);
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path) && f.bytes < (1 << 20)).map((f) => f.path).slice(0, 80);
  const dockManifests = files.filter((f) => !f.binary && prod(f.path) && f.bytes < (1 << 20) && f.path.split('/').length <= 4 &&
    /^(package\.json|pyproject\.toml|setup\.py|cargo\.toml|[\w.-]+\.gemspec|go\.mod|composer\.json|pubspec\.yaml|package\.swift|info\.plist|app\.json|app\.config\.[cm]?[jt]s|manifest\.json|androidmanifest\.xml|tauri\.conf\.json|capacitor\.config\.(json|[jt]s)|project\.pbxproj)$/i.test(basename(f.path))).map((f) => f.path).slice(0, 40);
  const pkgJsons = (byBase.get('package.json') || []).filter((p) => !SKIP_DIR.test(p)).slice(0, 20);
  read([...manifests, ...examples, ...workflows, ...dockManifests, ...pkgJsons]);
  for (const [p, text] of read(manifests)) for (const dep of depsOf(p, text)) deps.push({ dep, path: p });
  const depHits = (table) => {
    const hits = new Map();   // name -> paths
    for (const { dep, path } of deps) {
      const n = nameIn(table, dep);
      if (!n) continue;
      if (!hits.has(n)) hits.set(n, new Set());
      hits.get(n).add(path);
    }
    return hits;
  };

  Object.assign(S, { examples, workflows, dockManifests, pkgJsons, deps, depHits });
}
