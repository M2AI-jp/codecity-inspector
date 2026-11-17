// ディレクトリ名・ファイルの種類・分類の理由から、建物の中身を言い表す。
import { fmtInt, langName } from '../util.js';
import { base, jp } from './text.js';

// ---------- what a directory name means, in plain words ----------
const NAMES = Object.create(null);    // ディレクトリ名・拡張子で引く表は、constructor などの名前でも Object の中身を返さない
const GROUP = Object.create(null);            // name -> 'workshop' | 'shop' | 'house'
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
const NOUN_OF = Object.create(null);
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
export const fileNoun = (ext, kind) => (PROGRAM_EXT.has(ext) ? 'プログラム'
  : kind === 'workshop' && /^(json|jsonc|json5)$/.test(ext) ? '設定' : NOUN_OF[ext] || 'ファイル');
export const extOf = (p) => { const b = base(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : 'none'; };
export const count = (n, nounWord) => {
  if (nounWord === '絵') return `${fmtInt(n)}枚`;
  return n < 10 ? `${n}つ` : `${fmtInt(n)}個`;
};

// "JavaScript のプログラムが31個と、説明書きが2つ"
export function contentsPhrase(languages, kind, maxKinds = 2) {
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
export function reasonInfo(m) {
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
export const CONTENT_NOUN = { コード: 'プログラム', 文書: '説明書き', 画像: '絵', データ: 'データ', 設定: '設定', バイナリ: 'そのままでは読めないファイル' };

// The plain meaning of this place, from the most specific directory name we can explain.
export function meaningOf(m, kind, info) {
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
