import { basename, resolve } from 'node:path';

export function manifestPathOf(args, root) {
  const mi = args.indexOf('--manifest');
  return resolve(mi >= 0 ? args[mi + 1] : `${root}/art/game/manifest.json`);
}

export function inputsOf(args) {
  const inputs = [];
  let pendingLabel = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--manifest') { i++; continue; }
    if (a === '--label') { pendingLabel = args[++i]; continue; }
    if (a.startsWith('--')) continue;
    inputs.push({ file: a, label: pendingLabel || basename(a, '.json') });
    pendingLabel = null;
  }
  return inputs;
}
