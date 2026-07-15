import {
  FACILITY_ANCHORS,
  WORLD_DISTRICTS,
  WORLD_IMAGE,
  anchorsForPresentFacilities,
  computeWorldCamera,
  createInterpolatedMovement,
  directionBetweenPoints,
  districtForPoint,
  nearestFacilityAnchor,
  nearestNavigationNode,
  navigationEdgeBetween,
  nextNodeForDirection,
  sampleInterpolatedMovement,
  screenToWorld,
  shortestNavigationPath,
  worldRenderLayers,
  worldToScreen
} from './world-runtime.mjs';
import {
  SITE_CANVAS,
  SITE_RENDER_LAYERS,
  authoredTilePlacement,
  auditRuntimeAssetUsage,
  auditSiteRecipes,
  characterFrameRect,
  computeSiteCamera,
  effectFrameRect,
  groundAssetAt,
  groundTransformAt,
  loadForgeAssetImages,
  nearestSiteNode,
  nextSiteNodeForDirection,
  screenToSite,
  shortestSitePath,
  snowPixelOverlaysAt,
  siteNodeById,
  siteRecipeById,
  siteRecipesForFacility
} from './site-runtime.mjs';

const elements = {
  canvas: document.getElementById('world-canvas'),
  loading: document.getElementById('world-loading'),
  worldFallback: document.getElementById('world-fallback'),
  assetError: document.getElementById('asset-error'),
  assetErrorText: document.getElementById('asset-error-text'),
  help: document.getElementById('world-help'),
  status: document.getElementById('world-status'),
  repoName: document.getElementById('repo-name'),
  levelBadge: document.getElementById('level-badge'),
  placeLabel: document.getElementById('place-label'),
  overviewButton: document.getElementById('overview-btn'),
  backButton: document.getElementById('back-btn'),
  journalButton: document.getElementById('journal-btn'),
  journal: document.getElementById('journal-drawer'),
  journalClose: document.getElementById('journal-close-btn'),
  drawerRepo: document.getElementById('drawer-repo'),
  drawerHabitability: document.getElementById('drawer-habitability'),
  drawerLocation: document.getElementById('drawer-location'),
  facilityEmpty: document.getElementById('facility-empty'),
  facilityDetail: document.getElementById('facility-detail'),
  facilityDistrict: document.getElementById('facility-district'),
  facilityName: document.getElementById('facility-name'),
  facilityKind: document.getElementById('facility-kind'),
  facilityCount: document.getElementById('facility-count'),
  evidenceObserved: document.getElementById('evidence-observed'),
  evidenceInferred: document.getElementById('evidence-inferred'),
  evidenceUnknown: document.getElementById('evidence-unknown'),
  siteEnterButton: document.getElementById('site-enter-btn'),
  siteChoice: document.getElementById('site-choice-panel'),
  siteChoiceTitle: document.getElementById('site-choice-title'),
  siteChoiceButtons: document.getElementById('site-choice-buttons'),
  siteChoiceClose: document.getElementById('site-choice-close-btn')
};

const context = elements.canvas.getContext('2d', { alpha: false });
const initialNode = nearestNavigationNode(FACILITY_ANCHORS.town_hall.x, FACILITY_ANCHORS.town_hall.y);
const directionForKey = Object.freeze({
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right'
});

const state = {
  town: null,
  worldImage: null,
  worldReady: false,
  assets: null,
  assetError: null,
  view: 'overview',
  interactionStarted: false,
  camera: null,
  presentAnchors: [],
  hoveredAnchor: null,
  selectedAnchor: null,
  nearbyAnchor: null,
  worldNodeId: initialNode.id,
  worldPosition: { x: initialNode.x, y: initialNode.y },
  worldDirection: 'down',
  worldMovement: null,
  worldTransition: null,
  worldQueue: [],
  worldReturn: null,
  siteRecipe: null,
  siteNodeId: null,
  sitePosition: null,
  siteDirection: 'up',
  siteMovement: null,
  siteQueue: [],
  drawerOpener: null,
  lastTimestamp: 0
};

function announce(message) {
  elements.status.textContent = '';
  window.requestAnimationFrame(() => { elements.status.textContent = message; });
}

function facilityForAnchor(anchor) {
  return state.town?.model?.facilities?.find((facility) => facility.kind === anchor?.kind) ?? null;
}

function facilityIsPresent(facilityKind) {
  return state.town?.model?.facilities?.some((facility) => facility.kind === facilityKind && facility.present === true) === true;
}

function districtLabel(point) {
  return districtForPoint(point?.x, point?.y, WORLD_DISTRICTS)?.label ?? '街道';
}

function evidenceItems(target, items, emptyLabel) {
  target.replaceChildren();
  const values = Array.isArray(items) && items.length > 0 ? items : [emptyLabel];
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = String(value);
    target.append(item);
  }
}

function selectedFacility() {
  return facilityForAnchor(state.selectedAnchor);
}

function updateFacilityDetail() {
  const anchor = state.selectedAnchor;
  const facility = selectedFacility();
  elements.facilityEmpty.hidden = Boolean(anchor && facility);
  elements.facilityDetail.hidden = !anchor || !facility;
  if (!anchor || !facility) return;
  elements.facilityDistrict.textContent = state.view === 'site'
    ? state.siteRecipe.label
    : districtLabel(anchor);
  elements.facilityName.textContent = anchor.label;
  elements.facilityKind.textContent = facility.kind;
  elements.facilityCount.textContent = String(facility.count ?? 0);
  evidenceItems(elements.evidenceObserved, facility.evidence?.observed, '観測された根拠はありません。');
  evidenceItems(elements.evidenceInferred, facility.evidence?.inferred, '推測された根拠はありません。');
  evidenceItems(elements.evidenceUnknown, facility.evidence?.unknown, '未確認事項はありません。');
  const routes = siteRecipesForFacility(facility.kind);
  elements.siteEnterButton.hidden = facility.present !== true || routes.length === 0;
  elements.siteEnterButton.textContent = routes.length > 1 ? '4つの検査場所から選ぶ' : 'この施設を歩いて検査する';
}

function currentPlaceLabel() {
  if (state.view === 'site') return state.siteRecipe?.label ?? '検査場所';
  if (state.view === 'overview') return '街の全景';
  return districtLabel(state.worldPosition);
}

function updateSummary() {
  const name = state.town?.repository?.name || '検査情報を取得できませんでした';
  const habitability = state.town?.habitability;
  elements.repoName.textContent = name;
  elements.levelBadge.textContent = Number.isInteger(habitability?.level) ? `Lv.${habitability.level}` : 'Lv.-';
  elements.placeLabel.textContent = currentPlaceLabel();
  elements.drawerRepo.textContent = name;
  elements.drawerHabitability.textContent = habitability
    ? `${habitability.canLive ? '住めます' : '要整備'} · ${habitability.levelName}`
    : '未確認';
  elements.drawerLocation.textContent = currentPlaceLabel();
  elements.overviewButton.setAttribute('aria-pressed', String(state.view === 'overview'));
  elements.backButton.hidden = state.view !== 'site';
}

function openJournal(opener = document.activeElement) {
  state.drawerOpener = opener instanceof HTMLElement ? opener : elements.journalButton;
  elements.journal.hidden = false;
  elements.journalButton.setAttribute('aria-expanded', 'true');
  updateFacilityDetail();
  elements.journalClose.focus();
}

function closeJournal({ restoreFocus = true } = {}) {
  if (elements.journal.hidden) return;
  elements.journal.hidden = true;
  elements.journalButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus && state.drawerOpener?.isConnected) state.drawerOpener.focus();
}

function closeSiteChoice({ restoreFocus = true } = {}) {
  if (elements.siteChoice.hidden) return;
  elements.siteChoice.hidden = true;
  elements.siteChoiceButtons.replaceChildren();
  if (restoreFocus) elements.canvas.focus();
}

function showSiteChoice(recipes) {
  if (!state.assets || recipes.length === 0) return;
  elements.siteChoiceButtons.replaceChildren();
  elements.siteChoiceTitle.textContent = recipes.length > 1 ? '住宅の4つの検査場所' : '検査場所';
  for (const recipe of recipes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-choice-button';
    button.textContent = recipe.label;
    button.addEventListener('click', () => enterSite(recipe.id));
    elements.siteChoiceButtons.append(button);
  }
  elements.siteChoice.hidden = false;
  elements.siteChoiceButtons.querySelector('button')?.focus();
}

function resizeCanvas() {
  const bounds = elements.canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (elements.canvas.width !== width) elements.canvas.width = width;
  if (elements.canvas.height !== height) elements.canvas.height = height;
  draw(state.lastTimestamp);
}

function worldCamera() {
  return computeWorldCamera({
    mode: state.view === 'world' ? 'follow' : 'overview',
    viewportWidth: elements.canvas.width,
    viewportHeight: elements.canvas.height,
    focusX: state.worldPosition.x,
    focusY: state.worldPosition.y
  });
}

function drawWorldAnchor(anchor, active) {
  const screen = worldToScreen(state.camera, anchor);
  if (!screen) return;
  const radius = active ? 16 : 11;
  const glow = context.createRadialGradient(screen.x, screen.y, 1, screen.x, screen.y, radius);
  glow.addColorStop(0, active ? 'rgba(255, 235, 154, .82)' : 'rgba(255, 219, 112, .45)');
  glow.addColorStop(0.48, active ? 'rgba(226, 178, 63, .42)' : 'rgba(226, 178, 63, .20)');
  glow.addColorStop(1, 'rgba(226, 178, 63, 0)');
  context.fillStyle = glow;
  context.beginPath();
  context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  context.fill();
  if (active) {
    context.strokeStyle = 'rgba(255, 239, 180, .96)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(screen.x, screen.y, 6, 0, Math.PI * 2);
    context.stroke();
  }
}

function movementFrame(movement, timestamp) {
  if (!movement) return 'idle';
  return Math.floor(timestamp / 130) % 2 === 0 ? 'walk1' : 'walk2';
}

function drawCharacter(image, direction, frame, feetX, feetY) {
  const source = characterFrameRect(direction, frame);
  context.drawImage(image, source.x, source.y, source.width, source.height, feetX - 12, feetY - 40, 24, 40);
}

function drawWorld(timestamp) {
  state.camera = worldCamera();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = state.camera.scale < 1;
  context.fillStyle = '#050705';
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  context.drawImage(
    state.worldImage,
    state.camera.sourceX, state.camera.sourceY, state.camera.sourceWidth, state.camera.sourceHeight,
    state.camera.destX, state.camera.destY, state.camera.destWidth, state.camera.destHeight
  );

  const layers = worldRenderLayers({
    view: state.view,
    interactionStarted: state.interactionStarted,
    hasPlayerAsset: Boolean(state.assets),
    hoveredAnchor: state.hoveredAnchor,
    selectedAnchor: state.selectedAnchor,
    nearbyAnchor: state.nearbyAnchor
  });
  for (const anchor of layers.anchors) {
    drawWorldAnchor(anchor, anchor.kind === state.selectedAnchor?.kind || anchor.kind === state.nearbyAnchor?.kind);
  }
  if (layers.drawPlayer && !state.worldTransition) {
    const screen = worldToScreen(state.camera, state.worldPosition);
    drawCharacter(
      state.assets.images.get('character.player'),
      state.worldDirection,
      movementFrame(state.worldMovement, timestamp),
      screen.x,
      screen.y
    );
  }
  if (state.worldTransition) {
    const elapsed = Math.max(0, timestamp - state.worldTransition.startedAt);
    const progress = Math.min(1, elapsed / state.worldTransition.duration);
    context.fillStyle = `rgba(3, 5, 3, ${1 - progress})`;
    context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  }
}

function drawSite(timestamp) {
  const recipe = state.siteRecipe;
  const images = state.assets.images;
  const camera = computeSiteCamera(elements.canvas.width, elements.canvas.height);
  state.camera = camera;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#050705';
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  context.imageSmoothingEnabled = false;
  context.setTransform(camera.scale, 0, 0, camera.scale, camera.destX, camera.destY);
  context.save();
  context.beginPath();
  context.rect(0, 0, SITE_CANVAS.width, SITE_CANVAS.height);
  context.clip();

  const terrainUnderlay = new Set([
    'field.bridge_stone', 'field.bridge_wood', 'field.cliff', 'field.cobblestone',
    'field.dirt_path', 'field.dock_floor', 'field.fence_wood', 'field.plaza',
    'field.river_edge', 'field.road_corner', 'field.road_edge', 'field.road_intersection',
    'field.stairs_stone', 'field.wall_stone', 'field.water'
  ]);
  const featureOverlays = new Set(['field.tree', 'field.rock']);
  const drawGroundPass = (underlayPass) => {
    for (let y = 0; y < SITE_CANVAS.rows; y += 1) {
      for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
        const assetId = groundAssetAt(recipe, x, y);
        if (terrainUnderlay.has(assetId) !== underlayPass) continue;
        if (featureOverlays.has(assetId)) {
          context.drawImage(images.get('field.grass'), x * 64, y * 64, 64, 64);
        }
        const transform = groundTransformAt(recipe, x, y);
        context.save();
        context.translate(x * 64 + 32, y * 64 + 32);
        context.rotate(transform.quarterTurns * Math.PI / 2);
        if (transform.flipX) context.scale(-1, 1);
        context.drawImage(images.get(assetId), -32, -32, 64, 64);
        context.restore();
      }
    }
  };
  const drawTile = (entry) => {
    const placement = authoredTilePlacement(entry);
    context.save();
    context.translate(placement.x + 32, placement.y + 32);
    if (placement.flipX) context.scale(-1, 1);
    context.drawImage(images.get(entry.assetId), -32, -32, 64, 64);
    context.restore();
  };

  // SITE_RENDER_LAYERS is the declared painter's order. Tree/rock cells first
  // receive grass and then their transparent terrain-feature overlay.
  if (SITE_RENDER_LAYERS[0] === 'ground') drawGroundPass(false);
  if (SITE_RENDER_LAYERS[1] === 'terrain-underlay') drawGroundPass(true);
  for (let y = 0; y < SITE_CANVAS.rows; y += 1) for (let x = 0; x < SITE_CANVAS.columns; x += 1) {
    for (const drift of snowPixelOverlaysAt(recipe, x, y)) {
      context.fillStyle = drift.color;
      for (const rectangle of drift.rectangles) {
        context.fillRect(x * 64 + rectangle.x, y * 64 + rectangle.y, rectangle.width, rectangle.height);
      }
    }
  }
  for (const entry of recipe.rearDecor) drawTile(entry);

  const depthItems = [
    ...recipe.structures.map((entry, index) => ({ type: 'structure', entry, depth: entry.baselineY, index })),
    ...recipe.props.map((entry, index) => ({
      type: 'prop', entry, depth: authoredTilePlacement(entry).depth, index
    })),
    ...recipe.npcs.map((entry, index) => ({ type: 'npc', entry, depth: entry.y * 64 + 52, index })),
    { type: 'player', entry: null, depth: state.sitePosition.y * 64 + 52, index: 0 }
  ].sort((left, right) => left.depth - right.depth
    || ({ structure: 0, prop: 1, npc: 2, player: 3 }[left.type] - { structure: 0, prop: 1, npc: 2, player: 3 }[right.type])
    || left.index - right.index);
  for (const item of depthItems) {
    if (item.type === 'structure') {
      context.drawImage(images.get(item.entry.assetId), item.entry.x, item.entry.y, item.entry.width, item.entry.height);
    } else if (item.type === 'prop') drawTile(item.entry);
    else if (item.type === 'npc') {
      drawCharacter(images.get(item.entry.assetId), item.entry.direction, 'idle', item.entry.x * 64 + 32, item.entry.y * 64 + 52);
    } else {
      drawCharacter(
        images.get('character.player'),
        state.siteDirection,
        movementFrame(state.siteMovement, timestamp),
        state.sitePosition.x * 64 + 32,
        state.sitePosition.y * 64 + 52
      );
    }
  }
  for (const entry of recipe.frontOccluders) drawTile(entry);
  const effectFrame = effectFrameRect(Math.floor(timestamp / 160));
  for (const entry of recipe.effects) {
    context.drawImage(
      images.get(entry.assetId),
      effectFrame.x, effectFrame.y, effectFrame.width, effectFrame.height,
      entry.x * 64 + 16, entry.y * 64 + 16, 32, 32
    );
  }
  context.restore();
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function draw(timestamp = 0) {
  if (!state.worldReady || !state.worldImage || !context) return;
  if (state.view === 'site' && state.assets && state.siteRecipe) drawSite(timestamp);
  else drawWorld(timestamp);
}

function updateNearbyAnchor() {
  state.nearbyAnchor = nearestFacilityAnchor(
    state.worldPosition.x,
    state.worldPosition.y,
    state.presentAnchors,
    58
  );
  if (state.nearbyAnchor && !state.selectedAnchor) state.selectedAnchor = state.nearbyAnchor;
  updateFacilityDetail();
}

function startNextWorldSegment(timestamp) {
  if (state.worldMovement || state.worldTransition || state.worldQueue.length === 0) return;
  const target = state.worldQueue.shift();
  const fromId = state.worldNodeId;
  const edge = navigationEdgeBetween(fromId, target.id);
  if (!edge) {
    state.worldQueue = [];
    return;
  }
  const distance = Math.hypot(target.x - state.worldPosition.x, target.y - state.worldPosition.y);
  state.worldDirection = directionBetweenPoints(state.worldPosition, target, state.worldDirection);
  state.worldNodeId = target.id;
  if (edge.type === 'transition') {
    state.worldPosition = { x: target.x, y: target.y };
    state.worldTransition = { startedAt: timestamp, duration: 180, fromId, toId: target.id };
    updateNearbyAnchor();
    return;
  }
  state.worldMovement = createInterpolatedMovement(state.worldPosition, target, timestamp, Math.max(160, Math.min(520, distance * 3)));
}

function queueWorldPath(path, timestamp = performance.now()) {
  state.worldQueue = path.slice(1);
  startNextWorldSegment(timestamp);
}

function startNextSiteSegment(timestamp) {
  if (state.siteMovement || state.siteQueue.length === 0) return;
  const target = state.siteQueue.shift();
  state.siteDirection = directionBetweenPoints(state.sitePosition, target, state.siteDirection);
  state.siteNodeId = target.id;
  state.siteMovement = createInterpolatedMovement(state.sitePosition, target, timestamp, 180);
}

function queueSitePath(path, timestamp = performance.now()) {
  state.siteQueue = path.slice(1);
  startNextSiteSegment(timestamp);
}

function updateMovements(timestamp) {
  if (state.worldTransition && timestamp >= state.worldTransition.startedAt + state.worldTransition.duration) {
    state.worldTransition = null;
    updateSummary();
    startNextWorldSegment(timestamp);
  }
  if (state.worldMovement) {
    const sample = sampleInterpolatedMovement(state.worldMovement, timestamp);
    state.worldPosition = { x: sample.x, y: sample.y };
    state.worldDirection = sample.direction;
    if (sample.done) {
      state.worldPosition = { ...state.worldMovement.to };
      state.worldMovement = null;
      updateNearbyAnchor();
      updateSummary();
      startNextWorldSegment(timestamp);
    }
  }
  if (state.siteMovement) {
    const sample = sampleInterpolatedMovement(state.siteMovement, timestamp);
    state.sitePosition = { x: sample.x, y: sample.y };
    state.siteDirection = sample.direction;
    if (sample.done) {
      state.sitePosition = { ...state.siteMovement.to };
      state.siteMovement = null;
      startNextSiteSegment(timestamp);
    }
  }
}

function animationTick(timestamp) {
  state.lastTimestamp = timestamp;
  updateMovements(timestamp);
  draw(timestamp);
  window.requestAnimationFrame(animationTick);
}

function canPlay() {
  if (state.assets) return true;
  announce(state.assetError
    ? '承認済み必須素材を利用できないため、代替素材では開始しません。'
    : '承認済み必須素材を準備しています。');
  return false;
}

function beginWorldExploration() {
  if (!canPlay()) return false;
  state.interactionStarted = true;
  state.view = 'world';
  elements.canvas.dataset.mode = 'world';
  elements.help.hidden = false;
  updateNearbyAnchor();
  updateSummary();
  return true;
}

function showOverview() {
  if (state.view === 'site') returnToWorld();
  state.view = 'overview';
  state.worldMovement = null;
  state.worldTransition = null;
  state.worldQueue = [];
  elements.canvas.dataset.mode = 'overview';
  updateSummary();
  draw(state.lastTimestamp);
  announce('街の全景を表示しました。');
}

function moveWorldDirection(direction) {
  if (state.worldMovement || state.worldTransition || !beginWorldExploration()) return;
  const next = nextNodeForDirection(state.worldNodeId, direction);
  state.worldDirection = direction;
  if (next.id !== state.worldNodeId) queueWorldPath([nearestNavigationNode(state.worldPosition.x, state.worldPosition.y), next]);
  else draw(state.lastTimestamp);
}

function moveSiteDirection(direction) {
  if (state.siteMovement) return;
  const next = nextSiteNodeForDirection(state.siteRecipe, state.siteNodeId, direction);
  state.siteDirection = direction;
  if (next?.id !== state.siteNodeId) queueSitePath([siteNodeById(state.siteRecipe, state.siteNodeId), next]);
}

function currentSiteNearEvidence() {
  const evidence = siteNodeById(state.siteRecipe, state.siteRecipe?.evidenceNodeId);
  return evidence && Math.hypot(evidence.x - state.sitePosition.x, evidence.y - state.sitePosition.y) <= 1.05;
}

function tryEnterSelectedFacility() {
  const anchor = state.nearbyAnchor;
  const facility = facilityForAnchor(anchor);
  if (!anchor || facility?.present !== true) {
    announce('入れる施設の近くまで移動してください。');
    return;
  }
  state.selectedAnchor = anchor;
  const recipes = siteRecipesForFacility(facility.kind);
  if (recipes.length === 1) enterSite(recipes[0].id);
  else showSiteChoice(recipes);
}

function enterSite(siteId) {
  const recipe = siteRecipeById(siteId);
  if (!recipe || !canPlay() || !facilityIsPresent(recipe.facilityKind)) {
    announce('この検査場所は、観測された施設が存在するときだけ開きます。');
    return;
  }
  const anchor = FACILITY_ANCHORS[recipe.facilityKind];
  if (!anchor) return;
  state.worldReturn = {
    nodeId: state.worldNodeId,
    position: { ...state.worldPosition },
    direction: state.worldDirection,
    selectedKind: state.selectedAnchor?.kind ?? recipe.facilityKind
  };
  state.siteRecipe = recipe;
  state.siteNodeId = recipe.playerStartNodeId;
  const start = siteNodeById(recipe, recipe.playerStartNodeId);
  state.sitePosition = { x: start.x, y: start.y };
  state.siteDirection = 'up';
  state.siteMovement = null;
  state.siteQueue = [];
  state.selectedAnchor = anchor;
  state.view = 'site';
  elements.canvas.dataset.mode = 'site';
  closeJournal({ restoreFocus: false });
  closeSiteChoice({ restoreFocus: false });
  updateFacilityDetail();
  updateSummary();
  elements.canvas.focus();
  announce(`${recipe.label}に入りました。矢印キーまたはWASDで歩き、奥でEnterまたはSpaceを押すと根拠を確認できます。`);
}

function returnToWorld() {
  if (state.view !== 'site') return;
  const saved = state.worldReturn;
  state.siteRecipe = null;
  state.sitePosition = null;
  state.siteMovement = null;
  state.siteQueue = [];
  state.view = 'world';
  if (saved) {
    state.worldNodeId = saved.nodeId;
    state.worldPosition = { ...saved.position };
    state.worldDirection = saved.direction;
    state.selectedAnchor = state.presentAnchors.find((anchor) => anchor.kind === saved.selectedKind) ?? state.selectedAnchor;
  }
  elements.canvas.dataset.mode = 'world';
  updateNearbyAnchor();
  updateSummary();
  elements.canvas.focus();
  announce('同じ街道の位置へ戻りました。');
}

function canvasPoint(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * (elements.canvas.width / Math.max(1, bounds.width)),
    y: (event.clientY - bounds.top) * (elements.canvas.height / Math.max(1, bounds.height))
  };
}

function handleCanvasClick(event) {
  if (!state.worldReady || !state.camera || !canPlay()) return;
  const screen = canvasPoint(event);
  if (state.view === 'site') {
    if (state.siteMovement) return;
    const point = screenToSite(state.camera, screen);
    if (!point) return;
    const target = nearestSiteNode(state.siteRecipe, point.x / 64, point.y / 64);
    const path = shortestSitePath(state.siteRecipe, state.siteNodeId, target.id);
    queueSitePath(path);
    elements.canvas.focus();
    return;
  }
  const world = screenToWorld(state.camera, screen);
  if (!world || state.worldMovement || state.worldTransition || !beginWorldExploration()) return;
  const target = nearestNavigationNode(world.x, world.y);
  const path = shortestNavigationPath(state.worldNodeId, target.id);
  const anchor = nearestFacilityAnchor(world.x, world.y, state.presentAnchors, 32);
  if (anchor) state.selectedAnchor = anchor;
  queueWorldPath(path);
  updateFacilityDetail();
  elements.canvas.focus();
  announce(anchor ? `${anchor.label}へ向かっています。近くでEnterまたはSpaceを押してください。` : `${districtLabel(target)}へ移動しています。`);
}

function handleCanvasMove(event) {
  if (!state.worldReady || state.view === 'site' || !state.camera) return;
  const world = screenToWorld(state.camera, canvasPoint(event));
  const next = world ? nearestFacilityAnchor(world.x, world.y, state.presentAnchors, 24 / state.camera.scale) : null;
  if (next?.kind === state.hoveredAnchor?.kind) return;
  state.hoveredAnchor = next;
  state.interactionStarted = true;
  elements.canvas.title = next?.label ?? '';
  draw(state.lastTimestamp);
}

function handleCanvasKey(event) {
  const direction = directionForKey[event.key];
  if (direction) {
    event.preventDefault();
    if (state.view === 'site') moveSiteDirection(direction);
    else moveWorldDirection(direction);
    return;
  }
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (state.view === 'site') {
    if (currentSiteNearEvidence()) openJournal(elements.canvas);
    else announce('施設の奥まで歩くと、根拠を確認できます。');
  } else if (beginWorldExploration()) tryEnterSelectedFacility();
}

async function loadTown() {
  try {
    const response = await fetch('/api/town', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.town = await response.json();
    state.presentAnchors = anchorsForPresentFacilities(state.town?.model?.facilities);
    updateNearbyAnchor();
  } catch {
    state.town = null;
    state.presentAnchors = [];
    state.selectedAnchor = null;
    state.nearbyAnchor = null;
    announce('街の検査情報を取得できませんでした。風景のみ表示します。');
  }
  updateSummary();
  updateFacilityDetail();
}

function loadWorldImage() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => {
      if (image.naturalWidth !== WORLD_IMAGE.width || image.naturalHeight !== WORLD_IMAGE.height) {
        reject(new Error('World image dimensions do not match the completion design'));
        return;
      }
      state.worldImage = image;
      state.worldReady = true;
      elements.loading.hidden = true;
      resizeCanvas();
      resolve();
    }, { once: true });
    image.addEventListener('error', () => reject(new Error('World image failed to load')), { once: true });
    image.src = WORLD_IMAGE.src;
  });
}

async function loadAssets() {
  try {
    const siteAudit = auditSiteRecipes();
    const usageAudit = auditRuntimeAssetUsage();
    if (!siteAudit.ok || !usageAudit.ok) throw new Error('Runtime usage audit failed');
    state.assets = await loadForgeAssetImages();
  } catch (error) {
    state.assets = null;
    state.assetError = error;
    elements.assetErrorText.textContent = error?.message || '承認済み必須素材を読み込めません。代替素材は使用しません。';
    elements.assetError.hidden = false;
    announce('承認済み必須素材を読み込めません。代替素材は使用しません。');
  }
}

elements.canvas.addEventListener('click', handleCanvasClick);
elements.canvas.addEventListener('mousemove', handleCanvasMove);
elements.canvas.addEventListener('mouseleave', () => {
  state.hoveredAnchor = null;
  elements.canvas.title = '';
  draw(state.lastTimestamp);
});
elements.canvas.addEventListener('keydown', handleCanvasKey);
elements.overviewButton.addEventListener('click', showOverview);
elements.backButton.addEventListener('click', returnToWorld);
elements.journalButton.addEventListener('click', () => openJournal(elements.journalButton));
elements.journalClose.addEventListener('click', () => closeJournal());
elements.siteEnterButton.addEventListener('click', () => {
  const facility = selectedFacility();
  if (!facility || facility.present !== true) return;
  const recipes = siteRecipesForFacility(facility.kind);
  if (recipes.length === 1) enterSite(recipes[0].id);
  else showSiteChoice(recipes);
});
elements.siteChoiceClose.addEventListener('click', () => closeSiteChoice());
window.addEventListener('resize', resizeCanvas);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!elements.siteChoice.hidden) closeSiteChoice();
  else if (!elements.journal.hidden) closeJournal();
  else if (state.view === 'site') returnToWorld();
  else if (state.view === 'world') showOverview();
});

elements.canvas.dataset.mode = 'overview';
updateSummary();
updateFacilityDetail();
window.requestAnimationFrame(animationTick);

Promise.allSettled([loadTown(), loadWorldImage(), loadAssets()]).then((results) => {
  if (results[1].status === 'rejected') {
    state.worldReady = false;
    elements.loading.hidden = true;
    elements.canvas.hidden = true;
    elements.worldFallback.hidden = false;
    announce('街の風景を表示できませんでした。');
    return;
  }
  elements.canvas.focus();
  if (!state.assetError) announce('街の全景を表示しました。矢印キー、WASD、またはクリックで探索を始められます。');
});
