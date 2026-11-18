import { playerRect } from './screen-space.js';

// Leave a gap around the entire sprite, including when its centre crosses mid-screen.
export function noticeRegion(player, height) {
  const margin = 8, gap = 8;
  const top = player.y + player.h / 2 >= height / 2;
  const room = top ? player.y - gap - margin : height - margin - player.y - player.h - gap;
  return { top, height: Math.max(0, Math.floor(Math.min(height / 2 - 2 * margin, room))) };
}

// Keep the original wide-screen rectangle unless it covers the sprite. If the opposite
// edge has too little room, keep all text in the panel's native scroll area.
export function wideNoticeRegion(panel, player, height, edges = { top: 32, bottom: 18 }) {
  if (panel.x >= player.x + player.w || panel.x + panel.w <= player.x ||
      panel.y >= player.y + player.h || panel.y + panel.h <= player.y) return null;
  const top = panel.y + panel.h / 2 >= height / 2;
  const room = top ? player.y - 8 - edges.top : height - edges.bottom - player.y - player.h - 8;
  return { top, height: Math.max(0, Math.min(panel.h, Math.floor(room))) };
}

// The original contents and typography stay intact. Narrow screens get paging controls;
// wide screens retain their normal layout whenever it clears the player.
export class NoticeReader {
  constructor(panel, edges = { top: 32, bottom: 18 }) {
    this.panel = panel;
    this.edges = edges;
    panel.classList.add('notice-reader');
    this.content = document.createElement('div');
    this.content.className = 'notice-content';
    this.content.append(...panel.childNodes);
    this.controls = document.createElement('div');
    this.controls.className = 'notice-controls';
    this.previous = document.createElement('button');
    this.previous.type = 'button'; this.previous.textContent = '前へ';
    this.progress = document.createElement('span');
    this.progress.setAttribute('aria-live', 'polite');
    this.next = document.createElement('button');
    this.next.type = 'button'; this.next.textContent = '続きを読む';
    this.controls.append(this.previous, this.progress, this.next);
    panel.append(this.content, this.controls);
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.previous.addEventListener('click', () => this.turn(-1));
    this.next.addEventListener('click', () => this.turn(1));
    this.content.addEventListener('scroll', () => this.updateProgress());
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || !this.active() || !this.paged || e.altKey || e.ctrlKey || e.metaKey) return;
      const forward = ['Space', 'Enter', 'NumpadEnter', 'PageDown'].includes(e.code);
      if (!forward && e.code !== 'PageUp') return;
      e.preventDefault(); // a focused button must not activate a second time
      this.turn(e.code === 'PageUp' || (e.code === 'Space' && e.shiftKey) ? -1 : 1);
    });
  }

  active() {
    return this.mobile && this.panel.classList.contains('show') && !this.panel.closest('.intro, .roster-open');
  }

  reset() {
    this.content.scrollTop = this.panel.scrollTop = 0;
    this.wideRect = null;
    if (!this.mobile) this.clearPlacement(); // let the next notice measure its normal height
  }

  clearPlacement() {
    for (const name of ['top', 'bottom', 'max-height', 'overflow-y', 'pointer-events']) this.panel.style.removeProperty(name);
  }

  updateWide(player) {
    // Remeasure only when content, viewport or the normal docking classes change.
    // In particular, scrolling a constrained panel must not reset on every frame.
    const key = `${innerWidth}/${innerHeight}/${this.panel.className}/${this.panel.parentElement?.className}`;
    if (!this.wideRect || this.wideKey !== key) {
      const scroll = this.panel.scrollTop;
      this.clearPlacement();
      const r = this.panel.getBoundingClientRect();
      // offsetTop excludes the notice's brief entrance transform.
      this.wideRect = { x: r.x, y: this.panel.offsetTop, w: r.width, h: r.height };
      this.wideKey = key;
      this.wideScroll = scroll;
    }
    const region = wideNoticeRegion(this.wideRect, player, innerHeight, this.edges);
    if (!region) this.clearPlacement();
    else {
      const style = this.panel.style;
      for (const [key, value] of Object.entries({
        top: region.top ? `${this.edges.top}px` : 'auto',
        bottom: region.top ? 'auto' : `${this.edges.bottom}px`,
        maxHeight: `${region.height}px`, overflowY: 'auto', pointerEvents: 'auto',
      })) {
        if (style[key] !== value) style[key] = value;
      }
    }
    if (this.wideScroll != null) { this.panel.scrollTop = this.wideScroll; this.wideScroll = null; }
  }

  turn(direction) {
    if (!this.active()) return;
    // Overlap a full line so a line straddling a page boundary is readable on the next page.
    this.content.scrollTop += direction * this.step();
    this.updateProgress();
  }

  step() { return Math.max(1, this.content.clientHeight - 40); }

  updateProgress() {
    const max = Math.max(0, this.content.scrollHeight - this.content.clientHeight);
    const pages = Math.ceil(max / this.step()) + 1;
    const page = Math.min(pages, Math.floor((this.content.scrollTop + 1) / this.step()) + 1);
    const text = `${this.content.scrollTop >= max - 1 ? pages : page} / ${pages}`;
    if (this.progress.textContent !== text) this.progress.textContent = text;
    const previousDisabled = this.content.scrollTop <= 0, nextDisabled = this.content.scrollTop >= max - 1;
    if (this.previous.disabled !== previousDisabled) this.previous.disabled = previousDisabled;
    if (this.next.disabled !== nextDisabled) this.next.disabled = nextDisabled;
  }

  update(view, player) {
    const mobile = innerWidth <= 560;
    if (mobile !== this.mobile) {
      this.mobile = mobile;
      this.panel.classList.toggle('mobile', mobile);
      this.clearPlacement();
      this.wideRect = null;
    }
    if (!mobile) {
      if (this.panel.classList.contains('show')) this.updateWide(playerRect(view, player));
      return;
    }
    if (!this.active()) return;
    const region = noticeRegion(playerRect(view, player), innerHeight);
    const style = this.panel.style;
    for (const [key, value] of Object.entries({
      top: region.top ? '8px' : 'auto', bottom: region.top ? 'auto' : '8px', maxHeight: `${region.height}px`,
    })) {
      if (style[key] !== value) style[key] = value;
    }
    const css = getComputedStyle(this.panel);
    const frame = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((n, key) => n + parseFloat(css[key]), 0);
    this.paged = this.content.scrollHeight + frame > region.height + 1;
    this.panel.classList.toggle('paged', this.paged);
    this.updateProgress();
  }
}
