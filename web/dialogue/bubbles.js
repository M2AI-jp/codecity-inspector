// 住人・町の人・外部工務店の吹き出し。
import { fmtInt } from '../util.js';
import { san, shortSubject, spaceOut, whenJa, whenLead, width } from './text.js';

// ---------- townsfolk bubble ----------
// def: Town resident { name, commits, homes, lastCommit }. Returns plain text parts.
export function residentBubble(def, town) {
  if (def && def.local) return localBubble(def, town);
  const n = def.commits | 0;
  // 回数は役場と同じ数え方（マージを除く）。履歴を上限まで読んだ街では、その範囲で数えたと言う
  const hall = town && (town.buildings || []).find((b) => b.facility && b.facility.archetype === 'town_hall');
  const win = hall && hall.facility.facts && hall.facility.facts.contributorsWindow;
  const line = n > 0 ? (win ? `直近 ${fmtInt(win)} 件のうち ${fmtInt(n)} 回手を入れた人` : `この街に ${fmtInt(n)} 回手を入れた人`) : 'この街に手を入れた人';
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

// An ambient townsperson (常連): which building they belong to, and one true fact about it.
function localBubble(loc, town) {
  const b = loc.home && loc.home.data;
  const m = (b && b.module) || {};
  const fac = b && b.facility;
  const segs = String(m.path || '').split('/');
  const place = fac ? fac.name : !m.path || m.path === '.' ? '街のおおもと' : `「${width(m.path) > 18 ? segs[segs.length - 1] : m.path}」`;
  const line = `${place}の常連`;
  const latest = town && town.repo && Date.parse(town.repo.latestCommitDate);
  const fresh = Number.isFinite(latest) && Date.now() - latest < 14 * 86400e3;
  const days = (town && town.repo && town.repo.recentDays) || 90;
  const n = m.recent | 0;
  const busy = n > 0 ? (fresh ? (n >= 10 ? `最近にぎやか（この${days}日で${fmtInt(n)}回）` : `この${days}日で${fmtInt(n)}回、手が入った`)
    : `最後のコミットまでの${days}日で${fmtInt(n)}回、手が入った`) : '';
  let more = busy;
  const lc = m.lastCommit;
  if (loc.def && loc.def.fact === 1 && lc && lc.subject) {
    const w = whenJa(lc.date);
    more = `${w ? whenLead(w) : ''}${lc.author ? san(lc.author) : 'だれか'}が『${shortSubject(lc.subject, 20)}』と手を入れた`;
  }
  return { name: '町の人', line: spaceOut(line), more: spaceOut(more) };
}

// ---------- 外部工務店の代理人（town.contractors） ----------
// An external code-generating agent named in this town's commits. Its "done" is a self-report.
export function contractorBubble(def, town) {
  const days = (town && town.repo && town.repo.recentDays) || 90;
  const latest = town && town.repo && Date.parse(town.repo.latestCommitDate);
  const fresh = Number.isFinite(latest) && Date.now() - latest < 14 * 86400e3;
  const hall = town && (town.buildings || []).find((b) => b.facility && b.facility.archetype === 'town_hall');
  const win = hall && hall.facility.facts && hall.facility.facts.contributorsWindow;
  const n = def.commits | 0, r = def.recent | 0;
  const more = r > 0
    ? `この街で${fresh ? `最近${days}日` : `最後のコミットまでの${days}日`}に${fmtInt(r)}件の工事に名前があります`
    : n > 0 ? `${win ? `直近${fmtInt(win)}件の記録のうち` : 'この街の'}${fmtInt(n)}件の工事に名前があります` : '';
  const dojo = town && (town.buildings || []).some((b) => b.facility && b.facility.archetype === 'dojo');
  const note = ['工事の報告は自己申告です', `動くかどうかは${dojo ? '道場で' : '、動かして'}確かめてください`];
  return { name: def.name || '外部工務店', line: '外部工務店の代理人です', more: spaceOut(more), note };
}
