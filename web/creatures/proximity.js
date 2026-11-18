// Select the closest grounded creature, preserving list order and resident priority.
const NEAR = 26;                 // px, bubble distance (feet to feet)

// the creature to talk about: the nearest one on the ground within NEAR, unless a resident is nearer
export function pickCreature(list, player, walker) {
  let best = null, bd = NEAR * NEAR;
  for (const c of list) {
    if (c.flying) continue;
    const dx = c.x - player.x, dy = c.y - player.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = c; }
  }
  if (best && walker && (walker.x - player.x) ** 2 + (walker.y - player.y) ** 2 <= bd) return null;
  return best;
}
