import { validateOverlay } from '../../src/overlay/read.mjs';

export const goal = { at: { landmark: 'town_hall' }, label: '完了', lines: ['城の候補'], look: 'castle' };
export const overlay = (g = goal, extra = {}) => validateOverlay({ version: 1, goal: g, ...extra });
export const openTown = () => ({
  version: 1, repo: { name: 'castle-test' }, cols: 40, rows: 34,
  ground: Array(34).fill('+'.repeat(40)), props: [], buildings: [], landmarks: [],
  residents: [], crowd: [], terraces: [], stairs: [], spawn: { x: 20, y: 28 },
});
