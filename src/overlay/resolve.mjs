const distance = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const contains = (dir, path) => dir === '.' ? !path.includes('/') : path === dir || path.startsWith(`${dir}/`);

export function plazaPoint(town) {
  const well = (town.landmarks || []).find((l) => l.archetype === 'well');
  if (well) return { x: well.x, y: well.y };
  const cells = [];
  for (let y = 0; y < town.rows; y++) for (let x = 0; x < town.cols; x++) if (town.ground[y][x] === '+') cells.push({ x: x + .5, y: y + 1 });
  return cells.length ? cells.reduce((a, b) => distance(a, town.spawn) <= distance(b, town.spawn) ? a : b) : town.spawn;
}

export function resolveAt(town, at, { kind, markers = [] } = {}) {
  const buildings = town.buildings || [], landmarks = town.landmarks || [];
  const hall = buildings.find((b) => b.archetype === 'town_hall');
  const centre = plazaPoint(town);
  const anchor = (b) => ({ x: b.door.x + .5, y: b.y + b.h + 1, building: b });
  const fallback = () => hall ? anchor(hall) : landmarks.some((l) => l.archetype === 'well')
    ? { ...centre, plaza: true } : { ...town.spawn, plaza: true };
  if (at.marker !== undefined) {
    const m = markers.find((m) => m.id === at.marker);
    return m ? { x: m.x, y: m.y } : { reason: 'marker not placed' };
  }
  if (at.path !== undefined) {
    const candidates = [];
    for (const b of buildings) {
      // Facility evidence paths are not module ownership. Only modules and merged modules are.
      const paths = [...(!b.facility ? [b.module?.path] : []), ...(b.module?.merged || []), ...(b.facility?.merged || [])];
      for (const p of paths) if (p && contains(p, at.path)) candidates.push({ b, depth: p === '.' ? 0 : p.split('/').length });
    }
    candidates.sort((a, b) => b.depth - a.depth || a.b.id.localeCompare(b.b.id, 'en'));
    return candidates.length ? anchor(candidates[0].b) : fallback();
  }
  if (at.group !== undefined) {
    const choices = buildings.filter((b) => b.module?.group === at.group)
      .sort((a, b) => distance(anchor(a), centre) - distance(anchor(b), centre) || a.id.localeCompare(b.id, 'en'));
    if (choices.length) return anchor(choices[0]);
    return ['board', 'person'].includes(kind) ? { ...centre, plaza: true } : { reason: 'group has no building' };
  }
  if (at.building !== undefined) {
    const b = buildings.find((b) => b.id === at.building);
    return b ? anchor(b) : { reason: 'building not found' };
  }
  if (at.landmark !== undefined) {
    const b = buildings.find((b) => b.archetype === at.landmark);
    if (b) return anchor(b);
    const l = landmarks.find((l) => l.archetype === at.landmark);
    return l ? { x: l.x, y: l.y, plaza: true } : fallback();
  }
  return { reason: 'invalid at' };
}

export function doorChoices(town, target) {
  if (!target.building) return [];
  const b = target.building;
  return [b, ...town.buildings.filter((c) => c !== b && c.district === b.district)
    .sort((a, c) => distance(a.door, b.door) - distance(c.door, b.door) || a.id.localeCompare(c.id, 'en'))];
}
