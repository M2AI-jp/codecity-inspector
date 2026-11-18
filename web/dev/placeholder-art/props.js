// Keep the debug prop catalogue together so its drawing order and manifest fields stay aligned.
import { mk } from './shared.js';

function prop(w, h, draw) { const c = mk(w, h); draw(c.getContext('2d')); return c.toDataURL(); }

export function placeholderProps() {
  return {
    lamp: { src: prop(9, 28, (g) => { g.fillStyle = '#2a2a30'; g.fillRect(3, 6, 3, 22); g.fillRect(1, 26, 7, 2); g.fillStyle = '#3a3640'; g.fillRect(1, 0, 7, 8); g.fillStyle = '#ffd88a'; g.fillRect(2, 2, 5, 5); }), origin: [4, 27], solid: [-2, -2, 4, 3], light: [0, -23, 60] },
    tree: { src: prop(32, 42, (g) => { g.fillStyle = '#3b2a1e'; g.fillRect(14, 26, 5, 16); g.fillStyle = '#24402a'; g.fillRect(3, 6, 26, 22); g.fillRect(7, 1, 18, 30); g.fillStyle = '#2f5234'; g.fillRect(8, 4, 12, 10); }), origin: [16, 41], solid: [-3, -3, 6, 4], light: null },
    bush: { src: prop(16, 11, (g) => { g.fillStyle = '#2a4a2e'; g.fillRect(1, 3, 14, 8); g.fillRect(4, 0, 8, 11); g.fillStyle = '#386040'; g.fillRect(4, 2, 5, 3); }), origin: [8, 10], solid: null, light: null },
    barrel: { src: prop(10, 13, (g) => { g.fillStyle = '#6a4428'; g.fillRect(1, 0, 8, 13); g.fillStyle = '#3a2a20'; g.fillRect(1, 3, 8, 1); g.fillRect(1, 9, 8, 1); }), origin: [5, 12], solid: [-4, -4, 8, 5], light: null },
    crate: { src: prop(12, 12, (g) => { g.fillStyle = '#7a5a34'; g.fillRect(0, 0, 12, 12); g.fillStyle = '#4e3a22'; g.strokeStyle = '#4e3a22'; g.fillRect(0, 0, 12, 1); g.fillRect(0, 11, 12, 1); g.fillRect(5, 0, 2, 12); }), origin: [6, 11], solid: [-5, -5, 10, 6], light: null },
    bench: { src: prop(20, 10, (g) => { g.fillStyle = '#5a3e28'; g.fillRect(0, 2, 20, 4); g.fillStyle = '#3a2a1e'; g.fillRect(2, 6, 2, 4); g.fillRect(16, 6, 2, 4); }), origin: [10, 9], solid: [-9, -4, 18, 5], light: null },
    well: { src: prop(24, 24, (g) => { g.fillStyle = '#5c5a60'; g.fillRect(1, 10, 22, 13); g.fillStyle = '#16202c'; g.fillRect(4, 12, 16, 6); g.fillStyle = '#4a3424'; g.fillRect(2, 0, 2, 12); g.fillRect(20, 0, 2, 12); g.fillRect(1, 0, 22, 3); }), origin: [12, 21], solid: [-10, -8, 20, 10], light: null },
    noticeboard: { src: prop(20, 24, (g) => { g.fillStyle = '#4a3424'; g.fillRect(2, 8, 2, 16); g.fillRect(16, 8, 2, 16); g.fillStyle = '#6e4e30'; g.fillRect(0, 0, 20, 14); g.fillStyle = '#d8ccb0'; g.fillRect(3, 3, 6, 7); g.fillRect(11, 2, 6, 5); }), origin: [10, 23], solid: [-8, -3, 16, 4], light: null },
    fence: { src: prop(16, 10, (g) => { g.fillStyle = '#5a4a3a'; g.fillRect(0, 3, 16, 2); g.fillRect(0, 7, 16, 1); g.fillRect(1, 0, 2, 10); g.fillRect(13, 0, 2, 10); }), origin: [8, 9], solid: [-8, -3, 16, 3], light: null },
  };
}
