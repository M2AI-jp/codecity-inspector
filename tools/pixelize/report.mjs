// report: Append final counts and seam quality only after all output pixels are settled.
import { seamRatio } from './seamless.mjs';
export function finishReport(out, o, stretch, report) {
  const D = out.data, NO = out.width * out.height;
  const cs = new Set(); for (let i = 0; i < NO; i++) if (D[i * 4 + 3]) cs.add((D[i * 4] << 16) | (D[i * 4 + 1] << 8) | D[i * 4 + 2]);
  report.colours = cs.size;
  report.output = `${out.width}x${out.height}`;
  if (stretch && o.tileable) report.outputSeamRatio = +seamRatio(out).toFixed(2);
  return { image: out, report };
}
