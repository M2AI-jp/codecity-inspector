// Arrival intro and repository badge.
import { fmtInt } from '../util.js';
import { $, esc } from './dom.js';

export function showIntro(ui) {
  const el = $('intro');
  if (!el) return;
  const t = ui.town, r = t.repo || {};
  el.querySelector('.intro-title').textContent = r.name ? `${r.name} の街` : 'CodeCity';
  const hall = (t.buildings || []).find((b) => b.facility && b.facility.archetype === 'town_hall');
  const commits = hall && hall.facility.facts && hall.facility.facts.commits;
  const facts = [];
  if (t.buildings && t.buildings.length) facts.push(`建物 ${fmtInt(t.buildings.length)}`);
  if (t.residents && t.residents.length) facts.push(`住人 ${fmtInt(t.residents.length)}`);     // named contributors
  if (t.crowd && t.crowd.length) facts.push(`町の人 ${fmtInt(t.crowd.length)}`);               // ambient townsfolk
  if (commits > 0) facts.push(`コミット ${fmtInt(commits)}`);                                   // non-merge, as at the town hall
  el.querySelector('.intro-sub').textContent = facts.join('・');

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timers = [], root = $('ui');
  const done = () => {
    if (!ui.introOn) return;
    ui.introOn = false;
    timers.forEach(clearTimeout);
    window.removeEventListener('keydown', done, true);
    window.removeEventListener('pointerdown', done, true);
    el.classList.remove('on', 'show', 'out');
    root.classList.remove('intro');
  };
  ui.dismissIntro = done;
  ui.introOn = true;
  window.addEventListener('keydown', done, true);
  window.addEventListener('pointerdown', done, true);
  root.classList.add('intro');
  el.classList.add('on');
  void el.offsetWidth;                                        // start the fade from opacity 0
  el.classList.add('show');
  timers.push(setTimeout(() => el.classList.add('out'), reduce ? 3000 : 2200));
  timers.push(setTimeout(done, 3000));
}

export function renderRepo(ui) {
  const r = ui.town.repo || {};
  const branch = r.branch ? esc(r.branch) : '';
  const head = r.head ? esc(String(r.head).slice(0, 7)) : '';
  const sub = branch || head ? `<div class="sub">${branch}${branch && head ? ' ・ ' : ''}${head}</div>` : '';
  ui.el.repo.innerHTML = `<div class="name">${esc(r.name || 'CodeCity')}</div>${sub}`;
  ui.el.repo.classList.add('show');
}
