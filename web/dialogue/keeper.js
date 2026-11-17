// 建物の番人。事実を選ぶ順番と、乱数を引く順番を保つ。
import { fmtInt, mulberry32, strHash } from '../util.js';
import { base, san, shortSubject, spaceOut, whenJa, whenLead, width } from './text.js';
import { CONTENT_NOUN, contentsPhrase, extOf, fileNoun, meaningOf, reasonInfo } from './contents.js';
import { VOICE } from './voices.js';
import { FACILITY_VOICE } from './facility-voices.js';
import { facilityLines } from './facility.js';

// What a keeper says about their building, in plain, warm Japanese that a non-engineer can follow.
// Keepers are roles (工房の親方 / 商店の主人 / 家の人 / 廃屋の管理人), not people. Every claim comes
// from the module data (path, kind, reason, files, authors, lastCommit, topFiles, commits) or the
// fixed meaning of each kind (PRODUCT.md §4); directory names are explained only by what the name
// itself means. Missing data is skipped, never filled in.
//
// Shape: greeting → what this place is → 2–4 facts → a short closing line (4–7 lines in all).
// Wording varies per building (seeded by building.id and its place among buildings of its kind).

// ---------- keeper dialogue ----------
// building: Town building (with .module); keeper: { kind }; town: for comparing with other buildings.
export function keeperLines(building, keeper, town) {
  const fac = (building.data && building.data.facility) || building.facility;
  if (fac && FACILITY_VOICE[fac.archetype]) return facilityLines(building, fac, town);
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

  // construction in progress: files of this place changed in the working tree, not yet committed
  const dirty = m.works && m.works.dirty > 0 ? m.works.dirty : 0;
  if (dirty) facts.unshift({ p: 6, t: v.works(fmtInt(dirty)) });

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
