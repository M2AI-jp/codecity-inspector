// Guild roster DOM, tabs and the arrow keys borrowed from walking.
import { rosterPages } from '../dialogue.js';
import { $, esc } from './dom.js';

export function initRoster(ui) {
  const r = ui.el.roster;
  if (!r) return;
  r.innerHTML = '<div class="roster-head"><div class="roster-title">接続者ギルドの名簿</div>' +
    '<button type="button" class="roster-close" aria-label="とじる">×</button></div>' +
    '<div class="roster-tabs" role="tablist"></div><div class="roster-body"></div>' +
    '<div class="roster-foot"><span class="keys">← → か Q・E でページをめくる　Esc でとじる</span><span class="touch">上の札を押すとページが変わります</span></div>';
  // clicks inside the window never walk the player or skip the dialogue
  r.addEventListener('pointerdown', (e) => e.stopPropagation());
  // buttons give the focus back, so Space / Enter never "click" a button left focused
  r.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { ui.rosterTab = Number(t.dataset.tab) || 0; ui.renderRoster(); return; }
    if (e.target.closest('.roster-close')) ui.closeRoster();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  const c = ui.el.dlgChoice;
  if (c) {
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.addEventListener('click', (e) => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (e.target.closest('.choice') && ui.dlgKeeper) ui.openRoster(ui.dlgKeeper);
    });
  }
}

export function openRoster(ui, keeper) {
  const b = keeper && keeper.building;
  const fac = b && ((b.data && b.data.facility) || b.facility);
  if (!fac || !ui.el.roster) return;
  ui.rosterPagesList = rosterPages(fac, ui.town);
  if (ui.rosterTab >= ui.rosterPagesList.length) ui.rosterTab = 0;
  ui.rosterOpen = true;
  if (ui.input) {                  // a held ← / → stops here instead of running on under the window
    const h = ui.input.held, l = ui.input.latched;
    h.left = h.right = l.left = l.right = false;
  }
  ui.renderRoster();
  ui.el.roster.classList.add('show');
  (ui.root || $('ui')).classList.add('roster-open');
}

export function closeRoster(ui) {
  if (!ui.rosterOpen) return;
  ui.rosterOpen = false;
  ui.el.roster.classList.remove('show');
  (ui.root || $('ui')).classList.remove('roster-open');
}

export function renderRoster(ui) {
  const pages = ui.rosterPagesList || [];
  const i = Math.max(0, Math.min(pages.length - 1, ui.rosterTab));
  const r = ui.el.roster;
  r.querySelector('.roster-tabs').innerHTML = pages.map((p, k) =>
    `<button type="button" class="tab${k === i ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === i}">${esc(p.label)}</button>`).join('');
  const pg = pages[i];
  const body = r.querySelector('.roster-body');
  if (!pg) { body.innerHTML = ''; return; }
  const rows = pg.rows.length ? pg.rows.map((x) => `<div class="row${x.badge ? '' : ' nobadge'}${x.dim ? ' dim' : ''}${pg.stack ? ' stack' : ''}">` +
    (x.badge ? `<span class="badge">${esc(x.badge)}</span>` : '') +
    `<div class="t">${esc(x.title)}</div>${x.sub ? `<div class="s">${esc(x.sub)}</div>` : ''}</div>`).join('')
    : `<div class="empty">${esc(pg.empty)}</div>`;
  body.innerHTML = `${pg.intro ? `<div class="intro">${esc(pg.intro)}</div>` : ''}<div class="rows">${rows}</div>`;
  body.scrollTop = 0;
}
