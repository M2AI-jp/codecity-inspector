import { openSync, fstatSync, readSync, closeSync } from 'node:fs';

export const MAX_BYTES = 1_000_000;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && [...v].length <= max;
const id = (v) => typeof v === 'string' && v.length > 0;
const relative = (p) => id(p) && !p.startsWith('/') && !p.includes('\\') &&
  !p.split('/').includes('..') && !/^[a-z][a-z\d+.-]*:/i.test(p);

export function validateOverlay(input) {
  if (!object(input) || input.version !== 1) throw new Error('overlay: version must be 1');
  if (input.seed !== undefined && typeof input.seed !== 'string') throw new Error('overlay: seed must be a string');
  if (Buffer.byteLength(JSON.stringify({ seed: input.seed, groups: input.groups })) > MAX_BYTES) {
    throw new Error('overlay: seed and groups exceed 1,000,000 bytes');
  }
  const out = { version: 1, groups: [], markers: [], people: [], rejected: [] };
  if (input.seed !== undefined) out.seed = input.seed;
  if (object(input.source)) {
    out.source = {};
    for (const k of ['tool', 'name']) if (typeof input.source[k] === 'string') out.source[k] = input.source[k];
    if (Number.isSafeInteger(input.source.seq)) out.source.seq = input.source.seq;
  }
  const reject = (scope, index, item, reason) => out.rejected.push({
    overlay: true, scope, index, ...(id(item?.id) ? { id: item.id } : {}), reason,
  });
  if (input.groups !== undefined && !Array.isArray(input.groups)) throw new Error('overlay: groups must be an array');
  const groupIds = new Set();
  for (const g of input.groups || []) {
    if (!object(g) || !id(g.id) || groupIds.has(g.id) || !Array.isArray(g.paths) ||
        g.paths.some((p) => !relative(p)) || (g.label !== undefined && !text(g.label, 60))) {
      throw new Error('overlay: invalid or duplicate group (id, label <= 60, relative paths required)');
    }
    groupIds.add(g.id);
    out.groups.push({ id: g.id, ...(g.label !== undefined ? { label: g.label } : {}), paths: [...g.paths] });
  }
  if (input.title !== undefined) {
    if (object(input.title) && text(input.title.text, 60) && (input.title.sub === undefined || text(input.title.sub, 80))) {
      out.title = { text: input.title.text, ...(input.title.sub !== undefined ? { sub: input.title.sub } : {}) };
    } else reject('title', 0, input.title, 'invalid title or text limit (60/80 code points)');
  }
  const ids = new Set();
  const item = (v, scope, index) => {
    const fail = (reason) => { reject(scope, index, v, reason); return null; };
    if (!object(v)) return fail('expected object');
    const key = scope === 'goal' && v.id === undefined ? '$goal' : v.id;
    if (!id(key)) return fail('missing id');
    if (ids.has(key)) return fail('duplicate id');
    ids.add(key);
    if (scope === 'markers' && !['record', 'board', 'gate'].includes(v.kind)) return fail('unknown kind');
    const name = scope === 'people' ? 'name' : 'label';
    if (!text(v[name], 60)) return fail(`${name} limit: 60 code points (string required)`);
    if (v.lines !== undefined && (!Array.isArray(v.lines) || v.lines.length > 6 || v.lines.some((s) => !text(s, 80)))) {
      return fail('lines limit: 6 lines of 80 code points (strings required)');
    }
    const keys = object(v.at) ? Object.keys(v.at) : [];
    const allowed = ['path', 'group', 'building', 'landmark', ...(scope === 'people' ? ['marker'] : [])];
    if (keys.length !== 1 || !allowed.includes(keys[0]) || !id(v.at[keys[0]]) ||
        (keys[0] === 'path' && !relative(v.at.path))) return fail('invalid at');
    if (scope === 'markers' && v.kind === 'record' && !['passed', 'failed', 'unverified'].includes(v.state)) {
      return fail('invalid record state');
    }
    if (scope === 'people' && v.look !== undefined && (!Number.isSafeInteger(v.look) || v.look < 0)) return fail('invalid look');
    return { id: key, ...(scope === 'markers' ? { kind: v.kind } : {}),
      ...(scope === 'markers' && v.kind === 'record' ? { state: v.state } : {}),
      at: { ...v.at }, [name]: v[name], lines: [...(v.lines || [])],
      ...(scope === 'people' && v.look !== undefined ? { look: v.look } : {}) };
  };
  for (const [scope, limit] of [['markers', 2000], ['people', 100]]) {
    if (input[scope] !== undefined && !Array.isArray(input[scope])) throw new Error(`overlay: ${scope} must be an array`);
    for (const [i, v] of (input[scope] || []).entries()) {
      if (i >= limit) { reject(scope, i, v, `${scope} limit: ${limit}`); continue; }
      const accepted = item(v, scope, i);
      if (accepted) out[scope].push(accepted);
    }
  }
  if (input.goal !== undefined) {
    const goal = item(input.goal, 'goal', 0);
    if (goal) out.goal = goal;
  }
  // Input diagnostics belong to the producer (§8). Never import input.unplaced.
  return out;
}

export function parseOverlay(bytes) {
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('overlay: file exceeds 1,000,000 bytes');
  let input;
  try { input = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('overlay: invalid JSON'); }
  return validateOverlay(input);
}

export function readOverlay(file) {
  if (typeof file !== 'string' || !file || /^[a-z][a-z\d+.-]*:/i.test(file)) {
    throw new Error('overlay: a local file path is required');
  }
  let fd;
  try {
    fd = openSync(file, 'r');
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error('not a regular file');
    if (st.size > MAX_BYTES) throw new Error('file exceeds 1,000,000 bytes');
    // Bound the actual read as well: the writer may replace/grow the file after stat.
    const buf = Buffer.alloc(MAX_BYTES + 1);
    let size = 0, n;
    while (size < buf.length && (n = readSync(fd, buf, size, buf.length - size, null))) size += n;
    return parseOverlay(buf.subarray(0, size));
  } catch (e) { throw new Error(`overlay ${file}: ${e.message}`); }
  finally { if (fd !== undefined) closeSync(fd); }
}
