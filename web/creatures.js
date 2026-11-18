// Small creatures (town.creatures, CONTRACTS.md): pigeons = direct dependencies, dogs = bots that
// work on the repo, cats = scheduled / background work (and one asleep by a ruin). They are drawn
// y-sorted with the other sprites and under the night grade, never block anyone, and standing
// near one shows a tiny bubble with what it really stands for.
import { warnOnce } from './assets.js';
import { Creature } from './creatures/creature.js';
import { createCreatureBubble } from './creatures/bubble.js';
import { pickCreature } from './creatures/proximity.js';

export { loadCreatureArt } from './creatures/art.js';

export function createCreatures(town, world, sheets) {
  const list = [];
  for (const d of town.creatures || []) {
    if (!d || !d.home || !Number.isFinite(d.home.x) || !Number.isFinite(d.home.y)) continue;
    const c = new Creature(d, world, sheets);
    if (!c.sheet) warnOnce(`creature:${d.sprite || d.kind}`, `生き物 ${d.sprite || d.kind} の画像がありません（描かずに続けます）`);
    list.push(c);
  }
  // flocks: pigeons sharing a flock id
  const flocks = new Map();
  for (const c of list) if (c.kind === 'pigeon') {
    const k = c.d.flock ?? 0;
    (flocks.get(k) || flocks.set(k, []).get(k)).push(c);
  }
  for (const f of flocks.values()) for (const c of f) c.flock = f;

  const bubbles = createCreatureBubble(list);
  return {
    list,
    update(dt, player) {
      for (let i = 0; i < list.length; i++) list[i].update(dt, player, list);
    },
    pick(player, walker) { return pickCreature(list, player, walker); },
    bubble(view, player, best) { return bubbles.bubble(view, player, best); },
    get current() { return bubbles.current; },
  };
}
