// Small shared helpers: hashing, noise, RNG, formatting.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function strHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, seed = 0, octaves = 3) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, y * f, seed + o * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

// 1D smooth noise in [-1, 1] for flicker
export function noise1(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, 7, seed), b = hash2(i + 1, 7, seed);
  return (a + (b - a) * u) * 2 - 1;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function relativeDateJa(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'ついさっき';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}分前`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}時間前`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}日前`;
  const mo = d / 30.44; if (mo < 12) return `${Math.floor(mo)}か月前`;
  return `${Math.floor(d / 365.25)}年前`;
}

export const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ja-JP') : '?');

const LANG_NAMES = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript (JSX)',
  ts: 'TypeScript', tsx: 'TypeScript (TSX)', py: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust',
  java: 'Java', kt: 'Kotlin', swift: 'Swift', c: 'C', h: 'C ヘッダ', cpp: 'C++', cc: 'C++', hpp: 'C++ ヘッダ',
  cs: 'C#', php: 'PHP', sh: 'シェル', bash: 'シェル', zsh: 'シェル', css: 'CSS', scss: 'SCSS', sass: 'Sass',
  html: 'HTML', htm: 'HTML', vue: 'Vue', svelte: 'Svelte', md: 'Markdown', json: 'JSON', yml: 'YAML', yaml: 'YAML',
  toml: 'TOML', xml: 'XML', sql: 'SQL', lua: 'Lua', dart: 'Dart', ex: 'Elixir', exs: 'Elixir', txt: 'テキスト',
  png: '画像', jpg: '画像', svg: 'SVG', none: '拡張子なし',
};
export function langName(ext) {
  const k = String(ext || '').replace(/^\./, '').toLowerCase();
  return LANG_NAMES[k] || (k ? `.${k}` : 'その他');
}

export const KIND_JA = { workshop: '工房', shop: '商店', house: '住宅', ruin: '廃屋',
  town_hall: '役場', inn: '宿屋', pub: '酒場', warehouse: '倉庫', watchtower: '見張り台', dojo: '道場' };
