import {
  ACTOR_CONTRACT,
  CLUE_INTERACTIONS,
  DOOR_AUTO_COOLDOWN_MS,
  GAMEPLAY_ZOOM,
  INN_CONTRACT,
  buildInvestigation,
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
  drawWorldImage,
  loadProductionAssets
} from './site-runtime.mjs';

const elements = {
  canvas: document.querySelector('#world-canvas'),
  repositoryName: document.querySelector('#repository-name'),
  assetBadge: document.querySelector('#asset-badge'),
  geometryBadge: document.querySelector('#geometry-badge'),
  startup: document.querySelector('#startup-panel'),
  startupMessage: document.querySelector('#startup-message'),
  mission: document.querySelector('.mission-card'),
  error: document.querySelector('#game-error'),
  errorMessage: document.querySelector('#game-error-message'),
  errorDetails: document.querySelector('#game-error-details'),
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
  mode: 'exterior',
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
  questStage: 'unstarted',
  foundClues: new Set(),
  completionStartedAt: 0,
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

function stopWithError(error) {
  state.stopped = true;
  state.ready = false;
  elements.startup.hidden = true;
  elements.error.hidden = false;
  elements.errorMessage.textContent = error instanceof AssetContractError
    ? error.message
    : '街の検査結果またはproduction画像を読み込めませんでした。';
  const details = Array.isArray(error?.issues) && error.issues.length > 0
    ? error.issues
    : [String(error?.message ?? error)];
  elements.errorDetails.replaceChildren(...details.map((detail) => {
    const item = document.createElement('li');
    item.textContent = detail;
    return item;
  }));
  elements.assetBadge.textContent = '画像不足';
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
  if (dialogueOpen() || timestamp < state.transitionUntil) {
    state.player.moving = false;
    return;
  }
  const input = movementVector();
  const wasMoving = state.player.moving;
  const previousFacing = state.player.facing;
  const moved = moveActor(state.player, input, deltaSeconds, state.mode);
  state.player.x = moved.x;
  state.player.y = moved.y;
  state.player.facing = moved.facing;
  state.player.moving = moved.moved;
  if (moved.blocked) registerBump(timestamp);
  if (moved.moved && (!wasMoving || moved.facing !== previousFacing)) state.player.walkStartedAt = timestamp;
  if (!moved.moved) state.player.walkStartedAt = 0;
}

function updateNearby(timestamp) {
  if (dialogueOpen()) {
    state.nearby = null;
    elements.mission.hidden = true;
    elements.prompt.hidden = true;
    elements.action.disabled = true;
    return;
  }
  state.nearby = timestamp < state.transitionUntil
    ? null
    : nearbyInteraction(state.player, state.mode);
  elements.mission.hidden = state.nearby?.id === 'talk-innkeeper';
  elements.prompt.hidden = !state.nearby || state.nearby.id === 'talk-innkeeper';
  // A closed entrance (town hall / house / east market shop -- see
  // CLOSED_ENTRANCES in world-runtime.mjs) is honestly non-actionable: unlike
  // enter-inn/exit-inn there is no auto-transition and no manual fallback
  // that does anything for it (performAction's id checks simply don't match
  // 'closed-*'), so the action button stays disabled for it exactly like it
  // does with no nearby interaction at all.
  const isClosed = isClosedEntranceId(state.nearby?.id);
  elements.action.disabled = !state.nearby || isClosed;
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
  const isAutoDoor = state.nearby.id === 'enter-inn' || state.nearby.id === 'exit-inn';
  const noKeyAction = isAutoDoor || isClosed;
  elements.promptPlace.textContent = state.nearby.place;
  elements.promptAction.textContent = state.nearby.label;
  elements.promptKey.hidden = noKeyAction;
  if (state.lastNearbyId !== state.nearby.id) {
    state.lastNearbyId = state.nearby.id;
    setStatus(noKeyAction
      ? `${state.nearby.place}。${state.nearby.label}。`
      : `${state.nearby.place}。${state.nearby.label}。EnterまたはEキー。`);
  }
}

function updateQuestMission() {
  elements.mission.dataset.completed = state.questStage === 'completed' ? 'true' : 'false';
  if (state.questStage === 'unstarted') {
    elements.location.textContent = state.mode === 'interior' ? '古町の宿屋・室内' : '古町・宿屋前';
    elements.objective.textContent = state.mode === 'interior'
      ? '宿帳係に近づき、観測・推定・不明を聞く'
      : '宿屋の扉へ戻る、または東の大通りを歩く';
    return;
  }
  if (state.questStage === 'investigating') {
    const remaining = CLUE_INTERACTIONS.filter((clue) => !state.foundClues.has(clue.id));
    elements.location.textContent = `町の手掛かり　${state.foundClues.size}/3`;
    elements.objective.textContent = remaining.length > 0
      ? `残り：${remaining.map((clue) => clue.shortLabel).join('・')}`
      : '宿帳係へ報告する';
    return;
  }
  if (state.questStage === 'reportable') {
    elements.location.textContent = '手掛かり　3/3';
    elements.objective.textContent = '宿屋へ戻り、宿帳係へ報告する';
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
function applyModeSwitch(mode, timestamp) {
  state.mode = mode;
  if (mode === 'interior') {
    state.player.x = INN_CONTRACT.interior.entryFoot.x;
    state.player.y = INN_CONTRACT.interior.entryFoot.y;
    state.player.facing = 'north';
    state.cameraFocus = { x: INN_CONTRACT.interior.cameraFocus.x, y: INN_CONTRACT.interior.cameraFocus.y };
    updateQuestMission();
    setStatus('宿屋へ入りました。帳場へ近づいてください。');
  } else {
    state.player.x = INN_CONTRACT.door.returnPoint.x;
    state.player.y = INN_CONTRACT.door.returnPoint.y;
    state.player.facing = 'south';
    state.cameraFocus = { x: state.player.x, y: state.player.y };
    updateQuestMission();
    setStatus('宿屋から外へ戻りました。');
  }
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
function beginModeTransition(mode, timestamp) {
  // Load-bearing re-entry guard: while a transition is already pending,
  // every other caller (the auto-trigger in updateAutoTransition, and the
  // manual Enter/E/action-button fallback in performAction) must be a
  // strict no-op here, never restarting the clock or overwriting
  // startedAt/doorAuto -- otherwise a transition could never finish
  // (perpetually reset before elapsed reaches its own totalMs), which
  // means a perpetually stuck black fade overlay. See
  // test/town/transition-and-camera.test.mjs for a direct regression test.
  if (state.pendingTransition) return;
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
  state.pendingTransition = { targetMode: mode, startedAt: timestamp, applied: false, totalMs };
  state.doorAuto = { latched: true, cooldownUntil: timestamp + DOOR_AUTO_COOLDOWN_MS };
}

// Drives a pending fade transition forward each frame: applies the actual
// mode switch once elapsed time crosses the midpoint, then clears the
// pending transition once it finishes. Rendering reads the same pending
// transition via currentFadeAlpha() to draw the overlay.
function updateModeTransition(timestamp) {
  const pending = state.pendingTransition;
  if (!pending) return;
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
    applyModeSwitch(pending.targetMode, timestamp);
    pending.applied = true;
  }
  if (elapsed >= pending.totalMs || expired) {
    state.pendingTransition = null;
  }
}

function currentFadeAlpha(timestamp) {
  const pending = state.pendingTransition;
  return pending ? fadeOverlayAlpha(timestamp - pending.startedAt, pending.totalMs) : 0;
}

// Per-frame edge/latch/cooldown evaluation for the door the player is
// currently able to walk through (enter-inn in the exterior, exit-inn in
// the interior -- NPC talk and clue inspection deliberately stay manual
// only). Skipped entirely while a transition is already in flight so the
// fade-locked, nearby-less window mid-transition can never be misread as
// "the player stepped outside the trigger" and clear the latch early.
function updateAutoTransition(timestamp) {
  if (state.pendingTransition || dialogueOpen()) return;
  const autoId = state.mode === 'exterior' ? 'enter-inn' : 'exit-inn';
  const inside = state.nearby?.id === autoId;
  const result = evaluateDoorAutoTransition(state.doorAuto, inside, timestamp);
  state.doorAuto = { latched: result.latched, cooldownUntil: result.cooldownUntil };
  if (result.fire) beginModeTransition(state.mode === 'exterior' ? 'interior' : 'exterior', timestamp);
}

// Eases state.cameraFocus toward this frame's target (see
// smoothingFactor/lerpCameraFocus in world-runtime.mjs). Runs unconditionally
// every frame, including while input is locked, so it keeps settling even
// when the player can't move; applyModeSwitch snaps it directly on a mode
// switch so this never has to chase a same-frame teleport.
function updateCamera(deltaSeconds) {
  const target = state.mode === 'interior' ? INN_CONTRACT.interior.cameraFocus : state.player;
  // Read live every frame (not captured once like a transition's totalMs)
  // so toggling prefers-reduced-motion mid-session takes effect on the very
  // next frame instead of waiting for some future event.
  const rate = cameraSmoothingRateForMotionPreference(state.reduceMotion, CAMERA_SMOOTHING_RATE);
  state.cameraFocus = lerpCameraFocus(state.cameraFocus, target, deltaSeconds, rate);
}

function beginDialogue({ pages, speaker, anchor, kind }) {
  state.dialoguePages = pages;
  state.dialogueIndex = 0;
  state.dialogueSpeaker = speaker;
  state.dialogueAnchor = anchor;
  state.dialogueKind = kind;
  elements.mission.hidden = true;
  const page = state.dialoguePages[0];
  elements.dialogueStatus.textContent = `${speaker}、${page.label}。${page.body}`;
  elements.dialogueStatus.hidden = false;
  setStatus(`${speaker}。${page.label}。${page.body}`);
}

function openInnkeeperDialogue() {
  state.player.facing = 'north';
  state.player.moving = false;
  state.player.walkStartedAt = 0;
  const investigation = state.investigation ?? buildInvestigation(state.payload);
  let pages;
  let kind;
  if (state.questStage === 'unstarted') {
    pages = investigation.intro;
    kind = 'quest-intro';
  } else if (state.questStage === 'reportable') {
    pages = investigation.report;
    kind = 'quest-report';
  } else if (state.questStage === 'completed') {
    pages = [Object.freeze({
      className: 'observed',
      label: '記録済み',
      body: '報告は宿帳に残っています。未確認を故障と決めつけず、次の調査に備えましょう。'
    })];
    kind = 'quest-repeat';
  } else {
    const remaining = 3 - state.foundClues.size;
    pages = [Object.freeze({
      className: 'unknown',
      label: '調査中',
      body: `手掛かりは ${state.foundClues.size}/3 です。残り${remaining}か所を調べ、この帳場へ戻ってください。`
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

function openClueDialogue(clue) {
  const alreadyRecorded = state.foundClues.has(clue.id);
  if (!alreadyRecorded) state.foundClues.add(clue.id);
  if (state.questStage === 'investigating' && state.foundClues.size === 3) state.questStage = 'reportable';
  const investigation = state.investigation ?? buildInvestigation(state.payload);
  const site = investigation.sites[clue.id];
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
    const blockedNearby = nearbyInteraction(state.player, state.mode);
    setStatus(isClosedEntranceId(blockedNearby?.id)
      ? `${blockedNearby.place}。${blockedNearby.label}`
      : 'ここは通れません。別の道を探してください。');
  }
}

function drawLedgerCompletion(timestamp) {
  if (state.questStage !== 'completed') return;
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
    if (state.dialogueKind === 'quest-intro') {
      state.questStage = state.foundClues.size === 3 ? 'reportable' : 'investigating';
    }
    if (state.dialogueKind === 'quest-report') {
      state.questStage = 'completed';
      // state.lastTimestamp, not performance.now(): drawWorld() compares
      // this against its own `timestamp` argument (the rAF clock) to time
      // the completion celebration, so both sides must agree on what clock
      // "now" means -- see performAction's own comment on the same point.
      state.completionStartedAt = state.lastTimestamp;
    }
    const completedKind = state.dialogueKind;
    state.dialogueKind = null;
    elements.dialogueStatus.hidden = true;
    elements.mission.hidden = false;
    updateQuestMission();
    setStatus(completedKind === 'quest-report'
      ? '調査完了。3つの手掛かりを宿帳へ記録しました。'
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
  if (!state.ready || dialogueOpen() || timestamp < state.transitionUntil || !state.nearby) return;
  // enter-inn/exit-inn normally fire on their own via updateAutoTransition;
  // this stays as an explicit, unconditional fallback (e.g. the player
  // paused right at the threshold and doorAuto is mid-cooldown).
  if (state.nearby.id === 'enter-inn') beginModeTransition('interior', timestamp);
  if (state.nearby.id === 'exit-inn') beginModeTransition('exterior', timestamp);
  if (state.nearby.id === 'talk-innkeeper') openInnkeeperDialogue();
  if (state.nearby.id.startsWith('clue-')) openClueDialogue(state.nearby);
}

function drawWorld(timestamp) {
  const { width, height, dpr } = state.viewport;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#080c13';
  context.fillRect(0, 0, width, height);

  state.camera = createCamera(width, height, state.cameraFocus, state.zoom);
  context.save();
  context.scale(state.camera.zoom, state.camera.zoom);
  context.translate(-state.camera.x, -state.camera.y);
  drawWorldImage(context, state.assets.worldMaster);
  if (state.mode === 'exterior') {
    context.drawImage(state.assets.innExteriorClosed, 8, 72);
  } else {
    context.drawImage(state.assets.innCounterClean, 200, 255);
    drawLedgerCompletion(timestamp);
    const celebrating = state.completionStartedAt > 0
      && timestamp - state.completionStartedAt < 1_800;
    const npcColumn = dialogueOpen()
      ? [1, 2, 3, 2][Math.floor(timestamp / 180) % 4]
      : celebrating
        ? [1, 3, 2, 3, 1, 0][Math.floor((timestamp - state.completionStartedAt) / 120) % 6]
        : state.nearby?.id === 'talk-innkeeper' ? 2 : 0;
    context.drawImage(
      state.assets.bartender,
      npcColumn * 96,
      0,
      96,
      64,
      176,
      260,
      96,
      64
    );
  }
  const playerBehindStreetlamp = state.player.y < INN_CONTRACT.objects.routeStreetlampFoot.y;
  if (!playerBehindStreetlamp) {
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
    const progress = 1 - (state.bumpUntil - timestamp) / 300;
    context.save();
    context.strokeStyle = `rgba(255, 217, 132, ${0.9 - progress * 0.7})`;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(state.player.x, state.player.y + 1, 8 + progress * 7, Math.PI, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  if (playerBehindStreetlamp) {
    context.drawImage(
      state.assets.routeStreetlamp,
      INN_CONTRACT.objects.routeStreetlampOrigin.x,
      INN_CONTRACT.objects.routeStreetlampOrigin.y
    );
  }
  if (state.mode === 'interior') {
    context.drawImage(
      state.assets.entranceForeground,
      INN_CONTRACT.objects.entranceForegroundOrigin.x,
      INN_CONTRACT.objects.entranceForegroundOrigin.y
    );
  }
  if (state.mode === 'exterior') drawClueMarkers();
  context.restore();

  const fadeAlpha = currentFadeAlpha(timestamp);
  if (fadeAlpha > 0) {
    context.save();
    context.fillStyle = `rgba(8, 12, 19, ${fadeAlpha})`;
    context.fillRect(0, 0, width, height);
    context.restore();
  }

  if (dialogueOpen()) drawDialogue();
  else if (state.nearby?.id === 'talk-innkeeper') drawNpcSpeechPrompt();
}

// Small always-on "already investigated" checkmarks over each found clue,
// drawn in world space (inside drawWorld's camera transform) so they scroll
// and scale with the scene like any other prop.
function drawClueMarkers() {
  for (const clue of CLUE_INTERACTIONS) {
    if (!state.foundClues.has(clue.id)) continue;
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

function frame(rawTimestamp) {
  if (!state.ready || state.stopped) return;
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
  drawWorld(timestamp);
  state.animationFrame = window.requestAnimationFrame(frame);
}

function normalizedKey(event) {
  return String(event.key ?? '').toLowerCase();
}

function onKeyDown(event) {
  if (!state.ready || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = normalizedKey(event);
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

function changeZoom(delta) {
  state.zoom = Math.max(1, Math.min(2, state.zoom + delta));
  elements.zoomValue.value = `${state.zoom}×`;
  elements.zoomValue.textContent = `${state.zoom}×`;
  elements.zoomOut.disabled = state.zoom <= 1;
  elements.zoomIn.disabled = state.zoom >= 2;
}

function bindDirectionButton(button) {
  const release = (event) => {
    state.heldDirections.delete(event.pointerId);
    button.releasePointerCapture?.(event.pointerId);
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
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
    elements.startupMessage.textContent = 'ユーザー提供の町・本人キャラクター・宿屋オブジェクトを照合しています…';
    const payloadRequest = fetchTownPayload();
    const [payload, assets] = await Promise.all([payloadRequest, loadProductionAssets()]);
    assertTownPayload(payload);
    state.payload = payload;
    state.investigation = buildInvestigation(payload);
    state.assets = assets;
    state.ready = true;
    elements.repositoryName.textContent = payload.repository?.name || '名称未設定のリポジトリ';
    elements.assetBadge.textContent = 'user-direct画像 OK';
    elements.assetBadge.dataset.ready = 'true';
    elements.geometryBadge.textContent = 'target-town n=1';
    elements.geometryBadge.dataset.ready = 'true';
    elements.startup.hidden = true;
    elements.canvas.focus({ preventScroll: true });
    setStatus('街を開始しました。WASDまたは矢印キーで西へ進み、左上の宿屋へ向かってください。');
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
elements.action.addEventListener('click', () => performAction());
elements.zoomOut.addEventListener('click', () => changeZoom(-1));
elements.zoomIn.addEventListener('click', () => changeZoom(1));
for (const button of elements.dpad.querySelectorAll('[data-direction]')) bindDirectionButton(button);

resizeCanvas();
changeZoom(0);
boot();
