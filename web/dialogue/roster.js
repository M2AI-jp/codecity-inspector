// 酒場で開く名簿のページ。行とページの順番を保つ。
import { fmtInt } from '../util.js';
import { base, spaceOut } from './text.js';

// ---------- 接続者ギルドの名簿（酒場の主人が見せる） ----------
// Five pages built from pub facts only. Each row: { badge?, title, sub? }. Empty pages say so plainly.
// what the town does with each kind of request, in plain words (GET: shows something, POST: receives something)
const METHOD_JA = { GET: 'みせる', POST: 'うけとる', PUT: 'なおす', PATCH: 'なおす', DELETE: 'けす', HEAD: 'たしかめる', OPTIONS: 'たしかめる' };
const ROSTER_ROWS = 10;
// a long path keeps its end (the file name): "Library/Homebrew/utils/github.rb" -> "…/utils/github.rb"
const shortPath = (p, max = 30) => {
  p = String(p || '');
  if (p.length <= max) return p;
  const segs = p.split('/');
  let out = segs.pop();
  while (segs.length && out.length + segs[segs.length - 1].length + 3 <= max) out = `${segs.pop()}/${out}`;
  return segs.length ? `…/${out}` : out;
};
export function rosterPages(fac, town) {
  const f = (fac && fac.facts) || {};
  const arr = (x) => (Array.isArray(x) ? x : []);
  const cs = arr(f.connectors), routes = arr(f.routes), hooks = arr(f.webhooks), keys = arr(f.keys);
  const specs = arr(f.specs), prompts = arr(f.prompts), examples = arr(f.envExamples);
  const more = (shown, total, unit = '件') => (total > shown ? [{ title: `ほか ${fmtInt(total - shown)} ${unit}`, dim: true }] : []);
  const pages = [];

  const where = (c) => (c.paths && c.paths[0] ? shortPath(c.paths[0]) : '');
  const nakama = cs.slice(0, ROSTER_ROWS).map((c) => ({
    title: c.name,
    sub: c.via === 'dep' ? `道具の名簿に名前がある（${where(c)}）` : `コードに住所がある（${where(c)}）`,
  }));
  pages.push({ key: 'nakama', label: 'なかま', intro: 'この街と外をつなぐ相手と、そうだと分かったわけです。',
    rows: [...nakama, ...more(nakama.length, cs.length)], empty: '名簿に載っているなかまは、まだいません。' });

  const shownR = routes.slice(0, ROSTER_ROWS).map((r) => ({ badge: METHOD_JA[r.method] || 'うける', title: r.route, sub: shortPath(r.path) }));
  pages.push({ key: 'uketsuke', label: 'うけつけ', intro: '外から来た頼みごとを受ける窓口です。',
    rows: [...shownR, ...more(shownR.length, Math.max(f.routesTotal | 0, routes.length))], empty: '外から頼みごとを受ける窓口は、見つかりませんでした。' });

  const irai = [
    ...hooks.map((h) => ({ badge: 'うける', title: h, sub: '外からの知らせ（webhook）を受ける口' })),
    ...cs.filter((c) => c.via === 'url').map((c) => ({ badge: 'だす', title: c.name, sub: `${where(c) || 'コード'}から使いを出す` })),
  ];
  pages.push({ key: 'irai', label: 'いらい', intro: '外とのやりとりです。受ける知らせと、こちらから出す使い。',
    rows: [...irai.slice(0, ROSTER_ROWS), ...more(Math.min(ROSTER_ROWS, irai.length), irai.length)], empty: '外とのやりとりは、見つかりませんでした。' });

  const items = [
    ...keys.map((k) => ({ badge: 'かぎ', title: k.name, sub: `${k.for ? `${k.for}の鍵` : '鍵'}${k.example ? '・見本に名前がある' : ''}` })),
    ...specs.map((p) => ({ badge: 'しょるい', title: base(p), sub: `やりとりの取り決め（${shortPath(p)}）` })),
    ...prompts.map((p) => ({ badge: 'たのみかた', title: base(p), sub: `AIへの頼み方の書き置き（${shortPath(p)}）` })),
  ];
  const itemsTotal = keys.length + specs.length + Math.max(f.promptsTotal | 0, prompts.length);
  pages.push({ key: 'mochimono', label: 'もちもの', intro: '鍵は名前だけを書いています。中身（値）は見ていません。',
    rows: [...items.slice(0, ROSTER_ROWS), ...more(Math.min(ROSTER_ROWS, items.length), itemsTotal)], empty: 'もちものは、見つかりませんでした。' });

  const st = [{ title: 'つながるか確かめたことはありません（未確認）', sub: '名簿は、コードに書いてあることから作りました。' }];
  if (keys.length) {
    const inEx = keys.filter((k) => k.example).length;
    if (!examples.length) st.push({ title: '鍵の名前を書いた見本（.env.example）は、ありません' });
    else if (inEx === keys.length) st.push({ title: `鍵の名前は、ぜんぶ見本に書いてあります`, sub: examples[0] });
    else st.push({ title: `鍵の名前${fmtInt(keys.length)}個のうち、見本に書いてあるのは${fmtInt(inEx)}個です`, sub: examples[0] });
  } else st.push({ title: '鍵の名前は、見つかりませんでした' });
  if (f.watchtower) st.push({ title: '見張り台（記録と見張り）があります', sub: arr(f.watchTools).length ? arr(f.watchTools).slice(0, 3).join('、') : null });
  else st.push({ title: '見張り台（記録と見張り）は、この街にはありません' });
  pages.push({ key: 'joutai', label: 'じょうたい', intro: '分かっていることだけを書いています。', rows: st, empty: '', stack: true });

  for (const pg of pages) for (const r of pg.rows) { r.title = spaceOut(String(r.title || '')); if (r.sub) r.sub = spaceOut(String(r.sub)); }
  return pages;
}
