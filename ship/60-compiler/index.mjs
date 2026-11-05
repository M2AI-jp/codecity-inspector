// C-01–C-06: translate a WorldPlan and supplied asset metadata into drawing
// and collision data. File loading, movement, and cutaway state belong to callers.
const copy = value => structuredClone(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function collisionRects(collision) {
  if (collision.kind === 'none') return [];
  if (collision.kind === 'rects') return collision.rects;
  if (collision.kind === 'rect') {
    const { x, y, width, height } = collision;
    return [{ x, y, width, height }];
  }
  throw new TypeError('Unknown asset collision geometry');
}

function sprite(source, asset, kind, order = 0, visibility) {
  const scale = source.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new TypeError('Sprite scale must be positive');
  const { anchor } = source;
  const { pivot, usage } = asset;
  const draw = {
    x: anchor.x - pivot.x * scale,
    y: anchor.y - pivot.y * scale,
    width: usage.frame.width * scale,
    height: usage.frame.height * scale,
  };
  return {
    id: source.id,
    kind,
    assetId: asset.id,
    ...(source.placeId ? { placeId: source.placeId } : {}),
    anchor: copy(anchor),
    scale,
    pivot: copy(pivot),
    frame: copy(usage.frame),
    layer: usage.layer,
    draw,
    // Runtime replaces the first component when a moving actor changes y.
    depthKey: [anchor.y, order, source.id],
    collision: collisionRects(usage.collision).map(rect => ({
      x: draw.x + rect.x * scale,
      y: draw.y + rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    })),
    ...(source.animation ? { animation: source.animation } : {}),
    ...(source.direction ? { direction: source.direction } : {}),
    ...(visibility ? { visibility: copy(visibility) } : {}),
  };
}

function surface(source, visibility) {
  return {
    id: source.id,
    assetId: source.assetId,
    mode: source.mode ?? 'texture',
    ...(source.mode === 'image' ? { draw: copy(source.bounds) } : {
      textureOrigin: copy(source.textureOrigin),
      // A path clips a repeating world-aligned texture; it is not a sequence
      // of stretched or independently positioned pavement images.
      clip: source.bounds
        ? { kind: 'rect', rect: copy(source.bounds) }
        : { kind: 'path', points: copy(source.points), width: source.width },
    }),
    ...(visibility ? { visibility: copy(visibility) } : {}),
  };
}

/**
 * Input: generateWorldPlan({town}) output and manifest.assets metadata.
 * Output: a serializable scene with only referenced assets. All geometry is in
 * world coordinates; sprite images are placed at draw using manifest pivots.
 * Render ground surfaces first, place bases then visible interior floors/rooms,
 * and remaining sprites in depthKey order. Interior foregrounds share the
 * building's anchor; upper/foreground exterior layers hide on automatic entry.
 */
export function compileWorldPlan({ worldPlan, assets } = {}) {
  if (worldPlan?.version !== 1 || !Array.isArray(worldPlan.places)
      || !Array.isArray(worldPlan.surfaces) || !Array.isArray(assets)) {
    throw new TypeError('Expected a version 1 WorldPlan and asset metadata array');
  }
  const assetById = new Map(assets.map(asset => [asset.id, asset]));
  const usedAssets = new Map();
  const resolve = id => {
    const asset = assetById.get(id);
    if (!asset) throw new TypeError(`WorldPlan references missing asset: ${id}`);
    usedAssets.set(id, asset);
    return asset;
  };
  const entities = [];
  const surfaces = worldPlan.surfaces.map(source => {
    resolve(source.assetId);
    return surface(source);
  });
  const places = worldPlan.places.map(source => {
    const layers = {
      base: null, upper: null, foreground: null,
      interior: null, interiorForeground: null, interiorFloor: null,
    };
    const exterior = { placeId: source.id, state: 'exterior' };
    const interior = { placeId: source.id, state: 'interior' };
    const addLayer = (name, assetId, order, visibility) => {
      if (!assetId) return;
      const entity = sprite({
        id: `${source.id}:${name}`, placeId: source.id,
        anchor: source.anchor, scale: source.scale ?? 1,
      }, resolve(assetId), name, order, visibility);
      entities.push(entity);
      layers[name] = entity.id;
    };
    addLayer('base', source.assets.base, -3);
    addLayer('upper', source.assets.upper, 1, exterior);
    addLayer('foreground', source.assets.foreground, 2, exterior);
    addLayer('interior', source.interior.assetId, -2, interior);
    addLayer('interiorForeground', source.interior.foregroundAssetId, 2, interior);
    if (source.interior.floorAssetId) {
      resolve(source.interior.floorAssetId);
      const floor = surface({
        id: `${source.id}:interiorFloor`,
        assetId: source.interior.floorAssetId,
        bounds: source.interior.footprint,
        textureOrigin: { x: 0, y: 0 },
      }, interior);
      layers.interiorFloor = floor.id;
      surfaces.push(floor);
    }
    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      meaning: copy(source.meaning),
      sourcePaths: copy(source.sourcePaths),
      basis: copy(source.basis),
      ...(source.members !== undefined ? { members: copy(source.members) } : {}),
      ...(source.internalLinks !== undefined ? { internalLinks: copy(source.internalLinks) } : {}),
      ...(source.history ? { history: copy(source.history) } : {}),
      districtId: source.districtId,
      clusterId: copy(source.clusterId),
      appearance: source.appearance,
      appearanceBasis: copy(source.appearanceBasis),
      anchor: copy(source.anchor),
      footprint: copy(source.footprint),
      entrance: copy(source.entrance),
      access: copy(source.access),
      interior: copy(source.interior),
      collision: copy(source.collision),
      occlusion: copy(source.occlusion),
      layers,
      exteriorOccluders: [layers.upper, layers.foreground].filter(Boolean),
      interiorLayers: [layers.interiorFloor, layers.interior, layers.interiorForeground].filter(Boolean),
    };
  });
  for (const person of worldPlan.people) {
    entities.push(sprite(person, resolve(person.assetId), 'person'));
  }
  for (const prop of worldPlan.props) {
    const visibility = prop.interiorPlaceId
      ? { placeId: prop.interiorPlaceId, state: 'interior' }
      : undefined;
    const entity = sprite(prop, resolve(prop.assetId), 'prop', 0, visibility);
    entities.push(entity);
    if (prop.interiorPlaceId) {
      const place = places.find(candidate => candidate.id === prop.interiorPlaceId);
      if (!place) throw new TypeError(`Unknown prop interior: ${prop.interiorPlaceId}`);
      place.interiorLayers.push(entity.id);
    }
  }
  const player = sprite({
    ...worldPlan.player, id: 'player', anchor: worldPlan.spawn,
    animation: 'idle', direction: 'south',
  }, resolve(worldPlan.player.assetId), 'player');
  entities.push(player);
  entities.sort((a, b) => compare(a.depthKey[0], b.depthKey[0])
    || compare(a.depthKey[1], b.depthKey[1]) || compare(a.depthKey[2], b.depthKey[2]));
  // Actor collision lives on each actor and follows its current anchor.
  // Static walls/furnishings are ready for collision queries; interior solids
  // use the same visibility condition as their drawn room.
  const collision = [
    ...(worldPlan.collision ?? []).map((rect, index) => ({
      id: `environment:collision:${index}`, rect: copy(rect),
    })),
    ...places.flatMap(place => place.collision.map((rect, index) => ({
      id: `${place.id}:wall:${index}`, placeId: place.id, rect: copy(rect),
    }))),
  ];
  for (const entity of entities) {
    if (entity.kind === 'player' || entity.kind === 'person') continue;
    entity.collision.forEach((rect, index) => collision.push({
      id: `${entity.id}:collision:${index}`, entityId: entity.id,
      ...(entity.placeId ? { placeId: entity.placeId } : {}),
      rect: copy(rect),
      ...(entity.visibility ? { visibility: copy(entity.visibility) } : {}),
    }));
  }
  return {
    version: 1,
    repository: copy(worldPlan.repository),
    style: copy(worldPlan.style),
    bounds: copy(worldPlan.bounds),
    spawn: copy(worldPlan.spawn),
    camera: copy(worldPlan.camera),
    player,
    districts: copy(worldPlan.districts),
    places,
    // Connections preserve repository semantics. Paving comes exclusively
    // from WorldPlan.surfaces, so relation paths cannot double-paint streets.
    routes: copy(worldPlan.routes),
    surfaces,
    entities,
    collision,
    assets: [...usedAssets.values()].sort((a, b) => compare(a.id, b.id)).map(copy),
  };
}
