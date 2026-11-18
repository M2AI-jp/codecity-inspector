// DOM UI entry: keep public state, event registration and per-frame ordering together.
import { NoticeReader } from './notice-reader.js';
import { $, esc } from './ui/dom.js';
import { showIntro, renderRepo } from './ui/arrival.js';
import { showBuilding, factsHTML } from './ui/building-facts.js';
import { openDialogue, closeDialogue, setOffer, skip, tickDialogue, renderDialogue } from './ui/dialogue-panel.js';
import { initRoster, openRoster, closeRoster, renderRoster } from './ui/roster.js';
import { onKey } from './ui/keyboard.js';
import { layout } from './ui/layout.js';
import { updateBubble } from './ui/bubble.js';
import { updateNotice } from './ui/notice.js';
import { updateHint } from './ui/hint.js';

export class UI {
  constructor(town) {
    this.town = town;
    this.el = {
      repo: $('repo'), stats: $('stats'), dialogue: $('dialogue'), dlgName: $('dlg-name'),
      dlgText: $('dlg-text'), dlgChoice: $('dlg-choice'), notice: $('notice'), bubble: $('bubble'), hint: $('hint'), fps: $('fps'),
      roster: $('roster'),
    };
    this.input = null;            // web/input.js, set by main.js (the roster borrows ← / → while it is open)
    this.rosterOpen = false;
    this.rosterTab = 0;
    this.offerReady = false;
    this.noticeReader = new NoticeReader(this.el.notice);
    this.initRoster();
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.curBuilding = null;
    this.curKeeper = null;
    this.dlg = null;
    this.dlgStates = new Map();
    this.bubbleFor = null;
    this.bubbleX = -1; this.bubbleY = -1;
    this.noticeShown = false;
    this.hintTime = 0;
    this.renderRepo();
    this.el.dialogue.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.skip(); });
    // the facts panel fits the window it is shown in: refit when the window changes size
    window.addEventListener('resize', () => { if (this.curBuilding) this.showBuilding(this.curBuilding); });
    this.hintShown = null;
    this.showIntro();
  }

  // Public methods keep the same UI instance as the shared state of every panel.
  showIntro() { return showIntro(this); }
  renderRepo() { return renderRepo(this); }
  showBuilding(b) { return showBuilding(this, b); }
  factsHTML(b, t) { return factsHTML(this, b, t); }
  openDialogue(keeper) { return openDialogue(this, keeper); }
  closeDialogue() { return closeDialogue(this); }
  setOffer(on) { return setOffer(this, on); }
  onKey(e) { return onKey(this, e); }
  initRoster() { return initRoster(this); }
  openRoster(keeper) { return openRoster(this, keeper); }
  closeRoster() { return closeRoster(this); }
  renderRoster() { return renderRoster(this); }
  skip() { return skip(this); }
  tickDialogue(dt) { return tickDialogue(this, dt); }
  renderDialogue(full) { return renderDialogue(this, full); }

  // s: { building, keeper, walker, notice, view, dt, playerMoved, player }
  update(s) {
    if (this.introOn && s.playerMoved) this.dismissIntro();
    if (s.building !== this.curBuilding) { this.curBuilding = s.building; this.showBuilding(s.building); }
    if (s.keeper !== this.curKeeper) {
      this.curKeeper = s.keeper;
      if (s.keeper) this.openDialogue(s.keeper); else this.closeDialogue();
    }
    this.tickDialogue(s.dt);

    this.layout(s);

    updateBubble(this, s);
    updateNotice(this, s);
    updateHint(this, s);
  }

  layout(s) { return layout(this, s); }
  fps(text) { if (this.el.fps) this.el.fps.textContent = text; }
}

export function showError(msg) {
  const el = document.getElementById('error');
  el.innerHTML = `<div class="title">街を開けませんでした</div><p>${esc(msg)}</p>`;
  el.classList.add('show');
}
