// ---------- 乱数・ハッシュ ----------
function hash32(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- モジュールが多すぎるときは、小さいものから親へまとめる ----------
const sizeOf = (m) => m.lines + 30 * m.files;
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null);

const RUIN_SEGMENT = /(?:^|[\/\\])(?:archive|archives|attic|deprecated|legacy|old|obsolete|retired|unused|backup|backups|bak|tmp|temp)(?:[\/\\]|$)/i;

function aggregateKindAndReason(parts, recent) {
  const explicitRuin = parts.some((part) => RUIN_SEGMENT.test(part.path || ''));
  const onlyRuin = parts.length > 0 && parts.every((part) => part.kind === 'ruin');
  let kind;
  if (explicitRuin || (onlyRuin && recent <= 0)) kind = 'ruin';
  else if (parts.some((part) => part.kind === 'workshop')) kind = 'workshop';
  else if (parts.some((part) => part.kind === 'shop')) kind = 'shop';
  else kind = 'house';
  const reason = parts.find((part) => part.kind === kind && part.reason)?.reason
    || [...parts].sort((a, b) => (b.recent || 0) - (a.recent || 0))[0]?.reason
    || '';
  return { kind, reason };
}

function absorb(dst, src) {
  dst.merged = [...(dst.merged || []), ...(src.orig ? [src.path] : []), ...(src.merged || [])];
  dst.files += src.files; dst.lines += src.lines; dst.bytes += src.bytes;
  const langs = Object.assign(Object.create(null), dst.languages);
  for (const [k, v] of Object.entries(src.languages || {})) langs[k] = (langs[k] || 0) + v;
  dst.languages = Object.fromEntries(Object.entries(langs).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])));
  dst.commits = Math.max(dst.commits, src.commits);           // 正確な和集合は出せないので「少なくとも」の値
  const au = new Map((dst.authors || []).map((a) => [a.name, a.commits]));
  for (const a of src.authors || []) au.set(a.name, Math.max(au.get(a.name) || 0, a.commits));
  dst.authors = [...au.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 10).map(([name, commits]) => ({ name, commits }));
  if (src.lastCommit && (!dst.lastCommit || Date.parse(src.lastCommit.date) > Date.parse(dst.lastCommit.date))) dst.lastCommit = src.lastCommit;
  dst.recent = (dst.recent || 0) + (src.recent || 0);
  dst._parts = [...(dst._parts || []), ...(src._parts || [{
    path: src.path,
    kind: src.kind,
    reason: src.reason,
    recent: src.recent || 0,
  }])];
  const classification = aggregateKindAndReason(dst._parts, dst.recent);
  dst.kind = classification.kind;
  dst._aggregateReason = classification.reason;
  dst.topFiles = [...(dst.topFiles || []), ...(src.topFiles || [])].sort((a, b) => b.lines - a.lines || cmp(a.path, b.path)).slice(0, 8);
  // 作業中の変更（未コミットのファイル数）は足す
  const dirty = (dst.works?.dirty || 0) + (src.works?.dirty || 0);
  if (dirty > 0) dst.works = { ...(dst.works || {}), dirty };
}


export { hash32, makeRng, cmp, sizeOf, parentOf, RUIN_SEGMENT, absorb };
