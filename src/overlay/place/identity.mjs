import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// 公開の既定素材と識別子をまとめ、ハッシュへ渡すキーの順序を保つ。
export const defaultManifest = () => JSON.parse(readFileSync(new URL('../../../art/game/manifest.json', import.meta.url), 'utf8'));
export const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const layoutKey = (overlay) => hash({ seed: overlay.seed, groups: overlay.groups,
  ...(overlay.goal?.look ? { goalLook: overlay.goal.look, goalAt: overlay.goal.at } : {}) });
