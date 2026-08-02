// Pure game state and reducer. There is no DOM, Canvas, clock, storage, or I/O
// in this file. The browser adapter supplies a validated serialized bundle.

export const LOGICAL_SIZE = Object.freeze({ width: 384, height: 216 });
export const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
export const QUEST_CHOICES = Object.freeze(['見た', 'そうらしい', 'わからない']);
export const GUILD_TAB_LABELS = Object.freeze(['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい']);
// The browser distribution serves only the self-contained 70-runtime module.
// Keep its single accepted serialized transition local instead of importing a
// build-time domain module that is intentionally absent from the web artifact.
export const RUNTIME_REPOSITORY_INSPECTION_BINDING = Object.freeze({
  id: 'repository_inspected',
  event: 'repository_inspected',
  transition: 'repository_inspected',
  facilityKind: 'town_hall',
  effect: 'town_hall_lantern_lit',
});

const KEY_TO_DIRECTION = Object.freeze({
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
});
const GAMEPAD_DIRECTION_BUTTONS = Object.freeze({ up: 12, down: 13, left: 14, right: 15 });
const EMPTY_GAMEPAD_DIRECTIONS = Object.freeze({ up: false, down: false, left: false, right: false });
const DIRECTION_VECTOR = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});
const DIALOGUE_ENDINGS = Object.freeze({
  '見た': 'です。',
  'そうらしい': 'のようです。',
  'わからない': 'まだ、わかりません。',
});
const PERSISTED_REWARD_CHANGES = Object.freeze({
  [RUNTIME_REPOSITORY_INSPECTION_BINDING.event]: RUNTIME_REPOSITORY_INSPECTION_BINDING,
});

export function createInitialState(bundle, persisted = null) {
  const game = bundle.game;
  const questIds = game.quests.map((quest) => quest.id);
  const saved = normalizePersisted(persisted, bundle.world.identity.key, questIds);
  // Answers are keyed only by compiler-provided quest IDs. Numeric indexes are
  // intentionally not accepted: reordering sites must never transfer a saved
  // answer to a different investigation.
  const answers = game.quests.map((quest) => saved?.answers?.[quest.id] ?? null);
  const answered = answers.filter(Boolean).length;
  const reported = saved?.reported === true;
  const accepted = hasSavedRequest(saved, answered, reported);
  let savedRoom = game.rooms.find((room) => room.id === saved?.roomId) ?? null;
  const firstUnanswered = answers.findIndex((answer) => answer === null);
  const hasRequests = game.quests.length > 0;
  let player = {
    plotId: game.spawn.plotId,
    x: Number.isFinite(saved?.player?.x) ? saved.player.x : game.spawn.x,
    y: Number.isFinite(saved?.player?.y) ? saved.player.y : game.spawn.y,
    direction: DIRECTIONS.includes(saved?.player?.direction) ? saved.player.direction : 'down',
    moving: false,
    footbox: { ...game.player.footbox },
  };
  if (!canOccupy(bundle, savedRoom ? 'room' : 'explore', savedRoom?.id ?? null, player, player.x, player.y)) {
    savedRoom = null;
    player = { ...player, x: game.spawn.x, y: game.spawn.y };
  }
  const phase = saved?.exited === true ? 'exit' : savedRoom ? 'room' : 'explore';
  const state = {
    phase,
    roomId: savedRoom?.id ?? null,
    cutawayIds: savedRoom ? [...savedRoom.cutawayIds] : [],
    player,
    camera: { x: 0, y: 0, scale: integerScale(saved?.scale ?? 1) },
    animationMs: 0,
    input: { up: false, down: false, left: false, right: false, shift: false, gamepad: { ...EMPTY_GAMEPAD_DIRECTIONS } },
    overlook: false,
    dialogue: null,
    quest: {
      answers,
      activeIndex: firstUnanswered < 0 ? game.quests.length : firstUnanswered,
      answered,
      reported,
      accepted,
      status: !hasRequests ? 'no_request' : reported ? 'complete' : !accepted ? 'available' : answered === game.quests.length ? 'ready_report' : 'investigating',
    },
    report: { available: hasRequests && answered === game.quests.length && !reported, completed: reported },
    guild: { open: false, tabIndex: 0 },
    exit: { exited: saved?.exited === true, revisitCount: Number.isSafeInteger(saved?.revisitCount) ? saved.revisitCount : 0 },
    townRevision: saved?.townRevision ?? 0,
    // A report records the exact observed transition that was accepted at
    // that time. Never substitute a transition from a newer repository scan.
    townChange: reported ? saved?.townChange ?? null : null,
    lastDialogue: null,
  };
  return updateCamera(state, game);
}

export function normalizePersisted(value, identity, questIds = []) {
  if (!isRecord(value) || value.version !== 1 || value.identity !== identity) return null;
  if (!Array.isArray(value.questIds) || value.questIds.length !== questIds.length || value.questIds.some((id, index) => id !== questIds[index])) return null;
  const answers = isRecord(value.answers) ? Object.fromEntries(
    Object.entries(value.answers).filter(([, answer]) => QUEST_CHOICES.includes(answer?.choice)).map(([id, answer]) => [id, {
      choice: answer.choice,
      sentence: typeof answer.sentence === 'string' ? answer.sentence : '',
    }])
  ) : {};
  return {
    identity,
    answers,
    reported: value.reported === true,
    accepted: value.accepted === true,
    exited: value.exited === true,
    revisitCount: Number.isSafeInteger(value.revisitCount) && value.revisitCount >= 0 ? value.revisitCount : 0,
    scale: integerScale(value.scale ?? 1),
    townRevision: Number.isSafeInteger(value.townRevision) && value.townRevision >= 0 ? value.townRevision : 0,
    townChange: normalizePersistedTownChange(value.townChange),
    player: isRecord(value.player) && finite(value.player.x, null) !== null && finite(value.player.y, null) !== null && DIRECTIONS.includes(value.player.direction)
      ? { x: value.player.x, y: value.player.y, direction: value.player.direction }
      : null,
    roomId: typeof value.roomId === 'string' && value.roomId.trim() !== '' ? value.roomId : null,
  };
}

export function persistenceSnapshot(state, identity, questIds = []) {
  return {
    version: 1,
    identity,
    questIds: [...questIds],
    answers: Object.fromEntries(state.quest.answers.map((answer, index) => [questIds[index], answer]).filter(([id, answer]) => typeof id === 'string' && id.length > 0 && answer !== null)),
    reported: state.quest.reported,
    accepted: state.quest.accepted,
    exited: state.exit.exited,
    revisitCount: state.exit.revisitCount,
    scale: state.camera.scale,
    townRevision: state.townRevision,
    townChange: normalizePersistedTownChange(state.townChange),
    player: { x: state.player.x, y: state.player.y, direction: state.player.direction },
    roomId: state.phase === 'room' ? state.roomId : null,
  };
}

function normalizePersistedTownChange(value) {
  if (!isRecord(value)) return null;
  const keys = ['bindingId', 'effect', 'event', 'evidence', 'facilityKind', 'id', 'state'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) return null;
  const expected = PERSISTED_REWARD_CHANGES[value.event];
  if (!expected || typeof value.id !== 'string' || value.id.trim() === '' || value.state !== 'observed'
    || value.bindingId !== expected.id || value.facilityKind !== expected.facilityKind || value.effect !== expected.effect) return null;
  if (!isRecord(value.evidence) || JSON.stringify(Object.keys(value.evidence).sort()) !== JSON.stringify(['inferred', 'observed', 'unknown'])) return null;
  for (const state of ['observed', 'inferred', 'unknown']) {
    if (!Array.isArray(value.evidence[state]) || value.evidence[state].some((entry) => typeof entry !== 'string' || entry.trim() === '')) return null;
  }
  if (value.evidence.observed.length === 0) return null;
  return {
    id: value.id,
    event: value.event,
    bindingId: value.bindingId,
    facilityKind: value.facilityKind,
    effect: value.effect,
    state: 'observed',
    evidence: {
      observed: [...value.evidence.observed],
      inferred: [...value.evidence.inferred],
      unknown: [...value.evidence.unknown],
    },
  };
}

function hasSavedRequest(saved, answered, reported) {
  return saved?.accepted === true || answered > 0 || reported;
}

export function reduceGameState(state, action, bundle) {
  if (!isRecord(action) || typeof action.type !== 'string') return state;
  const game = bundle.game;
  switch (action.type) {
    case 'KEY_DOWN':
      return onKeyDown(state, action.key);
    case 'KEY_UP':
      return onKeyUp(state, action.key);
    case 'GAMEPAD_INPUT':
      return onGamepadInput(state, action.directions);
    case 'TICK':
      return advance(state, bundle, finite(action.dtMs, 0));
    case 'MOVE':
      return moveExplicit(state, bundle, action);
    case 'INTERACT':
      return interact(state, game);
    case 'CHOOSE':
      return choose(state, game, action.choice ?? action.index);
    case 'CHOICE_MOVE':
      return moveChoice(state, action.delta);
    case 'REPORT':
      return report(state, game);
    case 'GUILD_OPEN':
      return { ...state, guild: { open: true, tabIndex: 0 }, dialogue: null };
    case 'GUILD_TAB':
      return state.guild.open ? { ...state, guild: { ...state.guild, tabIndex: clamp(Math.trunc(action.index), 0, GUILD_TAB_LABELS.length - 1) } } : state;
    case 'SCALE':
      return { ...state, camera: { ...state.camera, scale: integerScale(state.camera.scale + Math.sign(finite(action.delta, 0))) } };
    case 'OVERLOOK':
      return { ...state, overlook: !state.overlook };
    case 'BACK':
      return back(state, game);
    case 'EXIT':
      return { ...state, phase: 'exit', roomId: null, cutawayIds: [], dialogue: null, guild: { open: false, tabIndex: 0 }, exit: { ...state.exit, exited: true } };
    case 'REVISIT':
      return state.phase === 'exit'
        ? { ...state, phase: 'explore', exit: { ...state.exit, exited: false, revisitCount: state.exit.revisitCount + 1 }, dialogue: null }
        : state;
    default:
      return state;
  }
}

export function evidenceSentence(statement, choice) {
  const ending = DIALOGUE_ENDINGS[choice];
  if (!ending) return '';
  const text = String(statement ?? '').trim().replace(/[。！？!?]+$/u, '');
  if (choice === 'わからない') return ending;
  return `${text}${ending}`;
}

/**
 * Convert one Standard Gamepad snapshot into edge-triggered runtime actions.
 * This function is deliberately pure so the browser adapter can poll an
 * unavailable or disconnected Gamepad API without leaking browser state into
 * the reducer. `previous` is the snapshot returned by the prior call.
 */
export function gamepadToActions(gamepad, previous = null) {
  const current = readGamepadInput(gamepad);
  const prior = previous && isRecord(previous) ? previous : readGamepadInput(null);
  const actions = [];
  if (!sameDirections(current.directions, prior.directions)) actions.push({ type: 'GAMEPAD_INPUT', directions: { ...current.directions } });
  if (current.a && !prior.a) actions.push({ type: 'INTERACT' });
  if (current.b && !prior.b) actions.push({ type: 'BACK' });
  if (current.start && !prior.start) actions.push({ type: 'OVERLOOK' });
  return Object.freeze({ snapshot: current, actions: Object.freeze(actions.map((action) => Object.freeze(action))) });
}

/** Alias with an explicit input-oriented name for pure adapter tests. */
export const mapGamepadInput = gamepadToActions;

export function readGamepadInput(gamepad) {
  const directions = { ...EMPTY_GAMEPAD_DIRECTIONS };
  const connected = isRecord(gamepad) && gamepad.connected !== false;
  if (connected) {
    for (const [direction, index] of Object.entries(GAMEPAD_DIRECTION_BUTTONS)) directions[direction] = buttonPressed(gamepad.buttons?.[index]);
    const axes = Array.isArray(gamepad.axes) ? gamepad.axes : [];
    if (Number.isFinite(axes[0])) {
      if (axes[0] <= -0.5) directions.left = true;
      if (axes[0] >= 0.5) directions.right = true;
    }
    if (Number.isFinite(axes[1])) {
      if (axes[1] <= -0.5) directions.up = true;
      if (axes[1] >= 0.5) directions.down = true;
    }
  }
  return Object.freeze({
    connected,
    directions: Object.freeze(directions),
    a: connected && buttonPressed(gamepad?.buttons?.[0]),
    b: connected && buttonPressed(gamepad?.buttons?.[1]),
    start: connected && buttonPressed(gamepad?.buttons?.[9]),
  });
}

function onKeyDown(state, key) {
  if (state.phase === 'exit' && ['Enter', 'Space', 'KeyE', 'KeyZ'].includes(key)) return reduceGameState(state, { type: 'REVISIT' }, { game: null });
  if (state.dialogue?.kind === 'quest') {
    if (['ArrowUp', 'ArrowLeft', 'KeyW', 'KeyA'].includes(key)) return moveChoice(state, -1);
    if (['ArrowDown', 'ArrowRight', 'KeyS', 'KeyD'].includes(key)) return moveChoice(state, 1);
  }
  const direction = KEY_TO_DIRECTION[key];
  if (direction) return { ...state, input: { ...state.input, [direction]: true }, player: { ...state.player, direction } };
  if (key === 'ShiftLeft' || key === 'ShiftRight') return { ...state, input: { ...state.input, shift: true } };
  return state;
}

function onKeyUp(state, key) {
  const direction = KEY_TO_DIRECTION[key];
  if (direction) return { ...state, input: { ...state.input, [direction]: false }, player: { ...state.player, moving: false } };
  if (key === 'ShiftLeft' || key === 'ShiftRight') return { ...state, input: { ...state.input, shift: false } };
  return state;
}

function onGamepadInput(state, directions) {
  const gamepad = Object.fromEntries(DIRECTIONS.map((direction) => [direction, directions?.[direction] === true]));
  const input = { ...state.input, gamepad };
  const direction = DIRECTIONS.find((entry) => input[entry] || gamepad[entry]);
  return {
    ...state,
    input,
    player: { ...state.player, direction: direction ?? state.player.direction, moving: direction ? state.player.moving : false },
  };
}

function advance(state, bundle, dtMs) {
  const game = bundle.game;
  const elapsed = Math.max(0, Math.min(dtMs, 250));
  const animated = { ...state, animationMs: (state.animationMs + elapsed) % 3_600_000 };
  if (state.phase !== 'explore' && state.phase !== 'room') return { ...animated, player: { ...state.player, moving: false } };
  if (state.dialogue || state.guild.open) return { ...animated, player: { ...state.player, moving: false } };
  const direction = activeDirection(state);
  if (!direction || elapsed <= 0) return { ...animated, player: { ...state.player, moving: false } };
  const speed = state.input.shift ? game.player.speeds.walk : game.player.speeds.run;
  const distance = speed * elapsed / 1000;
  return moveInDirection(animated, bundle, direction, distance);
}

function moveExplicit(state, bundle, action) {
  const game = bundle.game;
  const direction = DIRECTIONS.includes(action.direction) ? action.direction : state.player.direction;
  const seconds = Math.max(0, Math.min(finite(action.seconds, 0), 0.25));
  const speed = action.walk === true ? game.player.speeds.walk : game.player.speeds.run;
  return moveInDirection(state, bundle, direction, speed * seconds);
}

function moveInDirection(state, bundle, direction, distance) {
  const game = bundle.game;
  const vector = DIRECTION_VECTOR[direction];
  let x = state.player.x;
  let y = state.player.y;
  // Walk in small deterministic increments so a single frame cannot tunnel
  // through a one-pixel collision rectangle. The logical world is pixel based,
  // but the final increment remains fractional for the canonical 75/45 speeds.
  let remaining = Math.max(0, distance);
  while (remaining > 0) {
    const step = Math.min(1, remaining);
    const nextX = x + vector.x * step;
    const nextY = y + vector.y * step;
    if (!canOccupy(bundle, state.phase, state.roomId, state.player, nextX, nextY)) break;
    x = nextX;
    y = nextY;
    remaining -= step;
  }
  const moved = x !== state.player.x || y !== state.player.y;
  let next = { ...state, player: { ...state.player, x, y, direction, moving: moved } };
  next = maybeEnterRoom(next, game);
  return updateCamera(next, game);
}

function maybeEnterRoom(state, game) {
  if (state.phase !== 'explore') return state;
  const foot = playerFootRect(state.player);
  const entrance = game.entrances.find((entry) => intersects(foot, entry.rect));
  if (!entrance) return state;
  return {
    ...state,
    phase: 'room',
    roomId: entrance.roomId,
    cutawayIds: [...entrance.cutawayIds],
    player: { ...state.player, x: entrance.interiorSpawn.x, y: entrance.interiorSpawn.y, moving: false },
    dialogue: null,
  };
}

function interact(state, game) {
  if (state.phase === 'exit') return { ...state, phase: 'explore', exit: { ...state.exit, exited: false, revisitCount: state.exit.revisitCount + 1 } };
  if (state.guild.open) return state;
  if (state.dialogue?.kind === 'feedback') return { ...state, dialogue: null, lastDialogue: state.dialogue };
  if (state.dialogue?.kind === 'request') return acceptRequest(state);
  if (state.dialogue?.kind === 'quest') return choose(state, game, state.dialogue.choiceIndex);
  if (state.dialogue?.kind === 'report') return report(state, game);
  if (state.dialogue) return state;
  const foot = playerFootRect(state.player);
  const outdoors = state.phase === 'explore';
  if (outdoors && state.quest.status === 'available' && intersects(foot, game.request.rect)) return { ...state, dialogue: { kind: 'request', prompt: game.request.prompt, lines: ['街の三か所を、確かめてくれますか。'] } };
  const questIndex = outdoors && state.quest.accepted ? game.quests.findIndex((quest, index) => !state.quest.answers[index] && intersects(foot, quest.rect)) : -1;
  if (questIndex >= 0) return openQuestDialogue(state, game, questIndex);
  if (outdoors && state.quest.status === 'ready_report' && intersects(foot, game.report.rect)) return { ...state, phase: 'report', dialogue: { kind: 'report', prompt: game.report.prompt, lines: ['調査の記録を役場へ届けますか。'] } };
  const npc = game.npcs.find((entry) => {
    const inActiveRoom = state.phase === 'room' && entry.cutawayId === state.roomId;
    const outsideActiveRoom = outdoors && !entry.cutawayId;
    return (inActiveRoom || outsideActiveRoom) && intersects(foot, entry.interactionRect);
  });
  if (npc) {
    if (npc.kind === 'guild') return { ...state, guild: { open: true, tabIndex: 0 } };
    // A sparse repository model may not have dialogue copy for a resident.
    // Keep the interaction readable without inventing a claim about the
    // inspected repository.
    const lines = npc.dialogue.length > 0 ? [...npc.dialogue] : ['住民に話しかけました。'];
    return { ...state, dialogue: { kind: 'npc', npcId: npc.id, prompt: npc.prompt, lines } };
  }
  return state;
}

function acceptRequest(state) {
  if (state.quest.status !== 'available') return state;
  return {
    ...state,
    dialogue: { kind: 'feedback', prompt: '掲示板の依頼', lines: ['気づいたままを、聞かせてください。'] },
    quest: { ...state.quest, accepted: true, status: 'investigating' },
  };
}

function openQuestDialogue(state, game, index) {
  const quest = game.quests[index];
  return { ...state, dialogue: { kind: 'quest', questIndex: index, prompt: quest.subject, lines: [quest.statement], choices: [...QUEST_CHOICES], choiceIndex: 0 } };
}

function moveChoice(state, delta) {
  if (state.dialogue?.kind !== 'quest') return state;
  const direction = Math.sign(finite(delta, 0));
  if (!direction) return state;
  const choiceIndex = (state.dialogue.choiceIndex + direction + QUEST_CHOICES.length) % QUEST_CHOICES.length;
  return { ...state, dialogue: { ...state.dialogue, choiceIndex } };
}

function choose(state, game, value) {
  if (state.dialogue?.kind !== 'quest') return state;
  const index = state.dialogue.questIndex;
  const choice = typeof value === 'number' ? QUEST_CHOICES[clamp(Math.trunc(value), 0, QUEST_CHOICES.length - 1)] : QUEST_CHOICES.includes(value) ? value : null;
  if (!choice || !game.quests[index]) return state;
  const quest = game.quests[index];
  const answer = { choice, sentence: evidenceSentence(quest.statement, choice) };
  const answers = state.quest.answers.slice();
  answers[index] = answer;
  const answered = answers.filter(Boolean).length;
  const complete = game.quests.length > 0 && answered === game.quests.length;
  const next = {
    ...state,
    dialogue: { kind: 'feedback', prompt: quest.subject, lines: [answer.sentence], answer },
    quest: { answers, activeIndex: complete ? game.quests.length : answers.findIndex((entry) => entry === null), answered, reported: state.quest.reported, accepted: true, status: complete ? 'ready_report' : 'investigating' },
    report: { available: complete && !state.quest.reported, completed: state.quest.reported },
  };
  return next;
}

function report(state, game) {
  if (state.quest.status !== 'ready_report' || state.quest.reported) return state;
  const hasTownChange = game.report.change != null;
  return {
    ...state,
    phase: 'explore',
    dialogue: { kind: 'feedback', prompt: game.report.prompt, lines: ['記録を役場へ届けました。'] },
    quest: { ...state.quest, reported: true, status: 'complete' },
    report: { available: false, completed: true },
    townRevision: hasTownChange ? state.townRevision + 1 : state.townRevision,
    townChange: hasTownChange ? game.report.change : null,
  };
}

function back(state, game) {
  if (state.dialogue) return { ...state, dialogue: null };
  if (state.guild.open) return { ...state, guild: { open: false, tabIndex: 0 } };
  if (state.phase === 'room') {
    const entrance = game.entrances.find((entry) => entry.roomId === state.roomId);
    const exterior = entrance?.exteriorSpawn;
    return {
      ...state,
      phase: 'explore',
      roomId: null,
      cutawayIds: [],
      player: {
        ...state.player,
        ...(exterior ? { x: exterior.x, y: exterior.y } : {}),
        moving: false,
      },
    };
  }
  return state;
}

function activeDirection(state) {
  const gamepad = state.input.gamepad ?? EMPTY_GAMEPAD_DIRECTIONS;
  if (state.input[state.player.direction] || gamepad[state.player.direction]) return state.player.direction;
  return DIRECTIONS.find((direction) => state.input[direction] || gamepad[direction]) ?? null;
}

function canOccupy(bundle, phase, roomId, player, x, y) {
  const game = bundle.game;
  const foot = playerFootRect({ ...player, x, y });
  if (phase === 'room') {
    const room = game.rooms.find((entry) => entry.id === roomId);
    if (!room || !contains(room.bounds, foot)) return false;
    const roomCollisions = bundle.collisions?.interiorByRoom?.find((entry) => entry.roomId === roomId);
    if (!roomCollisions || !Array.isArray(roomCollisions.solidRects)) return false;
    return !roomCollisions.solidRects.some((rect) => intersects(foot, rect));
  }
  if (foot.x < 0 || foot.y < 0 || foot.x + foot.width > game.worldSize.width || foot.y + foot.height > game.worldSize.height) return false;
  return !game.collisions.some((rect) => intersects(foot, rect));
}

function playerFootRect(player) {
  return { x: player.x + player.footbox.x, y: player.y + player.footbox.y, width: player.footbox.width, height: player.footbox.height };
}

function updateCamera(state, game) {
  const foot = playerFootRect(state.player);
  const lead = DIRECTION_VECTOR[state.player.direction] ?? DIRECTION_VECTOR.down;
  const dead = { left: 96, right: 288, top: 54, bottom: 162 };
  let x = state.camera.x;
  let y = state.camera.y;
  const screenX = foot.x - x;
  const screenY = foot.y - y;
  if (screenX < dead.left) x = foot.x - dead.left + lead.x * 8;
  if (screenX + foot.width > dead.right) x = foot.x + foot.width - dead.right + lead.x * 8;
  if (screenY < dead.top) y = foot.y - dead.top + lead.y * 8;
  if (screenY + foot.height > dead.bottom) y = foot.y + foot.height - dead.bottom + lead.y * 8;
  x = clamp(x, 0, Math.max(0, game.worldSize.width - LOGICAL_SIZE.width));
  y = clamp(y, 0, Math.max(0, game.worldSize.height - LOGICAL_SIZE.height));
  return { ...state, camera: { ...state.camera, x, y } };
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function integerScale(value) { return clamp(Number.isFinite(value) ? Math.round(value) : 1, 1, 4); }
function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function buttonPressed(button) {
  if (isRecord(button)) return button.pressed === true || (Number.isFinite(button.value) && button.value >= 0.5);
  return button === true;
}

function sameDirections(left, right) {
  return DIRECTIONS.every((direction) => left?.[direction] === right?.[direction]);
}
