// Repository meaning -> places. Geometry and artwork belong to downstream
// composition; history is context, never a diagnosis of a broken building.
export const TOWN_PLACE_CAPACITY = 10;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const union = (items) => [...new Map(items.map(item => [JSON.stringify(item), structuredClone(item)])).values()];

function commonPath(paths) {
  const parts = paths.map(path => path.split('/').slice(0, -1));
  return (parts[0] ?? []).filter((part, index) =>
    parts.every(other => other.slice(0, index + 1).join('/') === parts[0].slice(0, index + 1).join('/'))).join('/');
}

function boundedGroups(groups, links) {
  // At or below capacity, preserve the exact existing identity and order.
  if (groups.length <= TOWN_PLACE_CAPACITY) return groups;
  const clusters = [...groups].sort((a, b) => compare(a.id, b.id)).map(group => [group]);
  const affinity = (left, right) => {
    const leftIds = new Set(left.map(group => group.id));
    const rightIds = new Set(right.map(group => group.id));
    const sharedMeaning = left.every(group => group.meaning === left[0].meaning)
      && right.every(group => group.meaning === left[0].meaning);
    const connected = links.filter(link =>
      leftIds.has(link.fromGroupId) && rightIds.has(link.toGroupId)
      || rightIds.has(link.fromGroupId) && leftIds.has(link.toGroupId)).length;
    const paths = [...left, ...right].flatMap(group => group.sourcePaths);
    const ancestor = commonPath(paths);
    const depth = ancestor ? ancestor.split('/').length : 0;
    const distance = paths.reduce((sum, path) => sum + path.split('/').length - 1 - depth, 0) / paths.length;
    return [Number(sharedMeaning), connected, depth, -distance];
  };
  while (clusters.length > TOWN_PLACE_CAPACITY) {
    let pair = [0, 1];
    let best;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const score = affinity(clusters[i], clusters[j]);
        const difference = best ? score.map((value, index) => value - best[index]).find(value => value !== 0) : 1;
        if (difference > 0) {
          best = score;
          pair = [i, j];
        }
      }
    }
    clusters[pair[0]].push(...clusters.splice(pair[1], 1)[0]);
  }
  return clusters.map(members => {
    if (members.length === 1) return members[0];
    members.sort((a, b) => compare(a.id, b.id));
    const counts = new Map();
    for (const member of members) counts.set(member.meaning, (counts.get(member.meaning) ?? 0) + 1);
    // Development work requires a workshop (C-04); otherwise the most common
    // member meaning leads, with lexical ties. All member meanings remain data.
    const meaning = counts.has('development-work') ? 'development-work'
      : [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || compare(a, b))[0];
    const sourcePaths = [...new Set(members.flatMap(member => member.sourcePaths))].sort(compare);
    const markers = union(members.flatMap(member => member.history?.markers ?? []));
    const ids = new Set(members.map(member => member.id));
    return {
      id: `district:${JSON.stringify([...ids])}`,
      name: commonPath(sourcePaths) || members.map(member => member.name).join(' + '),
      meaning, sourcePaths,
      basis: union(members.flatMap(member => member.basis)),
      members: members.map(({ id, name, meaning }) => ({ id, name, meaning })),
      internalLinks: links.filter(link => ids.has(link.fromGroupId) && ids.has(link.toGroupId)).map(link => structuredClone(link)),
      ...(markers.length ? { history: { markers } } : {}),
    };
  });
}

export function buildTownModel(semanticModel) {
  if (semanticModel?.version !== 1) {
    throw new TypeError('Town composition requires SemanticModel v1');
  }
  const groups = boundedGroups(semanticModel.groups, semanticModel.links);
  const placeIdByGroup = new Map(groups.flatMap(group =>
    (group.members ?? [group]).map(member => [member.id, `place:${group.id}`])));
  const links = new Map();
  for (const link of semanticModel.links) {
    const fromPlaceId = placeIdByGroup.get(link.fromGroupId);
    const toPlaceId = placeIdByGroup.get(link.toGroupId);
    if (fromPlaceId === toPlaceId) continue;
    const key = JSON.stringify([fromPlaceId, toPlaceId]);
    const prior = links.get(key);
    links.set(key, { fromPlaceId, toPlaceId, basis: union([...(prior?.basis ?? []), ...link.basis]) });
  }
  return {
    version: 1,
    repository: { ...semanticModel.repository },
    places: groups.map((group) => ({
      id: `place:${group.id}`,
      name: group.name,
      kind: group.meaning === 'development-work' ? 'workshop' : 'building',
      meaning: group.meaning,
      sourcePaths: [...group.sourcePaths],
      basis: group.basis.map((item) => ({ ...item })),
      ...(group.members ? { members: structuredClone(group.members), internalLinks: structuredClone(group.internalLinks) } : {}),
      ...(group.history ? { history: { markers: group.history.markers.map((marker) => ({ ...marker })) } } : {}),
    })),
    links: semanticModel.groups.length <= TOWN_PLACE_CAPACITY
      ? semanticModel.links.map(link => ({
        fromPlaceId: placeIdByGroup.get(link.fromGroupId),
        toPlaceId: placeIdByGroup.get(link.toGroupId),
        basis: link.basis.map(item => ({ ...item })),
      }))
      : [...links.values()],
  };
}
