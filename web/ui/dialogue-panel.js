// Keeper dialogue, typewriter timing and the final offer.
import { keeperLines, keeperOffer } from '../dialogue.js';
import { esc } from './dom.js';

const TYPE_CPS = 30;          // typewriter characters per second
const VISIBLE_LINES = 3;

export function openDialogue(ui, keeper) {
  const b = keeper.building;
  let st = ui.dlgStates.get(b.id);
  if (!st) {
    st = { lines: keeperLines(b, keeper, ui.town), line: 0, chars: 0, wait: 0.35, offer: keeperOffer(b) };
    ui.dlgStates.set(b.id, st);
  }
  ui.dlg = st;
  ui.dlgKeeper = keeper;
  ui.el.dlgName.textContent = keeper.name;
  ui.el.dialogue.classList.add('show');
  ui.renderDialogue(true);
}

export function closeDialogue(ui) {
  ui.dlg = null;
  ui.dlgKeeper = null;
  ui.setOffer(false);
  ui.closeRoster();
  ui.el.dialogue.classList.remove('show');
}

export function setOffer(ui, on) {
  if (on === ui.offerReady) return;
  ui.offerReady = on;
  const c = ui.el.dlgChoice;
  if (!c) return;
  c.innerHTML = on ? '<button type="button" class="choice">▶ 名簿をみる</button><span class="key">Enter</span>' : '';
  c.classList.toggle('show', on);
}

export function skip(ui) {
  const st = ui.dlg;
  if (!st) return;
  const cur = st.lines[st.line];
  if (cur && st.chars < cur.length) st.chars = cur.length;
  else if (st.line < st.lines.length - 1) { st.line++; st.chars = 0; st.wait = 0; }
  ui.renderDialogue(true);
}

export function tickDialogue(ui, dt) {
  const st = ui.dlg;
  if (!st) return;
  const cur = st.lines[st.line];
  if (!cur) return;
  if (st.chars < cur.length) {
    if (st.wait > 0) { st.wait -= dt; return; }
    const before = Math.floor(st.chars);
    st.chars = Math.min(cur.length, st.chars + dt * TYPE_CPS);
    if (Math.floor(st.chars) !== before) ui.renderDialogue(false);
    if (st.chars >= cur.length) st.wait = 1.1 + cur.length * 0.035;
  } else if (st.line < st.lines.length - 1) {
    st.wait -= dt;
    if (st.wait <= 0) { st.line++; st.chars = 0; st.wait = 0; ui.renderDialogue(true); }
  }
}

export function renderDialogue(ui, full) {
  const st = ui.dlg;
  if (!st) return;
  const keep = window.innerHeight < 720 ? 2 : VISIBLE_LINES;      // short windows: fewer lines
  const from = Math.max(0, st.line - (keep - 1));
  let html = '';
  for (let i = from; i <= st.line; i++) {
    const text = i < st.line ? st.lines[i] : st.lines[i].slice(0, Math.floor(st.chars));
    html += `<p class="${i < st.line ? 'old' : 'cur'}">${esc(text)}</p>`;
  }
  const done = st.line >= st.lines.length - 1 && st.chars >= (st.lines[st.line] || '').length;
  html += `<div class="more ${done ? 'done' : ''}">${st.line + 1} / ${st.lines.length}</div>`;
  ui.el.dlgText.innerHTML = html;
  ui.setOffer(!!st.offer && done);
  ui.panelH = ui.el.dialogue.offsetHeight;
}
