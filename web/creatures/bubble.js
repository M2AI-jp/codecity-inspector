// Lazy creature bubble DOM, factual text, and screen placement.
import { creatureVoice } from '../dialogue/creature-voices.js';
import { placeBubble, playerRect } from '../screen-space.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MEANING = {
  pigeon: () => 'このリポジトリが使っている道具',
  dog: () => 'リポジトリの手伝いをするbot',
  cat: (c) => (c.meaning === 'ruin' ? '長く触られていない場所で眠っている' : c.meaning === 'cron' ? '決まった時間に動く仕事' : '裏で動く仕事'),
};
const KIND_JA = { pigeon: '鳩', dog: '犬', cat: '猫' };

export function createCreatureBubble(list) {
  let el = null, cur = null;
  const bubbleEl = () => {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'creature-bubble';
    (document.getElementById('ui') || document.body).appendChild(el);
    return el;
  };

  return {
    bubble(view, player, best) {
      if (!list.length) return;
      const b = bubbleEl();
      if (best !== cur) {
        cur = best;
        document.getElementById('ui')?.classList.toggle('creature-talking', !!best);
        if (best) {
          const m = MEANING[best.kind](best.d);
          const voice = creatureVoice(best.d);
          b.innerHTML = `<div><span style="font-weight:700;color:#d8ecff">${KIND_JA[best.kind]}「${esc(voice.name)}」</span>`
            + `<span style="color:#d6ccb8">（${esc(m)}）</span></div>`
            + (voice.reason ? `<div class="evidence">${esc(voice.reason)}</div>` : '');
          b.style.opacity = '1';
        } else b.style.opacity = '0';
      }
      if (best) {
        const below = player.ry < best.ry - 4;
        const head = best.sheet ? best.sheet.py + 3 : 18;
        // keep the whole bubble on screen (a long workflow name near the edge would run off it)
        const cx = (Math.round(best.rx) - view.camX) * view.cssPerPx;
        const y = Math.round((Math.round(best.ry) + (below ? 5 : -head) - view.camY) * view.cssPerPx);
        placeBubble(b, cx, y, below, playerRect(view, player));
      }
    },
    get current() { return cur; },
  };
}
