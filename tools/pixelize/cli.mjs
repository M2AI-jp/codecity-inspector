// cli: Keep command-line I/O at the boundary while the entry retains its direct-execution guard.
import { readPNG, writePNG } from '../png.mjs';
import { parseArgs, optionsOf } from './arguments.mjs';
export function runCLI(pixelize) {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) {
    console.error('usage: node pixelize.mjs in.png out.png --grid CxR --cell 32 [--char-height 26] [--anchor bottom-center|center|top-center|bottom-left|top-left]\n'
      + '       [--key ff00ff] [--tol 120] [--colors N] [--no-despill] [--dark-boost 1.35] [--phases 6]\n'
      + '       node pixelize.mjs in.png out.png --grid 1x1 --size WxH [--fit contain|stretch] [--tileable]');
    process.exit(1);
  }
  const o = optionsOf(opt);
  const t0 = Date.now();
  const { image, report } = pixelize(readPNG(pos[0]), o);
  writePNG(pos[1], image);
  console.log(JSON.stringify({ ...report, ms: Date.now() - t0, wrote: pos[1] }, null, 1));
}
