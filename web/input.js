// Keyboard + pointer input. Keyboard: arrows / WASD, Shift = walk slowly. Pointer: click / tap to walk.

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

export class Input {
  constructor(target) {
    this.held = { up: false, down: false, left: false, right: false };
    this.latched = { up: false, down: false, left: false, right: false };   // a tap counts for >= 1 step
    this.keyEvents = 0;
    this.slow = false;
    this.clicks = [];         // queued { x, y } in client px
    this.anyKeyThisFrame = false;
    this.touched = false;     // user has interacted at all
    window.addEventListener('keydown', (e) => {
      this.slow = e.shiftKey;
      const d = KEYMAP[e.code];
      if (d) { this.held[d] = true; this.latched[d] = true; this.touched = true; this.keyEvents++; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      this.slow = e.shiftKey;
      const d = KEYMAP[e.code];
      if (d) { this.held[d] = false; e.preventDefault(); }
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      this.clicks.push({ x: e.clientX, y: e.clientY });
      this.touched = true;
      e.preventDefault();
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  clear() {
    this.held.up = this.held.down = this.held.left = this.held.right = false;
    this.latched.up = this.latched.down = this.latched.left = this.latched.right = false;
    this.slow = false;
  }

  axis(out) {
    const h = this.held, l = this.latched;
    out.x = (h.right || l.right ? 1 : 0) - (h.left || l.left ? 1 : 0);
    out.y = (h.down || l.down ? 1 : 0) - (h.up || l.up ? 1 : 0);
    l.up = l.down = l.left = l.right = false;
    return out;
  }
}
