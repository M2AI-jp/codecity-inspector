#!/usr/bin/env node
// Turn AI "pseudo pixel art" (blurry, unaligned art-pixel blocks) into exact native-resolution sprites.
// See README.md for usage. Exported: pixelize(img, opts) -> { image, report }.
import { fileURLToPath } from 'node:url';
import { prepareSource } from './pixelize/seamless.mjs';
import { prepareBackground } from './pixelize/background.mjs';
import { collectFrames, sheetScale } from './pixelize/frames.mjs';
import { buildPalette } from './pixelize/palette.mjs';
import { sampleFrames } from './pixelize/sample-frames.mjs';
import { postprocess } from './pixelize/postprocess.mjs';
import { finishReport } from './pixelize/report.mjs';
import { runCLI } from './pixelize/cli.mjs';

export { oklab, oklabToRgb } from './pixelize/colour.mjs';
export { kmeans } from './pixelize/kmeans.mjs';
export { seamRatio } from './pixelize/seamless.mjs';

// ---------- main ----------
export function pixelize(input, opts = {}) {
  const o = {
    grid: [1, 1], cell: 32, size: null, charHeight: 26, anchor: 'bottom-center', key: [255, 0, 255], tol: 120,
    colors: 0, fit: 'contain', tileable: false, despill: true, fineColors: 64, voteGroups: 16, darkBoost: 1.35,
    phases: 6, centerBy: null, despeckle: 2, outlineShare: 0.25, smooth: 0.09, ...opts,
  };
  const [cols, rows] = o.grid;
  const report = { input: `${input.width}x${input.height}` };
  const sheet1 = cols === 1 && rows === 1 && o.size;
  const cellW = sheet1 ? o.size[0] : o.cell, cellH = sheet1 ? o.size[1] : o.cell;
  const centerBy = o.centerBy ?? (sheet1 ? 'bbox' : 'centroid');
  const stretch = o.fit === 'stretch';
  const src = prepareSource(input, o, stretch, report);
  const { img, mask } = prepareBackground(src, o, stretch, report);
  const { frames, live } = collectFrames(img, mask, cols, rows, stretch, report);
  const pal = buildPalette(img, mask, o.fineColors, o.voteGroups);
  const { sx, sy } = sheetScale(frames, live, o, sheet1, cellW, cellH, stretch, report);
  const out = sampleFrames(img, pal, live, o, cols, rows, cellW, cellH, centerBy, stretch, sx, sy, report);
  postprocess(out, o, cellW, cellH, stretch, report);
  return finishReport(out, o, stretch, report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCLI(pixelize);
}
