import { playerRect } from './screen-space.js';

// Leave a gap around the entire sprite, including when its centre crosses mid-screen.
export function noticeRegion(player, height) {
  const margin = 8, gap = 8;
  const top = player.y + player.h / 2 >= height / 2;
  const room = top ? player.y - gap - margin : height - margin - player.y - player.h - gap;
  return { top, height: Math.max(0, Math.floor(Math.min(height / 2 - 2 * margin, room))) };
}

// The original contents and typography stay intact. Only narrow screens get a scroll window
// and paging controls; wide screens keep the original panel's size and position.
export class NoticeReader {
  constructor(panel) {
    this.panel = panel;
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

  reset() { this.content.scrollTop = 0; }

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
      if (!mobile) {
        for (const name of ['top', 'bottom', 'max-height']) this.panel.style.removeProperty(name);
      }
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
