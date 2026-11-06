// What a keeper says about their building, in plain, warm Japanese that a non-engineer can follow.
// Keepers are roles (工房の親方 / 商店の主人 / 家の人 / 廃屋の管理人), not people. Every claim comes
// from the module data (path, kind, reason, files, authors, lastCommit, topFiles, commits) or the
// fixed meaning of each kind (PRODUCT.md §4); directory names are explained only by what the name
// itself means. Missing data is skipped, never filled in.
//
// Shape: greeting → what this place is → 2–4 facts → a short closing line (4–7 lines in all).
// Wording varies per building (seeded by building.id and its place among buildings of its kind).

import { fmtInt, langName, mulberry32, strHash } from './util.js';

// ---------- text helpers ----------
const chars = (s) => Array.from(String(s ?? ''));
const isNarrow = (c) => c.codePointAt(0) < 0x2000;
// on-screen width in full-width characters: ASCII is a little over half a kanji
const width = (s) => chars(s).reduce((w, c) => w + (isNarrow(c) ? 0.55 : 1), 0);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[。.]+$/, '');
const base = (p) => String(p || '').split('/').pop();
const endsAscii = (s) => /[A-Za-z0-9)\]]$/.test(s);
const startsAscii = (s) => /^[A-Za-z0-9(]/.test(s);
// glue Japanese and Latin with a space only where a Latin word meets kana/kanji
const jp = (...parts) => parts.filter((p) => p !== '' && p != null).reduce((a, b) => {
  if (!a) return b;
  if ((endsAscii(a) && !/^[、。」』）\s]/.test(b)) || (startsAscii(b) && !/[、。「『（\s]$/.test(a))) return `${a} ${b}`;
  return a + b;
});
const san = (name) => jp(name, 'さん');
// a space where a Latin word meets kana/kanji ("ここは m2ai-jp さん", "中には JavaScript"), but
// never inside 「file names」 or 『quoted commit subjects』, which stay exactly as written
const KANA = '\u3041-\u30ff\u3400-\u9fff\u30fc';
const spaceOut = (line) => line.split(/(「[^」]*」|『[^』]*』)/).map((part, i) => (i % 2 ? part : part
  .replace(new RegExp(`([${KANA}])([A-Za-z])`, 'g'), '$1 $2')
  .replace(new RegExp(`([A-Za-z])([${KANA}])`, 'g'), '$1 $2'))).join('');
const も = (n) => (n >= 5 ? 'も' : '');

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
const whenLead = (w) => (/前$/.test(w) ? `${w}に` : `${w}、`);

// ---------- what a directory name means, in plain words ----------
const NAMES = {};
const GROUP = {};            // name -> 'workshop' | 'shop' | 'house'
let group = 'workshop';
const name = (keys, what) => { for (const k of keys.split(' ')) { NAMES[k] = what; GROUP[k] = group; } };
// workshop
name('.github workflows .circleci .gitlab .buildkite ci', '変更を自動で確かめる仕組み（CI）');
name('scripts script', 'いつもの作業を自動でこなす手順書（スクリプト）');
name('tasks', 'いつもの作業の手順');
name('tools tool devtools build-tools', '街づくりに使う道具');
name('bin', 'コマンドを打つと最初に動くプログラム');
name('.claude', 'AIの助手（Claude）に向けた設定');
name('.cursor', 'AIつきエディタ（Cursor）の設定');
name('.vscode', 'エディタ（VS Code）の設定');
name('.idea', 'エディタ（JetBrains）の設定');
name('.devcontainer', '開発の環境をまるごと用意する設定');
name('.husky', '記録の前に自動でかける点検の設定');
name('docker', 'プログラムを箱詰めして動かす（Docker）設定');
name('deploy deployment', 'できたものを世に出す（デプロイ）手順');
name('infra infrastructure ops k8s helm terraform', 'サーバーなど土台（インフラ）の設定');
name('config configs .config', '街の設定');
name('cmake', '組み立て（ビルド）の設定');
group = 'shop';
name('components component', '画面の部品');
name('widgets', '画面の小さな部品');
name('ui', '画面まわり');
name('views view pages page screens', '使う人が見る“画面”');
name('layouts', '画面の並べ方（レイアウト）');
name('templates', '画面のひな形');
name('web www', 'ブラウザで見る“画面”');
name('frontend front client', '使う人の手元で動く“画面”');
name('public static', 'そのまま配る画面の素材');
name('styles style css theme themes', '見た目（色や形）の決まり');
name('assets', '画面で使う絵や素材');
name('images img icons', '絵（画像）');
name('fonts', '文字の形（フォント）');
group = 'house';
name('src source lib', 'プログラムの本体');
name('engine core', 'しくみの中心（エンジン）');
name('commands cmd cli', 'コマンド（命令）ひとつひとつの中身');
name('server backend', '頼まれごとに答える裏方（サーバー）');
name('api', '外から呼び出す窓口（API）');
name('tests test spec specs __tests__', 'ちゃんと動くかを確かめる試験（テスト）');
name('e2e', '最初から最後まで通しで確かめる試験');
name('docs doc documentation', '説明書き（ドキュメント）');
name('examples example demos demo samples sample', '使い方の見本');
name('fixtures', 'お試し用のデータ');
name('data datasets', 'データ');
name('utils util helpers common shared', 'あちこちで使う便利な道具');
name('models model', 'データの形の決まり');
name('types', 'データの形の決まり（型）');
name('locales i18n', 'ほかの言葉への翻訳');
name('migrations', 'データベースの作りかえの手順');
name('db database', 'データベースまわり');
name('logs log', '動いたときの記録（ログ）');
name('outputs output out', '書き出された結果');
name('plugins', 'あとから足せる機能（プラグイン）');
name('mac macos', 'Mac で動かすための部分');
name('ios', 'iPhone で動かすための部分');
name('android', 'Android で動かすための部分');
name('windows', 'Windows で動かすための部分');
name('mcp', 'AIと道具をつなぐ仕組み（MCP）');
// ruin words (analyze.mjs RUIN_WORD)
const RUIN_NAMES = {
  legacy: '昔の作りのまま残されたもの', deprecated: 'もう使わないことになったもの', old: '古いもの',
  archive: 'しまいこまれた昔のもの', archived: 'しまいこまれた昔のもの', attic: '屋根裏にしまわれたもの',
  obsolete: '役目を終えたもの',
};

// ---------- files in plain words ----------
const PROGRAM_EXT = new Set(('js mjs cjs ts mts cts py rb go rs java kt kts swift c h cc cpp hpp cs php lua dart ex exs ' +
  'sh bash zsh ps1 pl r scala clj hs ml fs vb m mm zig nim jl').split(' '));
const NOUN_OF = {};
const noun = (exts, n) => { for (const e of exts.split(' ')) NOUN_OF[e] = n; };
noun('html htm ejs hbs handlebars pug njk liquid twig', '画面');
noun('jsx tsx vue svelte astro', '画面の部品');
noun('css scss sass less styl', '見た目の決まり');
noun('md markdown rst adoc org', '説明書き');
noun('txt', '文書');
noun('json jsonc json5 jsonl ndjson csv tsv xml parquet sqlite sqlite3 db dat', 'データ');
noun('log', '記録');
noun('yml yaml toml ini cfg conf env properties plist editorconfig lock', '設定');
noun('png jpg jpeg gif webp bmp ico icns svg tif tiff psd aseprite heic', '絵');
noun('woff woff2 ttf otf eot', 'フォント');
noun('mp3 wav ogg m4a flac', '音');
// in a workshop, JSON / YAML are settings rather than data
const fileNoun = (ext, kind) => (PROGRAM_EXT.has(ext) ? 'プログラム'
  : kind === 'workshop' && /^(json|jsonc|json5)$/.test(ext) ? '設定' : NOUN_OF[ext] || 'ファイル');
const extOf = (p) => { const b = base(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : 'none'; };
const count = (n, nounWord) => {
  if (nounWord === '絵') return `${fmtInt(n)}枚`;
  return n < 10 ? `${n}つ` : `${fmtInt(n)}個`;
};

// "JavaScript のプログラムが31個と、説明書きが2つ"
function contentsPhrase(languages, kind, maxKinds = 2) {
  const groups = new Map();
  for (const [ext, n] of Object.entries(languages || {})) {
    if (!(n > 0)) continue;
    const k = fileNoun(ext, kind);
    const g = groups.get(k) || { noun: k, n: 0, exts: new Map() };
    g.n += n; g.exts.set(langName(ext), (g.exts.get(langName(ext)) || 0) + n);
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => (a.noun === 'ファイル') - (b.noun === 'ファイル') || b.n - a.n);
  if (!list.length) return null;
  const label = (g) => {
    if (g.noun !== 'プログラム' || g.exts.size !== 1) return g.noun;
    return jp([...g.exts.keys()][0], 'のプログラム');
  };
  const [a, b] = list;
  let s = `${label(a)}が${count(a.n, a.noun)}`;
  const two = maxKinds > 1 && b && b.noun !== 'ファイル';
  if (two) s += `と、${label(b)}が${count(b.n, b.noun)}`;
  if (list.length > (two ? 2 : 1)) s += 'など';
  return { text: s, top: a.noun, only: list.length === 1 };
}

// ---------- reading module.reason (written by analyze.mjs / layout.mjs) ----------
function reasonInfo(m) {
  const r = String(m.reason || '').split('。小さなモジュール')[0];
  let x;
  if ((x = r.match(/^パス名に「(.+?)」を含む/))) return { type: 'ruinName', seg: x[1] };
  if ((x = r.match(/最新コミットより (\d+) 日前/))) return { type: 'ruinAge', days: Number(x[1]) };
  if ((x = r.match(/^ディレクトリ名「(.+?)」は/))) return { type: 'dir', seg: x[1] };
  if ((x = r.match(/^(.+?) を含む（ビルド/))) return { type: 'build', items: x[1].split('、') };
  if (r.startsWith('設定ファイルだけ')) return { type: 'config' };
  if (r.startsWith('UI のファイル')) return { type: 'ui' };
  if ((x = r.match(/^(.+?)が中心の領域/))) return { type: 'content', what: x[1] };
  return { type: 'none' };
}
const CONTENT_NOUN = { コード: 'プログラム', 文書: '説明書き', 画像: '絵', データ: 'データ', 設定: '設定', バイナリ: 'そのままでは読めないファイル' };

// The plain meaning of this place, from the most specific directory name we can explain.
function meaningOf(m, kind, info) {
  const segs = m.path && m.path !== '.' ? m.path.split('/') : [];
  if (kind === 'ruin' && info.type === 'ruinName') {
    const w = RUIN_NAMES[String(info.seg).toLowerCase().replace(/^[-_. ]+|[-_. ]+$/g, '')] ||
      Object.entries(RUIN_NAMES).find(([k]) => String(info.seg).toLowerCase().includes(k))?.[1];
    if (w) return { what: w, byName: true };
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i].toLowerCase();
    if (!NAMES[s]) continue;
    // a workshop is explained only by a workshop word; a shop may hold other things "for the screen"
    if (kind === 'workshop' && GROUP[s] !== 'workshop') continue;
    const what = kind === 'shop' && GROUP[s] !== 'shop' ? `画面まわりの${NAMES[s]}` : NAMES[s];
    const last = segs[segs.length - 1];
    return { what, part: i < segs.length - 1 ? last : null };
  }
  return null;
}

// ---------- voices ----------
// P: place name; W: what this place is; parts are filled in by keeperLines.
const VOICE = {
  workshop: {
    greet: [(P) => `おう、来たか。ここは${P}の工房だ。`, (P) => `よう、いらっしゃい。${P}の工房へようこそ。`, (P) => `おっ、見学かい。ここは${P}の工房さ。`],
    what: [(W) => `ここじゃ、${W}をこしらえてる。`, (W) => `${W}を、ここで手入れしてるのさ。`, (W) => `ここは${W}の仕事場だ。`],
    part: (X, W) => `「${X}」は、${W}の仲間だ。`,
    plain: ['街を動かすための段取りや道具を、ここで手入れしてる。', '街が動くための裏方仕事は、みんなここが受け持ちだ。'],
    root: 'どのフォルダにも入っていない、いちばん上のファイルを預かってる。',
    scripts: '「package.json」に、よく使う作業の手順が書いてあるんだ。',
    ci: '変更を自動で確かめる仕組み（CI）の手順も置いてある。',
    build: (F) => `${F}みたいな、組み立て（ビルド）の設定がそろってる。`,
    config: 'ここにあるのは、ぜんぶ設定ファイルだ。',
    authors: [(p) => `${p}、ここで手を動かしてくれた。`, (p) => `${p}、道具の手入れをしてくれた。`],
    alone: (A, n, c) => `ここは${A}がひとりで面倒を見てる。${n}回${も(c)}手を入れてくれた。`,
    recent: [(L, A, s) => `${L}${A}が『${s}』って仕事をしてったぞ。`, (W, A, s) => `最新の仕事は${W}、${A}の『${s}』だ。`],
    stuff: (c) => `中には${c}。`,
    big: (f, L, many) => `いちばんの大物は「${f}」で、${L}行${many ? 'もある' : 'だ'}。`,
    one: (f, L, n) => `置いてあるのは「${f}」ひとつきり。${L ? `${L}行の${n}だ。` : `中身は${n}さ。`}`,
    top1: (C) => `この街でいちばん手が入る場所だ。${C}回だぞ。`,
    topN: (C) => `これまでに${C}回も手が入った。街でも指折りの忙しさだ。`,
    quiet: (C) => `手が入ったのは、まだ${C}回だけ。のんびりした工房さ。`,
    mid: (C) => `これまでに${C}回、手が入ってる。`,
    merged: (n) => `小さな工房${n}軒ぶんを、ここにまとめてあるんだ。`,
    close: ['まあ、ゆっくり見ていきな。', '用があったら、また寄ってくれ。', '足もとに気をつけて、見ていきな。'],
  },
  shop: {
    greet: [(P) => `いらっしゃいませ。${P}のお店へようこそ。`, (P) => `これはこれは、ようこそ${P}の店へ。`, (P) => `いらっしゃいまし。こちらは${P}の店でございます。`],
    what: [(W) => `ここは、${W}をあつかう店です。`, (W) => `${W}を、こしらえて並べております。`, (W) => `うちは${W}の専門店でございます。`],
    part: (X, W) => `「${X}」は、${W}の一角でございます。`,
    plain: ['ここは、街の人に見せる“画面”をこしらえる店です。', '使う人の目にふれる“画面”を、こしらえて並べております。'],
    root: 'どのフォルダにも入っていない、いちばん上のファイルを並べております。',
    authors: [(p) => `${p}、手を入れてくださいました。`, (p) => `${p}、品物に手を入れてくださいました。`],
    alone: (A, n) => `このお店は、${A}がおひとりで${n}回手を入れてくださいました。`,
    recent: [(L, A, s) => `${L}${A}が『${s}』と手直しを。`, (W, A, s) => `新しい品は${W}、${A}の『${s}』です。`],
    stuff: (c) => `品物は${c}。`,
    big: (f, L, many) => `いちばん大きいのは「${f}」で、${L}行${many ? 'もございます' : 'です'}。`,
    one: (f, L, n) => `お品は「${f}」ひとつだけ。${L ? `${L}行の${n}です。` : `中身は${n}です。`}`,
    top1: (C) => `街でいちばん手の入るお店でして、${C}回になります。`,
    topN: (C) => `これまでに${C}回、手が入りました。街でも指折りのにぎわいです。`,
    quiet: (C) => `手が入ったのは${C}回だけの、静かなお店です。`,
    mid: (C) => `これまでに${C}回、手が入っております。`,
    merged: (n) => `小さなお店${n}軒ぶんを、ここにまとめております。`,
    close: ['どうぞ、ごゆっくりご覧くださいませ。', 'またのお越しを、お待ちしております。', '気になる品があれば、いつでもどうぞ。'],
  },
  house: {
    greet: [(P) => `あら、いらっしゃい。ここは${P}の家よ。`, (P) => `まあ、よく来たわね。${P}の家へようこそ。`, (P) => `はいはい、どうぞ上がって。${P}の家よ。`],
    what: [(W) => `ここでは、${W}を預かってるの。`, (W) => `うちには、${W}が住んでるのよ。`, (W) => `${W}の家なの。`],
    part: (X, W) => `「${X}」は、${W}の仲間なの。`,
    plain: [(N) => `ここは、${N}が暮らすふつうの家よ。`, (N) => `${N}が暮らす、街のふつうの家なの。`],
    root: 'どのフォルダにも入っていない、いちばん上のファイルを預かってるの。',
    authors: [(p) => `${p}、手を入れてくれたのよ。`, (p) => `${p}、面倒を見てくれたの。`],
    alone: (A, n, c) => `この家は${A}がひとりで、${n}回${も(c)}手を入れてくれたの。`,
    recent: [(L, A, s) => `${L}${A}が『${s}』って手を入れてったの。`, (W, A, s) => `新しいのは${W}の${A}の『${s}』よ。`],
    stuff: (c) => `この家には${c}。`,
    big: (f, L, many) => `いちばん大きいのは「${f}」、${L}行${many ? 'もあるのよ' : 'よ'}。`,
    one: (f, L, n) => `住んでるのは「${f}」ひとつだけ。${L ? `${L}行の${n}よ。` : `中身は${n}よ。`}`,
    top1: (C) => `この街でいちばんにぎやかな家なの。${C}回も手が入ったのよ。`,
    topN: (C) => `これまでに${C}回も手が入ったの。街でも指折りのにぎやかさよ。`,
    quiet: (C) => `手が入ったのはまだ${C}回。のんびりした家よ。`,
    mid: (C) => `これまでに${C}回、手が入ったのよ。`,
    merged: (n) => `小さな家${n}軒ぶんを、ひとつにまとめてあるの。`,
    close: ['ゆっくりしていってね。', 'またいつでも寄ってちょうだい。', '夜道は暗いから、気をつけて帰ってね。'],
  },
  ruin: {
    greet: [(P) => `おや、旅のお方かね。ここは${P}の古い家じゃ。`, (P) => `よう来なすった。ここは${P}の廃屋じゃよ。`, (P) => `ほう、こんな所まで珍しい。${P}の家へようこそ。`],
    what: [(W) => `ここには、${W}が眠っておる。`, (W) => `${W}が、ひっそり残っておる所じゃ。`],
    part: (X, W) => `「${X}」は、${W}の仲間じゃ。今は静かに眠っておる。`,
    byName: (W) => `名前のとおり、${W}が眠っておる所じゃ。`,
    plain: ['しばらく誰も手を入れておらん、静かな家じゃよ。', '長いこと、そっとしておかれた家でな。'],
    root: 'どのフォルダにも入っていない、いちばん上のファイルが残っておる。',
    oldest: '街の中でも、とりわけ古い一角じゃよ。',
    authors: [(p) => `${p}、ここに通ってくれたもんじゃ。`, (p) => `${p}、手を入れてくれたのう。`],
    alone: (A, n) => `ここに通っておったのは${A}ひとりじゃ。${n}回、手を入れてくれた。`,
    recent: [(W, A, s) => `最後の手入れは${W}、${A}の『${s}』じゃった。`, (L, A, s) => `${L}${A}が『${s}』と手を入れたのが最後じゃ。`],
    stuff: (c) => `今も${c}、残っておる。`,
    big: (f, L, many) => `いちばん大きい「${f}」は、${L}行${many ? 'もあるぞ' : 'じゃ'}。`,
    one: (f, L, n) => `残っておるのは「${f}」ひとつきり${L ? `、${L}行の${n}じゃ。` : 'じゃ。'}`,
    hist: [(C) => `手が入ったのは、ぜんぶで${C}回。そのたびに誰かが来てくれたんじゃ。`, (C) => `これまでに${C}回、手が入った。ひとつひとつが、この家の年輪じゃ。`],
    merged: (n) => `小さな家${n}軒ぶんが、ここに寄り集まっておる。`,
    close: ['古いものには、古いなりの味があるもんじゃ。', 'ほこりも汚れも、この家の歴史のうちじゃよ。', '昔の誰かの暮らしの跡が、まだ残っておるじゃろう。'],
  },
};

// ---------- keeper dialogue ----------
// building: Town building (with .module); keeper: { kind }; town: for comparing with other buildings.
export function keeperLines(building, keeper, town) {
  const m = building.module || {};
  const kind = VOICE[keeper && keeper.kind] ? keeper.kind : VOICE[m.kind] ? m.kind : 'house';
  const v = VOICE[kind];
  const rng = mulberry32(strHash(`dialogue:${building.id}:${m.path}`));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  // buildings of the same kind take turns through the variants, so neighbours differ
  const all = (town && Array.isArray(town.buildings) ? town.buildings : []).filter((b) => b && b.module);
  const same = all.filter((b) => (b.module.kind || 'house') === kind).map((b) => b.id);
  const k = Math.max(0, same.indexOf(building.id)) + (strHash(kind) % 3);
  const turn = (arr, off = 0) => arr[(k + off) % arr.length];

  const info = reasonInfo(m);
  const isRoot = !m.path || m.path === '.';
  const P = isRoot ? '街のおおもと' : `「${m.path}」`;
  const merged = Array.isArray(m.merged) && m.merged.length ? m.merged.length : 0;
  const atLeast = merged ? '以上' : '';     // merged buildings only know lower bounds (layout.mjs absorb)

  const greet = turn(v.greet)(P);

  // what this place is
  let what;
  const mean = isRoot ? null : meaningOf(m, kind, info);
  const contents = contentsPhrase(m.languages, kind);
  if (isRoot) what = v.root;
  else if (mean && mean.byName) what = v.byName(mean.what);
  else if (mean && mean.part) what = v.part(mean.part, mean.what);
  else if (mean) what = turn(v.what, 1)(mean.what);
  else if (kind === 'house') {
    const n = CONTENT_NOUN[info.what] || (contents && contents.top !== 'ファイル' ? contents.top : 'プログラム');
    what = turn(v.plain, 1)(n);
  } else what = turn(v.plain, 1);

  const facts = [];        // { p: priority, t: text }
  // why it is this kind, when the meaning above does not already say it
  if (kind === 'workshop' && info.type === 'build') {
    if (info.items.some((x) => x.startsWith('package.json'))) facts.push({ p: 3, t: v.scripts });
    else if (info.items.includes('.github/workflows')) facts.push({ p: 3, t: v.ci });
    else facts.push({ p: 3, t: v.build(`「${info.items[0]}」`) });
  } else if (kind === 'workshop' && info.type === 'config') facts.push({ p: 3, t: v.config });
  if (kind === 'ruin' && info.type === 'ruinAge') facts.push({ p: 2, t: v.oldest });
  if (merged) facts.push({ p: 1, t: v.merged(merged) });

  // who tends it
  const authors = (Array.isArray(m.authors) ? m.authors : []).filter((a) => a && a.name && a.commits > 0);
  let fAuthors = null;
  if (authors.length === 1 && !merged) fAuthors = v.alone(san(authors[0].name), fmtInt(authors[0].commits), authors[0].commits);
  else if (authors.length) {
    const [a, b] = authors;
    const pair = !b ? `${san(a.name)}が${fmtInt(a.commits)}回${atLeast}`
      : a.commits === b.commits ? `${san(a.name)}と${san(b.name)}が${fmtInt(a.commits)}回${atLeast}ずつ`
        : `${san(a.name)}が${fmtInt(a.commits)}回${atLeast}、${san(b.name)}が${fmtInt(b.commits)}回${atLeast}`;
    fAuthors = pick(v.authors)(pair);
  }

  // the latest change, quoted as written
  let fRecent = null;
  const lc = m.lastCommit;
  if (lc && lc.subject) {
    const w = whenJa(lc.date);
    const who = lc.author ? san(lc.author) : 'だれか';
    const s = shortSubject(lc.subject);
    const i = Math.floor(rng() * v.recent.length);
    if (w) fRecent = v.recent[i](kind === 'ruin' ? (i === 0 ? w : whenLead(w)) : i === 0 ? whenLead(w) : w, who, s);
    else fRecent = kind === 'ruin' ? `最後の手入れは、${who}の『${s}』じゃった。` : `いちばん新しい手入れは、${who}の『${s}』。`;
  }

  // what is inside, and the biggest file
  let fStuff = null;
  const top = (Array.isArray(m.topFiles) ? m.topFiles : []).filter((f) => f && f.path);
  if (m.files === 1 && top.length) {
    const f = top[0];
    fStuff = v.one(base(f.path), f.lines > 0 ? fmtInt(f.lines) : '', fileNoun(extOf(f.path), kind));
  } else if (contents) {
    // contents, then the biggest file if it is worth mentioning; drop the second kind of file
    // (or the biggest file) rather than let the line run long
    const big = top.length && top[0].lines >= 20 ? v.big(base(top[0].path), fmtInt(top[0].lines), top[0].lines >= 1000) : '';
    const one = contentsPhrase(m.languages, kind, 1);
    fStuff = [v.stuff(contents.text) + big, v.stuff(one.text) + big, big, v.stuff(contents.text)]
      .find((t) => t && width(t) <= 46) || v.stuff(one.text);
  }

  // how busy or quiet it is
  let fBusy = null;
  const C = Number.isFinite(m.commits) && m.commits > 0 ? m.commits : 0;
  if (C) {
    const Cs = `${fmtInt(C)}${atLeast}`;
    if (kind === 'ruin') fBusy = { p: 3, t: pick(v.hist)(Cs) };
    else {
      const counted = all.filter((b) => b.module.commits > 0);
      const above = counted.filter((b) => b.module.commits > C).length;
      const tied = counted.filter((b) => b.module.commits === C).length;
      if (!merged && counted.length >= 3 && above === 0 && tied === 1) fBusy = { p: 3, t: v.top1(Cs) };
      else if (!merged && counted.length >= 4 && above < Math.ceil(counted.length / 4) && C >= 10) fBusy = { p: 3, t: v.topN(Cs) };
      else if (C <= 3) fBusy = { p: 3, t: v.quiet(Cs) };
      else fBusy = { p: 1, t: v.mid(Cs) };
    }
  }

  // order: the ruin's keeper starts from history; the others vary between two orders
  const F = (p, t) => (t ? { p, t } : null);
  const ordered = kind === 'ruin'
    ? [...facts, F(5, fRecent), F(4, fAuthors), F(3, fStuff), fBusy]
    : rng() < 0.5
      ? [...facts, F(4, fAuthors), F(3, fStuff), F(5, fRecent), fBusy]
      : [...facts, F(3, fStuff), F(4, fAuthors), F(5, fRecent), fBusy];
  let list = ordered.filter(Boolean);
  while (list.length > 4) {                      // keep the 4 most interesting facts
    let lo = list.length - 1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].p < list[lo].p) lo = i;
    list = list.filter((_, i) => i !== lo);
  }
  return [greet, what, ...list.map((f) => f.t), turn(v.close, 2)].map(spaceOut);
}

// ---------- townsfolk bubble ----------
// def: Town resident { name, commits, homes, lastCommit }. Returns plain text parts.
export function residentBubble(def, town) {
  const n = def.commits | 0;
  const line = n > 0 ? `この街に ${fmtInt(n)} 回手を入れた人` : 'この街に手を入れた人';
  let more = '';
  const lc = def.lastCommit;
  if (lc && lc.subject) {
    const w = whenJa(lc.date);
    more = `${w ? `${w}、` : 'さいごは'}『${shortSubject(lc.subject, 23)}』って手を入れてた`;
  } else if (town && Array.isArray(def.homes) && def.homes.length) {
    const KIND = { workshop: '工房', shop: '店', house: '家', ruin: '廃屋' };
    const b = (town.buildings || []).find((x) => x.id === def.homes[0]);
    if (b && b.module) more = `よく行くのは${b.module.path === '.' ? '街のおおもと' : `「${b.module.path}」`}の${KIND[b.module.kind] || '建物'}`;
  }
  return { name: def.name || '?', line, more: spaceOut(more) };
}
