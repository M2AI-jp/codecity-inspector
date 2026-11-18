// Account for keepers and the outdoor facilities evidenced by the repository.
import { NEAR_KEEPER } from '../../web/config.js';
import { nearSeen } from './reach.mjs';

export function checkKeepers(town, world, npcs, seen) {
  // keepers: every building has one; outdoor keepers can be reached and talked to
  const noKeeper = world.buildings.filter((b) => b.module && !b.keeper);
  const outdoor = npcs.keepers.filter((k) => k.outdoor);
  const farKeepers = outdoor.filter((k) => !nearSeen(world, seen, k.x, k.y, NEAR_KEEPER - 4));
  const lmCount = (town.landmarks || []).length;
  const failed = noKeeper.length + farKeepers.length + Math.max(0, lmCount - outdoor.length);
  return { noKeeper, outdoor, farKeepers, lmCount, failed };
}

export function checkOutdoor(town, repo, gates) {
  const outdoorKinds = new Set(['gate', 'well']);
  const unplacedOutdoor = (town.unplaced || []).filter((u) => outdoorKinds.has(u.archetype));
  const placedOutdoor = new Map();
  for (const lm of town.landmarks || []) if (outdoorKinds.has(lm.archetype)) placedOutdoor.set(lm.archetype, (placedOutdoor.get(lm.archetype) || 0) + 1);
  const unplacedCounts = new Map();
  for (const u of unplacedOutdoor) unplacedCounts.set(u.archetype, (unplacedCounts.get(u.archetype) || 0) + 1);
  const evidenceMissing = [];
  for (const f of (repo?.facilities || []).filter((f) => outdoorKinds.has(f.archetype))) {
    const placed = placedOutdoor.get(f.archetype) || 0;
    if (placed) placedOutdoor.set(f.archetype, placed - 1);
    else {
      const recorded = unplacedCounts.get(f.archetype) || 0;
      if (recorded) unplacedCounts.set(f.archetype, recorded - 1);
      else evidenceMissing.push({ archetype: f.archetype, reason: 'RepoModel に証拠があるが town.landmarks にも town.unplaced にも無い' });
    }
  }
  const gatePropGap = Math.max(0, (town.landmarks || []).filter((lm) => lm.archetype === 'gate').length - gates.length);
  const canalUnplaced = (town.unplaced || []).filter((u) => u.archetype === 'canal');
  const wellEvidence = repo
    ? (repo.facilities || []).some((f) => f.archetype === 'well')
    : (town.landmarks || []).some((lm) => lm.archetype === 'well') ||
      (town.unplaced || []).some((u) => u.archetype === 'well');
  const canalMissing = wellEvidence && !town.canal && !canalUnplaced.length;
  const failed = unplacedOutdoor.length + evidenceMissing.length + gatePropGap +
    canalUnplaced.length + (canalMissing ? 1 : 0);
  return { unplacedOutdoor, evidenceMissing, gatePropGap, canalUnplaced, canalMissing, failed };
}
