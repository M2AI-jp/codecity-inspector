// Canvas dimensions and integer device-pixel scaling, including silent DPR changes.
import { TILE as T, NATIVE_TARGET_W } from './config.js';

export function createView(canvas, renderer) {
  const view = { vw: 480, vh: 270, scale: 1, cssPerPx: 1, camX: 0, camY: 0 };
  let lastW = 0, lastH = 0, lastDpr = 0;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    lastW = window.innerWidth; lastH = window.innerHeight; lastDpr = dpr;
    const dw = Math.max(1, Math.round(window.innerWidth * dpr));
    const dh = Math.max(1, Math.round(window.innerHeight * dpr));
    const targetW = Math.max(12 * T, Math.min(NATIVE_TARGET_W, lastW / 2));
    const scale = Math.max(Math.ceil(2 * dpr), Math.ceil(dw / targetW));
    view.scale = scale;
    view.vw = Math.ceil(dw / scale);
    view.vh = Math.ceil(dh / scale);
    view.cssPerPx = scale / dpr;
    canvas.width = view.vw; canvas.height = view.vh;
    canvas.style.width = `${(view.vw * scale) / dpr}px`;
    canvas.style.height = `${(view.vh * scale) / dpr}px`;
    renderer.ctx.imageSmoothingEnabled = false;
  }
  resize();
  window.addEventListener('resize', resize);
  // also catch size / DPR changes that arrive without a resize event (monitor moves, emulation)
  const checkSize = () => {
    if (window.innerWidth !== lastW || window.innerHeight !== lastH || (window.devicePixelRatio || 1) !== lastDpr) resize();
  };

  return { view, checkSize };
}
