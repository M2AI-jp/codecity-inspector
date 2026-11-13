import { basename } from 'node:path';

export const uniq = (a) => [...new Set(a)];

// 名前（github など）をファイル名に含むものを先に
export const byName = (name, paths) => {
  const k = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sortPaths(paths).sort((x, y) => (!basename(x).toLowerCase().includes(k)) - (!basename(y).toLowerCase().includes(k)));
};

export const sortPaths = (a) => [...a].sort((x, y) =>
  x.split('/').length - y.split('/').length || (x < y ? -1 : x > y ? 1 : 0));
