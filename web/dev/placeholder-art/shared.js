// Share canvas sizing and colour arithmetic so each debug drawing uses identical pixel rules.
export const T = 16;
export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
export const shade = (c, k) => rgb(c[0] * k, c[1] * k, c[2] * k);
