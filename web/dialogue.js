// What a keeper says about their building, in plain, warm Japanese. Keepers are roles
// (工房の親方 / 商店の主人 / 家の人 / 廃屋の管理人), not people, and speak only facts from the
// module data plus the fixed meaning of each kind (PRODUCT.md §4). Missing data is skipped.

import { fmtInt, langName, relativeDateJa } from './util.js';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[。.]$/, '');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const base = (p) => String(p || '').split('/').pop();

export function placeName(module) {
  if (!module) return 'この建物';
  return module.path === '.' || !module.path ? 'リポジトリのいちばん上の階層' : `「${module.path}」`;
}

const VOICE = {
  workshop: {
    greet: (P) => `おう、よく来たな。ここは${P}の工房だ。`,
    meaning: 'ビルドやテストみたいな、街を動かすための作業をする場所さ。',
    reason: (R) => `工房になっているのは「${R}」からだ。`,
    authors1: (a, n) => `ここでいちばん手を動かしているのは${a}さんで、${n}回だ。`,
    authors2: (a, n, b, m) => `ここでいちばん手を動かしているのは${a}さん（${n}回）、その次が${b}さん（${m}回）だ。`,
    recent: (when, who, subj) => `最近の仕事は${when}${who}の「${subj}」だな。`,
    file: (f, l) => `いちばん大きな道具は「${f}」で、${l}行ある。`,
    size: (F, L) => `ファイルは${F}個、ぜんぶで${L}行だ。`,
    lang1: (x) => `ファイルはぜんぶ${x}だ。`,
    lang: (x, n) => `${x}のファイルがいちばん多くて、${n}個だ。`,
    commits: (C) => `この工房に関わるコミットは、ぜんぶで${C}回だ。`,
  },
  shop: {
    greet: (P) => `いらっしゃいませ。ここは${P}の商店です。`,
    meaning: '画面や見た目など、使う人の目にふれる部分をあつかっています。',
    reason: (R) => `商店になっているのは「${R}」からです。`,
    authors1: (a, n) => `いちばんよく手を入れているのは${a}さんで、${n}回です。`,
    authors2: (a, n, b, m) => `いちばんよく手を入れているのは${a}さん（${n}回）、次が${b}さん（${m}回）です。`,
    recent: (when, who, subj) => `最近の変更は${when}${who}の「${subj}」です。`,
    file: (f, l) => `いちばん大きな品は「${f}」で、${l}行あります。`,
    size: (F, L) => `ファイルは${F}個、ぜんぶで${L}行あります。`,
    lang1: (x) => `ファイルはぜんぶ${x}です。`,
    lang: (x, n) => `${x}のファイルがいちばん多くて、${n}個です。`,
    commits: (C) => `このお店に関わるコミットは、ぜんぶで${C}回です。`,
  },
  house: {
    greet: (P) => `あら、いらっしゃい。ここは${P}の家よ。`,
    meaning: 'この街のふだんの仕事、つまり機能やしくみが暮らしているところなの。',
    reason: (R) => `住宅になっているのは「${R}」からなのよ。`,
    authors1: (a, n) => `よく手を入れてくれるのは${a}さんで、${n}回。`,
    authors2: (a, n, b, m) => `よく手を入れてくれるのは${a}さん（${n}回）と${b}さん（${m}回）。`,
    recent: (when, who, subj) => `最近の変更は${when}${who}の「${subj}」よ。`,
    file: (f, l) => `いちばん大きいのは「${f}」で、${l}行あるの。`,
    size: (F, L) => `ファイルは${F}個、ぜんぶで${L}行あるのよ。`,
    lang1: (x) => `ファイルはぜんぶ${x}よ。`,
    lang: (x, n) => `${x}のファイルがいちばん多くて、${n}個。`,
    commits: (C) => `この家に関わるコミットは、ぜんぶで${C}回よ。`,
  },
  ruin: {
    greet: (P) => `おや、いらっしゃい。ここは${P}の廃屋じゃ。`,
    meaning: 'しばらく誰も手を入れていない、静かな場所じゃよ。悪いところではない。',
    reason: (R) => `廃屋になっているのは「${R}」からじゃ。`,
    authors1: (a, n) => `ここに手を入れていたのは${a}さんで、${n}回じゃ。`,
    authors2: (a, n, b, m) => `ここに手を入れていたのは${a}さん（${n}回）と${b}さん（${m}回）じゃ。`,
    recent: (when, who, subj) => `最後に手が入ったのは${when}${who}の「${subj}」じゃった。`,
    file: (f, l) => `いちばん大きいのは「${f}」で、${l}行残っておる。`,
    size: (F, L) => `ファイルは${F}個、ぜんぶで${L}行じゃ。`,
    lang1: (x) => `ファイルはぜんぶ${x}じゃ。`,
    lang: (x, n) => `${x}のファイルがいちばん多くて、${n}個じゃ。`,
    commits: (C) => `ここに関わるコミットは、ぜんぶで${C}回じゃった。`,
  },
};

export function keeperLines(building, keeper) {
  const m = building.module || {};
  const v = VOICE[keeper && keeper.kind] || VOICE.house;
  const lines = [v.greet(placeName(m)), v.meaning];
  if (m.reason) lines.push(v.reason(clean(m.reason)));

  const authors = Array.isArray(m.authors) ? m.authors.filter((a) => a && a.name) : [];
  if (authors.length >= 2) lines.push(v.authors2(authors[0].name, fmtInt(authors[0].commits), authors[1].name, fmtInt(authors[1].commits)));
  else if (authors.length === 1) lines.push(v.authors1(authors[0].name, fmtInt(authors[0].commits)));

  const lc = m.lastCommit;
  if (lc && lc.subject) {
    const when = relativeDateJa(lc.date);
    lines.push(v.recent(when ? `${when}、` : '', lc.author ? `${lc.author}さん` : '誰か', cut(clean(lc.subject), 48)));
  }

  const top = Array.isArray(m.topFiles) ? m.topFiles.filter((f) => f && f.path) : [];
  if (top.length) lines.push(v.file(cut(base(top[0].path), 40), fmtInt(top[0].lines)));

  if (Number.isFinite(m.files) && m.files > 0 && Number.isFinite(m.lines) && m.lines > 0) lines.push(v.size(fmtInt(m.files), fmtInt(m.lines)));
  const langs = Object.entries(m.languages || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (langs.length === 1) lines.push(v.lang1(langName(langs[0][0])));
  else if (langs.length > 1) lines.push(v.lang(langName(langs[0][0]), fmtInt(langs[0][1])));
  if (Number.isFinite(m.commits) && m.commits > 0) lines.push(v.commits(fmtInt(m.commits)));
  return lines;
}
