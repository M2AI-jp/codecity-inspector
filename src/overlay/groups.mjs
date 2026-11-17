// Glob matching by segments, without RegExp backtracking or filesystem access.
function segmentMatch(pattern, value) {
  const p = [...pattern], v = [...value];
  let prev = new Uint8Array(v.length + 1); prev[0] = 1;
  for (const c of p) {
    const next = new Uint8Array(v.length + 1);
    if (c === '*') next[0] = prev[0];
    for (let j = 1; j <= v.length; j++) {
      next[j] = c === '*' ? prev[j] || next[j - 1] : (c === '?' || c === v[j - 1]) && prev[j - 1] ? 1 : 0;
    }
    prev = next;
  }
  return !!prev[v.length];
}

export function globMatch(pattern, path) {
  const p = pattern.replace(/^\.\//, '').replace(/\/$/, '').split('/');
  const v = path.replace(/^\.\//, '').replace(/\/$/, '').split('/');
  let prev = new Uint8Array(v.length + 1); prev[0] = 1;
  for (const s of p) {
    const next = new Uint8Array(v.length + 1);
    if (s === '**') next[0] = prev[0];
    for (let j = 1; j <= v.length; j++) next[j] = s === '**'
      ? prev[j] || next[j - 1] : prev[j - 1] && segmentMatch(s, v[j - 1]) ? 1 : 0;
    prev = next;
  }
  return !!prev[v.length];
}

export function applyGroups(model, groups, filesByModule = new Map()) {
  return { ...model, modules: model.modules.map((m) => {
    const paths = [m.path, ...(filesByModule.get(m.path) || (m.topFiles || []).map((f) => f.path))];
    const group = groups.find((g) => g.paths.some((pattern) => paths.some((p) => globMatch(pattern, p))));
    const { group: _old, ...copy } = m;
    return group ? { ...copy, group: group.id } : copy;
  }) };
}
