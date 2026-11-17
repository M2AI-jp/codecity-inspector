// 文の長さ・引用・日付など、会話で共通に使う小道具。
import { fmtInt } from '../util.js';

// ---------- text helpers ----------
const chars = (s) => Array.from(String(s ?? ''));
const isNarrow = (c) => c.codePointAt(0) < 0x2000;
// on-screen width in full-width characters: ASCII is a little over half a kanji
export const width = (s) => chars(s).reduce((w, c) => w + (isNarrow(c) ? 0.55 : 1), 0);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[。.]+$/, '');
export const base = (p) => String(p || '').split('/').pop();
const endsAscii = (s) => /[A-Za-z0-9)\]]$/.test(s);
const startsAscii = (s) => /^[A-Za-z0-9(]/.test(s);
// glue Japanese and Latin with a space only where a Latin word meets kana/kanji
export const jp = (...parts) => parts.filter((p) => p !== '' && p != null).reduce((a, b) => {
  if (!a) return b;
  if ((endsAscii(a) && !/^[、。」』）\s]/.test(b)) || (startsAscii(b) && !/[、。「『（\s]$/.test(a))) return `${a} ${b}`;
  return a + b;
});
export const san = (name) => jp(name, 'さん');
// a space where a Latin word meets kana/kanji ("ここは m2ai-jp さん", "中には JavaScript"), but
// never inside 「file names」 or 『quoted commit subjects』, which stay exactly as written
const KANA = '\u3041-\u30ff\u3400-\u9fff\u30fc';
export const spaceOut = (line) => line.split(/(「[^」]*」|『[^』]*』)/).map((part, i) => (i % 2 ? part : part
  .replace(new RegExp(`([${KANA}])([A-Za-z])`, 'g'), '$1 $2')
  .replace(new RegExp(`([A-Za-z])([${KANA}])`, 'g'), '$1 $2'))).join('');
export const も = (n) => (n >= 5 ? 'も' : '');

function cutWidth(s, max) {
  let out = '', w = 0;
  for (const c of chars(s)) {
    const cw = isNarrow(c) ? 0.55 : 1;
    if (w + cw > max - 1) break;
    out += c; w += cw;
  }
  // do not stop in the middle of a Latin word if a space is close
  const sp = out.lastIndexOf(' ');
  if (/[A-Za-z0-9]$/.test(out) && sp > out.length - 8 && sp > 0) out = out.slice(0, sp);
  return `${out.replace(/[\s、,:;：（(・-]+$/, '')}…`;
}

// A commit subject, quoted as written, but cut at a natural break when it is long.
export function shortSubject(subject, max = 22) {
  const s = clean(subject);
  if (!s) return '';
  if (width(s) <= max) return s;
  const re = /。|\. |; |: |：|、|, |（| \(|・| - | — /g;
  let best = -1, m;
  while ((m = re.exec(s))) {
    const w = width(s.slice(0, m.index));
    if (w > max - 1) break;
    if (w >= max * 0.4) best = m.index;        // "進軍:" or "Layout:" alone says too little
  }
  return best > 0 ? `${s.slice(0, best)}…` : cutWidth(s, max);
}

// A friendly relative date: きょう・きのう・4日前・2週間ほど前・3か月ほど前・1年半ほど前.
export function whenJa(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  if (now - t < 3600e3) return 'ついさっき';
  const day = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dd = Math.round((day(now) - day(t)) / 86400e3);
  if (dd <= 0) return 'きょう';
  if (dd === 1) return 'きのう';
  if (dd === 2) return 'おととい';
  if (dd < 14) return `${dd}日前`;
  if (dd < 45) return `${Math.round(dd / 7)}週間ほど前`;
  if (dd < 350) return `${Math.max(2, Math.round(dd / 30.44))}か月ほど前`;
  const y = Math.max(1, Math.round((dd / 365.25) * 2) / 2);
  return `${Math.floor(y)}年${y % 1 ? '半' : ''}ほど前`;
}
const daysAgo = (iso, now = Date.now()) => (now - Date.parse(iso)) / 86400e3;
// "4日前に" but "きのう、" (no に after きのう・きょう)
export const whenLead = (w) => (/前$/.test(w) ? `${w}に` : `${w}、`);


export const dateJa = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : ''; };
export const listJa = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join('、')}と${a[a.length - 1]}`);
export const q = (p) => `「${p}」`;
export const nPeople = (n) => (n === 1 ? 'ひとり' : n === 2 ? 'ふたり' : `${fmtInt(n)}人`);
