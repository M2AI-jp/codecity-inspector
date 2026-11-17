// 直接使っている依存を、鳩の根拠として読む。
import { SKIP_DIR } from './constants.mjs';
import { readText, depth, base } from './files.mjs';

// TOML: keys of the named tables ([dependencies], [dev-dependencies], [tool.poetry.dependencies] ...)
function tomlTableKeys(text, tables) {
  const out = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const t = /^\[([^\]]+)\]$/.exec(line);
    if (t) {
      const name = t[1].trim();
      cur = tables.includes(name) ? name : null;
      // [dependencies.foo] style
      for (const tb of tables) if (name.startsWith(`${tb}.`) && !name.slice(tb.length + 1).includes('.')) out.push(name.slice(tb.length + 1).replace(/"/g, ''));
      continue;
    }
    if (!cur) continue;
    const k = /^("?)([A-Za-z0-9_.\-]+)\1\s*=/.exec(line);
    if (k) out.push(k[2]);
  }
  return out;
}

// PEP 621: [project] dependencies = ["requests>=2", ...]
function pyprojectDeps(text) {
  const out = [];
  const sec = /(^|\n)\[project\]([\s\S]*?)(\n\[|$)/.exec(text);
  const d = sec && /(^|\n)\s*dependencies\s*=\s*\[([\s\S]*?)\]/.exec(sec[2]);
  if (d) for (const s of d[2].matchAll(/["']([^"']+)["']/g)) out.push(pyName(s[1]));
  return out.concat(tomlTableKeys(text, ['tool.poetry.dependencies', 'tool.poetry.dev-dependencies', 'tool.poetry.group.dev.dependencies']).filter((n) => n !== 'python'));
}

const pyName = (spec) => spec.trim().split(/[\s<>=!~;\[(@]/)[0];

function requirementsDeps(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-') || /^[a-z]+:\/\//i.test(line)) continue;
    const n = pyName(line);
    if (/^[A-Za-z0-9][A-Za-z0-9_.\-]*$/.test(n)) out.push(n);
  }
  return out;
}

function goModDeps(text) {
  const out = [];
  let block = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) { block = true; continue; }
    if (block && line === ')') { block = false; continue; }
    if (/\/\/\s*indirect/.test(line)) continue;
    const m = block ? /^(\S+)\s+v\S+/.exec(line) : /^require\s+(\S+)\s+v\S+/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

function gemfileDeps(text) {
  return [...text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]);
}

// one manifest -> [{ name, reason }]
function manifestDeps(root, rel) {
  const b = base(rel);
  const text = readText(root, rel);
  if (text == null) return [];
  const tag = (names, what) => names.map((name) => ({ name, reason: `${rel} の${what}` }));
  try {
    if (b === 'package.json' || b === 'composer.json') {
      const j = JSON.parse(text);
      if (b === 'composer.json') {
        const ok = (n) => n !== 'php' && !n.startsWith('ext-');
        return [...tag(Object.keys(j.require || {}).filter(ok), ' require'), ...tag(Object.keys(j['require-dev'] || {}).filter(ok), ' require-dev')];
      }
      return [...tag(Object.keys(j.dependencies || {}), ' dependencies'), ...tag(Object.keys(j.devDependencies || {}), ' devDependencies')];
    }
  } catch { return []; }
  if (/^requirements[^/]*\.txt$/i.test(b)) return tag(requirementsDeps(text), '依存');
  if (b === 'pyproject.toml') return tag(pyprojectDeps(text), '依存');
  if (b === 'Pipfile') return tag(tomlTableKeys(text, ['packages', 'dev-packages']), '依存');
  if (b === 'Cargo.toml') return tag(tomlTableKeys(text, ['dependencies', 'dev-dependencies', 'build-dependencies']), '依存');
  if (b === 'go.mod') return tag(goModDeps(text), ' require');
  if (b === 'Gemfile') return tag(gemfileDeps(text), ' gem');
  return [];
}

const MANIFEST = /^(package\.json|composer\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.mod|Gemfile)$/i;

function findDependencies(root, files) {
  // the repository's own manifests first; docs / examples / tests sites after them
  const aside = (f) => (/(^|\/)(docs?|examples?|samples?|demos?|tests?|spec|benchmarks?)\//i.test(f) ? 1 : 0);
  const manifests = files.filter((f) => MANIFEST.test(base(f)) && !SKIP_DIR.test(f) && depth(f) <= 3)
    .sort((a, b) => aside(a) - aside(b) || depth(a) - depth(b) || a.localeCompare(b));
  const seen = new Set(), out = [];
  for (const m of manifests.slice(0, 40)) {
    for (const d of manifestDeps(root, m)) {
      const key = d.name.toLowerCase();
      if (!d.name || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

export { findDependencies };
