import { KEEPER_BOX, TILE } from './config.js';

export function overlayPeople(overlay) {
  return [...(overlay?.people || []).map((p) => ({ ...p, runtimeId: p.runtimeId || `person:${p.id}` })),
    ...(overlay?.markers || []).filter((m) => m.keeper).map((m) => ({
    id: m.id, runtimeId: `keeper:${m.id}`, ...m.keeper, name: '門番', label: m.label, lines: m.lines, gate: true,
  }))];
}

export function addOverlayPeople(world, overlay) {
  for (const p of overlayPeople(overlay)) {
    const r = world.addRect(p.x * TILE + KEEPER_BOX[0], p.y * TILE + KEEPER_BOX[1], KEEPER_BOX[2], KEEPER_BOX[3], 'npc');
    if (r) r.overlayPerson = p.runtimeId;
  }
}

// Keep the existing rect/prop objects. Only the spatial index needs rebuilding after removal.
export function reindexOverlayRects(world) {
  world.buckets.fill(null);
  world.rects.forEach((r, i) => {
    const x0 = Math.max(0, Math.floor(r.x / TILE)), y0 = Math.max(0, Math.floor(r.y / TILE));
    const x1 = Math.min(world.cols - 1, Math.floor((r.x + r.w - .001) / TILE));
    const y1 = Math.min(world.rows - 1, Math.floor((r.y + r.h - .001) / TILE));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) (world.buckets[y * world.cols + x] ||= []).push(i);
  });
}
