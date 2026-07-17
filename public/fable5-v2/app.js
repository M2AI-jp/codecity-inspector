import {
  INTEGER_ZOOMS,
  TOUR_WITNESS_COUNT,
  buildingFactIds,
  buildingForCutaway,
  computeWorldCamera,
  createInterpolatedMovement,
  createTourState,
  createWorldRuntime,
  compareCodeUnits,
  describeFact,
  directionBetweenPoints,
  formatDialogueText,
  interactionFamily,
  interactionFactId,
  interactionProtocol,
  interactionVerbLabel,
  isTownHallInteraction,
  nearestInteraction,
  nearestNode,
  nextNodeForDirection,
  playerOccluded,
  progressStorageKey,
  reduceTour,
  residentConversationTarget,
  restoreTourState,
  sampleInterpolatedMovement,
  screenToWorld,
  selectableTourQuestions,
  shortestPath,
  tileCenter,
  tourObjective,
  visibleDepthEntries,
  withinBuildingReleaseZone
} from './world-runtime.mjs';
import {
  ForgeAssetError,
  characterFrame,
  collectWorldPlanAssetIds,
  fetchForgeManifest,
  loadForgeAssetImages,
  spriteFrame,
  terrainFrame
} from './site-runtime.mjs';

const elements = {
  canvas: document.querySelector('#world-canvas'),
  repositoryName: document.querySelector('#repository-name'),
  habitabilityBadge: document.querySelector('#habitability-badge'),
  zoomOut: document.querySelector('#zoom-out'),
  zoomIn: document.querySelector('#zoom-in'),
  zoomValue: document.querySelector('#zoom-value'),
  soundToggle: document.querySelector('#sound-toggle'),
  journalButton: document.querySelector('#journal-button'),
  startupPanel: document.querySelector('#startup-panel'),
  startupMessage: document.querySelector('#startup-message'),
  gameError: document.querySelector('#game-error'),
  gameErrorTitle: document.querySelector('#game-error-title'),
  gameErrorMessage: document.querySelector('#game-error-message'),
  gameErrorDetails: document.querySelector('#game-error-details'),
  contextHint: document.querySelector('#context-hint'),
  objectiveText: document.querySelector('#objective-text'),
  objectiveGuide: document.querySelector('#objective-guide'),
  nearbyPrompt: document.querySelector('#nearby-prompt'),
  nearbyPlace: document.querySelector('#nearby-place'),
  nearbyAction: document.querySelector('#nearby-action'),
  nearbyNote: document.querySelector('#nearby-note'),
  actionButton: document.querySelector('#action-button'),
  screenReaderStatus: document.querySelector('#screen-reader-status'),
  dialogue: document.querySelector('#dialogue'),
  dialogueSpeaker: document.querySelector('#dialogue-speaker'),
  dialogueBody: document.querySelector('#dialogue-body'),
  dialogueChoices: document.querySelector('#dialogue-choices'),
  dialogueClose: document.querySelector('#dialogue-close'),
  journal: document.querySelector('#journal'),
  journalClose: document.querySelector('#journal-close'),
  questionList: document.querySelector('#question-list'),
  findingList: document.querySelector('#finding-list'),
  locationList: document.querySelector('#location-list'),
  absentList: document.querySelector('#absent-list'),
  surveyList: document.querySelector('#survey-list'),
  evidencePanel: document.querySelector('#evidence-panel'),
  evidenceClose: document.querySelector('#evidence-close'),
  evidenceTitle: document.querySelector('#evidence-title'),
  evidenceSaying: document.querySelector('#evidence-saying'),
  evidenceObserved: document.querySelector('#evidence-observed'),
  evidenceInferred: document.querySelector('#evidence-inferred'),
  evidenceUnknown: document.querySelector('#evidence-unknown'),
  evidenceSource: document.querySelector('#evidence-source'),
  evidenceCopy: document.querySelector('#evidence-copy')
};

const context = elements.canvas.getContext('2d', { alpha: false });
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  ready: false,
  stopped: false,
  payload: null,
  runtime: null,
  assets: null,
  assetsComplete: false,
  repositoryName: '',
  storageKey: '',
  tour: createTourState(),
  questions: [],
  player: null,
  route: [],
  movement: null,
  footsteps: [],
  nearby: null,
  nearbyKey: '',
  cutawayId: null,
  cutawayExitStartedAt: null,
  roofAlpha: new Map(),
  roofTransitions: new Map(),
  pointers: new Map(),
  pinchDistance: null,
  pinchUsed: false,
  buildingReveals: new Map(),
  drawEntries: [],
  lightEntries: [],
  maximumEntryHeight: 0,
  bufferedDirection: null,
  modalBufferedDirection: null,
  dialoguePauseStartedAt: null,
  interactionSession: null,
  dojoObservation: null,
  conversationActorId: null,
  overview: null,
  zoom: 2,
  camera: null,
  viewport: { width: 1, height: 1, dpr: 1 },
  reducedMotion: reducedMotionQuery.matches,
  animationFrame: 0
};

const CUTAWAY_TRANSITION_MS = 460;
const ROOF_OPEN_ALPHA = 0.12;
const SOUND_CUES = Object.freeze({
  enter: Object.freeze([
    Object.freeze({ frequency: 196, endFrequency: 294, delay: 0, duration: 0.16, gain: 0.035 }),
    Object.freeze({ frequency: 392, endFrequency: 494, delay: 0.09, duration: 0.19, gain: 0.025 })
  ]),
  exit: Object.freeze([
    Object.freeze({ frequency: 294, endFrequency: 196, delay: 0, duration: 0.2, gain: 0.03 })
  ]),
  interact: Object.freeze([
    Object.freeze({ frequency: 523, endFrequency: 659, delay: 0, duration: 0.09, gain: 0.022 })
  ])
});

function easeInOutCubic(progress) {
  const value = Math.max(0, Math.min(1, progress));
  return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2;
}

const ANIMATION_REGISTRY = Object.freeze({
  'animation.building.cutaway.fade': Object.freeze({
    kind: 'cutaway', durationMs: 460, easingId: 'ease-in-out-cubic', easing: easeInOutCubic
  }),
  'animation.building.closed.idle': Object.freeze({
    kind: 'idle', durationMs: 0, easingId: 'linear', easing: (progress) => Math.max(0, Math.min(1, progress))
  })
});

const SOUND_EVENT_REGISTRY = Object.freeze({
  'sound.building.inn.entry': Object.freeze({
    'event.facility.enter': 'enter',
    'event.facility.exit': 'exit',
    'event.facility.talk-keeper': 'interact'
  }),
  'sound.building.closed-sign': Object.freeze({
    'event.facility.inspect-closure-sign': 'interact'
  })
});

const PREFAB_BEHAVIOR_REGISTRY = Object.freeze({
  'behavior.building.enterable-service': Object.freeze({
    kind: 'enterable',
    prefabId: 'prefab.service.inn.enterable',
    access: 'enterable',
    animationSetId: 'animation.building.cutaway.fade',
    collision: Object.freeze({ exterior: 'solid-footprint', entrance: 'door', interior: 'walkable' }),
    eventIds: Object.freeze([
      'event.facility.approach',
      'event.facility.enter',
      'event.facility.talk-keeper',
      'event.facility.exit'
    ]),
    interactionEventId: 'event.facility.talk-keeper',
    interactionVerb: 'talk-innkeeper',
    labelMode: 'proximity',
    soundSetId: 'sound.building.inn.entry',
    speakerRole: 'keeper.inn'
  }),
  'behavior.building.closed-evidence-sign': Object.freeze({
    kind: 'closed',
    prefabId: 'prefab.module.closed-unreached',
    access: 'closed',
    animationSetId: 'animation.building.closed.idle',
    collision: Object.freeze({ exterior: 'solid-footprint', entrance: 'blocked', interior: 'none' }),
    eventIds: Object.freeze([
      'event.facility.approach',
      'event.facility.inspect-closure-sign'
    ]),
    interactionEventId: 'event.facility.inspect-closure-sign',
    interactionVerb: 'inspect-closure-sign',
    labelMode: 'proximity',
    soundSetId: 'sound.building.closed-sign',
    speakerRole: null
  })
});

const LEGACY_CUTAWAY_ANIMATION = Object.freeze({
  kind: 'cutaway', durationMs: CUTAWAY_TRANSITION_MS, easingId: 'ease-in-out-cubic', easing: easeInOutCubic
});
const LEGACY_ENTERABLE_PROGRAM = Object.freeze({
  kind: 'legacy-enterable',
  access: 'enterable',
  collision: Object.freeze({ exterior: 'solid-footprint', entrance: 'door', interior: 'walkable' }),
  animation: LEGACY_CUTAWAY_ANIMATION,
  eventIds: Object.freeze([]),
  soundEvents: null
});
const prefabProgramCache = new WeakMap();
const legacyProgramCache = new WeakMap();

function createSoundEngine() {
  let audioContext = null;
  let activated = false;
  let muted = false;
  const contextForPlayback = () => {
    if (!activated || muted) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    try {
      audioContext ??= new AudioContext();
    } catch {
      return null;
    }
    return audioContext;
  };
  return Object.freeze({
    async prime() {
      activated = true;
      const current = contextForPlayback();
      if (current?.state === 'suspended') {
        try {
          await current.resume();
        } catch {
          // Sound is optional. The generated city remains fully playable in silence.
        }
      }
    },
    play(name) {
      const current = contextForPlayback();
      const cue = SOUND_CUES[name];
      if (!current || current.state !== 'running' || !cue) return;
      for (const note of cue) {
        const start = current.currentTime + note.delay;
        const end = start + note.duration;
        try {
          const oscillator = current.createOscillator();
          const gain = current.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(note.frequency, start);
          oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, end);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(note.gain, start + Math.min(0.025, note.duration / 3));
          gain.gain.exponentialRampToValueAtTime(0.0001, end);
          oscillator.connect(gain).connect(current.destination);
          oscillator.start(start);
          oscillator.stop(end + 0.01);
        } catch {
          // Web Audio may be unavailable or blocked; gameplay must continue without it.
        }
      }
    },
    toggle() {
      muted = !muted;
      return muted;
    }
  });
}

const sound = createSoundEngine();

function withDeadline(promise, milliseconds, message = '残りの承認済み素材が15秒以内に届きませんでした。') {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new ForgeAssetError(message)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => window.clearTimeout(timer));
}

function criticalAssetIds(plan) {
  const ids = new Set(['character.player', 'structure.survey_plot', 'effect.construction_dust']);
  for (const cell of plan.terrain) ids.add(cell.assetId);
  const criticalBuildings = plan.buildings.filter((building) => {
    const family = interactionFamily(building);
    return family === 'ledger' || family === 'spatial';
  });
  const criticalBuildingIds = new Set(criticalBuildings.map((building) => building.id));
  for (const building of criticalBuildings) {
    ids.add(building.assetId);
    for (const overlay of building.overlays ?? []) ids.add(typeof overlay === 'string' ? overlay : overlay.assetId);
  }
  for (const npc of plan.npcs) if (criticalBuildingIds.has(npc.home)) ids.add(npc.assetId);
  return [...ids].filter(Boolean).sort();
}

function setStartupMessage(message) {
  elements.startupMessage.textContent = message;
}

function humanError(error) {
  if (error instanceof ForgeAssetError) return error.message;
  return error?.message || '予期しない読み込みエラーが発生しました。';
}

function showFatal(title, error, details = []) {
  if (state.stopped) return;
  state.stopped = true;
  state.ready = false;
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  elements.startupPanel.hidden = true;
  elements.contextHint.hidden = true;
  elements.nearbyPrompt.hidden = true;
  elements.actionButton.disabled = true;
  elements.gameErrorTitle.textContent = title;
  elements.gameErrorMessage.textContent = humanError(error);
  elements.gameErrorDetails.replaceChildren();
  for (const detail of [...(error?.issues ?? []), ...details].slice(0, 24)) {
    const item = document.createElement('li');
    item.textContent = String(detail);
    elements.gameErrorDetails.append(item);
  }
  elements.gameError.hidden = false;
}

function assertTownPayload(payload) {
  const issues = [];
  if (!payload || typeof payload !== 'object') issues.push('応答がオブジェクトではありません。');
  if (payload?.schemaVersion !== 2) issues.push('GET /api/town は schemaVersion 2 である必要があります。');
  if (!payload?.worldPlan || payload.worldPlan.schemaVersion !== 2) issues.push('遊べる WorldPlan v2 が含まれていません。');
  if (typeof payload?.repository?.name !== 'string') issues.push('repository.name がありません。');
  if (issues.length > 0) throw new Error(`街データの契約に適合しません。\n${issues.join('\n')}`);
}

function loadSavedTour() {
  try {
    const parsed = JSON.parse(localStorage.getItem(state.storageKey) ?? 'null');
    return restoreTourState(parsed, state.runtime);
  } catch {
    return createTourState();
  }
}

function saveTour() {
  if (!state.assetsComplete) return;
  try {
    localStorage.setItem(state.storageKey, JSON.stringify(state.tour));
  } catch {
    announce('進捗をブラウザーに保存できませんでした。この画面を閉じるまでは遊べます。');
  }
}

function setTour(next) {
  if (!state.assetsComplete || next === state.tour) return false;
  state.tour = next;
  saveTour();
  renderHud();
  renderJournal();
  return true;
}

function announce(message) {
  elements.screenReaderStatus.textContent = '';
  window.requestAnimationFrame(() => { elements.screenReaderStatus.textContent = message; });
}

function displayBuildingName(building) {
  const fixed = ({
    town_hall: '市庁舎',
    gate: '街の門',
    dojo: '古い道場',
    inn: '宿屋',
    house: '住居',
    residence: '住居',
    survey_tower: '測量塔',
    archive: '資料館',
    dock: '港',
    guild: 'ギルド会館'
  })[building.facilityKind];
  if (fixed) return fixed;
  const file = building.files?.[0];
  const basename = typeof file === 'string' ? file.split('/').at(-1) : null;
  return basename ? `建物「${basename}」` : '街の調査地点';
}

function prefabValue(building, field) {
  return building?.prefab?.[field] ?? building?.[field] ?? null;
}

function hasPrefabDeclaration(building) {
  return typeof building?.prefab?.id === 'string' || typeof building?.prefabId === 'string';
}

function sameEventIds(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((eventId) => actual.includes(eventId));
}

function prefabProgram(building) {
  if (!building || typeof building !== 'object' || !hasPrefabDeclaration(building)) return null;
  if (prefabProgramCache.has(building)) return prefabProgramCache.get(building);
  const prefab = building.prefab;
  const behavior = PREFAB_BEHAVIOR_REGISTRY[prefab?.behaviorId];
  const animation = ANIMATION_REGISTRY[prefab?.animationSetId];
  const soundEvents = SOUND_EVENT_REGISTRY[prefab?.soundSetId];
  const matches = Boolean(behavior && animation && soundEvents)
    && prefab.id === behavior.prefabId
    && prefab.access === behavior.access
    && prefab.animationSetId === behavior.animationSetId
    && prefab.cutawayDurationMs === animation.durationMs
    && prefab.cutawayEasing === animation.easingId
    && prefab.collision?.exterior === behavior.collision.exterior
    && prefab.collision?.entrance === behavior.collision.entrance
    && prefab.collision?.interior === behavior.collision.interior
    && sameEventIds(prefab.eventIds, behavior.eventIds)
    && prefab.soundSetId === behavior.soundSetId
    && prefab.labelMode === behavior.labelMode
    && (prefab.speakerRole ?? null) === behavior.speakerRole
    && prefab.interactionVerb === behavior.interactionVerb
    && Object.hasOwn(soundEvents ?? {}, behavior.interactionEventId);
  const program = matches ? Object.freeze({ ...behavior, animation, soundEvents }) : null;
  prefabProgramCache.set(building, program);
  return program;
}

function legacyEnterableProgram(building) {
  if (!building || hasPrefabDeclaration(building) || building.class === 'S' || !state.runtime) return null;
  if (legacyProgramCache.has(building)) return legacyProgramCache.get(building);
  const roomNodeIds = new Set((building.rooms ?? [])
    .flatMap((room) => Array.isArray(room?.floorNavNodeIds) ? room.floorNavNodeIds : [])
    .filter((nodeId) => typeof nodeId === 'string'));
  const interiorNodeIds = new Set([...roomNodeIds].filter((nodeId) => {
    const node = state.runtime.nodeById.get(nodeId);
    return node?.space === 'interior' && node.buildingId === building.id;
  }));
  const hasInteriorDoor = interiorNodeIds.size > 0 && state.runtime.plan.nav.edges.some((edge) => (
    edge.kind === 'door' && (interiorNodeIds.has(edge.from) !== interiorNodeIds.has(edge.to))
  ));
  const program = hasInteriorDoor ? LEGACY_ENTERABLE_PROGRAM : null;
  legacyProgramCache.set(building, program);
  return program;
}

function buildingAccess(building) {
  const program = prefabProgram(building);
  if (program?.kind === 'enterable'
    && program.collision.entrance === 'door'
    && program.collision.interior === 'walkable') return 'enterable';
  if (program?.kind === 'closed'
    && program.collision.entrance === 'blocked'
    && program.collision.interior === 'none') return 'closed';
  return legacyEnterableProgram(building)?.access ?? null;
}

function buildingAllowsCutaway(building) {
  if (!building) return false;
  if (!hasPrefabDeclaration(building)) return Boolean(legacyEnterableProgram(building));
  const program = prefabProgram(building);
  return program?.kind === 'enterable'
    && program.collision.entrance === 'door'
    && program.collision.interior === 'walkable'
    && program.animation.kind === 'cutaway';
}

function cutawayAnimation(building) {
  if (!hasPrefabDeclaration(building)) return legacyEnterableProgram(building)?.animation ?? null;
  const program = prefabProgram(building);
  return program?.kind === 'enterable' && program.animation.kind === 'cutaway' ? program.animation : null;
}

function playPrefabEvent(building, eventId) {
  const program = prefabProgram(building);
  if (!program || !program.eventIds.includes(eventId)) return;
  const cue = program.soundEvents[eventId];
  if (cue) sound.play(cue);
}

function habitabilityLabel(habitability) {
  if (!habitability || typeof habitability !== 'object') return '居住性 不明';
  const level = Number.isInteger(habitability.level) ? `Lv.${habitability.level}` : '';
  const label = habitability.label ?? (habitability.canLive ? '居住可能' : '要調査');
  return [level, label].filter(Boolean).join(' ');
}

function renderHud() {
  if (!state.runtime) return;
  elements.objectiveText.textContent = tourObjective(state.tour);
  elements.journalButton.disabled = !state.assetsComplete || !state.tour.journalReceived;
  elements.zoomValue.value = `${state.zoom}×`;
  elements.zoomValue.textContent = `${state.zoom}×`;
  elements.zoomOut.disabled = Boolean(state.overview) || state.zoom === INTEGER_ZOOMS[0];
  elements.zoomIn.disabled = Boolean(state.overview) || state.zoom === INTEGER_ZOOMS.at(-1);
  elements.objectiveGuide.hidden = state.tour.status === 'complete';
  elements.objectiveGuide.textContent = state.tour.status === 'choose-question' ? '問いを選ぶ' : '目的地へ案内';
}

function resizeCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (elements.canvas.width !== pixelWidth || elements.canvas.height !== pixelHeight) {
    elements.canvas.width = pixelWidth;
    elements.canvas.height = pixelHeight;
  }
  state.viewport = { width, height, dpr };
}

function currentCamera() {
  if (state.overview) {
    const scale = Math.max(0.05, Math.min(
      state.viewport.width / state.runtime.width,
      state.viewport.height / state.runtime.height
    ));
    state.camera = Object.freeze({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: state.runtime.width,
      sourceHeight: state.runtime.height,
      scale,
      zoom: null,
      viewportWidth: state.viewport.width,
      viewportHeight: state.viewport.height,
      offsetX: Math.floor((state.viewport.width - state.runtime.width * scale) / 2),
      offsetY: Math.floor((state.viewport.height - state.runtime.height * scale) / 2)
    });
    return state.camera;
  }
  state.camera = computeWorldCamera({
    viewportWidth: state.viewport.width,
    viewportHeight: state.viewport.height,
    worldWidth: state.runtime.width,
    worldHeight: state.runtime.height,
    focusX: state.player.x,
    focusY: state.player.y,
    zoom: state.zoom
  });
  state.camera = Object.freeze({ ...state.camera, offsetX: 0, offsetY: 0 });
  return state.camera;
}

function requireAssetImage(assetId, role) {
  const image = state.assets.image(assetId, role);
  if (!image) throw new Error(`承認済み画像が読み込まれていません: ${assetId}:${role ?? 'primary'}`);
  return image;
}

function assetImageReady(assetId, role) {
  return Boolean(state.assets.image(assetId, role));
}

function buildingImageReady(building) {
  const asset = state.assets.asset(building.assetId);
  return asset?.category === 'building'
    ? assetImageReady(building.assetId, 'base') && assetImageReady(building.assetId, 'roof')
    : assetImageReady(building.assetId, 'primary');
}

function drawTerrain(timestamp) {
  const { runtime, camera } = state;
  const tileSize = runtime.tileSize;
  const firstX = Math.max(0, Math.floor(camera.sourceX / tileSize));
  const firstY = Math.max(0, Math.floor(camera.sourceY / tileSize));
  const lastX = Math.min(runtime.widthTiles - 1, Math.ceil((camera.sourceX + camera.sourceWidth) / tileSize));
  const lastY = Math.min(runtime.heightTiles - 1, Math.ceil((camera.sourceY + camera.sourceHeight) / tileSize));
  for (let y = firstY; y <= lastY; y += 1) {
    for (let x = firstX; x <= lastX; x += 1) {
      const cell = runtime.terrainRows[y][x];
      const image = requireAssetImage(cell.assetId);
      const definition = state.assets.definition(cell.assetId);
      const frame = terrainFrame(definition, cell.variant, timestamp);
      if (!frame) throw new Error(`地形タイル契約を解釈できません: ${cell.assetId}`);
      context.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }
}

function buildingAnchor(building) {
  return {
    x: building.footprint.x + building.footprint.width / 2,
    y: building.footprint.y + building.footprint.height
  };
}

function drawBuildingLayer(building, role, alpha = 1) {
  const asset = state.assets.asset(building.assetId);
  if (asset?.category !== 'building') {
    if (role === 'base' && buildingImageReady(building)) {
      const position = buildingAnchor(building);
      drawWholeAsset(building.assetId, position.x, position.y, { alpha });
    } else if (role === 'base' && assetImageReady('structure.survey_plot')) {
      const position = buildingAnchor(building);
      drawWholeAsset('structure.survey_plot', position.x, position.y, { alpha: 0.9 });
    }
    return;
  }
  if (!buildingImageReady(building)) {
    if (role === 'base') {
      const position = buildingAnchor(building);
      drawWholeAsset('structure.survey_plot', position.x, position.y, { alpha: 0.9 });
    }
    return;
  }
  const image = requireAssetImage(building.assetId, role);
  const definition = state.assets.definition(building.assetId);
  const layer = definition.buildingLayerContract?.artifacts?.find((entry) => entry.role === role);
  const anchor = layer?.anchor ?? definition.pivot ?? { x: image.naturalWidth / 2, y: image.naturalHeight };
  const position = buildingAnchor(building);
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(image, Math.round(position.x - anchor.x), Math.round(position.y - anchor.y));
  context.restore();
}

function drawWholeAsset(assetId, x, y, { alpha = 1, frameIndex = null } = {}) {
  const image = requireAssetImage(assetId);
  const definition = state.assets.definition(assetId);
  const frame = frameIndex === null ? null : spriteFrame(definition, frameIndex);
  const sourceWidth = frame?.sw ?? image.naturalWidth;
  const sourceHeight = frame?.sh ?? image.naturalHeight;
  const pivot = definition.pivot ?? { x: sourceWidth / 2, y: sourceHeight };
  context.save();
  context.globalAlpha = alpha;
  if (frame) {
    context.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, x - pivot.x, y - pivot.y, frame.sw, frame.sh);
  } else {
    context.drawImage(image, x - pivot.x, y - pivot.y);
  }
  context.restore();
}

function drawCharacter(assetId, x, y, facing, action, timestamp, { silhouette = false, alpha = 1 } = {}) {
  const image = requireAssetImage(assetId);
  const definition = state.assets.definition(assetId);
  const frame = characterFrame(definition, facing, action, timestamp);
  if (!frame) throw new Error(`キャラクター契約を解釈できません: ${assetId}`);
  context.save();
  context.globalAlpha = alpha;
  if (silhouette) {
    context.filter = 'brightness(0) saturate(100%) invert(81%) sepia(26%) saturate(915%) hue-rotate(122deg) brightness(98%)';
  }
  context.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, x - frame.sw / 2, y - frame.sh, frame.sw, frame.sh);
  context.restore();
}

function playerNeedsSilhouette(visibleEntries) {
  if (playerOccluded(state.runtime, state.player.x, state.player.y)) return true;
  for (const { building } of visibleEntries.filter((entry) => entry.kind === 'building')) {
    if (state.assets.asset(building.assetId)?.category !== 'building') continue;
    if (!buildingImageReady(building)) continue;
    const definition = state.assets.definition(building.assetId);
    const pivot = definition.pivot;
    if (!pivot) continue;
    const anchor = buildingAnchor(building);
    for (const region of definition.occlusion?.regions ?? []) {
      const left = anchor.x - pivot.x + region.x;
      const top = anchor.y - pivot.y + region.y;
      if (state.player.x >= left && state.player.x <= left + region.width
        && state.player.y >= top && state.player.y <= top + region.height) return true;
    }
  }
  return false;
}

function npcPosition(npc) {
  const [tileX, tileY] = npc.patrol[0];
  return tileCenter(tileX, tileY, state.runtime.tileSize);
}

function shouldDrawNpc(npc) {
  if (npc.role === 'resident' || npc.role === 'dojo-student') return npc.home === state.cutawayId;
  return true;
}

function assetBounds(assetId, x, y, role = null) {
  const asset = state.assets.asset(assetId);
  const definition = asset?.definition;
  if (!definition) return { x, y, width: 0, height: 0 };
  const layer = role && asset.category === 'building'
    ? definition.buildingLayerContract?.artifacts?.find((entry) => entry.role === role)
    : null;
  const frame = asset.category === 'character' ? definition.characterSpriteContract?.frame : null;
  const size = layer?.outputSize ?? frame ?? definition.outputSize ?? { width: 0, height: 0 };
  const pivot = layer?.anchor ?? definition.pivot ?? { x: size.width / 2, y: size.height };
  return { x: x - pivot.x, y: y - pivot.y, width: size.width, height: size.height };
}

function unionBounds(left, right) {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(left.x + left.width, right.x + right.width) - x,
    height: Math.max(left.y + left.height, right.y + right.height) - y
  };
}

function buildDrawIndex() {
  const entries = [];
  for (const building of state.runtime.buildings) {
    const point = buildingAnchor(building);
    const asset = state.assets.asset(building.assetId);
    const bounds = asset?.category === 'building'
      ? unionBounds(
        assetBounds(building.assetId, point.x, point.y, 'base'),
        assetBounds(building.assetId, point.x, point.y, 'roof')
      )
      : assetBounds(building.assetId, point.x, point.y);
    entries.push({ kind: 'building', depth: point.y, building, bounds });
  }
  for (const prop of state.runtime.plan.props) {
    const point = tileCenter(prop.x, prop.y, state.runtime.tileSize);
    entries.push({ kind: 'prop', depth: point.y, prop, point, bounds: assetBounds(prop.assetId, point.x, point.y) });
  }
  for (const npc of state.runtime.plan.npcs) {
    const point = npcPosition(npc);
    entries.push({ kind: 'npc', depth: point.y, npc, point, bounds: assetBounds(npc.assetId, point.x, point.y) });
  }
  state.drawEntries = entries.sort((left, right) => left.depth - right.depth || compareCodeUnits(left.kind, right.kind));
  state.lightEntries = state.runtime.plan.lights.map((light) => {
    const point = tileCenter(light.x, light.y, state.runtime.tileSize);
    return { kind: 'light', depth: point.y, light, point, bounds: assetBounds(light.assetId, point.x, point.y) };
  }).sort((left, right) => left.depth - right.depth);
  state.maximumEntryHeight = Math.max(
    0,
    ...state.drawEntries.map((entry) => entry.bounds.height),
    ...state.lightEntries.map((entry) => entry.bounds.height)
  );
}

function drawIndexedEntity(entity, timestamp) {
  if (entity.kind === 'building') {
    drawBuildingLayer(entity.building, 'base');
    const anchor = buildingAnchor(entity.building);
    const revealStartedAt = state.buildingReveals.get(entity.building.id);
    if (revealStartedAt !== undefined) {
      const elapsed = timestamp - revealStartedAt;
      if (!state.reducedMotion && elapsed < 480) {
        drawWholeAsset('effect.construction_dust', anchor.x, anchor.y, { frameIndex: Math.floor(elapsed / 120) });
      } else state.buildingReveals.delete(entity.building.id);
    }
    if (buildingImageReady(entity.building)) {
      for (const overlay of entity.building.overlays ?? []) {
        const assetId = typeof overlay === 'string' ? overlay : overlay.assetId;
        if (assetId && assetImageReady(assetId)) drawWholeAsset(assetId, anchor.x, anchor.y);
      }
    }
  } else if (entity.kind === 'prop') {
    if (assetImageReady(entity.prop.assetId)) drawWholeAsset(entity.prop.assetId, entity.point.x, entity.point.y, { frameIndex: 0 });
  } else if (entity.kind === 'npc' && shouldDrawNpc(entity.npc) && assetImageReady(entity.npc.assetId)) {
    drawCharacter(entity.npc.assetId, entity.point.x, entity.point.y, 'south', 'idle', timestamp);
  }
}

function drawFootsteps() {
  if (state.footsteps.length === 0) return;
  context.save();
  context.fillStyle = 'rgba(115, 216, 210, 0.42)';
  for (const nodeId of state.footsteps.slice(0, 3)) {
    const node = state.runtime.nodeById.get(nodeId);
    if (!node) continue;
    context.beginPath();
    context.ellipse(node.worldX - 7, node.worldY - 5, 5, 9, -0.35, 0, Math.PI * 2);
    context.ellipse(node.worldX + 7, node.worldY + 4, 5, 9, 0.35, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawDojoObservation(timestamp) {
  const observation = state.dojoObservation;
  if (!observation) return;
  const ready = timestamp >= observation.readyAt;
  const pulse = state.reducedMotion ? 1 : 0.75 + Math.sin(timestamp / 130) * 0.2;
  context.save();
  context.strokeStyle = ready ? '#7fe0bc' : '#f2c96d';
  context.fillStyle = ready ? 'rgba(127, 224, 188, 0.18)' : 'rgba(242, 201, 109, 0.14)';
  context.lineWidth = Math.max(2, 4 / state.camera.scale);
  context.beginPath();
  context.arc(observation.target.x, observation.target.y, state.runtime.tileSize * 0.34 * pulse, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(observation.target.x - 18, observation.target.y);
  context.lineTo(observation.target.x + 18, observation.target.y);
  context.moveTo(observation.target.x, observation.target.y - 18);
  context.lineTo(observation.target.x, observation.target.y + 18);
  context.stroke();
  context.restore();
}

function drawEntranceAffordances(timestamp) {
  for (const building of state.runtime.buildings) {
    if (buildingAccess(building) !== 'enterable' || building.id === state.cutawayId) continue;
    const { x, y } = building.entrance;
    if (x < state.camera.sourceX - state.runtime.tileSize
      || y < state.camera.sourceY - state.runtime.tileSize
      || x > state.camera.sourceX + state.camera.sourceWidth + state.runtime.tileSize
      || y > state.camera.sourceY + state.camera.sourceHeight + state.runtime.tileSize) continue;
    const lift = state.reducedMotion ? 0 : Math.sin(timestamp / 240) * 2;
    context.save();
    context.translate(x, y - state.runtime.tileSize * 0.28 + lift);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(11, 16, 32, 0.88)';
    context.beginPath();
    context.moveTo(-9, -5);
    context.lineTo(0, 4);
    context.lineTo(9, -5);
    context.stroke();
    context.lineWidth = 2;
    context.strokeStyle = '#f2c96d';
    context.stroke();
    context.restore();
  }
}

function drawWorld(timestamp) {
  resizeCanvas();
  currentCamera();
  const { width, height, dpr } = state.viewport;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#11182a';
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(state.camera.offsetX ?? 0, state.camera.offsetY ?? 0);
  context.scale(state.camera.scale, state.camera.scale);
  context.translate(-state.camera.sourceX, -state.camera.sourceY);
  context.imageSmoothingEnabled = false;

  drawTerrain(timestamp);
  drawFootsteps();

  const entities = visibleDepthEntries(state.drawEntries, state.camera, state.maximumEntryHeight);
  let playerDrawn = false;
  for (const entity of entities) {
    if (!playerDrawn && state.player.y <= entity.depth) {
      drawCharacter('character.player', state.player.x, state.player.y, state.player.facing, state.movement ? 'walk' : 'idle', timestamp);
      playerDrawn = true;
    }
    drawIndexedEntity(entity, timestamp);
  }
  if (!playerDrawn) drawCharacter('character.player', state.player.x, state.player.y, state.player.facing, state.movement ? 'walk' : 'idle', timestamp);

  for (const entity of entities) {
    if (entity.kind !== 'building' || state.assets.asset(entity.building.assetId)?.category !== 'building') continue;
    drawBuildingLayer(entity.building, 'roof', state.roofAlpha.get(entity.building.id) ?? 1);
  }

  for (const { light, point } of visibleDepthEntries(state.lightEntries, state.camera, state.maximumEntryHeight)) {
    if (!light.on || !assetImageReady(light.assetId)) continue;
    context.save();
    context.globalCompositeOperation = 'lighter';
    drawWholeAsset(light.assetId, point.x, point.y, { alpha: 0.78, frameIndex: Math.floor(timestamp / 280) });
    context.restore();
  }

  drawEntranceAffordances(timestamp);
  drawDojoObservation(timestamp);

  if (playerNeedsSilhouette(entities)) {
    drawCharacter('character.player', state.player.x, state.player.y, state.player.facing, state.movement ? 'walk' : 'idle', timestamp, {
      silhouette: true,
      alpha: 0.5
    });
  }
  context.restore();
}

function startNextMovement(timestamp) {
  if (state.movement || state.route.length === 0) return;
  const toNodeId = state.route.shift();
  const to = state.runtime.nodeById.get(toNodeId);
  if (!to) return;
  state.player.facing = directionBetweenPoints(state.player, { x: to.worldX, y: to.worldY });
  const distance = Math.hypot(to.worldX - state.player.x, to.worldY - state.player.y);
  state.movement = {
    ...createInterpolatedMovement({
      from: state.player,
      to: { x: to.worldX, y: to.worldY },
      startedAt: timestamp,
      duration: Math.max(130, distance * 3.1),
      reducedMotion: state.reducedMotion
    }),
    toNodeId
  };
}

function updateMovement(timestamp) {
  startNextMovement(timestamp);
  if (!state.movement) return;
  const sampled = sampleInterpolatedMovement(state.movement, timestamp);
  state.player.x = sampled.x;
  state.player.y = sampled.y;
  if (!sampled.done) return;
  state.player.navNodeId = state.movement.toNodeId;
  state.movement = null;
  if (state.bufferedDirection) {
    state.route = [];
    state.footsteps = [];
    const next = nextNodeForDirection(state.runtime, state.player.navNodeId, state.bufferedDirection);
    state.bufferedDirection = null;
    if (next) {
      state.route = [next.id];
      state.footsteps = [next.id];
    }
  }
  if (state.route.length === 0) state.footsteps = [];
  startNextMovement(timestamp);
}

function updateNearby() {
  const nearby = nearestInteraction(state.runtime, state.player.x, state.player.y);
  if (state.dojoObservation && nearby?.building.id !== state.dojoObservation.buildingId) {
    cancelDojoObservation('観察地点を離れたため、道場の観察を取り消しました。');
  }
  state.nearby = nearby;
  const declaredPrefab = nearby ? hasPrefabDeclaration(nearby.building) : false;
  const program = nearby ? prefabProgram(nearby.building) : null;
  const invalidPrefab = declaredPrefab && !program;
  const ready = nearby ? !invalidPrefab && state.assetsComplete && buildingImageReady(nearby.building) : false;
  const access = nearby ? buildingAccess(nearby.building) : null;
  const dojoStage = state.dojoObservation
    ? (performance.now() >= state.dojoObservation.readyAt ? 'ready' : Math.floor((state.dojoObservation.readyAt - performance.now()) / 250))
    : '';
  const overviewStage = state.overview?.buildingId ?? '';
  const key = nearby ? `${nearby.building.id}:${nearby.family}:${access}:${invalidPrefab}:${ready}:${state.assetsComplete}:${dojoStage}:${overviewStage}` : '';
  if (key === state.nearbyKey) return;
  state.nearbyKey = key;
  if (!nearby) {
    elements.nearbyPrompt.hidden = true;
    delete elements.nearbyPrompt.dataset.access;
    elements.actionButton.disabled = true;
    elements.contextHint.hidden = state.tour.status === 'complete';
    return;
  }
  elements.contextHint.hidden = true;
  elements.nearbyPrompt.dataset.access = invalidPrefab ? 'invalid' : access ?? 'legacy';
  elements.nearbyPlace.textContent = access === 'closed'
    ? '閉鎖 · 未到達／要確認'
    : access === 'enterable'
      ? `${displayBuildingName(nearby.building)} · 入れる`
      : displayBuildingName(nearby.building);
  elements.nearbyNote.textContent = invalidPrefab
    ? 'Prefabの動作宣言が一致しないため、この施設の操作を停止しています。'
    : access === 'closed'
      ? '入口からの静的な道筋が未確認です。死んだコードとは断定していません。'
      : 'Enter / Space、またはTabで操作ボタンへ';
  if (invalidPrefab) {
    elements.nearbyAction.textContent = '施設動作を確認できません';
  } else if (access === 'closed') {
    elements.nearbyAction.textContent = ready ? '閉鎖看板を調べる' : '承認済み素材を照合中…';
  } else if (state.overview?.buildingId === nearby.building.id) {
    elements.nearbyAction.textContent = '俯瞰を終了して記録する';
  } else if (state.dojoObservation?.buildingId === nearby.building.id) {
    const remaining = Math.max(0, state.dojoObservation.readyAt - performance.now());
    elements.nearbyAction.textContent = remaining > 0
      ? `標的を観察中（あと${Math.ceil(remaining / 1000)}秒）`
      : '観察結果を記録する';
  } else {
    elements.nearbyAction.textContent = ready ? interactionVerbLabel(nearby.family) : '承認済み素材を照合中…';
  }
  elements.nearbyPrompt.hidden = false;
  elements.actionButton.disabled = !ready;
  elements.actionButton.setAttribute('aria-label', invalidPrefab
    ? 'Prefabの動作宣言が一致しないため操作できません'
    : access === 'closed'
      ? '閉鎖看板を調べる'
      : `${displayBuildingName(nearby.building)}で${interactionVerbLabel(nearby.family)}`);
}

function updateCutaway(timestamp) {
  const cutawayCandidate = buildingForCutaway(state.runtime, state.player.x, state.player.y);
  const candidate = buildingAllowsCutaway(cutawayCandidate) ? cutawayCandidate : null;
  if (candidate) {
    if (state.cutawayId !== candidate.id) {
      const previous = state.runtime.buildingById.get(state.cutawayId);
      playPrefabEvent(previous, 'event.facility.exit');
      state.cutawayId = candidate.id;
      playPrefabEvent(candidate, 'event.facility.enter');
    }
    state.cutawayExitStartedAt = null;
  } else if (state.cutawayId) {
    const active = state.runtime.buildingById.get(state.cutawayId);
    if (withinBuildingReleaseZone(state.runtime, active, state.player.x, state.player.y)) {
      state.cutawayExitStartedAt = null;
    } else if (state.cutawayExitStartedAt === null) {
      state.cutawayExitStartedAt = timestamp;
    } else if (timestamp - state.cutawayExitStartedAt >= 300) {
      playPrefabEvent(active, 'event.facility.exit');
      state.cutawayId = null;
      state.cutawayExitStartedAt = null;
    }
  }
  for (const building of state.runtime.buildings) {
    const animation = cutawayAnimation(building);
    const target = building.id === state.cutawayId && buildingAllowsCutaway(building) && animation
      ? ROOF_OPEN_ALPHA : 1;
    let current = state.roofAlpha.get(building.id) ?? 1;
    let transition = state.roofTransitions.get(building.id) ?? null;
    if (transition) {
      const progress = (timestamp - transition.startedAt) / Math.max(1, transition.duration);
      current = transition.from + (transition.to - transition.from) * transition.easing(progress);
      if (progress >= 1) {
        current = transition.to;
        state.roofTransitions.delete(building.id);
        transition = null;
      }
    }
    if (state.reducedMotion) {
      current = target;
      state.roofTransitions.delete(building.id);
    } else if (animation && (!transition || transition.to !== target) && Math.abs(current - target) > 0.0001) {
      const fullDistance = 1 - ROOF_OPEN_ALPHA;
      const duration = animation.durationMs * Math.abs(target - current) / fullDistance;
      transition = Object.freeze({ from: current, to: target, startedAt: timestamp, duration, easing: animation.easing });
      state.roofTransitions.set(building.id, transition);
    }
    state.roofAlpha.set(building.id, current);
  }
}

function frame(timestamp) {
  if (!state.ready || state.stopped) return;
  try {
    if (!elements.dialogue.open) updateMovement(timestamp);
    updateCutaway(timestamp);
    updateNearby();
    drawWorld(timestamp);
    state.animationFrame = requestAnimationFrame(frame);
  } catch (error) {
    showFatal('描画を続けられません', error);
  }
}

function routeToNode(targetNodeId) {
  const originId = state.movement?.toNodeId ?? state.player.navNodeId;
  const path = shortestPath(state.runtime, originId, targetNodeId);
  if (path.length === 0) {
    announce('そこへ続く歩ける道は、WorldPlanにありません。');
    return false;
  }
  state.bufferedDirection = null;
  state.route = path.slice(1);
  state.footsteps = state.route.length <= 3
    ? [...state.route]
    : [state.route[Math.floor(state.route.length / 3)], state.route[Math.floor(state.route.length * 2 / 3)], state.route.at(-1)];
  return true;
}

function routeToWorld(x, y) {
  const target = nearestNode(state.runtime, x, y, { space: 'outdoor' });
  if (target) routeToNode(target.node.id);
}

function routeToBuilding(building) {
  const target = nearestNode(state.runtime, building.interaction.x, building.interaction.y);
  if (target && routeToNode(target.node.id)) announce(`${displayBuildingName(building)}へ向かいます。`);
}

function guideObjective() {
  if (!state.ready) return;
  if (state.tour.status === 'choose-question') {
    openJournal();
    return;
  }
  let destination = null;
  if (['need-journal', 'return-town-hall', 'answer'].includes(state.tour.status)) {
    destination = state.runtime.buildings.find(isTownHallInteraction) ?? null;
  } else if (state.tour.status === 'investigating') {
    const usedBuildings = new Set(state.tour.witnesses.map((entry) => entry.buildingId));
    const usedFamilies = new Set(state.tour.witnesses.map((entry) => entry.family));
    const candidates = state.runtime.buildings.filter((building) => {
      const protocol = interactionProtocol(building);
      return protocol.supported && protocol.family && protocol.family !== 'ledger'
        && !usedBuildings.has(building.id);
    });
    destination = candidates.find((building) => buildingFactIds(state.runtime, building).includes(state.tour.questionId))
      ?? candidates.find((building) => !usedFamilies.has(interactionFamily(building)))
      ?? null;
  }
  if (destination) routeToBuilding(destination);
  else announce('次の調査場所をWorldPlanから見つけられません。');
}

function cancelDialogueSession() {
  if (state.interactionSession?.kind === 'entry-tags' || state.interactionSession?.kind === 'neighbor') {
    state.interactionSession = null;
    state.conversationActorId = null;
    state.nearbyKey = '';
  }
}

function pauseDialogueMovement() {
  if (state.dialoguePauseStartedAt === null) state.dialoguePauseStartedAt = performance.now();
  state.route = [];
  state.footsteps = [];
}

function resumeDialogueMovement() {
  if (state.dialoguePauseStartedAt === null) return;
  const pausedFor = Math.max(0, performance.now() - state.dialoguePauseStartedAt);
  if (state.movement) state.movement = { ...state.movement, startedAt: state.movement.startedAt + pausedFor };
  state.dialoguePauseStartedAt = null;
}

function consumeModalDirection() {
  if (!state.modalBufferedDirection || modalIsOpen() || !state.ready || !state.runtime || !state.player) return;
  const direction = state.modalBufferedDirection;
  state.modalBufferedDirection = null;
  if (state.movement || state.route.length > 0) {
    state.bufferedDirection = direction;
    return;
  }
  const next = nextNodeForDirection(state.runtime, state.player.navNodeId, direction);
  if (!next) return;
  state.route = [next.id];
  state.footsteps = [next.id];
}

function scheduleModalDirection() {
  window.requestAnimationFrame(consumeModalDirection);
}

function finalizeDialogueClose() {
  cancelDialogueSession();
  resumeDialogueMovement();
  scheduleModalDirection();
}

function closeDialogue() {
  if (elements.dialogue.open && typeof elements.dialogue.close === 'function') elements.dialogue.close();
  else elements.dialogue.removeAttribute('open');
  finalizeDialogueClose();
}

function showModal(dialog) {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function openDialogue({ speaker, body, choices = [] }) {
  if (!elements.dialogue.open) pauseDialogueMovement();
  elements.dialogueSpeaker.textContent = speaker;
  elements.dialogueBody.textContent = formatDialogueText(body);
  elements.dialogueChoices.replaceChildren();
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-button';
    button.textContent = choice.label;
    button.addEventListener('click', choice.run, { once: true });
    elements.dialogueChoices.append(button);
  }
  if (choices.length === 0) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice-button';
    button.textContent = '閉じる';
    button.addEventListener('click', closeDialogue, { once: true });
    elements.dialogueChoices.append(button);
  }
  showModal(elements.dialogue);
  elements.dialogueChoices.querySelector('button')?.focus();
}

function openFinalQuestion() {
  const question = state.runtime.factById.get(state.tour.questionId);
  openDialogue({
    speaker: '市庁舎の記録官',
    body: `現場を三つの方法で確かめましたね。\n\n「${describeFact(question)}」\n\nこの内容には、検査で直接観測した根拠がありますか？`,
    choices: [
      { label: 'はい、直接観測の根拠がある', run: () => finishTour(true) },
      { label: 'いいえ、直接観測の根拠はない', run: () => finishTour(false) }
    ]
  });
}

function finishTour(answer) {
  const question = state.runtime.factById.get(state.tour.questionId);
  const correctAnswer = (question?.evidence?.observed?.length ?? 0) > 0;
  const correct = answer === correctAnswer;
  setTour(reduceTour(state.tour, { type: 'answer', value: answer }, state.runtime));
  closeDialogue();
  window.queueMicrotask(() => openDialogue({
    speaker: '市庁舎の記録官',
    body: correct
      ? `正解です。答えは「${correctAnswer ? '直接観測の根拠がある' : '直接観測の根拠はない'}」。観測・推定・不明を分けて読めています。これからは自由に街を調べられます。`
      : `答えは「${correctAnswer ? '直接観測の根拠がある' : '直接観測の根拠はない'}」です。間違えてもペナルティはありません。証拠の三つの欄を読み返しながら、自由に街を調べてください。`
  }));
  announce('最初の調査を完了しました。');
}

function performLedgerInteraction(building) {
  if (!isTownHallInteraction(building)) {
    openDialogue({
      speaker: displayBuildingName(building),
      body: '記録官は不在です。入口の留守札には「報告と手帳の受け渡しは市庁舎で」とあります。'
    });
    return;
  }
  if (state.tour.status === 'need-journal') {
    openDialogue({
      speaker: '市庁舎の記録官',
      body: 'ようこそ。この街は、検査で確認した事実からできています。観測したこと、そこから推定したこと、まだ分からないことを混ぜないでください。まず調査手帳をどうぞ。',
      choices: [{
        label: '調査手帳を受け取る',
        run: () => {
          setTour(reduceTour(state.tour, { type: 'receiveJournal', buildingId: building.id }, state.runtime));
          closeDialogue();
          renderJournal();
          showModal(elements.journal);
          announce('調査手帳を受け取りました。調べる問いを選んでください。');
        }
      }]
    });
    return;
  }
  if (state.tour.status === 'return-town-hall') {
    openDialogue({
      speaker: '市庁舎の記録官',
      body: `異なる三つの方法で現場を確かめました。発見を記録簿に戻しますか？`,
      choices: [{
        label: '三つの発見を報告する',
        run: () => {
          setTour(reduceTour(state.tour, { type: 'report', buildingId: building.id }, state.runtime));
          closeDialogue();
          window.queueMicrotask(openFinalQuestion);
        }
      }]
    });
    return;
  }
  if (state.tour.status === 'answer') {
    openFinalQuestion();
    return;
  }
  if (state.tour.status === 'choose-question') {
    openDialogue({
      speaker: '市庁舎の記録官',
      body: '手帳を開き、今回調べる問いをひとつ選んでください。選ぶまでは現場の記録は進みません。',
      choices: [{ label: '調査手帳を開く', run: () => { closeDialogue(); openJournal(); } }]
    });
    return;
  }
  if (state.tour.status === 'investigating') {
    openDialogue({
      speaker: '市庁舎の記録官',
      body: `現場で異なる調べ方を三つ試してください。現在 ${state.tour.witnesses.length}/${TOUR_WITNESS_COUNT} 件です。建物へ入っただけでは記録されません。`,
      choices: [{ label: '調査を続ける', run: closeDialogue }]
    });
    return;
  }
  openDialogue({
    speaker: '市庁舎の記録官',
    body: '最初の調査は完了しています。手帳から、いつでも観測・推定・不明を読み返せます。'
  });
}

function shortSourceLabel(value, fallback = '行先未確認') {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value.split(/[?#]/, 1)[0].split(/[\\/]/).filter(Boolean).at(-1) ?? fallback;
}

function streetReferenceLabel(kind) {
  return ({
    'dynamic-import': '動的な道',
    'static-import': '静的な道',
    import: '参照の道',
    require: '読込の道'
  })[kind] ?? '参照の道';
}

function gateEntryTags(building, fact) {
  const values = new Set([
    ...(building.files ?? []),
    fact?.params?.path,
    fact?.params?.from,
    fact?.params?.source,
    fact?.params?.to,
    fact?.params?.targetHint
  ].filter((value) => typeof value === 'string' && value.length > 0));
  const bindings = state.runtime.plan.streets.flatMap((street) => street.edgeBindings ?? []);
  const related = bindings.filter((binding) => [binding.from, binding.to, binding.targetHint].some((value) => values.has(value)));
  const tags = related.map((binding) => {
    const destination = binding.status === 'resolved' ? shortSourceLabel(binding.to) : shortSourceLabel(binding.targetHint);
    const status = binding.status === 'resolved' ? '接続確認' : '行先未確認';
    return `${streetReferenceLabel(binding.kind)}：${shortSourceLabel(binding.from)}から${destination}（${status}）`;
  });
  if (tags.length === 0 && fact) {
    const origin = fact.params?.from ?? fact.params?.path ?? fact.params?.source;
    if (origin) tags.push(`入口元：${shortSourceLabel(origin)}`);
    const destination = fact.params?.to ?? fact.params?.targetHint ?? fact.params?.test;
    if (destination) tags.push(`行先：${shortSourceLabel(destination)}`);
    tags.push(describeFact(fact));
  }
  return [...new Set(tags)].slice(0, 8);
}

function completeWitness(nearby, factId) {
  const next = reduceTour(state.tour, {
    type: 'witness',
    buildingId: nearby.building.id,
    family: nearby.family,
    factId
  }, state.runtime);
  const changed = setTour(next);
  state.interactionSession = null;
  state.conversationActorId = null;
  state.dojoObservation = null;
  closeDialogue();
  if (changed && factId) showEvidence(factId);
  if (changed) announce(`${displayBuildingName(nearby.building)}で発見を記録しました。${state.tour.witnesses.length}件です。`);
}

function openGateTagStep(nearby) {
  const session = state.interactionSession;
  if (!session || session.kind !== 'entry-tags' || session.buildingId !== nearby.building.id) return;
  const tag = session.tags[session.index];
  const final = session.index === session.tags.length - 1;
  openDialogue({
    speaker: displayBuildingName(nearby.building),
    body: `入口札 ${session.index + 1}/${session.tags.length}。「${tag}」札の順番と街路の対応を確かめます。`,
    choices: [{
      label: final ? '最後の札を記録する' : '次の入口札を読む',
      run: () => {
        if (final) completeWitness(nearby, session.factId);
        else {
          state.interactionSession = Object.freeze({ ...session, index: session.index + 1 });
          openGateTagStep(nearby);
        }
      }
    }]
  });
}

function startGateInspection(nearby, fact) {
  const tags = gateEntryTags(nearby.building, fact);
  if (tags.length === 0) {
    openDialogue({ speaker: displayBuildingName(nearby.building), body: 'この門には照合できる入口札がありません。' });
    return;
  }
  state.interactionSession = Object.freeze({
    kind: 'entry-tags', buildingId: nearby.building.id, factId: fact.id, tags: Object.freeze(tags), index: 0
  });
  openGateTagStep(nearby);
}

function dojoTarget(building) {
  const prop = state.runtime.plan.props.find((candidate) => (
    ['prop.practice_target', 'prop.training_dummy'].includes(candidate.assetId)
      && candidate.x >= building.footprint.tileX
      && candidate.y >= building.footprint.tileY
      && candidate.x < building.footprint.tileX + building.footprint.tileWidth
      && candidate.y < building.footprint.tileY + building.footprint.tileHeight
  ));
  return prop ? tileCenter(prop.x, prop.y, state.runtime.tileSize) : { x: building.interaction.x, y: building.interaction.y - state.runtime.tileSize * 0.45 };
}

function startDojoObservation(nearby, fact) {
  const now = performance.now();
  state.route = [];
  state.footsteps = [];
  state.dojoObservation = Object.freeze({
    kind: 'timed-target',
    buildingId: nearby.building.id,
    factId: fact.id,
    target: Object.freeze(dojoTarget(nearby.building)),
    startedAt: now,
    readyAt: now + (state.reducedMotion ? 900 : 2200)
  });
  state.nearbyKey = '';
  announce('道場の標的を観察します。光る標的から目を離さず、完了後にもう一度調べてください。Escapeで取り消せます。');
}

function cancelDojoObservation(message = '') {
  if (!state.dojoObservation) return;
  state.dojoObservation = null;
  state.nearbyKey = '';
  if (message) announce(message);
}

function finishDojoObservation(nearby) {
  if (!state.dojoObservation || state.dojoObservation.buildingId !== nearby.building.id) return;
  if (performance.now() < state.dojoObservation.readyAt) {
    announce('まだ観察中です。光る標的の変化をもう少し見届けてください。');
    return;
  }
  completeWitness(nearby, state.dojoObservation.factId);
}

function conversationSpeaker(actor, building) {
  if (prefabProgram(building)?.speakerRole === 'keeper.inn' && actor?.role === 'keeper.inn') return '宿の主人';
  if (actor?.role === 'witness') return '近所の目撃者';
  if (actor?.role === 'resident') return 'この家の住人';
  return '街の住人';
}

function openNeighborStep(nearby, step) {
  const session = state.interactionSession;
  if (!session || session.kind !== 'neighbor' || session.buildingId !== nearby.building.id) return;
  const roomName = shortSourceLabel(session.roomFile, '玄関の部屋');
  const fact = state.runtime.factById.get(session.factId);
  if (step === 0) {
    openDialogue({
      speaker: session.speaker,
      body: `${roomName}にいる住人へ、手帳で選んだ問いを伝えます。部屋と話し手を確かめてから聞きます。`,
      choices: [{ label: '住人に問いを伝える', run: () => openNeighborStep(nearby, 1) }]
    });
    return;
  }
  openDialogue({
    speaker: session.speaker,
    body: `住人は「${describeFact(fact)}」と答えました。目撃と伝聞を分け、最後まで聞いた時だけ記録します。`,
    choices: [{ label: '返答を最後まで聞いて記録', run: () => completeWitness(nearby, session.factId) }]
  });
}

function startNeighborConversation(nearby, fact) {
  const { room, actor } = residentConversationTarget(state.runtime, nearby.building, fact);
  if (!actor) {
    openDialogue({ speaker: displayBuildingName(nearby.building), body: 'この部屋には、話を聞ける住人が見つかりません。' });
    return;
  }
  state.conversationActorId = actor.id;
  state.interactionSession = Object.freeze({
    kind: 'neighbor', buildingId: nearby.building.id, factId: fact.id,
    actorId: actor.id, roomFile: room?.file ?? null, speaker: conversationSpeaker(actor, nearby.building)
  });
  openNeighborStep(nearby, 0);
}

function startTowerOverview(nearby, fact) {
  state.route = [];
  state.footsteps = [];
  state.overview = Object.freeze({
    kind: 'fit-world',
    buildingId: nearby.building.id,
    factId: fact.id,
    previousZoom: state.zoom,
    previousCamera: state.camera ? Object.freeze({ ...state.camera }) : null
  });
  state.nearbyKey = '';
  renderHud();
  announce('測量塔から街全体を見渡しています。もう一度調べると俯瞰を終了し、発見を記録します。');
}

function leaveTowerOverview({ record = false } = {}) {
  const overview = state.overview;
  if (!overview) return;
  const building = state.runtime.buildingById.get(overview.buildingId);
  state.overview = null;
  state.zoom = overview.previousZoom;
  state.camera = overview.previousCamera;
  state.nearbyKey = '';
  renderHud();
  if (record && building) {
    completeWitness({ building, family: interactionFamily(building) }, overview.factId);
  } else {
    announce('俯瞰を取り消し、元の視点へ戻りました。発見は記録していません。');
  }
}

function performWitnessInteraction(nearby) {
  const { building, family } = nearby;
  const protocol = interactionProtocol(building);
  const factId = interactionFactId(state.runtime, building, state.tour.questionId);
  const fact = state.runtime.factById.get(factId);
  const sameBuilding = state.tour.witnesses.some((entry) => entry.buildingId === building.id);
  const sameFamily = state.tour.witnesses.some((entry) => entry.family === family);
  const canReplaceFamily = !sameBuilding && sameFamily && factId === state.tour.questionId;
  const alreadyRecorded = sameBuilding || (sameFamily && !canReplaceFamily);

  if (!protocol.supported || !protocol.family) {
    openDialogue({
      speaker: displayBuildingName(building),
      body: '入口には留守札があります。この場所には、今回の調査で実行できる固有の手順がありません。'
    });
    return;
  }

  if (state.tour.status === 'choose-question' || state.tour.status === 'need-journal') {
    const townHall = state.runtime.buildings.find(isTownHallInteraction) ?? null;
    openDialogue({
      speaker: displayBuildingName(building),
      body: 'ここには手がかりがありますが、先に市庁舎で調査手帳を受け取り、問いを選ぶ必要があります。',
      choices: townHall ? [{
        label: '市庁舎へ向かう',
        run: () => {
          closeDialogue();
          routeToBuilding(townHall);
        }
      }] : []
    });
    return;
  }
  if (state.tour.status !== 'investigating' || alreadyRecorded) {
    openDialogue({
      speaker: displayBuildingName(building),
      body: alreadyRecorded
        ? `この場所の「${interactionVerbLabel(family)}」は記録済みです。別の方法を試してください。${describeFact(fact)}`
        : describeFact(fact),
      choices: fact ? [{ label: '証拠を読む', run: () => { closeDialogue(); showEvidence(fact.id); } }] : []
    });
    return;
  }
  if (!fact) {
    openDialogue({ speaker: displayBuildingName(building), body: 'ここに結び付いた調査記録はありません。' });
    return;
  }
  if (protocol.kind === 'entry-tags') startGateInspection(nearby, fact);
  else if (protocol.kind === 'forms') startDojoObservation(nearby, fact);
  else if (protocol.kind === 'neighbor') startNeighborConversation(nearby, fact);
  else if (protocol.kind === 'overview') startTowerOverview(nearby, fact);
  else openDialogue({
    speaker: displayBuildingName(building),
    body: `留守札を最後まで読みます。${describeFact(fact)}`,
    choices: [{ label: '札の内容を記録する', run: () => completeWitness(nearby, fact.id) }]
  });
}

function dispatchPrefabInteraction(nearby, program) {
  const enterable = program.kind === 'enterable'
    && program.collision.entrance === 'door'
    && program.collision.interior === 'walkable';
  const closed = program.kind === 'closed'
    && program.collision.entrance === 'blocked'
    && program.collision.interior === 'none';
  if (!enterable && !closed) return false;
  playPrefabEvent(nearby.building, program.interactionEventId);
  performWitnessInteraction(nearby);
  return true;
}

function performInteraction() {
  if (!state.ready || !state.assetsComplete || !state.nearby || state.movement || !buildingImageReady(state.nearby.building)) return;
  const program = prefabProgram(state.nearby.building);
  if (hasPrefabDeclaration(state.nearby.building) && !program) {
    announce('Prefabの動作宣言が一致しないため、この施設は操作できません。');
    return;
  }
  if (program && dispatchPrefabInteraction(state.nearby, program)) return;
  if (state.overview) {
    leaveTowerOverview({ record: true });
    return;
  }
  if (state.dojoObservation) {
    finishDojoObservation(state.nearby);
    return;
  }
  if (isTownHallInteraction(state.nearby.building)) performLedgerInteraction(state.nearby.building);
  else performWitnessInteraction(state.nearby);
}

function appendEvidenceList(element, values, emptyMessage) {
  element.replaceChildren();
  const items = Array.isArray(values) ? values : [];
  if (items.length === 0) {
    const item = document.createElement('li');
    item.textContent = emptyMessage;
    element.append(item);
    return;
  }
  for (const value of items) {
    const item = document.createElement('li');
    item.textContent = humanizeEvidence(value);
    element.append(item);
  }
}

function humanizeEvidence(value) {
  if (typeof value !== 'string') return JSON.stringify(value);
  const exact = {
    'inspection.entrypoint.observed': '静的検査で、街への入口として直接確認しました。',
    'inspection.unresolved.observed': '静的な参照先の解決を試み、見つからない状態を直接確認しました。',
    'inspection.cycle.inferred': '確認した参照関係から、循環している構造を推定しました。',
    'inspection.test_association.inferred': 'ファイル名と参照関係から、テストとの対応を推定しました。',
    'inspection.file.unverified': '対応するテストは、この検査では確認できていません。',
    'inspection.reachability.unreached.inferred': '確認済みの入口からの静的な道筋がないと推定しました。',
    'inspection.dependency.runtime_unknown': '実行時にだけ決まる依存関係なので、この静的検査では不明です。',
    'inspection.truncation.observed': '安全な検査上限に達したことを直接確認しました。',
    'inspection.truncation.omitted_scope_unknown': '上限を超えて省略した範囲の内容は不明です。',
    'inspection.repository.name.observed': '測量対象のリポジトリ名を直接確認しました。',
    'inspection.repository.name.unknown': '測量対象のリポジトリ名は、この検査では不明です。',
    'inspection.file.inventory.observed': '安全な静的検査で、ファイル一覧を直接確認しました。',
    'inspection.file.inventory.unknown': 'ファイル一覧を、この検査では確認できていません。',
    'inspection.dependency.inventory.observed': '安全な静的検査で、ファイル間の参照一覧を直接確認しました。',
    'inspection.dependency.inventory.unknown': 'ファイル間の参照一覧を、この検査では確認できていません。'
  }[value];
  if (exact) return exact;
  const facility = value.match(/^facility\.(present|absent)\.(observed|inferred|unknown)$/);
  if (facility) {
    const stateCopy = facility[1] === 'present' ? '施設がある状態' : '施設がない状態';
    const classCopy = {
      observed: '直接確認した証拠があります。',
      inferred: '観測から推定した証拠があります。',
      unknown: 'まだ確認できない点が残っています。'
    }[facility[2]];
    return `${stateCopy}について、${classCopy}`;
  }
  if (/observed$/.test(value)) return '静的検査で直接確認した追加の記録があります。';
  if (/inferred$/.test(value)) return '確認済みの関係から推定した追加の記録があります。';
  return 'この検査だけでは確認できない追加の項目があります。';
}

function factTypeLabel(type) {
  return ({
    entrypoint: '街への入口',
    unresolved: '行先未確認の参照',
    cycle: '循環する参照',
    test_association: 'テストとの関係',
    unverified: '未検証の対象',
    unreached: '入口から未到達',
    runtime_unknown: '実行時は不明',
    truncation: '検査範囲の上限',
    survey_scope: '測量の範囲',
    facility_present: '確認済みの施設',
    facility_absent: '存在しない施設'
  })[type] ?? '街の調査記録';
}

function friendlyFactInput(fact) {
  const params = fact?.params ?? {};
  const rows = [];
  const add = (label, value, formatter = shortSourceLabel) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) rows.push(`${label}: ${value.map((item) => formatter(item)).join('、')}`);
    else rows.push(`${label}: ${formatter(value)}`);
  };
  add('対象', params.path ?? params.from ?? params.source);
  add('行先', params.to ?? params.targetHint);
  add('関連テスト', params.test);
  add('構成要素', params.members);
  add('名称', params.name, (value) => String(value));
  add('件数', params.count, (value) => String(value));
  add('区分', params.dimension, (value) => ({
    repository: 'リポジトリ', files: 'ファイル', static_dependencies: '静的な参照'
  })[value] ?? '検査対象');
  add('参照方法', params.kind, streetReferenceLabel);
  add('施設', params.facilityKind, (value) => ({
    town_hall: '市庁舎', gate: '街の門', dojo: '道場', inn: '宿屋', house: '住居', survey_tower: '測量塔'
  })[value] ?? '街の施設');
  return rows.length > 0 ? rows.join('\n') : '追加の検査入力はありません。';
}

function showEvidence(factId) {
  const fact = state.runtime.factById.get(factId);
  if (!fact) return;
  elements.evidenceTitle.textContent = `証拠：${factTypeLabel(fact.type)}`;
  elements.evidenceSaying.textContent = describeFact(fact);
  appendEvidenceList(elements.evidenceObserved, fact.evidence.observed, '直接観測された項目はありません。');
  appendEvidenceList(elements.evidenceInferred, fact.evidence.inferred, 'この項目で明示された推定はありません。');
  appendEvidenceList(elements.evidenceUnknown, fact.evidence.unknown, 'この項目で明示された不明点はありません。');
  elements.evidenceSource.textContent = friendlyFactInput(fact);
  elements.evidencePanel.hidden = false;
  elements.evidenceClose.focus();
}

function renderQuestions() {
  elements.questionList.replaceChildren();
  if (state.questions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '今回選べる問いはありません。';
    elements.questionList.append(empty);
    return;
  }
  for (const question of state.questions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'journal-action';
    button.textContent = describeFact(question);
    const current = state.tour.questionId === question.id;
    button.setAttribute('aria-current', String(current));
    button.disabled = state.tour.status !== 'choose-question';
    button.addEventListener('click', () => {
      if (!setTour(reduceTour(state.tour, { type: 'selectQuestion', questionId: question.id }, state.runtime))) return;
      closeJournal();
      announce('問いを選びました。異なる方法で三つの現場を調べてください。');
    });
    elements.questionList.append(button);
  }
}

function renderFindings() {
  elements.findingList.replaceChildren();
  if (state.tour.witnesses.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'まだ現場で記録した発見はありません。場所に着いたら「調べる」を選び、現場固有の動作を実行してください。';
    elements.findingList.append(empty);
    return;
  }
  for (const witness of state.tour.witnesses) {
    const building = state.runtime.buildingById.get(witness.buildingId);
    const card = document.createElement('article');
    card.className = 'finding-card';
    const title = document.createElement('strong');
    title.textContent = building ? displayBuildingName(building) : witness.buildingId;
    const method = document.createElement('p');
    method.textContent = interactionVerbLabel(witness.family);
    card.append(title, method);
    for (const factId of witness.factIds) {
      const fact = state.runtime.factById.get(factId);
      if (!fact) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = describeFact(fact);
      button.addEventListener('click', () => showEvidence(fact.id));
      card.append(button);
    }
    elements.findingList.append(card);
  }
}

function renderLocations() {
  elements.locationList.replaceChildren();
  for (const building of state.runtime.buildings) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'location-button';
    button.textContent = `${displayBuildingName(building)} — ${interactionVerbLabel(interactionFamily(building))}`;
    button.addEventListener('click', () => {
      closeJournal();
      routeToBuilding(building);
    });
    elements.locationList.append(button);
  }
}

function renderFactList(element, facts, emptyMessage) {
  element.replaceChildren();
  if (facts.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = emptyMessage;
    element.append(empty);
    return;
  }
  for (const fact of facts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = describeFact(fact);
    button.addEventListener('click', () => showEvidence(fact.id));
    element.append(button);
  }
}

function renderSurveyLimits() {
  renderFactList(
    elements.absentList,
    state.runtime.facts.filter((fact) => fact.type === 'facility_absent'),
    '検査で「存在しない」と記録された施設はありません。未確認と不存在は分けて扱います。'
  );
  renderFactList(
    elements.surveyList,
    state.runtime.facts.filter((fact) => fact.type === 'survey_scope' || fact.type === 'truncation'),
    '測量範囲の追加情報はありません。この街は安全な静的検査で確認できた範囲だけを表します。'
  );
}

function renderJournal() {
  if (!state.runtime) return;
  renderQuestions();
  renderFindings();
  renderSurveyLimits();
  renderLocations();
}

function openJournal() {
  if (!state.tour.journalReceived) return;
  renderJournal();
  showModal(elements.journal);
}

function closeJournal() {
  if (elements.journal.open && typeof elements.journal.close === 'function') elements.journal.close();
  else elements.journal.removeAttribute('open');
  scheduleModalDirection();
}

function changeZoom(delta) {
  if (state.overview) return;
  const index = INTEGER_ZOOMS.indexOf(state.zoom);
  state.zoom = INTEGER_ZOOMS[Math.max(0, Math.min(INTEGER_ZOOMS.length - 1, index + delta))];
  renderHud();
}

function keyboardDirection(key) {
  return ({
    ArrowUp: 'north', w: 'north', W: 'north',
    ArrowRight: 'east', d: 'east', D: 'east',
    ArrowDown: 'south', s: 'south', S: 'south',
    ArrowLeft: 'west', a: 'west', A: 'west'
  })[key] ?? null;
}

function modalIsOpen() {
  return elements.dialogue.open || elements.journal.open || !elements.evidencePanel.hidden;
}

function onKeyDown(event) {
  if (!state.ready || state.stopped) return;
  const soundKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (['e', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(soundKey)) {
    void sound.prime();
  }
  if ((event.key === 'Escape') && !elements.evidencePanel.hidden) {
    elements.evidencePanel.hidden = true;
    scheduleModalDirection();
    return;
  }
  if (event.key === 'Escape' && state.overview) {
    event.preventDefault();
    leaveTowerOverview();
    return;
  }
  if (event.key === 'Escape' && state.dojoObservation) {
    event.preventDefault();
    cancelDojoObservation('道場の観察を取り消しました。発見は記録していません。');
    return;
  }
  const direction = keyboardDirection(event.key);
  if (elements.dialogue.open && direction) {
    event.preventDefault();
    state.modalBufferedDirection = direction;
    return;
  }
  if (modalIsOpen()) return;
  if (event.target instanceof Element
    && event.target.closest('button, input, select, textarea, a, summary, [contenteditable="true"]')) return;
  if (direction) {
    event.preventDefault();
    if (state.overview) return;
    if (state.dojoObservation) cancelDojoObservation('移動したため、道場の観察を取り消しました。');
    if (state.movement || state.route.length > 0) {
      state.bufferedDirection = direction;
      return;
    }
    const next = nextNodeForDirection(state.runtime, state.player.navNodeId, direction);
    if (next) {
      state.route = [next.id];
      state.footsteps = [next.id];
    }
    return;
  }
  if (event.key === 'e' || event.key === 'E' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    performInteraction();
  }
  if (event.key === 'j' || event.key === 'J') openJournal();
  if (event.key === '+' || event.key === '=') changeZoom(1);
  if (event.key === '-' || event.key === '_') changeZoom(-1);
}

function routeFromPointer(event) {
  if (!state.ready || modalIsOpen() || state.overview) return;
  if (state.dojoObservation) cancelDojoObservation('移動したため、道場の観察を取り消しました。');
  event.preventDefault();
  const rect = elements.canvas.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  const world = screenToWorld(state.camera, screenX, screenY);
  routeToWorld(world.x, world.y);
}

function pointerDistance() {
  const points = [...state.pointers.values()];
  return points.length < 2 ? null : Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function onPointerDown(event) {
  if (!state.ready || modalIsOpen() || state.overview) return;
  void sound.prime();
  elements.canvas.focus({ preventScroll: true });
  elements.canvas.setPointerCapture?.(event.pointerId);
  state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
  if (state.pointers.size === 2) state.pinchDistance = pointerDistance();
}

function onPointerMove(event) {
  const point = state.pointers.get(event.pointerId);
  if (!point) return;
  point.x = event.clientX;
  point.y = event.clientY;
  if (state.pointers.size !== 2) return;
  event.preventDefault();
  const distance = pointerDistance();
  if (!state.pinchDistance || !distance) {
    state.pinchDistance = distance;
    return;
  }
  const ratio = distance / state.pinchDistance;
  if (ratio >= 1.18) {
    changeZoom(1);
    state.pinchDistance = distance;
    state.pinchUsed = true;
  } else if (ratio <= 0.82) {
    changeZoom(-1);
    state.pinchDistance = distance;
    state.pinchUsed = true;
  }
}

function onPointerUp(event) {
  const point = state.pointers.get(event.pointerId);
  const wasPinch = state.pinchUsed;
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) state.pinchDistance = null;
  if (state.pointers.size === 0) state.pinchUsed = false;
  if (!point || wasPinch || Math.hypot(event.clientX - point.startX, event.clientY - point.startY) > 10) return;
  routeFromPointer(event);
}

function onPointerCancel(event) {
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) state.pinchDistance = null;
  if (state.pointers.size === 0) state.pinchUsed = false;
}

async function streamRemainingAssets(manifest) {
  try {
    const expectedPngCount = manifest.assets.reduce((total, asset) => total + asset.artifacts.length, 0);
    const completeAssets = await withDeadline(loadForgeAssetImages({
      manifest,
      imageByKey: state.assets.imageByKey,
      onImageLoaded: (assetId) => {
        state.nearbyKey = '';
        for (const building of state.runtime.buildings) {
          if (building.assetId === assetId && buildingImageReady(building) && !state.buildingReveals.has(building.id)) {
            state.buildingReveals.set(building.id, performance.now());
          }
        }
      }
    }), 15_000, '全128点の承認済み素材を15秒以内に検証できませんでした。');
    if (expectedPngCount !== 128 || completeAssets.imageByKey.size !== 128) {
      throw new ForgeAssetError(`承認済み素材は128点必要ですが、${completeAssets.imageByKey.size}点だけ読み込まれました。`);
    }
    state.assets = completeAssets;
    state.assetsComplete = true;
    state.nearbyKey = '';
    renderHud();
    renderJournal();
    updateNearby();
    announce('街の承認済み素材がすべて揃いました。');
  } catch (error) {
    showFatal('承認済み素材の読み込みを完了できません', error);
  }
}

async function loadTown() {
  try {
    setStartupMessage('リポジトリの検査結果を読み込んでいます…');
    const response = await fetch('/api/town', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`街データを取得できませんでした (${response.status})。`);
    const payload = await response.json();
    assertTownPayload(payload);
    state.payload = payload;
    state.runtime = createWorldRuntime(payload.worldPlan);
    state.repositoryName = payload.repository.name || '名称未設定のリポジトリ';
    state.storageKey = progressStorageKey(state.repositoryName, payload.worldPlan.inspectionDigest);
    state.questions = selectableTourQuestions(state.runtime);
    elements.repositoryName.textContent = state.repositoryName;
    elements.habitabilityBadge.textContent = habitabilityLabel(payload.habitability);
    elements.habitabilityBadge.dataset.live = String(payload.habitability?.canLive === true);

    setStartupMessage('人間が承認したFable5素材を照合しています…');
    const requiredAssetIds = [...new Set([
      ...collectWorldPlanAssetIds(payload.worldPlan),
      'structure.survey_plot',
      'effect.construction_dust'
    ])].sort();
    const manifest = await fetchForgeManifest({ requiredAssetIds });
    setStartupMessage('地形・門・市庁舎を先に組み立てています…');
    state.assets = await withDeadline(loadForgeAssetImages({
      manifest,
      requiredAssetIds: criticalAssetIds(payload.worldPlan)
    }), 15_000);

    // The manifest has already proven that every WorldPlan asset is human-approved.
    // Let the player begin once the ground, player, gate, town hall, and survey marker
    // are present; later images remain individually unavailable until their bytes arrive.
    // This keeps the release fail-closed for unexported assets without turning a normal
    // streaming download into a dead start screen.
    state.assetsComplete = true;
    state.tour = loadSavedTour();
    saveTour();
    state.player = {
      x: state.runtime.start.x,
      y: state.runtime.start.y,
      facing: state.runtime.start.facing,
      navNodeId: state.runtime.start.navNodeId
    };
    elements.startupPanel.hidden = true;
    elements.gameError.hidden = true;
    elements.contextHint.hidden = false;
    buildDrawIndex();
    state.ready = true;
    renderHud();
    renderJournal();
    updateNearby();
    state.animationFrame = requestAnimationFrame(frame);
    void streamRemainingAssets(manifest);
    announce(`${state.repositoryName}の街を開始しました。${tourObjective(state.tour)}`);
  } catch (error) {
    const title = error instanceof ForgeAssetError ? '承認済み素材が揃っていません' : '街を開始できません';
    showFatal(title, error);
  }
}

elements.zoomOut.addEventListener('click', () => changeZoom(-1));
elements.zoomIn.addEventListener('click', () => changeZoom(1));
elements.journalButton.addEventListener('click', openJournal);
elements.objectiveGuide.addEventListener('click', guideObjective);
elements.journalClose.addEventListener('click', closeJournal);
elements.journal.addEventListener('close', scheduleModalDirection);
elements.dialogueClose.addEventListener('click', closeDialogue);
elements.dialogue.addEventListener('cancel', cancelDialogueSession);
elements.dialogue.addEventListener('close', finalizeDialogueClose);
elements.evidenceClose.addEventListener('click', () => {
  elements.evidencePanel.hidden = true;
  scheduleModalDirection();
});
elements.evidenceCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.evidenceSource.textContent);
    announce('検査入力をコピーしました。');
  } catch {
    announce('このブラウザーではコピーできませんでした。テキストを選択してコピーしてください。');
  }
});
elements.actionButton.addEventListener('click', () => {
  void sound.prime();
  performInteraction();
});
elements.soundToggle.addEventListener('click', () => {
  const muted = sound.toggle();
  elements.soundToggle.setAttribute('aria-pressed', String(muted));
  elements.soundToggle.textContent = muted ? '🔇 効果音 OFF' : '🔊 効果音 ON';
  elements.soundToggle.setAttribute('aria-label', muted ? '効果音をオンにする' : '効果音をミュートする');
  if (!muted) void sound.prime().then(() => sound.play('interact'));
});
elements.canvas.addEventListener('pointerdown', onPointerDown);
elements.canvas.addEventListener('pointermove', onPointerMove);
elements.canvas.addEventListener('pointerup', onPointerUp);
elements.canvas.addEventListener('pointercancel', onPointerCancel);
window.addEventListener('keydown', onKeyDown);
window.addEventListener('resize', resizeCanvas);
reducedMotionQuery.addEventListener?.('change', (event) => { state.reducedMotion = event.matches; });

resizeCanvas();
loadTown();
