// Secondary building panel: trim lower-priority rows until the panel fits.
import { KIND_JA, fmtInt, langName } from '../util.js';
import { whenJa, shortSubject } from '../dialogue.js';
import { esc } from './dom.js';

// Long paths wrap into a tall column in the narrow facts panel (and push its last rows off the
// bottom): keep the end of the path (the file / folder name) and elide the front.
function fitPath(p, max) {
  p = String(p ?? '');
  if (p.length <= max) return p;
  const segs = p.split('/');
  let out = segs.pop();
  if (out.length > max) return `${out.slice(0, Math.ceil(max / 2) - 1)}…${out.slice(-Math.floor(max / 2))}`;
  while (segs.length && out.length + segs[segs.length - 1].length + 3 <= max) out = `${segs.pop()}/${out}`;
  return segs.length ? `…/${out}` : out;
}

const FACT_TRIM = 10;         // facts panel: how many trim steps there are (factsHTML)

export function showBuilding(ui, b) {
  const el = ui.el.stats;
  if (!b || !b.module) { el.classList.remove('show'); return; }
  el.classList.remove('scroll');
  let t = 0;
  for (;;) {
    el.innerHTML = ui.factsHTML(b, t);
    if (el.scrollHeight <= el.clientHeight + 1 || t >= FACT_TRIM) break;
    t++;
  }
  if (el.scrollHeight > el.clientHeight + 1) { el.classList.add('scroll'); el.scrollTop = 0; }
  el.classList.add('show');
}

export function factsHTML(ui, b, t) {
  const m = b.module;
  const fac = b.data && b.data.facility;
  const kind = KIND_JA[m.kind] || (fac && fac.name) || '建物';
  const rows = [];
  if (m.reason && (!b.keeper || fac)) rows.push(['なぜ' + kind + '？', esc(m.reason)]);   // the keeper says it otherwise
  if (fac && fac.evidence && fac.evidence.length && t < 10) {
    const ev = fac.evidence.filter((p) => p !== '.git').slice(0, t >= 2 ? 1 : 2);
    const more = fac.evidenceCount > ev.length + (fac.evidence.includes('.git') ? 1 : 0) ? ` <span class="dim">ほか ${fmtInt(fac.evidenceCount - ev.length)}</span>` : '';
    if (ev.length) rows.push(['根拠', ev.map((p) => `<div class="file" title="${esc(p)}">${esc(fitPath(p, 24))}</div>`).join('') + more]);
  }
  const merged = fac && fac.merged ? fac.merged.filter((p) => p !== m.path) : [];     // the header already names m.path
  if (merged.length && t < 6) rows.push(['まとめた所', esc(merged.slice(0, 3).join('、'))]);
  if (Number.isFinite(m.files) && t < 7) rows.push(['大きさ', `${fmtInt(m.files)} ファイル・${fmtInt(m.lines)} 行`]);
  const langs = Object.entries(m.languages || {}).filter(([, n]) => n > 0).sort((a, c) => c[1] - a[1]).slice(0, 4);
  if (langs.length && t < 3) rows.push(['言語', langs.map(([k, n]) => `${esc(langName(k))} ${fmtInt(n)}`).join('・')]);
  const lc = m.lastCommit;
  if (lc && t < 9) {
    const when = whenJa(lc.date);          // same wording as the keeper, so the two never disagree
    rows.push(['最近の変更', `「${esc(shortSubject(lc.subject || '', 34))}」<span class="dim">${esc(lc.author || '')}${when ? `・${esc(when)}` : ''}</span>`]);
  }
  const authors = (m.authors || []).slice(0, t >= 5 ? 1 : 2);
  // counts are non-merge commits (as at the town hall); where history was read only up to a limit, say so
  const hall = (ui.town.buildings || []).find((x) => x.facility && x.facility.archetype === 'town_hall');
  const win = hall && hall.facility.facts && hall.facility.facts.contributorsWindow;
  if (authors.length && t < 8) rows.push(['よく触る人', authors.map((a) => `${esc(a.name)} <span class="dim">${fmtInt(a.commits)}回</span>`).join('、') + (win ? ` <span class="dim">（直近 ${fmtInt(win)} 件）</span>` : '')]);
  const files = (m.topFiles || []).slice(0, t >= 1 ? 1 : 2);
  const short = (fp) => (m.path && m.path !== '.' && String(fp).startsWith(`${m.path}/`) ? String(fp).slice(m.path.length + 1) : fp);
  if (files.length && t < 4) rows.push(['大きいファイル', files.map((f) => `<div class="file">${esc(fitPath(short(f.path), 24))} <span class="dim">${fmtInt(f.lines)}行</span></div>`).join('')]);
  return `<div class="head"><span class="kind kind-${esc(m.kind)}">${esc(kind)}</span><span class="path" title="${esc(m.path)}">${esc(m.path === '.' ? '（ルート）' : fitPath(m.path, 40))}</span></div>` +
    `<div class="grid">${(fac ? rows.filter(([k]) => k !== '大きいファイル' && k !== '言語' && (k !== '大きさ' || (fac.merged && fac.merged.length))) : rows).map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>`;
}
