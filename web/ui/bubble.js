import { residentBubble, contractorBubble } from '../dialogue.js';
import { placeBubble, playerRect } from '../screen-space.js';
import { esc } from './dom.js';

export function updateBubble(ui, s) {
  // resident bubble
  const w = s.walker;
  const bub = ui.el.bubble;
  if (w !== ui.bubbleFor) {
    ui.bubbleFor = w;
    if (w) {
      const t = w.contractor ? contractorBubble(w.def, ui.town) : residentBubble(w.local ? w : (w.def || w), ui.town);
      bub.innerHTML = `<div><span class="who">${esc(t.name)}</span><span class="sep">─</span>${esc(t.line)}</div>` +
        (t.more ? `<div class="more">${esc(t.more)}</div>` : '') + (t.note ? [].concat(t.note).map((n) => `<div class="note">${esc(n)}</div>`).join('') : '');
      bub.classList.toggle('wrap', !!t.note);
      bub.classList.add('show');
    } else bub.classList.remove('show');
  }
  if (w) {
    // above the resident's head, or under their feet when the player stands above them,
    // so the bubble never sits on the player
    const v = s.view;
    const below = s.player.ry < w.ry - 4;
    const x = (Math.round(w.rx) - v.camX) * v.cssPerPx;
    const y = (Math.round(w.ry) + (below ? 4 : -34) - v.camY) * v.cssPerPx;
    placeBubble(bub, x, y, below, playerRect(v, s.player));
  }
}
