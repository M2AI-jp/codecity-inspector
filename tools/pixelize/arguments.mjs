// arguments: Preserve permissive CLI parsing and option insertion order.
import { hexRgb } from './colour.mjs';
// ---------- CLI ----------
export function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2), nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) opt[k] = true; else { opt[k] = nxt; i++; }
  }
  return { pos, opt };
}

export function optionsOf(opt) {
  const xy = (s) => String(s).toLowerCase().split('x').map(Number);
  const o = {};
  if (opt.grid) o.grid = xy(opt.grid);
  if (opt.cell) o.cell = +opt.cell;
  if (opt.size) o.size = xy(opt.size);
  if (opt['char-height']) o.charHeight = +opt['char-height'];
  if (opt.anchor) o.anchor = opt.anchor;
  if (opt.key) o.key = hexRgb(opt.key);
  if (opt.tol) o.tol = +opt.tol;
  if (opt.colors) o.colors = +opt.colors;
  if (opt.fit) o.fit = opt.fit;
  if (opt.tileable) o.tileable = true;
  if (opt['no-despill']) o.despill = false;
  if (opt['dark-boost']) o.darkBoost = +opt['dark-boost'];
  if (opt.phases) o.phases = +opt.phases;
  if (opt['center-by']) o.centerBy = opt['center-by'];
  if (opt['outline-share'] !== undefined) o.outlineShare = +opt['outline-share'];
  if (opt.smooth !== undefined) o.smooth = +opt.smooth;
  return o;
}
