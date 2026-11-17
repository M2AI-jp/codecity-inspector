import { SPLIT_AT } from './constants.mjs';

// ---------- ディレクトリ → モジュール ----------
export function buildTree(files) {
  const root = { path: '', name: '', depth: 0, files: [], children: new Map(), count: 0 };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    node.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      let c = node.children.get(parts[i]);
      if (!c) {
        c = { path: parts.slice(0, i + 1).join('/'), name: parts[i], depth: i + 1, files: [], children: new Map(), count: 0 };
        node.children.set(parts[i], c);
      }
      node = c;
      node.count++;
    }
    node.files.push(f);
  }
  return root;
}

function collect(node, out = []) {
  out.push(...node.files);
  for (const c of node.children.values()) collect(c, out);
  return out;
}
const sortedKids = (node) => [...node.children.values()].sort((a, b) => (a.name < b.name ? -1 : 1));

export function groupModules(tree) {
  const groups = [];
  if (tree.files.length) groups.push({ path: '.', files: [...tree.files], node: null });
  const split = (node, minKid) => {
    const own = [...node.files];
    const kids = [];
    for (const c of sortedKids(node)) { if (c.count < minKid) collect(c, own); else kids.push(c); }
    if (kids.length + (own.length ? 1 : 0) < 2) return null;
    return { own, kids };
  };
  const visit = (node) => {
    const s = node.depth < SPLIT_AT.length && node.count > SPLIT_AT[node.depth] ? split(node, 3) : null;
    if (!s) { groups.push({ path: node.path, files: collect(node), node }); return; }
    if (s.own.length) groups.push({ path: node.path, files: s.own, node: null });
    for (const k of s.kids) visit(k);
  };
  for (const c of sortedKids(tree)) visit(c);
  // 小さなリポジトリでも街になるよう、モジュールが少なければ大きいディレクトリから分ける
  for (let guard = 0; groups.length < 6 && guard < 20; guard++) {
    const cand = groups.filter((g) => g.node && g.node.children.size > 0 && g.node.depth < 5)
      .sort((a, b) => b.files.length - a.files.length || (a.path < b.path ? -1 : 1));
    let done = false;
    for (const g of cand) {
      const s = split(g.node, 1);
      if (!s) continue;
      groups.splice(groups.indexOf(g), 1);
      if (s.own.length) groups.push({ path: g.path, files: s.own, node: null });
      for (const k of s.kids) groups.push({ path: k.path, files: collect(k), node: k });
      done = true;
      break;
    }
    if (!done) break;
  }
  groups.sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : a.path < b.path ? -1 : 1));
  return groups;
}

// パス → モジュール（親をさかのぼって探す。ルート直下のファイルだけが "."）
export function makeOwnerOf(groups) {
  const byKey = new Map(groups.map((g, i) => [g.path === '.' ? '' : g.path, i]));
  return (p) => {
    if (!p.includes('/')) return byKey.get('');
    let d = p;
    for (let j = d.lastIndexOf('/'); j > 0; j = d.lastIndexOf('/')) {
      d = d.slice(0, j);
      const i = byKey.get(d);
      if (i !== undefined) return i;
    }
    return undefined;
  };
}
