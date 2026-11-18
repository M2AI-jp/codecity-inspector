import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateOverlay } from '../../src/overlay/read.mjs';

const base = resolve('compare');
export function fixture(t) {
  mkdirSync(base, { recursive: true });
  const temp = mkdtempSync(join(base, 'overlay-test-')), dir = join(temp, 'repo');
  mkdirSync(dir, { recursive: true });
  // 親の作業フォルダ（CI の clone など）を、見本のリポジトリとして拾わない（test/groups.test.mjs と同じ）
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = temp;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous;
    rmSync(temp, { recursive: true, force: true });
  });
  return dir;
}
export function simpleTown() {
  const building = (id, x, path, group = 'g') => ({
    id, archetype: 'house_s', x, y: 4, w: 6, h: 4, door: { x: x + 2, y: 7 }, district: group,
    module: { path, group, kind: 'house', files: 1, lines: 20, languages: {}, authors: [], topFiles: [], commits: 0, recent: 0 },
  });
  return { version: 1, repo: { name: 'overlay-fixture' }, cols: 32, rows: 24,
    ground: Array(24).fill('+'.repeat(32)), buildings: [building('b1', 4, 'src'), building('b2', 16, 'lib')],
    props: [], landmarks: [], residents: [], crowd: [], terraces: [], stairs: [], spawn: { x: 14, y: 16 } };
}
export const record = (id, at = { building: 'b1' }, state = 'unverified') => ({ id, kind: 'record', state, at, label: id, lines: ['記録'] });
export const parsed = (fields = {}) => validateOverlay({ version: 1, ...fields });
