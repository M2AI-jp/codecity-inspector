import {
  ACTOR_CONTRACT,
  CLUE_INTERACTIONS,
  DOOR_AUTO_COOLDOWN_MS,
  GAMEPLAY_ZOOM,
  INN_CONTRACT,
  buildInvestigation,
  bumpGlowProgress,
  cameraSmoothingRateForMotionPreference,
  createCamera,
  createDoorAutoState,
  evaluateDoorAutoTransition,
  fadeOverlayAlpha,
  isClosedEntranceId,
  isTransitionExpired,
  ledgerPulseForMotionPreference,
  lerpCameraFocus,
  moveActor,
  normalizeMovementInput,
  facingForVector,
  nearbyInteraction,
  rectsOverlap,
  spriteFrame,
  transitionDurationForMotionPreference,
  worldToScreen,
  wrapCanvasText
} from './world-runtime.mjs';
import {
  AssetContractError,
  DIALOGUE_CROPS,
  drawCharacterFrame,
  drawNativeCrop,
  drawWorldPrefabs,
  loadProductionAssets
} from './site-runtime.mjs';
import {
  enter as enterBuilding,
  exit as exitBuilding,
  getBuilding,
  getInteraction as getBuildingInteraction,
  isInteriorWalkable as isBuildingInteriorWalkable
} from './building-runtime.mjs';
import {
  chooseInvestigationQuestion,
  createInvestigationState,
  recordInvestigationClue,
  startInnDialogue,
  submitTownHallReport
} from './quest-runtime.mjs';
import { createFable5Persistence } from './persistence.mjs';
import { createAudioFeedback } from './audio-feedback.mjs';
import {
  createFable5SessionState,
  createInitialFable5SessionState,
  restoreFable5SessionState
} from './session-runtime.mjs';

const elements = {
  canvas: document.querySelector('#world-canvas'),
  repositoryName: document.querySelector('#repository-name'),
  assetBadge: document.querySelector('#asset-badge'),
  geometryBadge: document.querySelector('#geometry-badge'),
  startup: document.querySelector('#startup-panel'),
  startupMessage: document.querySelector('#startup-message'),
  mission: document.querySelector('.mission-card'),
  error: document.querySelector('#game-error'),
  errorEyebrow: document.querySelector('#game-error-eyebrow'),
  errorTitle: document.querySelector('#game-error-title'),
  errorMessage: document.querySelector('#game-error-message'),
  errorDetails: document.querySelector('#game-error-details'),
  errorNote: document.querySelector('#game-error-note'),
  objective: document.querySelector('#objective-text'),
  location: document.querySelector('#location-text'),
  prompt: document.querySelector('#nearby-prompt'),
  promptPlace: document.querySelector('#nearby-place'),
  promptAction: document.querySelector('#nearby-action'),
  promptKey: document.querySelector('#nearby-key-hint'),
  action: document.querySelector('#action-button'),
  zoomOut: document.querySelector('#zoom-out'),
  zoomIn: document.querySelector('#zoom-in'),
  zoomValue: document.querySelector('#zoom-value'),
  audioMute: document.querySelector('#audio-mute'),
  audioVolume: document.querySelector('#audio-volume'),
  audioVolumeValue: document.querySelector('#audio-volume-value'),
  restartProgress: document.querySelector('#restart-progress'),
  interiorDisclosure: document.querySelector('#interior-disclosure'),
  questChoicePanel: document.querySelector('#quest-choice-panel'),
  questChoiceButtons: document.querySelectorAll('#quest-choice-panel [data-question]'),
  reportPanel: document.querySelector('#report-panel'),
  reportSummary: document.querySelector('#report-summary'),
  submitReport: document.querySelector('#submit-report-button'),
  cancelReport: document.querySelector('#cancel-report-button'),
  resetPanel: document.querySelector('#reset-panel'),
  confirmReset: document.querySelector('#confirm-reset-button'),
  cancelReset: document.querySelector('#cancel-reset-button'),
  screenReaderStatus: document.querySelector('#screen-reader-status'),
  dialogueStatus: document.querySelector('#dialogue-status'),
  dpad: document.querySelector('#dpad')
};

const context = elements.canvas.getContext('2d', { alpha: false });
context.imageSmoothingEnabled = false;

// Total wall-clock time (ms) a mode switch spends fading out + back in; the
// state swap itself (see applyModeSwitch) lands exactly at the midpoint,
// when fadeOverlayAlpha() reports the screen fully covered. This also feeds
// state.transitionUntil, so it is the single knob for how long input stays
// locked across a door transition. TRANSITION_TOTAL_MS_REDUCED is the
// prefers-reduced-motion replacement for it (see beginModeTransition and
// transitionDurationForMotionPreference in world-runtime.mjs) -- shortened
// rather than eliminated so a transition still reads as a scene change
// instead of a jarring instant pop, while cutting the sustained-motion
// fade time by more than half.
const TRANSITION_TOTAL_MS = 200;
const TRANSITION_TOTAL_MS_REDUCED = 80;
// Fraction of the remaining camera-to-target distance closed per 60fps
// frame; see smoothingFactor() in world-runtime.mjs for the frame-rate
// independent conversion. Under prefers-reduced-motion this is replaced by
// a rate of 1 (see cameraSmoothingRateForMotionPreference), which makes the
// camera follow the player immediately instead of easing.
const CAMERA_SMOOTHING_RATE = 0.15;

// prefers-reduced-motion is read once here at module load (state.reduceMotion's
// initial value below) and again on every 'change' event (see the
// addEventListener call near the other window listeners at the bottom of
// this file), so a user who toggles the OS/browser setting mid-session sees
// every motion-driven system -- camera easing, the ledger completion pulse,
// door transition fade duration -- adjust immediately, with no reload
// required. matchMedia is guarded for environments where it might be
// missing (never actually true in a supported browser, but this keeps boot
// from throwing rather than silently degrading motion preferences).
const reducedMotionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

const state = {
  ready: false,
  stopped: false,
  assets: null,
  payload: null,
  investigation: null,
  quest: createInvestigationState(),
  persistence: null,
  progressLoadStatus: 'not-loaded',
  // Audio preference bytes are stored inside the same repository+digest
  // scoped progress envelope as quest/player/settings.  Never let this
  // runtime fall back to audio-feedback's generic module key.
  audio: createAudioFeedback({ storage: null }),
  mode: 'exterior',
  buildingId: null,
  player: {
    x: ACTOR_CONTRACT.spawn.x,
    y: ACTOR_CONTRACT.spawn.y,
    facing: 'north',
    moving: false,
    walkStartedAt: 0
  },
  keys: new Set(),
  heldDirections: new Map(),
  nearby: null,
  lastNearbyId: null,
  zoom: GAMEPLAY_ZOOM,
  camera: null,
  cameraFocus: { x: ACTOR_CONTRACT.spawn.x, y: ACTOR_CONTRACT.spawn.y },
  viewport: { width: 1, height: 1, dpr: 1 },
  transitionUntil: 0,
  pendingTransition: null,
  doorAuto: createDoorAutoState(),
  bumpUntil: 0,
  lastBumpStatusAt: 0,
  dialoguePages: [],
  dialogueIndex: -1,
  dialogueKind: null,
  dialogueSpeaker: '',
  dialogueAnchor: null,
  modal: null,
  completionStartedAt: 0,
  releaseGateNotice: null,
  progressDirty: false,
  lastProgressSavedAt: 0,
  lastProgressSaveAttemptAt: 0,
  saveFailureNotified: false,
  lastFootstepAt: 0,
  lastTimestamp: 0,
  animationFrame: 0,
  reduceMotion: reducedMotionQuery?.matches ?? false
};

function setStatus(message) {
  elements.screenReaderStatus.textContent = '';
  window.requestAnimationFrame(() => {
    elements.screenReaderStatus.textContent = message;
  });
}

// `building-runtime.mjs` is the primary availability authority.  Keep this
// small second check at the browser boundary as a release safety belt: a
// future interaction/transition implementation must not make a design-only
// room customer-reachable just because it still has useful navigation data.
// The inn is currently withdrawn because its former character sheet no
// longer matches the style authority. City hall and the residence also remain
// data contracts until their matching interior kit and NPC have both passed
// the asset-approval path.
function isCustomerReachableInterior(buildingId) {
  return getBuilding(buildingId)?.runtimeAvailability?.state === 'available';
}

function unavailableInteriorReason(buildingId) {
  const building = getBuilding(buildingId);
  const reason = building?.runtimeAvailability?.reason;
  return typeof reason === 'string' && reason.trim()
    ? reason
    : 'この建物の承認済み室内素材を準備中です';
}

function unavailableInteriorNotice(buildingId, suffix = '') {
  const building = getBuilding(buildingId);
  return `${building?.label ?? 'この建物'}。${unavailableInteriorReason(buildingId)}${suffix}`;
}

// The normal runtime already returns this shape for blocked entries. This
// defensive conversion prevents a future regression or stale interior state
// from exposing a pending room; the exit remains an escape-only exception.
function enforceInteriorReleaseGate(interaction) {
  // Keep an exit available as a recovery route if a stale client state is
  // ever encountered, but expose no pending room interaction or auto-entry.
  if (!interaction || interaction.kind === 'exit'
    || isCustomerReachableInterior(interaction.buildingId)) return interaction;
  return Object.freeze({
    ...interaction,
    id: `unavailable-${interaction.buildingId}`,
    kind: 'unavailable',
    label: unavailableInteriorReason(interaction.buildingId),
    enabled: false,
    quest: null
  });
}

function transitionIsReleased(transition) {
  if (!transition) return false;
  if (transition.mode === 'exterior') return true;
  return transition.mode === 'interior' && isCustomerReachableInterior(transition.buildingId);
}

// A persisted session normally goes through session-runtime's equivalent
// validation.  Looking for this one exact stale state before deserializing
// lets us give the player the real release reason instead of a generic
// corruption message if an interior is withdrawn after an earlier session.
function blockedSavedInteriorNotice(savedState) {
  const location = savedState?.location;
  if (location?.mode !== 'interior' || typeof location.buildingId !== 'string') return null;
  return isCustomerReachableInterior(location.buildingId)
    ? null
    : unavailableInteriorNotice(location.buildingId, ' 屋外から再開します。');
}

function stopWithError(error) {
  state.stopped = true;
  state.ready = false;
  elements.startup.hidden = true;
  elements.error.hidden = false;
  // A boot-time crash unrelated to image verification (a plain code defect
  // in payload handling, session restore, etc.) must never be reported to
  // the player -- or to whoever reads this screen next -- as "images
  // missing". That mislabel previously sent investigation toward the asset
  // pipeline for a bug that was actually a session-state shape mismatch in
  // app.js. Only a genuine AssetContractError, thrown solely by the
  // verified-image pipeline in site-runtime.mjs's loadProductionAssets(),
  // gets the asset/production-gate framing; everything else gets an honest
  // "failed to start" label instead.
  const isAssetFailure = error instanceof AssetContractError;
  elements.errorEyebrow.textContent = isAssetFailure ? 'production gate' : '起動エラー';
  elements.errorTitle.textContent = isAssetFailure ? '必要な画像が揃っていません' : 'ゲームを起動できませんでした';
  elements.errorMessage.textContent = isAssetFailure
    ? error.message
    : '予期しない不具合が発生しました。素材や検査結果の問題ではありません。';
  const details = Array.isArray(error?.issues) && error.issues.length > 0
    ? error.issues
    : [String(error?.message ?? error)];
  elements.errorDetails.replaceChildren(...details.map((detail) => {
    const item = document.createElement('li');
    item.textContent = detail;
    return item;
  }));
  elements.errorNote.textContent = isAssetFailure
    ? '見た目の代替物は描かず、asset contractを満たすまで開始しません。'
    : 'ページの再読み込みで解決しない場合は開発者に連絡してください。';
  elements.assetBadge.textContent = isAssetFailure ? '画像不足' : '起動失敗';
  elements.assetBadge.dataset.ready = 'false';
}

function assertTownPayload(payload) {
  if (!payload || payload.schemaVersion !== 2 || !payload.worldPlan || !Array.isArray(payload.facts)) {
    throw new Error('GET /api/town に検証済みWorldPlan v2が含まれていません。');
  }
}

function resizeCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (elements.canvas.width !== pixelWidth || elements.canvas.height !== pixelHeight) {
    elements.canvas.width = pixelWidth;
    elements.canvas.height = pixelHeight;
  }
  state.viewport = { width, height, dpr };
}

function movementVector() {
  let x = 0;
  let y = 0;
  const down = (key) => state.keys.has(key);
  if (down('arrowleft') || down('a')) x -= 1;
  if (down('arrowright') || down('d')) x += 1;
  if (down('arrowup') || down('w')) y -= 1;
  if (down('arrowdown') || down('s')) y += 1;
  for (const direction of state.heldDirections.values()) {
    if (direction === 'west') x -= 1;
    if (direction === 'east') x += 1;
    if (direction === 'north') y -= 1;
    if (direction === 'south') y += 1;
  }
  return { x, y };
}

function dialogueOpen() {
  return state.dialogueIndex >= 0 && state.dialogueIndex < state.dialoguePages.length;
}

function modalOpen() {
  return state.modal !== null;
}

function questPhase() {
  return state.quest?.phase ?? 'new';
}

function recordedClueIds() {
  return new Set(state.quest?.clues?.map(({ id }) => id) ?? []);
}

function safeBrowserStorage() {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function syncAudioControls() {
  const preferences = state.audio.getPreferences();
  elements.audioMute.textContent = preferences.muted ? '音声 OFF' : '音声 ON';
  elements.audioMute.setAttribute('aria-pressed', String(preferences.muted));
  elements.audioVolume.value = String(Math.round(preferences.volume * 100));
  elements.audioVolumeValue.textContent = `${Math.round(preferences.volume * 100)}%`;
}

// AudioContext creation/resume is deliberately reachable only from DOM input
// handlers below. Calling this helper from rendering, boot, or a timer would
// violate browser autoplay policies and make sound a hidden side effect.
function unlockAudioFromGesture() {
  void state.audio.unlock().then(syncAudioControls);
}

function syncInteriorDisclosure() {
  const building = state.mode === 'interior' ? getBuilding(state.buildingId) : null;
  const inferred = building?.interiorEvidence === 'inferred';
  elements.interiorDisclosure.hidden = !inferred;
  if (!inferred) return;
  elements.interiorDisclosure.textContent = `${building.label}の室内は推定された操作領域です。背景・配置・人物の来歴は未承認で、承認済みの室内画像は表示していません。`;
}

function currentSessionSnapshot() {
  return createFable5SessionState({
    quest: state.quest,
    // session-runtime.mjs's validPlayer() requires the player record to have
    // *exactly* the keys {x, y, facing} (see its exactKeys check) because
    // that is the durable save contract. state.player additionally carries
    // `moving` and `walkStartedAt`, which exist only to drive this frame's
    // walk animation/audio and are meaningless once reloaded. Passing
    // state.player through unfiltered made every single save attempt fail
    // with 'invalid-player' -- from the very first frame, since even the
    // freshly spawned player already has those two extra keys -- so no
    // progress was ever actually persisted despite the UI staying silent
    // about it (saveProgress() degrades this failure to a generic "check
    // your browser storage settings" notice, which is misleading here too:
    // this had nothing to do with storage availability). Only x/y/facing
    // are ever meant to cross the save boundary.
    player: { x: state.player.x, y: state.player.y, facing: state.player.facing },
    mode: state.mode,
    buildingId: state.buildingId,
    zoom: state.zoom,
    audioPreferences: state.audio.getPreferences()
  });
}

function markProgressDirty() {
  state.progressDirty = true;
}

function reportSaveFailure(status) {
  if (!state.saveFailureNotified) {
    state.saveFailureNotified = true;
    setStatus(status === 'invalid-session'
      ? '進行を安全に保存できません。ブラウザーを再読み込みして、もう一度試してください。'
      : '進行を保存できません。ブラウザーの保存設定を確認してください。ゲームはこのまま続けられます。');
  }
  return { status };
}

function saveProgress() {
  // Failed persistence must be retried, but not once per animation frame.
  // Keep this separate from lastProgressSavedAt, whose meaning remains a
  // confirmed successful write.
  state.lastProgressSaveAttemptAt = state.lastTimestamp;
  if (!state.persistence) return { status: 'not-saved' };
  const snapshot = currentSessionSnapshot();
  if (!snapshot.ok) return reportSaveFailure(snapshot.code ?? 'invalid-session');
  const result = state.persistence.save(snapshot.state);
  if (result.status === 'saved') {
    const recovered = state.saveFailureNotified;
    state.saveFailureNotified = false;
    state.progressDirty = false;
    state.lastProgressSavedAt = state.lastTimestamp;
    if (recovered) setStatus('進行の保存を再開しました。');
  } else {
    reportSaveFailure(result.status);
  }
  return result;
}

function applyRestoredSession(session) {
  state.quest = session.quest;
  state.mode = session.mode;
  state.buildingId = session.buildingId;
  state.player = {
    x: session.player.x,
    y: session.player.y,
    facing: session.player.facing,
    moving: false,
    walkStartedAt: 0
  };
  state.zoom = session.zoom;
  state.audio.setMuted(session.audioPreferences.muted);
  state.audio.setVolume(session.audioPreferences.volume);
  const building = state.mode === 'interior' ? getBuilding(state.buildingId) : null;
  state.cameraFocus = building?.interior?.cameraFocus
    ? { ...building.interior.cameraFocus }
    : { x: state.player.x, y: state.player.y };
  state.pendingTransition = null;
  state.transitionUntil = 0;
  state.doorAuto = createDoorAutoState();
  state.progressDirty = false;
  syncZoomControls();
  syncAudioControls();
  syncInteriorDisclosure();
}

// Both restoreSessionProgress() (fresh boot) and resetCurrentSession() (the
// "最初から" button) need exactly the same "start over" runtime session.
// createInitialFable5SessionState() (like createFable5SessionState()) returns
// the versioned persistence-envelope shape -- state.location.mode/buildingId
// and state.settings.zoom/audio -- because that is exactly what saveProgress()
// writes to storage. applyRestoredSession() is the one place that fans a
// session out into live `state`, and it has always consumed the flat
// runtime shape (state.mode/buildingId/zoom/audioPreferences) that
// restoreFable5SessionState() produces when reading a save back.
// restoreSessionProgress() used to round-trip the fresh envelope through
// restoreFable5SessionState() correctly inline, but resetCurrentSession()
// separately re-derived the same "start over" session by hand and passed the
// nested envelope straight to applyRestoredSession() -- skipping that
// flattening step and reproducing, on a real button click, the exact same
// "Cannot read properties of undefined (reading 'muted')" crash already
// documented below for the boot path (session.audioPreferences does not
// exist on the nested envelope). Both callers now share this one helper so
// there is only one implementation that can ever get the flattening right or
// wrong, matching the "fresh session round-trips through restore" contract
// in test/town/session-runtime.test.mjs.
function freshRuntimeSession() {
  const initial = createInitialFable5SessionState();
  if (!initial.ok) return null;
  const runtime = restoreFable5SessionState(initial.state);
  return runtime.ok ? runtime.state : null;
}

function restoreSessionProgress(payload) {
  state.persistence = createFable5Persistence({
    storage: safeBrowserStorage(),
    repositoryIdentity: payload?.repository?.name,
    inspectionDigest: payload?.worldPlan?.inspectionDigest
  });
  const loaded = state.persistence.load();
  state.progressLoadStatus = loaded.status;
  const initialRuntime = freshRuntimeSession();
  if (!initialRuntime) throw new Error('Fable5 initial session contract is invalid');
  if (loaded.status !== 'loaded' || !loaded.state) {
    applyRestoredSession(initialRuntime);
    return;
  }
  const blockedNotice = blockedSavedInteriorNotice(loaded.state);
  if (blockedNotice) {
    // Never revive a saved route into a room whose approved customer-facing
    // asset set is no longer available. Start from the verified exterior
    // snapshot instead; this is deliberately not an inferred-room fallback.
    state.progressLoadStatus = 'release-blocked-interior';
    state.releaseGateNotice = blockedNotice;
    applyRestoredSession(initialRuntime);
    return;
  }
  const restored = restoreFable5SessionState(loaded.state);
  if (!restored.ok) {
    // A valid persistence envelope can still contain a stale or impossible
    // route state. Do not infer a nearby coordinate, room, or preference.
    state.progressLoadStatus = `corrupt-session:${restored.code}`;
    applyRestoredSession(initialRuntime);
    return;
  }
  applyRestoredSession(restored.state);
}

function updateQuest(next, { savedStatus = null } = {}) {
  if (!next?.ok) return false;
  state.quest = next.state;
  markProgressDirty();
  saveProgress();
  updateQuestMission();
  if (savedStatus) setStatus(savedStatus);
  return true;
}

function moveWithinBuilding(input, deltaSeconds) {
  const vector = normalizeMovementInput(input);
  const distance = Math.max(0, Math.min(0.05, Number(deltaSeconds) || 0)) * ACTOR_CONTRACT.speed;
  let x = state.player.x;
  let y = state.player.y;
  let blocked = false;
  if (vector.x !== 0) {
    const candidate = { x: x + vector.x * distance, y };
    if (isBuildingInteriorWalkable(state.buildingId, candidate)) x = candidate.x;
    else blocked = true;
  }
  if (vector.y !== 0) {
    const candidate = { x, y: y + vector.y * distance };
    if (isBuildingInteriorWalkable(state.buildingId, candidate)) y = candidate.y;
    else blocked = true;
  }
  return {
    x,
    y,
    moved: x !== state.player.x || y !== state.player.y,
    blocked: blocked && (vector.x !== 0 || vector.y !== 0),
    facing: facingForVector(vector, state.player.facing)
  };
}

// The only place player position is mutated. It runs exactly once per
// requestAnimationFrame callback (see frame()) with that frame's own
// deltaSeconds, so distance is always (elapsed time) * speed with no
// double-counting. Earlier this app also nudged the player by a
// hard-coded 0.06s on every keydown/pointerdown for instant feedback,
// but that ran outside the rAF loop without advancing state.lastTimestamp,
// so the very next frame's deltaSeconds still covered the same wall-clock
// interval and moveActor() was applied twice for it -- a ~4.5px warp
// (0.06s * 75px/s) on top of the normal ~1.25px/frame motion, every time a
// key was pressed or a direction changed. Input handlers now only ever
// update state.keys / state.heldDirections (see onKeyDown, onKeyUp,
// bindDirectionButton below); the next animation frame -- at most ~16ms
// away -- is what actually moves the player.
function updateMovement(deltaSeconds, timestamp) {
  if (dialogueOpen() || modalOpen() || timestamp < state.transitionUntil) {
    state.player.moving = false;
    return;
  }
  const input = movementVector();
  const wasMoving = state.player.moving;
  const previousFacing = state.player.facing;
  const moved = state.mode === 'interior'
    ? moveWithinBuilding(input, deltaSeconds)
    : moveActor(state.player, input, deltaSeconds, 'exterior');
  state.player.x = moved.x;
  state.player.y = moved.y;
  state.player.facing = moved.facing;
  state.player.moving = moved.moved;
  if (moved.moved) markProgressDirty();
  if (moved.blocked) registerBump(timestamp);
  if (moved.moved && (!wasMoving || moved.facing !== previousFacing)) state.player.walkStartedAt = timestamp;
  if (!moved.moved) state.player.walkStartedAt = 0;
  if (moved.moved && timestamp - state.lastFootstepAt >= 170) {
    state.lastFootstepAt = timestamp;
    state.audio.footstep();
  }
}

function currentInteraction() {
  // Building runtime is authoritative for entry availability and in-room
  // affordances. A pending interior returns an explicit unavailable reason
  // before legacy closed-entrance copy can make it look silently operable.
  const building = getBuildingInteraction({
    mode: state.mode,
    buildingId: state.mode === 'interior' ? state.buildingId : null,
    position: state.player,
    questState: state.quest
  });
  if (building) return enforceInteriorReleaseGate(building);
  if (state.mode !== 'exterior') return null;

  const legacy = nearbyInteraction(state.player, 'exterior');
  // Keep historical closed copy from replacing the building-runtime reason
  // for city hall/residence. The east shop remains honestly closed.
  if (legacy?.id === 'closed-townhall' || legacy?.id === 'closed-house') return null;
  return legacy;
}

function updateNearby(timestamp) {
  if (dialogueOpen() || modalOpen()) {
    state.nearby = null;
    elements.mission.hidden = true;
    elements.prompt.hidden = true;
    elements.action.disabled = true;
    return;
  }
  state.nearby = timestamp < state.transitionUntil ? null : currentInteraction();
  elements.mission.hidden = state.nearby?.id === 'talk-innkeeper';
  elements.prompt.hidden = !state.nearby || state.nearby.id === 'talk-innkeeper';
  // The remaining legacy closed entrance (the east-market shop) is honestly
  // non-actionable. City hall and residence use building-runtime before this
  // point, so neither can be disabled by a historical closed-* fallback.
  const isClosed = isClosedEntranceId(state.nearby?.id);
  elements.action.disabled = !state.nearby || isClosed || state.nearby.enabled === false;
  if (!state.nearby) {
    if (state.lastNearbyId) setStatus('近くに操作できるものはありません。');
    state.lastNearbyId = null;
    return;
  }
  // Doors now auto-enter/exit on approach (see updateAutoTransition), so
  // their prompt describes walking in rather than a key press; the key
  // hint chip is hidden for them too. NPC talk and clue inspection stay
  // manual-only and keep the key hint. Closed entrances are hidden the same
  // way as auto doors: there is nothing to press Enter/E for, only a reason
  // to read (Fable5VerticalSlice24x16.md requirement 4).
  const isAutoDoor = state.nearby.enabled === true
    && (state.nearby.kind === 'enter' || state.nearby.kind === 'exit');
  const noKeyAction = isAutoDoor || isClosed || state.nearby.enabled === false;
  const promptLabel = state.nearby.enabled === false && state.nearby.quest?.label
    ? state.nearby.quest.label
    : state.nearby.label;
  elements.promptPlace.textContent = state.nearby.place;
  elements.promptAction.textContent = promptLabel;
  elements.promptKey.hidden = noKeyAction;
  if (state.lastNearbyId !== state.nearby.id) {
    state.lastNearbyId = state.nearby.id;
    setStatus(noKeyAction
      ? `${state.nearby.place}。${promptLabel}。`
      : `${state.nearby.place}。${promptLabel}。EnterまたはEキー。`);
  }
}

function updateQuestMission() {
  const phase = questPhase();
  const building = state.mode === 'interior' ? getBuilding(state.buildingId) : null;
  const location = building?.label ?? '古町・屋外';
  elements.mission.dataset.completed = phase === 'completed' ? 'true' : 'false';
  if (!isCustomerReachableInterior('inn') && (phase === 'new' || phase === 'inn-dialogue')) {
    const inn = getBuilding('inn');
    elements.location.textContent = '古町・宿屋前';
    elements.objective.textContent = `${inn?.label ?? '宿屋'}は${unavailableInteriorReason('inn')}。`;
    return;
  }
  if (phase === 'new' || phase === 'inn-dialogue') {
    elements.location.textContent = state.mode === 'interior' ? `${location}・室内` : '古町・宿屋前';
    elements.objective.textContent = state.mode === 'interior'
      ? '宿帳係に近づき、観測・推定・不明を聞く'
      : '宿屋へ入り、調査の問いを一つ選ぶ';
    return;
  }
  if (phase === 'investigating') {
    const found = recordedClueIds();
    const remaining = CLUE_INTERACTIONS.filter((clue) => !found.has(clue.id));
    elements.location.textContent = `町の手掛かり　${found.size}/3`;
    elements.objective.textContent = remaining.length > 0
      ? `残り：${remaining.map((clue) => clue.shortLabel).join('・')}`
      : '市庁舎の記録係へ報告する';
    return;
  }
  if (phase === 'reportable') {
    elements.location.textContent = '手掛かり　3/3';
    const cityHall = getBuilding('city-hall');
    elements.objective.textContent = cityHall?.runtimeAvailability?.state === 'available'
      ? '市庁舎へ入り、記録係に報告する'
      : '市庁舎の承認済み内装を準備中のため、報告ルートは公開待ちです';
    return;
  }
  elements.location.textContent = '調査完了・tiny-town';
  elements.objective.textContent = '入口・循環・未確認の手掛かりを宿帳へ記録した';
}

// Applies the actual mode/position swap. Called once, at the midpoint of a
// fade transition (see updateModeTransition) when the black overlay is at
// full opacity, so the pop is never visible. Also snaps state.cameraFocus
// straight to the new mode's target instead of letting updateCamera() ease
// into it, so the camera is already exactly right the instant the fade-in
// reveals the new scene -- easing here would look like the camera visibly
// catching up right after the reveal.
function applyModeSwitch(transition, timestamp) {
  if (!transitionIsReleased(transition)) {
    setStatus(unavailableInteriorNotice(transition?.buildingId));
    return false;
  }
  state.mode = transition.mode;
  state.buildingId = transition.buildingId;
  state.player.x = transition.player.x;
  state.player.y = transition.player.y;
  state.player.facing = transition.mode === 'interior' ? 'north' : 'south';
  state.player.moving = false;
  state.player.walkStartedAt = 0;
  state.cameraFocus = { x: transition.cameraFocus.x, y: transition.cameraFocus.y };
  state.lastFootstepAt = timestamp;
  state.audio.door();
  markProgressDirty();
  saveProgress();
  syncInteriorDisclosure();
  updateQuestMission();
  const building = getBuilding(transition.buildingId);
  if (transition.mode === 'interior') {
    const evidence = building?.interiorEvidence === 'inferred'
      ? '推定の室内操作領域です。承認済み背景はありません。'
      : '帳場へ近づいてください。';
    setStatus(`${building?.label ?? '建物'}へ入りました。${evidence}`);
  } else {
    setStatus('建物から屋外へ戻りました。');
  }
  return true;
}

// Starts a fade-out/switch/fade-in transition to `mode` instead of
// switching immediately. Input stays locked for the whole transition via
// the existing state.transitionUntil (updateMovement/updateNearby already
// honour it). state.doorAuto is force-latched here -- regardless of
// whether this transition was triggered automatically or by a manual
// Enter/E/action-button press -- so the trigger belonging to the *new*
// mode cannot immediately refire: the interior spawn point
// (INN_CONTRACT.interior.entryFoot) sits inside the exit trigger's own
// radius, so without this an auto-entered player would otherwise bounce
// straight back outside.
function beginModeTransition(transition, timestamp) {
  // Load-bearing re-entry guard: while a transition is already pending,
  // every other caller (the auto-trigger in updateAutoTransition, and the
  // manual Enter/E/action-button fallback in performAction) must be a
  // strict no-op here, never restarting the clock or overwriting
  // startedAt/doorAuto -- otherwise a transition could never finish
  // (perpetually reset before elapsed reaches its own totalMs), which
  // means a perpetually stuck black fade overlay. See
  // test/town/transition-and-camera.test.mjs for a direct regression test.
  if (state.pendingTransition) return false;
  if (!transitionIsReleased(transition)) {
    setStatus(unavailableInteriorNotice(transition?.buildingId));
    return false;
  }
  // The duration is resolved once, here, from whatever state.reduceMotion is
  // *right now* and stored on the transition itself (pending.totalMs) rather
  // than re-read from the live setting on every later frame -- so a
  // prefers-reduced-motion toggle mid-flight can never change an
  // already-running transition's speed out from under
  // updateModeTransition/currentFadeAlpha, only the next transition that
  // begins after the toggle (see this function's own module-level comment
  // on state.reduceMotion for why that is still "live" enough to satisfy
  // the no-reload requirement).
  const totalMs = transitionDurationForMotionPreference(state.reduceMotion, TRANSITION_TOTAL_MS, TRANSITION_TOTAL_MS_REDUCED);
  state.transitionUntil = timestamp + totalMs;
  state.pendingTransition = { transition, startedAt: timestamp, applied: false, totalMs };
  state.doorAuto = { latched: true, cooldownUntil: timestamp + DOOR_AUTO_COOLDOWN_MS };
  return true;
}

// Drives a pending fade transition forward each frame: applies the actual
// mode switch once elapsed time crosses the midpoint, then clears the
// pending transition once it finishes. Rendering reads the same pending
// transition via currentFadeAlpha() to draw the overlay.
function updateModeTransition(timestamp) {
  const pending = state.pendingTransition;
  if (!pending) return;
  if (!transitionIsReleased(pending.transition)) {
    // A release can be withdrawn while an auto/manual transition is fading.
    // Drop the pending interior rather than applying a stale route.
    state.pendingTransition = null;
    state.transitionUntil = timestamp;
    setStatus(unavailableInteriorNotice(pending.transition?.buildingId));
    return;
  }
  const elapsed = timestamp - pending.startedAt;
  // Watchdog: force the transition closed if it could never resolve on its
  // own (see isTransitionExpired's own comment in world-runtime.mjs). This
  // is pure insurance -- with timestamp sanitized at the top of frame() and
  // a single, consistent clock basis everywhere a transition's startedAt is
  // recorded (see performAction), `elapsed` should always cross
  // pending.totalMs/2 and pending.totalMs well before this fires -- but a
  // stuck transition means a stuck black overlay and permanently locked
  // input, so it must never be possible to get wedged here for any reason,
  // including ones not yet imagined.
  const expired = isTransitionExpired(elapsed, pending.totalMs);
  if (!pending.applied && (elapsed >= pending.totalMs / 2 || expired)) {
    pending.applied = applyModeSwitch(pending.transition, timestamp);
  }
  if (elapsed >= pending.totalMs || expired) {
    state.pendingTransition = null;
  }
}

function currentFadeAlpha(timestamp) {
  const pending = state.pendingTransition;
  return pending ? fadeOverlayAlpha(timestamp - pending.startedAt, pending.totalMs) : 0;
}

// Per-frame edge/latch/cooldown evaluation for the explicitly enabled door
// interaction under the player. NPC talk and clue inspection deliberately
// stay manual-only. Skipped entirely while a transition is already in flight
// so the fade-locked, nearby-less window mid-transition can never be
// misread as "the player stepped outside the trigger" and clear the latch
// early.
function updateAutoTransition(timestamp) {
  if (state.pendingTransition || dialogueOpen() || modalOpen()) return;
  // `enabled === true` is deliberate: unavailable building entries must not
  // become passable merely because they have entrance geometry. This keeps
  // city hall and residence blocked until their approved interiors exist.
  const autoDoor = state.nearby?.enabled === true
    && (state.nearby.kind === 'enter' || state.nearby.kind === 'exit')
    ? state.nearby
    : null;
  const inside = Boolean(autoDoor);
  const result = evaluateDoorAutoTransition(state.doorAuto, inside, timestamp);
  state.doorAuto = { latched: result.latched, cooldownUntil: result.cooldownUntil };
  if (!result.fire || !autoDoor) return;
  const transition = autoDoor.kind === 'enter'
    ? enterBuilding(autoDoor.buildingId, state.player)
    : exitBuilding(autoDoor.buildingId, state.player);
  if (transition) beginModeTransition(transition, timestamp);
}

// Eases state.cameraFocus toward this frame's target (see
// smoothingFactor/lerpCameraFocus in world-runtime.mjs). Runs unconditionally
// every frame, including while input is locked, so it keeps settling even
// when the player can't move; applyModeSwitch snaps it directly on a mode
// switch so this never has to chase a same-frame teleport.
function updateCamera(deltaSeconds) {
  const interiorBuilding = state.mode === 'interior' ? getBuilding(state.buildingId) : null;
  const target = interiorBuilding?.interior?.cameraFocus ?? state.player;
  // Read live every frame (not captured once like a transition's totalMs)
  // so toggling prefers-reduced-motion mid-session takes effect on the very
  // next frame instead of waiting for some future event.
  const rate = cameraSmoothingRateForMotionPreference(state.reduceMotion, CAMERA_SMOOTHING_RATE);
  state.cameraFocus = lerpCameraFocus(state.cameraFocus, target, deltaSeconds, rate);
}

function beginDialogue({ pages, speaker, anchor, kind }) {
  if (!Array.isArray(pages) || pages.length === 0) return;
  state.dialoguePages = pages;
  state.dialogueIndex = 0;
  state.dialogueSpeaker = speaker;
  state.dialogueAnchor = anchor;
  state.dialogueKind = kind;
  elements.mission.hidden = true;
  const page = state.dialoguePages[0];
  elements.dialogueStatus.textContent = `${speaker}、${page.label}。${page.body}`;
  elements.dialogueStatus.hidden = false;
  state.audio.dialogue();
  setStatus(`${speaker}。${page.label}。${page.body}`);
}

function openInnkeeperDialogue() {
  state.player.facing = 'north';
  state.player.moving = false;
  state.player.walkStartedAt = 0;
  const phase = questPhase();
  if (phase === 'new') {
    const started = startInnDialogue(state.quest);
    if (!updateQuest(started)) return;
    showQuestionPanel();
    return;
  }
  if (phase === 'inn-dialogue') {
    showQuestionPanel();
    return;
  }
  let pages;
  let kind;
  if (phase === 'completed') {
    pages = [Object.freeze({
      className: 'observed',
      label: '記録済み',
      body: '報告は市庁舎の記録として保存されています。未確認を故障と決めつけず、次の調査に備えましょう。'
    })];
    kind = 'quest-repeat';
  } else {
    const remaining = 3 - recordedClueIds().size;
    pages = [Object.freeze({
      className: 'unknown',
      label: '調査中',
      body: `手掛かりは ${recordedClueIds().size}/3 です。残り${remaining}か所を調べ、市庁舎の記録係へ報告してください。`
    })];
    kind = 'quest-progress';
  }
  beginDialogue({
    pages,
    speaker: '宿帳係',
    anchor: INN_CONTRACT.interior.npcUiConnectorAnchor,
    kind
  });
}

function evidenceReferencesFor(site) {
  const references = site?.fact?.evidence?.[site?.evidenceClass];
  return Array.isArray(references)
    ? references.filter((reference) => typeof reference === 'string' && reference.trim().length > 0)
    : [];
}

function openClueDialogue(clue) {
  const investigation = state.investigation ?? buildInvestigation(state.payload);
  if (questPhase() !== 'investigating') {
    beginDialogue({
      pages: [Object.freeze({
        className: 'unknown',
        label: '調査の順序',
        body: 'この手掛かりは、宿屋で観測・推定・不明の問いを選んだ後に記録できます。'
      })],
      speaker: clue.place,
      anchor: clue.anchor,
      kind: 'clue-locked'
    });
    return;
  }
  const alreadyRecorded = recordedClueIds().has(clue.id);
  const site = investigation.sites[clue.id];
  if (!alreadyRecorded) {
    const recorded = recordInvestigationClue(state.quest, clue.id, evidenceReferencesFor(site));
    if (!updateQuest(recorded)) return;
  }
  const pages = alreadyRecorded
    ? [Object.freeze({
      className: 'observed',
      label: '記録済み',
      body: `${clue.place}の手掛かりは宿帳へ控えています。残りの場所を調べてください。`
    })]
    : site.pages;
  beginDialogue({
    pages,
    speaker: clue.place,
    anchor: clue.anchor,
    kind: alreadyRecorded ? 'clue-repeat' : 'clue'
  });
}

// Bumping a wall right at a closed entrance (town hall / house / east market
// shop) used to give the exact same generic message as bumping a bench or a
// lamp post, which is exactly what Fable5VerticalSlice24x16.md requirement 4
// rules out: an unimplemented door must not read as "just another obstacle".
// This looks up nearbyInteraction() fresh (rather than trusting
// state.nearby, whose value this frame -- see frame()'s call order -- was
// computed from the position *before* this failed move attempt) so the
// closed-door reason and the ambient prompt shown while merely standing
// nearby always agree, matching requirement 4's "一貫したUXで示す". Any
// other obstacle (bench, lamp, planter, the flowerbed) keeps the original
// generic message.
function registerBump(timestamp) {
  state.bumpUntil = Math.max(state.bumpUntil, timestamp + 300);
  if (!state.lastBumpStatusAt || timestamp - state.lastBumpStatusAt >= 700) {
    state.lastBumpStatusAt = timestamp;
    const blockedNearby = currentInteraction();
    setStatus(isClosedEntranceId(blockedNearby?.id) || blockedNearby?.kind === 'unavailable'
      ? `${blockedNearby.place}。${blockedNearby.label}`
      : 'ここは通れません。別の道を探してください。');
  }
}

function drawLedgerCompletion(timestamp) {
  if (questPhase() !== 'completed') return;
  // See ledgerCompletionPulse's own comment in world-runtime.mjs: this is
  // the one call in the whole render path proven (against a real browser)
  // to throw -- not just draw something wrong -- when a non-finite
  // timestamp reaches it, which is what turns a single bad frame into a
  // permanently dead rAF loop. frame()'s sanitizeTimestamp() should make
  // that unreachable in practice; the guard inside ledgerCompletionPulse
  // itself is the last line of defense. ledgerPulseForMotionPreference
  // wraps that same guarded function and additionally freezes the glow at
  // its rest brightness under prefers-reduced-motion instead of pulsing.
  const pulse = ledgerPulseForMotionPreference(state.reduceMotion, timestamp);
  context.save();
  const glow = context.createRadialGradient(224, 315, 3, 224, 315, 46);
  glow.addColorStop(0, `rgba(255, 228, 145, ${0.38 * pulse})`);
  glow.addColorStop(0.45, `rgba(255, 194, 82, ${0.2 * pulse})`);
  glow.addColorStop(1, 'rgba(255, 176, 60, 0)');
  context.fillStyle = glow;
  context.fillRect(176, 275, 96, 80);
  context.fillStyle = '#1b160c';
  context.fillRect(238, 315, 58, 18);
  context.strokeStyle = '#f3d77b';
  context.lineWidth = 1;
  context.strokeRect(238.5, 315.5, 57, 17);
  context.fillStyle = '#ffe9a6';
  context.font = '800 10px ui-monospace, monospace';
  context.textBaseline = 'top';
  context.fillText('✓ 記録済', 244, 319);
  context.restore();
}

function advanceDialogue() {
  if (!dialogueOpen()) return;
  state.dialogueIndex += 1;
  if (!dialogueOpen()) {
    state.dialogueIndex = -1;
    const completedKind = state.dialogueKind;
    state.dialogueKind = null;
    elements.dialogueStatus.hidden = true;
    elements.mission.hidden = false;
    updateQuestMission();
    setStatus(completedKind === 'quest-report'
      ? '調査完了。3つの手掛かりを市庁舎の記録へ保存しました。'
      : '会話を閉じました。');
    return;
  }
  const page = state.dialoguePages[state.dialogueIndex];
  elements.dialogueStatus.textContent = `${state.dialogueSpeaker}、${page.label}。${page.body}`;
  setStatus(`${state.dialogueSpeaker}。${page.label}。${page.body}`);
}

function closeDialogue() {
  if (!dialogueOpen()) return;
  state.dialogueIndex = -1;
  state.dialogueKind = null;
  elements.dialogueStatus.hidden = true;
  elements.mission.hidden = false;
  updateQuestMission();
  setStatus('会話を閉じました。');
}

const QUESTION_COPY = Object.freeze({
  observed: Object.freeze({
    label: '観測について聞く',
    body: '観測された事実だけを記録する問いです。町では古い街灯の台座を調べてください。'
  }),
  inferred: Object.freeze({
    label: '推定について聞く',
    body: '推定は構造から導いた仮説であり、実行時の成否を断定しない問いです。中央広場の井戸を調べてください。'
  }),
  unknown: Object.freeze({
    label: '不明について聞く',
    body: '未確認は故障を意味しません。東市場の閉じた看板を調べてください。'
  })
});

function showQuestionPanel() {
  if (questPhase() !== 'inn-dialogue') return;
  state.keys.clear();
  state.heldDirections.clear();
  state.modal = 'question';
  elements.questChoicePanel.hidden = false;
  elements.reportPanel.hidden = true;
  elements.resetPanel.hidden = true;
  elements.mission.hidden = true;
  elements.questChoiceButtons[0]?.focus({ preventScroll: true });
  setStatus('宿帳係。今回の調査で確かめる問いを、観測・推定・不明から一つ選んでください。');
}

function closeModal() {
  state.modal = null;
  elements.questChoicePanel.hidden = true;
  elements.reportPanel.hidden = true;
  elements.resetPanel.hidden = true;
  elements.mission.hidden = false;
  updateQuestMission();
}

function showResetPanel() {
  if (!state.ready || !state.persistence || modalOpen()) return;
  state.keys.clear();
  state.heldDirections.clear();
  state.modal = 'reset';
  elements.questChoicePanel.hidden = true;
  elements.reportPanel.hidden = true;
  elements.resetPanel.hidden = false;
  elements.mission.hidden = true;
  elements.confirmReset.focus({ preventScroll: true });
  setStatus('最初から始める確認。現在のリポジトリと検査結果の保存だけを消去します。');
}

function resetCurrentSession() {
  if (state.modal !== 'reset' || !state.persistence) return;
  const result = state.persistence.reset({ confirmed: true });
  if (result.status !== 'reset') {
    setStatus('この検査結果の保存を消去できませんでした。ブラウザーの保存設定を確認してください。');
    return;
  }
  // See freshRuntimeSession()'s own comment: this used to call
  // createInitialFable5SessionState() directly and hand its nested envelope
  // straight to applyRestoredSession(), which crashes on the very first
  // read of session.audioPreferences.muted. Sharing the same helper
  // restoreSessionProgress() uses is what actually fixes it -- there is now
  // only one place that can flatten this shape, not two.
  const initialRuntime = freshRuntimeSession();
  if (!initialRuntime) {
    setStatus('新しい調査記録を作成できませんでした。');
    return;
  }
  applyRestoredSession(initialRuntime);
  state.progressLoadStatus = 'reset';
  closeModal();
  setStatus('このリポジトリと検査結果の保存を消去し、最初から開始しました。');
}

function chooseQuestion(questionId) {
  if (state.modal !== 'question') return;
  const selected = chooseInvestigationQuestion(state.quest, questionId);
  if (!updateQuest(selected)) {
    setStatus('その問いは選べません。調査の状態を確認してください。');
    return;
  }
  const copy = QUESTION_COPY[questionId];
  closeModal();
  beginDialogue({
    pages: [Object.freeze({
      className: questionId,
      label: copy?.label ?? '調査の問い',
      body: copy?.body ?? '三つの手掛かりを、観測・推定・不明として区別して記録してください。'
    })],
    speaker: '宿帳係',
    anchor: INN_CONTRACT.interior.npcUiConnectorAnchor,
    kind: 'question-selected'
  });
}

function showReportPanel() {
  if (questPhase() !== 'reportable') return;
  const records = state.quest.clues
    .map((clue) => `${CLUE_INTERACTIONS.find(({ id }) => id === clue.id)?.shortLabel ?? clue.id}（${clue.evidenceClass}）`)
    .join('・');
  state.keys.clear();
  state.heldDirections.clear();
  state.modal = 'report';
  elements.reportSummary.textContent = `記録する手掛かり: ${records}。観測・推定・不明を区別したまま、市庁舎の記録に保存します。`;
  elements.reportPanel.hidden = false;
  elements.questChoicePanel.hidden = true;
  elements.mission.hidden = true;
  elements.submitReport.focus({ preventScroll: true });
  setStatus('市庁舎の記録係。3つの手掛かりを区別して報告する内容を確認してください。');
}

function submitReport() {
  if (state.modal !== 'report') return;
  const report = submitTownHallReport(state.quest, {
    answer: {
      questionId: state.quest.questionId,
      clues: state.quest.clues.map(({ id, evidenceClass, evidenceRefs }) => ({ id, evidenceClass, evidenceRefs }))
    },
    result: {
      status: 'filed',
      evidenceClasses: state.quest.clues.map(({ evidenceClass }) => evidenceClass)
    }
  });
  if (!updateQuest(report)) {
    setStatus('報告を保存できませんでした。調査の状態を確認してください。');
    return;
  }
  state.completionStartedAt = state.lastTimestamp;
  closeModal();
  const investigation = state.investigation ?? buildInvestigation(state.payload);
  beginDialogue({
    pages: investigation.report,
    speaker: '市庁舎の記録係',
    anchor: getBuilding('city-hall')?.interior.interaction.point ?? state.player,
    kind: 'quest-report'
  });
}

function openResidentDialogue() {
  const building = getBuilding('residence');
  beginDialogue({
    pages: [Object.freeze({
      className: 'inferred',
      label: '推定の室内',
      body: 'ここは操作できる推定室内です。背景・配置・人物の来歴は未承認で、調査の事実は追加しません。三つの記録がそろったら市庁舎で報告できます。'
    })],
    speaker: '住宅の案内',
    anchor: building?.interior.interaction.point ?? state.player,
    kind: 'residence'
  });
}

// Defaults to state.lastTimestamp (the rAF loop's own most recent
// timestamp) rather than performance.now(): performAction is called from
// DOM event handlers (keydown, the action button's click) outside the rAF
// loop, and state.lastTimestamp as of "just now" is close enough (at most
// one frame stale) while guaranteeing every comparison against
// state.transitionUntil / a pending transition's startedAt stays on the
// exact same clock basis those were recorded with. Mixing in a second,
// independent clock here used to mean a manually-triggered transition's
// startedAt could end up on a different timeline than the timestamps
// updateModeTransition is later driven with -- see isTransitionExpired's
// comment in world-runtime.mjs for what that does to `elapsed`.
function performAction(timestamp = state.lastTimestamp) {
  if (!state.ready || dialogueOpen() || modalOpen() || timestamp < state.transitionUntil || !state.nearby) return;
  if (state.nearby.enabled === false || isClosedEntranceId(state.nearby.id)) return;
  if (state.nearby.kind === 'enter') {
    const transition = enterBuilding(state.nearby.buildingId, state.player);
    if (transition) beginModeTransition(transition, timestamp);
    return;
  }
  if (state.nearby.kind === 'exit') {
    const transition = exitBuilding(state.nearby.buildingId, state.player);
    if (transition) beginModeTransition(transition, timestamp);
    return;
  }
  if (state.nearby.id === 'talk-innkeeper') {
    openInnkeeperDialogue();
    return;
  }
  if (state.nearby.id === 'talk-town-clerk' && state.nearby.quest?.action === 'submit-townhall-report') {
    showReportPanel();
    return;
  }
  if (state.nearby.id === 'talk-resident') {
    openResidentDialogue();
    return;
  }
  if (state.nearby.id.startsWith('clue-')) openClueDialogue(state.nearby);
}

function drawWorld(timestamp) {
  const { width, height, dpr } = state.viewport;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#080c13';
  context.fillRect(0, 0, width, height);

  state.camera = createCamera(width, height, state.cameraFocus, state.zoom);
  if (state.mode === 'interior' && !isCustomerReachableInterior(state.buildingId)) {
    // This state is unreachable through every supported route. Render only a
    // non-playable release notice if stale code ever attempts to force it;
    // never revive the retired inferred-room fixture or any pending art.
    drawUnavailableInteriorGate(state.buildingId);
    drawFadeOverlay(timestamp, width, height);
    return;
  }

  context.save();
  context.scale(state.camera.zoom, state.camera.zoom);
  context.translate(-state.camera.x, -state.camera.y);
  drawWorldPrefabs(context, state.assets.worldPrefabs);
  if (state.mode === 'exterior') {
    context.drawImage(state.assets.innExteriorClosed, 8, 72);
  } else if (state.buildingId === 'inn') {
    context.drawImage(state.assets.innCounterClean, 200, 255);
    drawLedgerCompletion(timestamp);
  }
  const playerBehindStreetlamp = state.mode === 'exterior'
    && state.player.y < INN_CONTRACT.objects.routeStreetlampFoot.y;
  if (state.mode === 'exterior' && !playerBehindStreetlamp) {
    context.drawImage(
      state.assets.routeStreetlamp,
      INN_CONTRACT.objects.routeStreetlampOrigin.x,
      INN_CONTRACT.objects.routeStreetlampOrigin.y
    );
  }
  drawCharacterFrame(
    context,
    state.assets.player,
    spriteFrame(state.player, timestamp),
    state.player
  );
  if (timestamp < state.bumpUntil) {
    const progress = bumpGlowProgress(timestamp, state.bumpUntil);
    context.save();
    context.strokeStyle = `rgba(255, 217, 132, ${0.9 - progress * 0.7})`;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(state.player.x, state.player.y + 1, 8 + progress * 7, Math.PI, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  if (state.mode === 'exterior' && playerBehindStreetlamp) {
    context.drawImage(
      state.assets.routeStreetlamp,
      INN_CONTRACT.objects.routeStreetlampOrigin.x,
      INN_CONTRACT.objects.routeStreetlampOrigin.y
    );
  }
  if (state.mode === 'interior' && state.buildingId === 'inn') {
    context.drawImage(
      state.assets.entranceForeground,
      INN_CONTRACT.objects.entranceForegroundOrigin.x,
      INN_CONTRACT.objects.entranceForegroundOrigin.y
    );
  }
  if (state.mode === 'exterior') drawClueMarkers();
  context.restore();

  drawFadeOverlay(timestamp, width, height);

  if (dialogueOpen()) drawDialogue();
  else if (state.nearby?.id === 'talk-innkeeper' && state.buildingId === 'inn') drawNpcSpeechPrompt();
}

function drawFadeOverlay(timestamp, width, height) {
  const fadeAlpha = currentFadeAlpha(timestamp);
  if (fadeAlpha <= 0) return;
  context.save();
  context.setTransform(state.viewport.dpr, 0, 0, state.viewport.dpr, 0, 0);
  context.fillStyle = `rgba(8, 12, 19, ${fadeAlpha})`;
  context.fillRect(0, 0, width, height);
  context.restore();
}

// A final fail-closed renderer guard. This is not a room and intentionally
// exposes neither movement, NPCs, nor provisional artwork. Normal play never
// reaches it: restore and transition gates recover to the released exterior.
function drawUnavailableInteriorGate(buildingId) {
  const { width, height } = state.viewport;
  context.save();
  context.fillStyle = '#080c13';
  context.fillRect(0, 0, width, height);
  const panelWidth = Math.min(560, Math.max(260, width - 40));
  const panelX = Math.round((width - panelWidth) / 2);
  const panelY = Math.max(92, Math.round(height * 0.34));
  context.fillStyle = 'rgba(8, 12, 19, 0.88)';
  context.fillRect(panelX, panelY, panelWidth, 116);
  context.strokeStyle = '#e9c65f';
  context.lineWidth = 2;
  context.strokeRect(panelX + 1, panelY + 1, panelWidth - 2, 114);
  context.fillStyle = '#ffd984';
  context.textBaseline = 'top';
  context.font = '800 16px system-ui, sans-serif';
  context.fillText('この室内は公開待ちです', panelX + 18, panelY + 18);
  context.fillStyle = '#f9f1d4';
  context.font = '700 15px system-ui, sans-serif';
  const lines = wrapCanvasText(context, unavailableInteriorNotice(buildingId), panelWidth - 36).slice(0, 3);
  context.fillStyle = '#b9c1d1';
  context.font = '600 14px system-ui, sans-serif';
  lines.forEach((line, index) => context.fillText(line, panelX + 18, panelY + 50 + index * 19));
  context.restore();
}

// Small always-on "already investigated" checkmarks over each found clue,
// drawn in world space (inside drawWorld's camera transform) so they scroll
// and scale with the scene like any other prop.
function drawClueMarkers() {
  const found = recordedClueIds();
  for (const clue of CLUE_INTERACTIONS) {
    if (!found.has(clue.id)) continue;
    const markerX = clue.anchor.x;
    const markerY = clue.anchor.y - 8;
    context.save();
    context.fillStyle = 'rgba(15, 20, 15, 0.82)';
    context.beginPath();
    context.arc(markerX, markerY, 8, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#9ef4cf';
    context.lineWidth = 1.4;
    context.stroke();
    context.strokeStyle = '#eafff3';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(markerX - 3.4, markerY + 0.3);
    context.lineTo(markerX - 0.8, markerY + 3.2);
    context.lineTo(markerX + 3.8, markerY - 3.6);
    context.stroke();
    context.restore();
  }
}

function dialogueFramePosition() {
  const speaker = worldToScreen(
    state.camera,
    state.dialogueAnchor ?? INN_CONTRACT.interior.npcUiConnectorAnchor
  );
  const frame = DIALOGUE_CROPS.frame;
  const x = Math.max(8, Math.min(state.viewport.width - frame.width - 8, speaker.x - frame.width / 2));
  let y = Math.max(8, Math.min(state.viewport.height - frame.height - 8, speaker.y - frame.height + 8));

  // A clue's interaction radius can let the player stand close enough
  // beneath its anchor (or the innkeeper's) that the dialogue frame would
  // otherwise be drawn right on top of the player's own sprite. Raise the
  // frame clear of it when that happens instead of hard-coding per-site
  // offsets, since the overlap depends on wherever the player was actually
  // standing when the dialogue opened.
  const playerFoot = worldToScreen(state.camera, state.player);
  const playerBox = { x: playerFoot.x - 32, y: playerFoot.y - 120, width: 64, height: 128 };
  if (rectsOverlap({ x, y, width: frame.width, height: frame.height }, playerBox)) {
    y = Math.max(8, Math.min(y, playerBox.y - frame.height - 6));
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function drawNpcSpeechPrompt() {
  const bubble = DIALOGUE_CROPS.speechBubble;
  const speaker = worldToScreen(state.camera, INN_CONTRACT.interior.npcUiConnectorAnchor);
  const x = Math.max(8, Math.min(state.viewport.width - bubble.width - 8, speaker.x - bubble.width / 2));
  const y = Math.max(8, Math.min(state.viewport.height - bubble.height - 8, speaker.y - bubble.height + 5));
  context.drawImage(state.assets.speechBubble, Math.round(x), Math.round(y));
  context.save();
  context.textBaseline = 'top';
  context.fillStyle = '#fff9dc';
  context.font = '800 14px system-ui, sans-serif';
  context.fillText('宿帳係', x + bubble.safeInsets.left, y + bubble.safeInsets.top);
  context.font = '700 13px system-ui, sans-serif';
  context.fillStyle = '#d8cc91';
  context.fillText('Enter / E で話す', x + bubble.safeInsets.left, y + bubble.safeInsets.top + 25);
  context.restore();
}

function drawDialogue() {
  const page = state.dialoguePages[state.dialogueIndex];
  const frame = DIALOGUE_CROPS.frame;
  const position = dialogueFramePosition();
  context.drawImage(state.assets.dialogueFrame, position.x, position.y);

  const textX = position.x + frame.safeInsets.left;
  const textWidth = frame.width - frame.safeInsets.left - frame.safeInsets.right;
  context.save();
  context.textBaseline = 'top';
  context.font = '700 15px system-ui, sans-serif';
  context.fillStyle = page.className === 'observed'
    ? '#9ef4cf'
    : page.className === 'inferred' ? '#ffd984' : '#c9d2ee';
  context.fillText(`${state.dialogueSpeaker}　｜　${page.label}`, textX, position.y + 24);
  context.font = '600 16px system-ui, sans-serif';
  context.fillStyle = '#fff9dc';
  const lines = wrapCanvasText(context, page.body, textWidth).slice(0, 3);
  lines.forEach((line, index) => context.fillText(line, textX, position.y + 54 + index * 22));
  context.font = '700 12px system-ui, sans-serif';
  context.fillStyle = '#d8cc91';
  context.fillText('Enter / Space：続ける　Esc：閉じる', textX, position.y + 124);
  drawNativeCrop(
    context,
    state.assets.dialogueSheet,
    DIALOGUE_CROPS.continueMarker,
    position.x + frame.width - frame.safeInsets.right - DIALOGUE_CROPS.continueMarker.width,
    position.y + 143
  );
  context.restore();
}

// requestAnimationFrame's contract guarantees a finite DOMHighResTimeStamp,
// but nothing here used to defend against that contract breaking -- a
// hostile/foreign caller, a browser/automation edge case, or any other
// non-finite value reaching this callback -- and the fallout was severe and
// permanent. A single bad `timestamp` poisons state.lastTimestamp (every
// later deltaSeconds computes off it, forever, since NaN - anything is
// still NaN), which poisons state.cameraFocus via updateCamera (see
// lerpCameraFocus's own guard in world-runtime.mjs for why that specific
// corruption never self-heals on its own), and -- whenever the quest is
// already complete, since drawLedgerCompletion() runs unconditionally every
// frame in interior mode -- throws an uncaught SyntaxError that permanently
// kills this entire rAF loop (see drawLedgerCompletion's own comment).
// sanitizeTimestamp() is the single choke point that keeps
// state.lastTimestamp, and therefore every timestamp derived from it this
// frame, finite by construction, no matter what requestAnimationFrame
// (real or synthetic/hijacked) hands back.
function sanitizeTimestamp(timestamp, fallback) {
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

// This is the render loop's only supervisor: requestAnimationFrame never
// retries or reschedules a callback that threw, so before this fix a single
// uncaught exception anywhere in one frame's work (two confirmed real causes
// already existed -- see sanitizeTimestamp's own comment above and
// bumpGlowProgress's in world-runtime.mjs, both of which fed an
// uncatchable canvas exception from here) silently and permanently stopped
// the whole game with no on-screen signal at all: the last HUD text painted
// stays put, looking alive, while the canvas never updates again. try/catch
// cannot make an individual bad frame render correctly, but it can guarantee
// this function always reaches its own trailing requestAnimationFrame(frame)
// call -- in a finally block, so neither a caught nor an uncaught-by-design
// path can skip it -- so the game recovers on the very next frame instead of
// dying forever. The error is still surfaced to the console rather than
// swallowed, so a regression here remains loudly debuggable.
function frame(rawTimestamp) {
  if (!state.ready || state.stopped) return;
  try {
    const timestamp = sanitizeTimestamp(rawTimestamp, state.lastTimestamp);
    const deltaSeconds = state.lastTimestamp === 0
      ? 0
      : Math.min(0.05, Math.max(0, (timestamp - state.lastTimestamp) / 1000));
    state.lastTimestamp = timestamp;
    resizeCanvas();
    updateMovement(deltaSeconds, timestamp);
    updateNearby(timestamp);
    updateModeTransition(timestamp);
    updateAutoTransition(timestamp);
    updateCamera(deltaSeconds);
    if (state.progressDirty && timestamp - state.lastProgressSaveAttemptAt >= 750) saveProgress();
    drawWorld(timestamp);
  } catch (error) {
    console.error('fable5: frame() threw; recovering and continuing next frame', error);
  } finally {
    state.animationFrame = window.requestAnimationFrame(frame);
  }
}

function normalizedKey(event) {
  return String(event.key ?? '').toLowerCase();
}

function onKeyDown(event) {
  if (!state.ready || event.metaKey || event.ctrlKey || event.altKey) return;
  unlockAudioFromGesture();
  const key = normalizedKey(event);
  if (modalOpen()) {
    if (key === 'escape') {
      event.preventDefault();
      closeModal();
      setStatus('確認を取り消しました。現在の保存は残っています。');
    }
    return;
  }
  const movementKey = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(key);
  if (movementKey) {
    event.preventDefault();
    state.keys.add(key);
    return;
  }
  if (key === 'escape' && dialogueOpen()) {
    event.preventDefault();
    closeDialogue();
    return;
  }
  if ((key === 'enter' || key === ' ' || key === 'e') && !event.repeat) {
    event.preventDefault();
    if (dialogueOpen()) advanceDialogue();
    else performAction();
  }
}

function onKeyUp(event) {
  state.keys.delete(normalizedKey(event));
}

function syncZoomControls() {
  elements.zoomValue.value = `${state.zoom}×`;
  elements.zoomValue.textContent = `${state.zoom}×`;
  elements.zoomOut.disabled = state.zoom <= 1;
  elements.zoomIn.disabled = state.zoom >= 2;
}

function changeZoom(delta) {
  const previous = state.zoom;
  state.zoom = Math.max(1, Math.min(2, state.zoom + delta));
  syncZoomControls();
  if (state.ready && state.zoom !== previous) {
    markProgressDirty();
    saveProgress();
  }
}

function bindDirectionButton(button) {
  const release = (event) => {
    state.heldDirections.delete(event.pointerId);
    button.releasePointerCapture?.(event.pointerId);
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    unlockAudioFromGesture();
    button.setPointerCapture?.(event.pointerId);
    state.heldDirections.set(event.pointerId, button.dataset.direction);
    elements.canvas.focus({ preventScroll: true });
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', (event) => state.heldDirections.delete(event.pointerId));
}

async function fetchTownPayload(timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/api/town', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`GET /api/town failed: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('GET /api/town timed out after 15 seconds');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function boot() {
  try {
    elements.startupMessage.textContent = 'ユーザー提供の町を構成するprefab・本人キャラクター・宿屋オブジェクトを照合しています…';
    const payloadRequest = fetchTownPayload();
    const [payload, assets] = await Promise.all([payloadRequest, loadProductionAssets()]);
    assertTownPayload(payload);
    state.payload = payload;
    state.investigation = buildInvestigation(payload);
    restoreSessionProgress(payload);
    state.assets = assets;
    state.ready = true;
    elements.repositoryName.textContent = payload.repository?.name || '名称未設定のリポジトリ';
    elements.assetBadge.textContent = 'prefab画像 OK';
    elements.assetBadge.dataset.ready = 'true';
    elements.geometryBadge.textContent = 'target-town n=1';
    elements.geometryBadge.dataset.ready = 'true';
    elements.startup.hidden = true;
    syncAudioControls();
    syncInteriorDisclosure();
    updateQuestMission();
    elements.canvas.focus({ preventScroll: true });
    const progressNotice = state.progressLoadStatus === 'loaded'
      ? 'この検査結果に対応する前回の調査記録を復元しました。'
      : state.progressLoadStatus === 'missing'
        // Never invite the player toward an interaction that cannot actually
        // happen yet: while the inn has no approved NPC art, say so instead
        // of "go talk to the innkeeper". This automatically reverts to the
        // normal invitation the instant isCustomerReachableInterior('inn')
        // is true, with no further code change.
        ? isCustomerReachableInterior('inn')
          ? '街を開始しました。宿屋へ入り、宿帳係に話しかけてください。'
          : `街を開始しました。${unavailableInteriorReason('inn')}`
        : state.progressLoadStatus === 'storage-unavailable'
          ? '保存を利用できないため、新しい記録として開始しました。ブラウザーの保存設定を確認してください。'
          : state.progressLoadStatus === 'release-blocked-interior'
            ? state.releaseGateNotice
        : '保存済みの調査記録は検証できなかったため、新しい記録として開始します。';
    setStatus(progressNotice);
    state.animationFrame = window.requestAnimationFrame(frame);
  } catch (error) {
    stopWithError(error);
  }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', () => {
  state.keys.clear();
  state.heldDirections.clear();
});
window.addEventListener('pagehide', () => {
  if (state.progressDirty) saveProgress();
});
window.addEventListener('resize', resizeCanvas);
// Live reflection of the OS/browser motion preference: updateCamera() reads
// state.reduceMotion fresh every frame and beginModeTransition()/
// drawLedgerCompletion() read it whenever they next run, so flipping this
// mid-session takes effect immediately -- no reload, no re-entering the
// game -- matching the same MediaQueryList 'change' event the .spinner's
// own @media (prefers-reduced-motion: reduce) rule in styles.css responds
// to automatically via CSS.
reducedMotionQuery?.addEventListener('change', (event) => {
  state.reduceMotion = event.matches;
});
elements.action.addEventListener('click', () => {
  unlockAudioFromGesture();
  performAction();
});
elements.zoomOut.addEventListener('click', () => changeZoom(-1));
elements.zoomIn.addEventListener('click', () => changeZoom(1));
elements.audioMute.addEventListener('click', () => {
  unlockAudioFromGesture();
  state.audio.toggleMuted();
  syncAudioControls();
  markProgressDirty();
  saveProgress();
});
elements.audioVolume.addEventListener('input', () => {
  unlockAudioFromGesture();
  state.audio.setVolume(Number(elements.audioVolume.value) / 100);
  syncAudioControls();
  markProgressDirty();
  saveProgress();
});
elements.restartProgress.addEventListener('click', () => {
  unlockAudioFromGesture();
  showResetPanel();
});
for (const button of elements.questChoiceButtons) {
  button.addEventListener('click', () => {
    unlockAudioFromGesture();
    chooseQuestion(button.dataset.question);
  });
}
elements.submitReport.addEventListener('click', () => {
  unlockAudioFromGesture();
  submitReport();
});
elements.cancelReport.addEventListener('click', () => {
  unlockAudioFromGesture();
  closeModal();
  setStatus('報告を取り消しました。3つの手掛かりは記録したままです。');
});
elements.confirmReset.addEventListener('click', () => {
  unlockAudioFromGesture();
  resetCurrentSession();
});
elements.cancelReset.addEventListener('click', () => {
  unlockAudioFromGesture();
  closeModal();
  setStatus('最初からの開始を取り消しました。現在の保存は残っています。');
});
for (const button of elements.dpad.querySelectorAll('[data-direction]')) bindDirectionButton(button);

resizeCanvas();
changeZoom(0);
boot();
