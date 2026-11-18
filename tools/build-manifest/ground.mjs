import path from 'node:path';

export function ground(source) {
  const { GAME, list, rel } = source;
  const dir = path.join(GAME, 'ground');
  const out = {};
  for (const f of list(dir, '.png')) out[f.replace(/\.png$/, '')] = rel(path.join(dir, f));
  return out;
}
