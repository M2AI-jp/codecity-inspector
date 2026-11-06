// DOM overlay (Japanese): repo badge, keeper dialogue (typewriter), building facts, resident
// bubble, noticeboard. Everything opens and closes by proximity; no key is needed.

import { KIND_JA, fmtInt, langName } from './util.js';
import { keeperLines, residentBubble, whenJa, shortSubject } from './dialogue.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPE_CPS = 30;          // typewriter characters per second
const VISIBLE_LINES = 3;

export class UI {
  constructor(town) {
    this.town = town;
    this.el = {
      repo: $('repo'), stats: $('stats'), dialogue: $('dialogue'), dlgName: $('dlg-name'),
      dlgText: $('dlg-text'), notice: $('notice'), bubble: $('bubble'), hint: $('hint'), fps: $('fps'),
    };
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
    this.hintShown = null;
  }

  renderRepo() {
    const r = this.town.repo || {};
    const branch = r.branch ? esc(r.branch) : '';
    const head = r.head ? esc(String(r.head).slice(0, 7)) : '';
    const sub = branch || head ? `<div class="sub">${branch}${branch && head ? ' ・ ' : ''}${head}</div>` : '';
    this.el.repo.innerHTML = `<div class="name">${esc(r.name || 'CodeCity')}</div>${sub}`;
    this.el.repo.classList.add('show');
  }

  // --- building facts (secondary panel) -------------------------------------
  showBuilding(b) {
    const el = this.el.stats;
    if (!b || !b.module) { el.classList.remove('show'); return; }
    const m = b.module;
    const kind = KIND_JA[m.kind] || '建物';
    const rows = [];
    if (m.reason && !b.keeper) rows.push(['なぜ' + kind + '？', esc(m.reason)]);   // the keeper says it otherwise
    if (Number.isFinite(m.files)) rows.push(['大きさ', `${fmtInt(m.files)} ファイル・${fmtInt(m.lines)} 行`]);
    const langs = Object.entries(m.languages || {}).filter(([, n]) => n > 0).sort((a, c) => c[1] - a[1]).slice(0, 4);
    if (langs.length) rows.push(['言語', langs.map(([k, n]) => `${esc(langName(k))} ${fmtInt(n)}`).join('・')]);
    const lc = m.lastCommit;
    if (lc) {
      const when = whenJa(lc.date);          // same wording as the keeper, so the two never disagree
      rows.push(['最近の変更', `「${esc(shortSubject(lc.subject || '', 34))}」<span class="dim">${esc(lc.author || '')}${when ? `・${esc(when)}` : ''}</span>`]);
    }
    const authors = (m.authors || []).slice(0, 2);
    if (authors.length) rows.push(['よく触る人', authors.map((a) => `${esc(a.name)} <span class="dim">${fmtInt(a.commits)}回</span>`).join('、')]);
    const files = (m.topFiles || []).slice(0, 2);
    const short = (fp) => (m.path && m.path !== '.' && String(fp).startsWith(`${m.path}/`) ? String(fp).slice(m.path.length + 1) : fp);
    if (files.length) rows.push(['大きいファイル', files.map((f) => `<div class="file">${esc(short(f.path))} <span class="dim">${fmtInt(f.lines)}行</span></div>`).join('')]);
    el.innerHTML = `<div class="head"><span class="kind kind-${esc(m.kind)}">${esc(kind)}</span><span class="path">${esc(m.path === '.' ? '（ルート）' : m.path)}</span></div>` +
      `<div class="grid">${rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>`;
    el.classList.add('show');
  }

  // --- keeper dialogue ---------------------------------------------------------
  openDialogue(keeper) {
    const b = keeper.building;
    let st = this.dlgStates.get(b.id);
    if (!st) {
      st = { lines: keeperLines(b, keeper, this.town), line: 0, chars: 0, wait: 0.35 };
      this.dlgStates.set(b.id, st);
    }
    this.dlg = st;
    this.el.dlgName.textContent = keeper.name;
    this.el.dialogue.classList.add('show');
    this.renderDialogue(true);
  }

  closeDialogue() {
    this.dlg = null;
    this.el.dialogue.classList.remove('show');
  }

  skip() {
    const st = this.dlg;
    if (!st) return;
    const cur = st.lines[st.line];
    if (cur && st.chars < cur.length) st.chars = cur.length;
    else if (st.line < st.lines.length - 1) { st.line++; st.chars = 0; st.wait = 0; }
    this.renderDialogue(true);
  }

  tickDialogue(dt) {
    const st = this.dlg;
    if (!st) return;
    const cur = st.lines[st.line];
    if (!cur) return;
    if (st.chars < cur.length) {
      if (st.wait > 0) { st.wait -= dt; return; }
      const before = Math.floor(st.chars);
      st.chars = Math.min(cur.length, st.chars + dt * TYPE_CPS);
      if (Math.floor(st.chars) !== before) this.renderDialogue(false);
      if (st.chars >= cur.length) st.wait = 1.1 + cur.length * 0.035;
    } else if (st.line < st.lines.length - 1) {
      st.wait -= dt;
      if (st.wait <= 0) { st.line++; st.chars = 0; st.wait = 0; this.renderDialogue(true); }
    }
  }

  renderDialogue(full) {
    const st = this.dlg;
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
    this.el.dlgText.innerHTML = html;
    this.panelH = this.el.dialogue.offsetHeight;
  }

  // --- per-frame update --------------------------------------------------------
  // s: { building, keeper, walker, notice, view:{camX,camY,scale} , dt, playerMoved }
  update(s) {
    if (s.building !== this.curBuilding) { this.curBuilding = s.building; this.showBuilding(s.building); }
    if (s.keeper !== this.curKeeper) {
      this.curKeeper = s.keeper;
      if (s.keeper) this.openDialogue(s.keeper); else this.closeDialogue();
    }
    this.tickDialogue(s.dt);

    this.layout(s);

    // resident bubble
    const w = s.walker;
    const bub = this.el.bubble;
    if (w !== this.bubbleFor) {
      this.bubbleFor = w;
      if (w) {
        const t = residentBubble(w.def || w, this.town);
        bub.innerHTML = `<div><span class="who">${esc(t.name)}</span><span class="sep">─</span>${esc(t.line)}</div>` +
          (t.more ? `<div class="more">${esc(t.more)}</div>` : '');
        bub.classList.add('show');
      } else bub.classList.remove('show');
    }
    if (w) {
      // above the resident's head, or under their feet when the player stands above them,
      // so the bubble never sits on the player
      const v = s.view;
      const below = s.player.ry < w.ry - 4;
      const x = Math.round(((Math.round(w.rx) - v.camX) * v.cssPerPx));
      const y = Math.round(((Math.round(w.ry) + (below ? 4 : -34) - v.camY) * v.cssPerPx));
      if (x !== this.bubbleX || y !== this.bubbleY || below !== this.bubbleBelow) {
        this.bubbleX = x; this.bubbleY = y; this.bubbleBelow = below;
        bub.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${below ? '0' : '-100%'})`;
      }
    }

    // noticeboard (README)
    const showNotice = !!s.notice && !s.keeper;
    if (showNotice !== this.noticeShown) {
      this.noticeShown = showNotice;
      if (showNotice) {
        const r = s.notice;
        this.el.notice.innerHTML = `<div class="label">掲示板</div>${r.title ? `<div class="title">${esc(r.title)}</div>` : ''}${r.excerpt ? `<p>${esc(r.excerpt)}</p>` : ''}`;
        this.el.notice.classList.add('show');
        this.panelH = this.el.notice.offsetHeight;
      } else this.el.notice.classList.remove('show');
    }

    // controls hint fades after the player has moved around for a bit; never covers a dialogue
    if (this.el.hint) {
      if (this.hintTime < 6 && s.playerMoved) this.hintTime += s.dt;
      const want = this.hintTime < 6 && !this.dlg && !this.noticeShown;
      if (want !== this.hintShown) { this.hintShown = want; this.el.hint.classList.toggle('show', want); }
    }
  }

  // Panels never cover the player: the dialogue / noticeboard dock on the screen edge opposite
  // the player's vertical position, the facts panel on the side opposite their horizontal
  // position, and the corner badges hide while the player is under them. Classes only change
  // when the player crosses a threshold (with hysteresis), so the DOM is not touched per frame.
  layout(s) {
    const v = s.view, p = s.player;
    const W = window.innerWidth, H = window.innerHeight;
    const px = (Math.round(p.rx) - v.camX) * v.cssPerPx;
    const py = (Math.round(p.ry) - 14 - v.camY) * v.cssPerPx;      // body centre
    const r = 18 * v.cssPerPx;                                       // player sprite half-size
    let dock = this.dock || 'bottom', side = this.side || 'right';
    // dock where the panel actually fits without reaching the player
    const ph = this.panelH || 160;
    const below = H - 18 - (py + r), above = (py - r) - 32;
    if (dock === 'bottom' && below < ph + 8 && above > below) dock = 'top';
    else if (dock === 'top' && above < ph + 8 && below > above) dock = 'bottom';
    if (side === 'right' && px > W * 0.56) side = 'left'; else if (side === 'left' && px < W * 0.44) side = 'right';
    const underTL = px - r < 380 && py - r < 90;
    const underBL = px - r < 760 && py + r > H - 70;
    const ui = this.root || (this.root = document.getElementById('ui'));
    if (dock !== this.dock) { ui.classList.toggle('dock-top', dock === 'top'); this.dock = dock; }
    if (side !== this.side) { ui.classList.toggle('side-left', side === 'left'); this.side = side; }
    const talking = !!this.dlg || this.noticeShown;
    if (talking !== this.talking) { ui.classList.toggle('talking', talking); this.talking = talking; }
    if (underTL !== this.underTL) { ui.classList.toggle('under-tl', underTL); this.underTL = underTL; }
    if (underBL !== this.underBL) { ui.classList.toggle('under-bl', underBL); this.underBL = underBL; }
  }

  fps(text) { if (this.el.fps) this.el.fps.textContent = text; }
}

export function showError(msg) {
  const el = document.getElementById('error');
  el.innerHTML = `<div class="title">街を開けませんでした</div><p>${esc(msg)}</p>`;
  el.classList.add('show');
}
