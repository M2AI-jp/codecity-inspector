// C-02–C-06: one world coordinate space for walking, drawing and cutaway.
const contains = (rect, point) => point.x >= rect.x && point.y >= rect.y
  && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const visible = (item, active) => !item.visibility
  || (item.visibility.state === 'interior'
    ? item.visibility.placeId === active : item.visibility.placeId !== active);

async function loadImages(assets) {
  return new Map(await Promise.all(assets.map(asset => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([asset.id, image]);
    image.onerror = () => reject(new Error(`Unable to load town asset: ${asset.id}`));
    image.src = asset.url ?? asset.path;
  }))));
}

function createMovement(scene) {
  const player = structuredClone(scene.player);
  const occupied = new Set();
  let active = null;
  // Eligibility starts at the physical threshold and ends on leaving all
  // reveal regions. Overlap precedence is interior, nearest anchor, then ID.
  function occupancy(point) {
    const next = new Set();
    for (const place of scene.places) {
      if (!place.access.automaticEntry) continue;
      const regions = place.occlusion.revealRegions;
      if (!regions.some(region => contains(region, point))) continue;
      if (occupied.has(place.id) || contains(place.access.threshold, point)) next.add(place.id);
    }
    const candidates = scene.places.filter(place => next.has(place.id));
    candidates.sort((a, b) =>
      Number(contains(b.interior.footprint, point)) - Number(contains(a.interior.footprint, point))
      || Math.hypot(point.x - a.anchor.x, point.y - a.anchor.y)
        - Math.hypot(point.x - b.anchor.x, point.y - b.anchor.y)
      || compare(a.id, b.id));
    return { next, active: candidates[0]?.id ?? null };
  }
  function moveAxis(axis, amount) {
    const point = { ...player.anchor, [axis]: player.anchor[axis] + amount };
    const proposed = occupancy(point);
    const dx = point.x - scene.player.anchor.x;
    const dy = point.y - scene.player.anchor.y;
    const bodies = scene.player.collision.map(rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy }));
    const { bounds } = scene;
    if (!contains(bounds, point) || bodies.some(body =>
      body.x < bounds.x || body.y < bounds.y
      || body.x + body.width > bounds.x + bounds.width
      || body.y + body.height > bounds.y + bounds.height
      || scene.collision.some(solid => visible(solid, proposed.active) && overlaps(body, solid.rect)))) return;
    player.anchor = point;
    player.draw.x = scene.player.draw.x + dx;
    player.draw.y = scene.player.draw.y + dy;
    player.depthKey[0] = point.y;
    occupied.clear();
    for (const id of proposed.next) occupied.add(id);
    active = proposed.active;
  }
  moveAxis('x', 0);
  return {
    player,
    get active() { return active; },
    update(keys, seconds) {
      const x = Number(keys.has('ArrowRight') || keys.has('KeyD'))
        - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
      const y = Number(keys.has('ArrowDown') || keys.has('KeyS'))
        - Number(keys.has('ArrowUp') || keys.has('KeyW'));
      const length = Math.hypot(x, y);
      player.animation = length ? 'walk' : 'idle';
      if (!length) return;
      player.direction = x ? (x > 0 ? 'east' : 'west') : (y > 0 ? 'south' : 'north');
      // Small spatial steps prevent crossing thin walls or skipping thresholds.
      const distance = seconds * 90;
      const steps = Math.max(1, Math.ceil(distance));
      for (let step = 0; step < steps; step += 1) {
        moveAxis('x', x / length * distance / steps);
        moveAxis('y', y / length * distance / steps);
      }
    },
  };
}

function createRenderer(canvas, scene, images) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const assets = new Map(scene.assets.map(asset => [asset.id, asset]));
  const patterns = new Map(scene.surfaces.filter(surface => surface.mode !== 'image').map(surface => [
    surface.assetId, context.createPattern(images.get(surface.assetId), 'repeat'),
  ]));
  function surface(item) {
    if (item.mode === 'image') {
      const { x, y, width, height } = item.draw;
      context.drawImage(images.get(item.assetId), x, y, width, height);
      return;
    }
    const { x, y } = item.textureOrigin;
    context.save();
    context.translate(x, y);
    context.fillStyle = patterns.get(item.assetId);
    context.strokeStyle = patterns.get(item.assetId);
    const clip = item.clip;
    if (clip.kind === 'rect') {
      const rect = clip.rect;
      context.fillRect(rect.x - x, rect.y - y, rect.width, rect.height);
    } else {
      context.beginPath();
      clip.points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x - x, point.y - y);
        else context.lineTo(point.x - x, point.y - y);
      });
      context.lineWidth = clip.width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.stroke();
    }
    context.restore();
  }
  function sprite(entity, seconds) {
    const animation = assets.get(entity.assetId).usage.animations?.[entity.animation]?.[entity.direction];
    const index = animation ? animation.frames[Math.floor(seconds * animation.fps) % animation.frames.length] : 0;
    const { frame, draw } = entity;
    context.drawImage(images.get(entity.assetId),
      (index % frame.columns) * frame.width, Math.floor(index / frame.columns) * frame.height,
      frame.width, frame.height,
      Math.round(draw.x), Math.round(draw.y), draw.width, draw.height);
  }
  const cameraAxis = (position, start, span, viewport) => Math.round(span <= viewport
    ? start - (viewport - span) / 2
    : Math.max(start, Math.min(start + span - viewport, position - viewport / 2)));
  return (movement, seconds) => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#182026';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const x = cameraAxis(movement.player.anchor.x, scene.bounds.x, scene.bounds.width, canvas.width);
    const y = cameraAxis(movement.player.anchor.y, scene.bounds.y, scene.bounds.height, canvas.height);
    context.translate(-x, -y);
    const active = movement.active;
    const entities = scene.entities.map(entity => entity.kind === 'player' ? movement.player : entity)
      .filter(entity => visible(entity, active));
    for (const item of scene.surfaces) if (!item.visibility) surface(item);
    for (const entity of entities) if (entity.kind === 'base') sprite(entity, seconds);
    for (const item of scene.surfaces) if (item.visibility && visible(item, active)) surface(item);
    for (const entity of entities) if (entity.kind === 'interior') sprite(entity, seconds);
    const depth = entities.filter(entity => entity.kind !== 'base' && entity.kind !== 'interior');
    depth.sort((a, b) => compare(a.depthKey[0], b.depthKey[0])
      || compare(a.depthKey[1], b.depthKey[1]) || compare(a.depthKey[2], b.depthKey[2]));
    for (const entity of depth) sprite(entity, seconds);
  };
}

/**
 * Mount a compiler scene into a caller-owned canvas. Asset URLs are consumed as
 * supplied (url ?? path), so delivery controls their base. Resolves after every
 * image loads; rejects loading errors. The caller owns visible loading/error UI.
 * Arrow keys or WASD walk while the canvas has focus. dispose releases all
 * input, resize and animation resources. No scene data is mutated.
 */
export async function mountTown({ canvas, scene }) {
  const images = await loadImages(scene.assets);
  const movement = createMovement(scene);
  const render = createRenderer(canvas, scene, images);
  const previous = {
    tabindex: canvas.getAttribute('tabindex'), label: canvas.getAttribute('aria-label'),
    imageRendering: canvas.style.imageRendering,
  };
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', `${scene.repository.name} — 矢印キーまたはWASDで街を歩く`);
  canvas.style.imageRendering = 'pixelated';
  const keys = new Set();
  const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  const keydown = event => {
    if (!movementKeys.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    keys.add(event.code);
  };
  const keyup = event => { keys.delete(event.code); };
  const blur = () => keys.clear();
  const focus = () => canvas.focus({ preventScroll: true });
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('keyup', keyup);
  canvas.addEventListener('blur', blur);
  canvas.addEventListener('pointerdown', focus);
  const resize = () => {
    // Two CSS pixels per world pixel retain the authored pixel-art density.
    canvas.width = Math.max(1, Math.round(canvas.clientWidth / 2));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight / 2));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  let last = null;
  let frame;
  const tick = now => {
    movement.update(keys, last === null ? 0 : Math.min((now - last) / 1000, 0.05));
    last = now;
    render(movement, now / 1000);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('keyup', keyup);
      canvas.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', focus);
      keys.clear();
      for (const [name, value] of [['tabindex', previous.tabindex], ['aria-label', previous.label]]) {
        if (value === null) canvas.removeAttribute(name);
        else canvas.setAttribute(name, value);
      }
      canvas.style.imageRendering = previous.imageRendering;
    },
  };
}
