// node tools/gallery.mjs out.html
// Builds a single self-contained review page of every image under art/ (approved + candidates),
// so the user can say which candidates are OK. Images are embedded as data URIs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'art');
const out = process.argv[2] || path.join(ROOT, 'gallery.html');

const uri = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
const exists = (p) => fs.existsSync(p);
const list = (dir, re) => (exists(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : []);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pngSize = (p) => { const b = fs.readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const MEANING = {
  house_s: '住宅（小）— 小さな機能・モジュール', house_m: '住宅（中）', house_l: '住宅（大）— 大きなモジュール',
  shop: '商店 — 画面・UIの領域', workshop: '工房 — build・CI・開発の道具', ruin: '廃屋 — 長く触られていない古いコード',
  town_hall: '役場 — gitリポジトリそのもの', inn: '宿屋 — 公開Webサービス', pub: '酒場 — API・外部接続・LLM',
  warehouse: '倉庫 — DB・storage', watchtower: '見張り台 — logs・monitoring', dojo: '道場 — test・E2E',
  dock: '船着場 — アプリ・パッケージを外へ届ける所',
};
const KEEPER = {
  'keeper-smith': '工房の親方', 'keeper-shop': '商店の主人', 'keeper-house': '家の人', 'keeper-ruin': '廃屋の管理人',
  'keeper-town_hall': '役場の書記', 'keeper-inn': '宿屋の番頭', 'keeper-pub': '酒場の主人', 'keeper-warehouse': '倉庫番',
  'keeper-watchtower': '見張り台の番人', 'keeper-dojo': '道場の検査官', 'keeper-dock': '船頭', 'keeper-well': '井戸番',
  contractor: '外部工務店の代理人',
};
const PROP_MEANING = {
  wellhouse: '井戸小屋 — env・secrets・設定（外に立つ施設）', pier: '桟橋（歩ける板）', 'pier-2': '桟橋（歩ける板）', boat: 'もやった舟',
  scaffold: '足場 — 作業中の変更がある建物', 'scaffold-2': '足場 — 作業中の変更がある建物', 'sign-works': '工事中の札', lumber: '材木',
};

const sections = [];
// the label is the file's own name, so it never shifts when candidates are added or removed
const code = (p) => p;

// approved
const approved = list(path.join(ART, 'approved'), /\.png$/);
sections.push({
  id: 'approved', title: '承認済み', note: 'あなたがOKを出した画像。全素材の画風と大きさの基準です。',
  items: approved.map((f) => ({ code: '承認', name: f, img: uri(path.join(ART, 'approved', f)), scale: 3, sheet: true })),
});

// buildings
const bdir = path.join(ART, 'game', 'buildings');
const bitems = list(bdir, /\.json$/).map((j) => {
  const key = j.replace(/\.json$/, '');
  const meta = JSON.parse(fs.readFileSync(path.join(bdir, j), 'utf8'));
  const a = path.join(bdir, `${key}.exterior.png`), b = path.join(bdir, `${key}.cutaway.png`);
  if (!exists(a)) return null;
  const [w, h] = pngSize(a);
  return { code: code('建', key), name: key, sub: MEANING[meta.archetype] || meta.archetype, pair: [uri(a), exists(b) ? uri(b) : null], w, h, scale: 3 };
}).filter(Boolean);
sections.push({ id: 'buildings', title: '建物', note: '左が外観、右が中に入ったときの姿（同じ位置で切り替わります）。', items: bitems });

// people
const rdir = path.join(ART, 'game', 'residents');
const people = list(rdir, /\.png$/).map((f) => {
  const key = f.replace(/\.png$/, '');
  return { code: code('人', key), name: key, sub: KEEPER[key] || (key.startsWith('townsfolk') ? '街を歩く住人' : ''), img: uri(path.join(rdir, f)), scale: 3, sheet: true, anim: true };
});
sections.push({ id: 'people', title: '人物', note: '上から 下・左・右・上 向き。右の小窓は歩きの動き。', items: people });

// creatures
const cdir = path.join(ART, 'game', 'creatures');
const creatures = list(cdir, /\.png$/).map((f) => ({ code: code('生', f.replace(/\.png$/, '')), name: f.replace(/\.png$/, ''), img: uri(path.join(cdir, f)), scale: 4, sheet: true }));
if (creatures.length) sections.push({ id: 'creatures', title: '生き物', note: 'bot・cron・依存などの生活感を表す小さな生き物。', items: creatures });

// props
const pdir = path.join(ART, 'game', 'props');
const props = list(pdir, /\.png$/).map((f) => ({ code: code('物', f.replace(/\.png$/, '')), name: f.replace(/\.png$/, ''), sub: PROP_MEANING[f.replace(/\.png$/, '')] || '', img: uri(path.join(pdir, f)), scale: 3 }));
sections.push({ id: 'props', title: '小物', note: '', items: props });

// ground
const gdir = path.join(ART, 'game', 'ground');
const ground = list(gdir, /\.png$/).map((f) => ({ code: code('地', f.replace(/\.png$/, '')), name: f.replace(/\.png$/, ''), img: uri(path.join(gdir, f)), scale: 2, tile: true }));
sections.push({ id: 'ground', title: '地面', note: '継ぎ目なしで敷き詰める地面の素材（2×2で並べて表示）。', items: ground });

const player = approved.length ? uri(path.join(ART, 'approved', approved[0])) : '';
const total = bitems.length + people.length + creatures.length + props.length + ground.length;

const card = (it) => {
  const label = `<div class="cap"><span class="code">${esc(it.code)}</span><span class="nm">${esc(it.name)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</div>`;
  if (it.pair) {
    const st = `style="width:${it.w * it.scale}px"`;
    return `<figure class="card wide">${label}<div class="pair"><img ${st} src="${it.pair[0]}" alt="${esc(it.name)} 外観">${it.pair[1] ? `<img ${st} src="${it.pair[1]}" alt="${esc(it.name)} 中">` : '<div class="missing">中の絵なし</div>'}<canvas class="ref" width="32" height="32" aria-label="大きさ比べ用の主人公"></canvas></div></figure>`;
  }
  if (it.tile) return `<figure class="card">${label}<div class="tile" style="background-image:url(${it.img})"></div></figure>`;
  const anim = it.anim ? `<canvas class="walk" width="32" height="32" data-src="${it.img}"></canvas>` : '';
  return `<figure class="card${it.sheet ? ' sheet' : ''}">${label}<div class="row"><img class="s${it.scale}" src="${it.img}" alt="${esc(it.name)}">${anim}</div></figure>`;
};

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CodeCity 素材レビュー</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DotGothic16&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>
:root {
  /* one visual world: a night town at lamp-light; images sit on the same dark ground they live on in the game */
  --bg: #15171c; --panel: #1d2028; --line: #2c303b; --ink: #e9e4d8; --dim: #a39d90; --lamp: #e8b25a;
  --display: "DotGothic16", "Hiragino Sans", sans-serif; --body: "Noto Sans JP", "Hiragino Sans", sans-serif;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); line-height: 1.7; }
main { max-width: 1240px; margin: 0 auto; padding: 32px 16px 80px; display: grid; gap: 40px; }
header { display: grid; gap: 10px; max-width: 70ch; }
h1 { font-family: var(--display); font-weight: 400; font-size: 34px; margin: 0; letter-spacing: .04em; text-wrap: balance; }
h2 { font-family: var(--display); font-weight: 400; font-size: 24px; margin: 0; color: var(--lamp); }
p { margin: 0; color: var(--dim); }
.how { color: var(--ink); background: var(--panel); border-left: 3px solid var(--lamp); padding: 10px 14px; }
.count { font-variant-numeric: tabular-nums; }
section { display: grid; gap: 14px; }
.grid { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
.card { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; display: grid; gap: 10px; max-width: 100%; }
.cap { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.code { font-family: var(--display); color: var(--bg); background: var(--lamp); padding: 0 6px; border-radius: 3px; font-size: 15px; }
.nm { font-weight: 700; font-size: 15px; }
.sub { color: var(--dim); font-size: 14px; }
img { image-rendering: pixelated; max-width: 100%; height: auto; display: block; }
.row, .pair { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.wide { overflow-x: auto; }
.ref { width: 96px; height: 96px; image-rendering: pixelated; }
.walk { width: 96px; height: 96px; image-rendering: pixelated; background: #0f1115; border-radius: 4px; }
.tile { width: 256px; height: 256px; background-size: auto; background-repeat: repeat; image-rendering: pixelated; }
.missing { color: var(--dim); font-size: 14px; }
footer { color: var(--dim); font-size: 14px; }
</style>
</head>
<body>
<main>
<header>
  <h1>CodeCity 素材レビュー</h1>
  <p>リポジトリが夜の街になるゲームの素材です。承認済みは1点だけで、ほかの <span class="count">${total}</span> 点はすべて候補です。</p>
  <p class="how">OKにする素材の名前（例: dock-1、keeper-well）を返信してください。名前は素材を足しても変わりません。OKのものだけを「承認済み」に移します。NGのものは理由を一言もらえると作り直しに使います。</p>
</header>
${sections.map((s) => `<section id="${s.id}"><h2>${esc(s.title)}</h2>${s.note ? `<p>${esc(s.note)}</p>` : ''}<div class="grid">${s.items.map(card).join('')}</div></section>`).join('\n')}
<footer>各人物の右の小窓は、そのシートから歩きの動きを再生したものです。建物の右端の人物は、大きさ比べ用の承認済みの主人公です。</footer>
</main>
<script>
// size images to an integer multiple of their natural size, and play walk cycles from 4x4 sheets
for (const img of document.querySelectorAll('img.s2, img.s3, img.s4')) {
  const k = img.classList.contains('s4') ? 4 : img.classList.contains('s3') ? 3 : 2;
  const set = () => { img.style.width = img.naturalWidth * k + 'px'; };
  img.complete ? set() : img.addEventListener('load', set);
}
const hero = new Image(); hero.src = ${JSON.stringify(player)};
hero.onload = () => { for (const cv of document.querySelectorAll('canvas.ref')) { const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(hero, 0, 64, 32, 32, 0, 0, 32, 32); } };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
for (const cv of document.querySelectorAll('canvas.walk')) {
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  const sheet = new Image(); sheet.src = cv.dataset.src;
  let t = 0;
  const draw = () => {
    const rows = sheet.naturalHeight / 32, cols = sheet.naturalWidth / 32;
    const dir = Math.floor(t / 8) % 4, f = [1, 0, 3, 2][t % 4];
    const row = cols === 4 ? dir : dir * 2 + (rows === 8 ? 0 : 0);
    g.clearRect(0, 0, 32, 32);
    g.drawImage(sheet, (cols === 4 ? f : 2 + f) * 32, (cols === 4 ? row : [2, 6, 4, 0][dir]) * 32, 32, 32, 0, 0, 32, 32);
    t++;
  };
  sheet.onload = () => { draw(); if (!reduce) setInterval(draw, 160); };
}
</script>
</body>
</html>`;
fs.writeFileSync(out, html);
console.log(`wrote ${out}: ${total} candidates, ${(html.length / 1024 / 1024).toFixed(1)} MB`);
