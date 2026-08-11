// Pure game state and reducer. There is no DOM, Canvas, clock, storage, or I/O
// in this file. The browser adapter supplies a validated serialized bundle.

const CUTAWAY_TRANSITION_MS = 180;
const DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);
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
const DIRECTION_VECTOR = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});
const PERSISTED_REWARD_CHANGES = Object.freeze({
  [RUNTIME_REPOSITORY_INSPECTION_BINDING.event]: RUNTIME_REPOSITORY_INSPECTION_BINDING,
});

function minimumView(game) {
  return game.camera.minimumView;
}

function quantizeCameraOrigin(value, zoom) {
  const quantum = Math.max(1, Math.round(1 / zoom));
  return Math.round(value / quantum) * quantum;
}

function quantizedOverviewZoom(bounds, viewport) {
  const ratio = Math.max(bounds.width / viewport.width, bounds.height / viewport.height);
  let exponent = !Number.isFinite(ratio) || ratio <= 1 ? 0 : Math.max(0, Math.ceil(Math.log2(ratio)));
  while (true) {
    const zoom = 1 / (2 ** exponent);
    const quantum = Math.max(1, Math.round(1 / zoom));
    const visibleWorld = { width: viewport.width / zoom, height: viewport.height / zoom };
    const origin = {
      x: Math.round((bounds.x + (bounds.width - visibleWorld.width) / 2) / quantum) * quantum,
      y: Math.round((bounds.y + (bounds.height - visibleWorld.height) / 2) / quantum) * quantum,
    };
    if (origin.x <= bounds.x && origin.y <= bounds.y
      && origin.x + visibleWorld.width >= bounds.x + bounds.width
      && origin.y + visibleWorld.height >= bounds.y + bounds.height) return zoom;
    exponent += 1;
  }
}

function overviewCamera(game, viewport) {
  const overview = game.camera.overview;
  const minimum = minimumView(game);
  if (viewport.width === minimum.width && viewport.height === minimum.height) {
    return { mode: 'overview', zoom: overview.zoom, x: overview.origin.x, y: overview.origin.y };
  }
  const zoom = quantizedOverviewZoom(overview.bounds, viewport);
  const visibleWorld = {
    width: viewport.width / zoom,
    height: viewport.height / zoom,
  };
  return {
    mode: 'overview',
    zoom,
    x: quantizeCameraOrigin(overview.bounds.x + (overview.bounds.width - visibleWorld.width) / 2, zoom),
    y: quantizeCameraOrigin(overview.bounds.y + (overview.bounds.height - visibleWorld.height) / 2, zoom),
  };
}

function normalizeViewport(value, fallback) {
  if (!isRecord(value)) return { ...fallback };
  return {
    width: Math.max(1, Math.floor(Number.isFinite(value.width) ? value.width : fallback.width)),
    height: Math.max(1, Math.floor(Number.isFinite(value.height) ? value.height : fallback.height)),
  };
}

export function createInitialState(bundle, persisted = null) {
  const game = bundle.game;
  const questIds = game.quests.map((quest) => quest.id);
  const saved = normalizePersisted(persisted, bundle.world.identity.key, questIds);
  // Persistence stores only which compiler-owned facts were discovered. The
  // sentence, truth state, and action are always rebuilt from this bundle, so
  // browser storage can never replace the inspector's finding.
  const discoveredIds = new Set(saved?.discoveredQuestIds ?? []);
  const discoveries = game.quests.map((quest) => discoveredIds.has(quest.id) ? canonicalDiscovery(quest) : null);
  const discoveredCount = discoveries.filter(Boolean).length;
  const allDiscovered = game.quests.length > 0 && discoveredCount === game.quests.length;
  const reported = saved?.reported === true && allDiscovered && saved.townChange !== null;
  const accepted = hasSavedRequest(saved, discoveredCount, reported);
  // Resident positions are transient and always restart from compiler-authored
  // bodies. Build those bodies before accepting a persisted player position so
  // a save cannot respawn the player inside a live resident on the same plane.
  const residents = game.npcs.map((npc) => ({
    id: npc.id,
    assetId: npc.assetId,
    position: { ...npc.position },
    body: { ...npc.body },
    footPivot: { ...npc.footPivot },
    interactionRect: { ...npc.interactionRect },
    direction: npc.direction,
    facing: npc.facing ?? npc.direction,
    action: npc.action ?? (npc.animationState === 'walk' ? 'walk' : npc.animationState),
    animationState: npc.animationState ?? 'idle',
    behavior: npc.behavior,
    talking: false,
    path: { kind: npc.path?.kind ?? 'still', points: (npc.path?.points ?? [npc.position]).map((entry) => ({ ...entry })) },
    speed: Number.isFinite(npc.speed) ? npc.speed : 0,
    phase: Number.isFinite(npc.phase) ? npc.phase : 0,
    pathIndex: 0,
    pathDirection: 1,
    interiorId: npc.interiorId ?? null,
    reach: Number.isFinite(npc.reach) ? npc.reach : 18,
  }));
  let savedInterior = game.interiors.find((interior) => interior.id === saved?.interiorId) ?? null;
  const hasRequests = game.quests.length > 0;
  let player = {
    x: Number.isFinite(saved?.player?.x) ? saved.player.x : game.spawn.x,
    y: Number.isFinite(saved?.player?.y) ? saved.player.y : game.spawn.y,
    direction: DIRECTIONS.includes(saved?.player?.direction) ? saved.player.direction : 'down',
    moving: false,
    footbox: { ...game.player.footbox },
  };
  const initialResidentState = { residents };
  if (!canOccupy(bundle, savedInterior?.id ?? null, player, player.x, player.y, initialResidentState)) {
    savedInterior = null;
    player = { ...player, x: game.spawn.x, y: game.spawn.y };
    if (!canOccupy(bundle, null, player, player.x, player.y, initialResidentState)) {
      throw new TypeError('SceneBundle spawn must be walkable and clear of initial residents');
    }
  }
  const state = {
    phase: 'explore',
    interiorId: savedInterior?.id ?? null,
    cutawayInteriorId: savedInterior?.id ?? null,
    cutawayProgress: savedInterior ? 1 : 0,
    player,
    // Resident positions, directions, actions, and path cursors are transient
    // runtime state. They are intentionally absent from persistenceSnapshot.
    residents,
    viewport: { ...minimumView(game) },
    camera: overviewCamera(game, minimumView(game)),
    animationMs: 0,
    input: { up: false, down: false, left: false, right: false, shift: false },
    dialogue: null,
    quest: {
      discoveries,
      reported,
      accepted,
      status: !hasRequests ? 'no_request' : reported ? 'complete' : !accepted ? 'available' : allDiscovered ? 'ready_report' : 'investigating',
    },
    // A report records the exact observed transition that was accepted at
    // that time. Never substitute a transition from a newer repository scan.
    townChange: reported ? saved?.townChange ?? null : null,
  };
  return updateCamera(state, game);
}

function normalizePersisted(value, identity, questIds = []) {
  if (!isRecord(value) || value.version !== 3 || value.identity !== identity) return null;
  if (!Array.isArray(value.questIds) || value.questIds.length !== questIds.length || value.questIds.some((id, index) => id !== questIds[index])) return null;
  const requestedDiscoveries = new Set(Array.isArray(value.discoveredQuestIds)
    ? value.discoveredQuestIds.filter((id) => typeof id === 'string')
    : []);
  const discoveredQuestIds = questIds.filter((id) => requestedDiscoveries.has(id));
  return {
    identity,
    discoveredQuestIds,
    reported: value.reported === true,
    accepted: value.accepted === true,
    townChange: normalizePersistedTownChange(value.townChange),
    player: isRecord(value.player) && finite(value.player.x, null) !== null && finite(value.player.y, null) !== null && DIRECTIONS.includes(value.player.direction)
      ? { x: value.player.x, y: value.player.y, direction: value.player.direction }
      : null,
    interiorId: typeof value.interiorId === 'string' && value.interiorId.trim() !== '' ? value.interiorId : null,
  };
}

export function persistenceSnapshot(state, identity, questIds = []) {
  const discovered = new Set(state.quest.discoveries
    .filter((entry) => isRecord(entry) && typeof entry.questId === 'string')
    .map((entry) => entry.questId));
  return {
    version: 3,
    identity,
    questIds: [...questIds],
    discoveredQuestIds: questIds.filter((id) => discovered.has(id)),
    reported: state.quest.reported,
    accepted: state.quest.accepted,
    townChange: normalizePersistedTownChange(state.townChange),
    player: { x: state.player.x, y: state.player.y, direction: state.player.direction },
    interiorId: state.interiorId,
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

function hasSavedRequest(saved, discovered, reported) {
  return saved?.accepted === true || discovered > 0 || reported;
}

export function reduceGameState(state, action, bundle) {
  if (!isRecord(action) || typeof action.type !== 'string') return state;
  const game = bundle.game;
  switch (action.type) {
    case 'KEY_DOWN':
      return onKeyDown(state, action.key, game);
    case 'KEY_UP':
      return onKeyUp(state, action.key);
    case 'TICK':
      return advance(state, bundle, finite(action.dtMs, 0));
    case 'INTERACT':
      return interact(state, game);
    case 'BACK':
      return back(state, game);
    case 'EXIT':
      return {
        ...state,
        phase: 'exit',
        dialogue: { kind: 'exit', prompt: '街を出る', lines: ['街を閉じています…'] },
      };
    case 'VIEWPORT_CHANGED':
      return changeViewport(state, action.viewport, game);
    default:
      return state;
  }
}

function onKeyDown(state, key, game) {
  const direction = KEY_TO_DIRECTION[key];
  if (direction) {
    const next = {
      ...state,
      input: { ...state.input, [direction]: true },
      player: { ...state.player, direction },
    };
    if (state.camera.mode !== 'overview') return next;
    return updateCamera({
      ...next,
      camera: { ...state.camera, mode: 'follow', zoom: game.camera.follow.zoom },
    }, game);
  }
  if (key === 'ShiftLeft' || key === 'ShiftRight') return { ...state, input: { ...state.input, shift: true } };
  return state;
}

function changeViewport(state, value, game) {
  const viewport = normalizeViewport(value, minimumView(game));
  if (viewport.width === state.viewport.width && viewport.height === state.viewport.height) return state;
  const next = { ...state, viewport };
  if (state.camera.mode === 'overview') return { ...next, camera: overviewCamera(game, viewport) };
  return updateCamera(next, game);
}

function onKeyUp(state, key) {
  const direction = KEY_TO_DIRECTION[key];
  if (direction) return { ...state, input: { ...state.input, [direction]: false }, player: { ...state.player, moving: false } };
  if (key === 'ShiftLeft' || key === 'ShiftRight') return { ...state, input: { ...state.input, shift: false } };
  return state;
}

function advance(state, bundle, dtMs) {
  const game = bundle.game;
  const elapsed = Math.max(0, Math.min(dtMs, 250));
  let animated = advanceCutaway({ ...state, animationMs: (state.animationMs + elapsed) % 3_600_000 }, elapsed);
  if (state.phase !== 'explore' || state.dialogue) return { ...animated, player: { ...state.player, moving: false } };
  animated = advanceResidents(animated, bundle, elapsed);
  const direction = activeDirection(state);
  if (!direction || elapsed <= 0) return { ...animated, player: { ...state.player, moving: false } };
  const speed = state.input.shift ? game.player.speeds.walk : game.player.speeds.run;
  const distance = speed * elapsed / 1000;
  return moveInDirection(animated, bundle, direction, distance);
}

function residentPositionAtAnchor(npc, anchor) {
  const pivot = npc.footPivot ?? { x: 0, y: 0 };
  return { x: anchor.x - pivot.x, y: anchor.y - pivot.y };
}

function residentBodyAt(npc, position) {
  const offset = {
    x: npc.body.x - npc.position.x,
    y: npc.body.y - npc.position.y,
  };
  return {
    x: position.x + offset.x,
    y: position.y + offset.y,
    width: npc.body.width,
    height: npc.body.height,
  };
}

function residentInteractionAt(body, reach, facing) {
  if (facing === 'up') return { x: body.x, y: body.y - reach, width: body.width, height: reach };
  if (facing === 'down') return { x: body.x, y: body.y + body.height, width: body.width, height: reach };
  if (facing === 'left') return { x: body.x - reach, y: body.y, width: reach, height: body.height };
  return { x: body.x + body.width, y: body.y, width: reach, height: body.height };
}

function residentDirection(from, to, fallback) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx < 0 ? 'left' : 'right';
  if (dy !== 0) return dy < 0 ? 'up' : 'down';
  return fallback;
}

function residentPlane(game, resident, body) {
  if (resident.interiorId) {
    const interior = game.interiors.find((entry) => entry.id === resident.interiorId);
    return Boolean(interior && contains(interior.bounds, body)
      && !interior.collisions.some((entry) => intersects(entry, body)));
  }
  if (body.x < 0 || body.y < 0 || body.x + body.width > game.worldSize.width || body.y + body.height > game.worldSize.height) return false;
  if (game.collisions.some((entry) => intersects(entry, body)) || blockedBySurface(game, body)) return false;
  return !game.interiors.some((entry) => intersects(entry.bounds, body) && !intersects(entry.access, body));
}

function residentTarget(path, index, direction) {
  const points = path.points;
  if (!Array.isArray(points) || points.length < 2) return null;
  let nextIndex = index + direction;
  let nextDirection = direction;
  if (nextIndex >= points.length || nextIndex < 0) {
    nextDirection = -direction;
    nextIndex = index + nextDirection;
  }
  if (nextIndex < 0 || nextIndex >= points.length) return null;
  return { nextIndex, nextDirection, point: points[nextIndex] };
}

function moveResident(state, bundle, resident, elapsed, occupiedBodies) {
  if (resident.path.kind !== 'ping-pong' || resident.path.points.length < 2 || resident.speed <= 0) {
    return {
      ...resident,
      interactionRect: residentInteractionAt(resident.body, resident.reach, resident.facing ?? resident.direction ?? 'down'),
    };
  }
  let position = { ...resident.position };
  let body = { ...resident.body };
  let index = resident.pathIndex;
  let directionSign = resident.pathDirection || 1;
  let remaining = resident.speed * elapsed / 1000;
  let moved = false;
  let facing = resident.facing ?? resident.direction ?? 'down';
  while (remaining > 0) {
    const target = residentTarget(resident.path, index, directionSign);
    if (!target) break;
    const targetPosition = residentPositionAtAnchor(resident, target.point);
    const dx = targetPosition.x - position.x;
    const dy = targetPosition.y - position.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.001) {
      index = target.nextIndex;
      directionSign = target.nextDirection;
      continue;
    }
    const amount = Math.min(remaining, distance);
    const candidate = {
      x: position.x + dx / distance * amount,
      y: position.y + dy / distance * amount,
    };
    const candidateBody = residentBodyAt(resident, candidate);
    const blockedByPlayer = intersects(candidateBody, playerFootRect(state.player));
    const blockedByResident = occupiedBodies.some((entry) => entry.id !== resident.id
      && entry.interiorId === resident.interiorId && intersects(candidateBody, entry.body));
    if (!residentPlane(bundle.game, resident, candidateBody) || blockedByPlayer || blockedByResident) {
      // A mover never crosses a player or another live body. Reverse its
      // deterministic path cursor and wait for a later tick.
      directionSign = -directionSign;
      break;
    }
    facing = residentDirection(position, candidate, facing);
    position = candidate;
    body = candidateBody;
    moved = true;
    remaining -= amount;
    if (amount >= distance - 0.001) {
      index = target.nextIndex;
      directionSign = target.nextDirection;
    }
  }
  const action = moved ? 'walk' : resident.action;
  const animationState = moved ? 'walk' : (resident.action === 'work' ? 'work' : 'idle');
  return {
    ...resident,
    position,
    body,
    interactionRect: residentInteractionAt(body, resident.reach, facing),
    pathIndex: index,
    pathDirection: directionSign,
    direction: facing,
    facing,
    action,
    animationState,
  };
}

function advanceResidents(state, bundle, elapsed) {
  const occupiedBodies = state.residents.map((resident) => ({
    id: resident.id,
    body: resident.body,
    interiorId: resident.interiorId,
  }));
  const residents = state.residents.map((resident) => {
    // Talking is a transient pose. If a caller closes the framed dialogue
    // without the normal BACK transition, restore the compiler-authored
    // action/behavior on the next deterministic tick before moving.
    const restored = resident.talking && !state.dialogue
      ? restoreResidentAuthored(resident, bundle.game)
      : resident;
    const next = moveResident(state, bundle, restored, elapsed, occupiedBodies);
    const slot = occupiedBodies.find((entry) => entry.id === resident.id);
    if (slot) slot.body = next.body;
    return next;
  });
  return { ...state, residents };
}

function moveInDirection(state, bundle, direction, distance) {
  const game = bundle.game;
  const vector = DIRECTION_VECTOR[direction];
  let x = state.player.x;
  let y = state.player.y;
  let interiorId = state.interiorId;
  // Walk in small deterministic increments so a single frame cannot tunnel
  // through a one-pixel obstacle. The final increment remains fractional so
  // authored movement speed is preserved without tunnelling.
  let remaining = Math.max(0, distance);
  while (remaining > 0) {
    const step = Math.min(1, remaining);
    const nextX = x + vector.x * step;
    const nextY = y + vector.y * step;
    const nextFoot = playerFootRect({ ...state.player, x: nextX, y: nextY });
    const nextInterior = interiorAt(game, interiorId, nextFoot);
    if (!canOccupy(bundle, nextInterior?.id ?? null, state.player, nextX, nextY, state)) break;
    x = nextX;
    y = nextY;
    interiorId = nextInterior?.id ?? null;
    remaining -= step;
  }
  const moved = x !== state.player.x || y !== state.player.y;
  const entering = interiorId !== null && interiorId !== state.interiorId;
  const next = {
    ...state,
    interiorId,
    cutawayInteriorId: entering ? interiorId : state.cutawayInteriorId,
    cutawayProgress: entering && state.cutawayInteriorId !== interiorId ? 0 : state.cutawayProgress,
    player: { ...state.player, x, y, direction, moving: moved },
  };
  return updateCamera(next, game);
}

function advanceCutaway(state, elapsed) {
  const target = state.interiorId ? 1 : 0;
  const step = elapsed / CUTAWAY_TRANSITION_MS;
  const cutawayProgress = target > state.cutawayProgress
    ? Math.min(target, state.cutawayProgress + step)
    : Math.max(target, state.cutawayProgress - step);
  return {
    ...state,
    cutawayProgress,
    cutawayInteriorId: cutawayProgress === 0 && !state.interiorId ? null : state.cutawayInteriorId,
  };
}

function interact(state, game) {
  if (state.dialogue?.kind === 'feedback') {
    if (Array.isArray(state.dialogue.pages)) {
      const page = Number.isInteger(state.dialogue.page) ? state.dialogue.page : 0;
      if (page < state.dialogue.pages.length - 1) {
        return { ...state, dialogue: { ...state.dialogue, page: page + 1 } };
      }
    }
    return { ...restoreDialogueResident(state, game), dialogue: null };
  }
  if (state.dialogue?.kind === 'discovery') return { ...restoreDialogueResident(state, game), dialogue: null };
  if (state.dialogue?.kind === 'request') return acceptRequest(state);
  if (state.dialogue?.kind === 'report') return advanceReportPage(state, game);
  if (state.dialogue?.kind === 'npc') return { ...restoreDialogueResident(state, game), dialogue: null };
  if (state.dialogue) return state;
  const foot = playerFootRect(state.player);
  const outdoors = state.phase === 'explore' && state.interiorId === null;
  const inInteractionSpace = (entry) => entry.interiorId
    ? entry.interiorId === state.interiorId
    : outdoors;
  if (outdoors && state.quest.status === 'available' && intersects(foot, game.request.rect)) return { ...state, dialogue: { kind: 'request', prompt: game.request.prompt, lines: ['街の三か所にある手がかりを、それぞれの場所に合った方法で調べてくれますか。'] } };
  const questIndex = state.quest.accepted
    ? game.quests.findIndex((quest, index) => !state.quest.discoveries[index] && inInteractionSpace(quest) && intersects(foot, quest.rect))
    : -1;
  if (questIndex >= 0) return discoverQuest(state, game, questIndex);
  if (state.quest.status === 'ready_report' && inInteractionSpace(game.report) && intersects(foot, game.report.rect)) {
    return {
      ...state,
      phase: 'report',
      dialogue: {
        kind: 'report',
        prompt: game.report.prompt,
        pages: reportPages(state.quest.discoveries),
        page: 0,
      },
    };
  }
  const npc = state.residents.find((entry) => {
    const inActiveInterior = entry.interiorId && entry.interiorId === state.interiorId;
    const outsideActiveInterior = outdoors && !entry.interiorId;
    return (inActiveInterior || outsideActiveInterior) && intersects(foot, entry.interactionRect);
  });
  if (npc) {
    // A sparse repository model may not have dialogue copy for a resident.
    // Keep the interaction readable without inventing a claim about the
    // inspected repository.
    const sourceNpc = game.npcs.find((entry) => entry.id === npc.id);
    const lines = sourceNpc?.dialogue?.length > 0 ? [...sourceNpc.dialogue] : ['住民に話しかけました。'];
    const facing = residentDirection(npc.position, state.player, npc.facing ?? npc.direction ?? 'down');
    const residents = state.residents.map((entry) => entry.id === npc.id
      ? {
        ...entry,
        action: 'talk',
        animationState: 'idle',
        direction: facing,
        facing,
        interactionRect: residentInteractionAt(entry.body, entry.reach, facing),
        talking: true,
      }
      : entry);
    return { ...state, residents, dialogue: { kind: 'npc', npcId: npc.id, prompt: sourceNpc?.prompt ?? '住民に話す', lines } };
  }
  return state;
}

function acceptRequest(state) {
  if (state.quest.status !== 'available') return state;
  return {
    ...state,
    dialogue: { kind: 'feedback', prompt: '掲示板の依頼', lines: ['道具や記録に触れ、そこで確かめられることだけを持ち帰ってください。'] },
    quest: { ...state.quest, accepted: true, status: 'investigating' },
  };
}

function canonicalDiscovery(quest) {
  return {
    questId: quest.id,
    state: quest.state,
    action: quest.action,
    sentence: quest.statement,
  };
}

function discoverQuest(state, game, index) {
  if (state.quest.discoveries[index] || !game.quests[index]) return state;
  const quest = game.quests[index];
  const discovery = canonicalDiscovery(quest);
  const discoveries = state.quest.discoveries.slice();
  discoveries[index] = discovery;
  const complete = game.quests.length > 0 && discoveries.every(Boolean);
  return {
    ...state,
    dialogue: {
      kind: 'discovery',
      questId: quest.id,
      prompt: quest.subject,
      lines: [`${discovery.action}。`, discovery.sentence],
      discovery,
    },
    quest: { discoveries, reported: state.quest.reported, accepted: true, status: complete ? 'ready_report' : 'investigating' },
  };
}

function reportLines(discoveries, submitted) {
  const found = discoveries.filter(Boolean);
  const lines = [submitted
    ? '三つの場所で得た発見を、役場の一つの記録につなぎました。'
    : '三つの場所で得た発見を、一つの調査記録につなぎます。'];
  for (const discovery of found) lines.push(`${discovery.action}：${discovery.sentence}`);
  if (found.some((discovery) => discovery.state === 'inferred')) {
    lines.push('「ようです」と記した発見は、残された手がかりからの推定です。');
  }
  if (found.some((discovery) => discovery.state === 'unknown')) {
    lines.push('確認できなかったことは、わからないまま記録に残します。');
  }
  lines.push('この調査では街の由来を読んだだけで、仕組みを動かした結果や成功までは確かめていません。');
  return lines;
}

function reportPages(discoveries, submitted = false) {
  const lines = [...reportLines(discoveries, submitted), submitted
    ? '役場の灯りは、読み取りだけの調査が終わった印としてともりました。'
    : 'この内容を役場へ届けますか。'];
  // Reports have one bounded two-page presentation. This is deliberately not
  // a general pager: all compiler-authored findings and uncertainty stay in
  // these two pages and the final page owns the submit prompt.
  const split = Math.max(1, Math.ceil(lines.length / 2));
  return [lines.slice(0, split), lines.slice(split)];
}

function advanceReportPage(state, game) {
  const pages = Array.isArray(state.dialogue?.pages) ? state.dialogue.pages : reportPages(state.quest.discoveries);
  const page = Number.isInteger(state.dialogue?.page) ? state.dialogue.page : 0;
  if (page < pages.length - 1) {
    return { ...state, dialogue: { ...state.dialogue, pages, page: page + 1 } };
  }
  return report({ ...state, dialogue: { ...state.dialogue, pages, page } }, game);
}

function report(state, game) {
  if (state.quest.status !== 'ready_report' || state.quest.reported) return state;
  const hasTownChange = game.report.change != null;
  return {
    ...state,
    phase: 'explore',
    dialogue: {
      kind: 'feedback',
      prompt: game.report.prompt,
      pages: reportPages(state.quest.discoveries, true),
      page: 0,
    },
    quest: { ...state.quest, reported: true, status: 'complete' },
    townChange: hasTownChange ? game.report.change : null,
  };
}

function restoreResidentAuthored(resident, game) {
  const authored = game.npcs.find((entry) => entry.id === resident.id);
  if (!authored) return resident;
  return {
    ...resident,
    action: authored.action,
    animationState: authored.animationState,
    behavior: authored.behavior,
    direction: authored.direction,
    facing: authored.facing ?? authored.direction,
    interactionRect: residentInteractionAt(resident.body, resident.reach, authored.facing ?? authored.direction),
    talking: false,
  };
}

function restoreDialogueResident(state, game) {
  const npcId = state.dialogue?.npcId;
  if (!npcId) return state;
  return {
    ...state,
    residents: state.residents.map((resident) => resident.id === npcId
      ? restoreResidentAuthored(resident, game)
      : resident),
  };
}

function back(state, game) {
  if (state.dialogue) {
    // The report prompt temporarily uses its own phase so the report frame
    // can render. Cancelling that prompt must restore free exploration;
    // otherwise movement and every outdoor interaction remain disabled.
    const restored = restoreDialogueResident(state, game);
    return state.dialogue.kind === 'report' && state.phase === 'report'
      ? { ...restored, phase: 'explore', dialogue: null }
      : { ...restored, dialogue: null };
  }
  return state;
}

function activeDirection(state) {
  if (state.input[state.player.direction]) return state.player.direction;
  return DIRECTIONS.find((direction) => state.input[direction]) ?? null;
}

function canOccupy(bundle, interiorId, player, x, y, state = null) {
  const game = bundle.game;
  const foot = playerFootRect({ ...player, x, y });
  if (interiorId) {
    const interior = game.interiors.find((entry) => entry.id === interiorId);
    if (!interior || (!contains(interior.bounds, foot) && !intersects(interior.access, foot))) return false;
    if (!Array.isArray(interior.collisions)) return false;
    if (interior.collisions.some((rect) => intersects(foot, rect))) return false;
  } else {
    if (foot.x < 0 || foot.y < 0 || foot.x + foot.width > game.worldSize.width || foot.y + foot.height > game.worldSize.height) return false;
    if (game.collisions.some((rect) => intersects(foot, rect)) || blockedBySurface(game, foot)) return false;
  }
  if (state?.residents?.some((resident) => resident.interiorId === (interiorId ?? null) && intersects(foot, resident.body))) return false;
  return true;
}

function blockedBySurface(game, foot) {
  const crossings = game.surfaces.filter((surface) => surface.recipe === 'crossing');
  for (const surface of game.surfaces) {
    if (!surface.blocked || !surfaceIntersectsRect(surface, foot)) continue;
    if (crossings.some((crossing) => surfaceIntersectsRect(crossing, foot))) continue;
    return true;
  }
  return false;
}

function surfaceIntersectsRect(surface, rectangle) {
  const geometry = surface.geometry;
  if (geometry?.kind === 'area') return intersects(geometry.rect, rectangle);
  if (geometry?.kind !== 'path' || !Array.isArray(geometry.points) || !Number.isFinite(geometry.width)) return false;
  for (let index = 1; index < geometry.points.length; index += 1) {
    if (distanceSegmentToRect(geometry.points[index - 1], geometry.points[index], rectangle) <= geometry.width / 2) return true;
  }
  return false;
}

function distanceSegmentToRect(from, to, rectangle) {
  if (segmentIntersectsRect(from, to, rectangle)) return 0;
  const corners = [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x, y: rectangle.y + rectangle.height },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
  ];
  return Math.min(
    distancePointToRect(from, rectangle),
    distancePointToRect(to, rectangle),
    ...corners.map((corner) => distancePointToSegment(corner, from, to)),
  );
}

function segmentIntersectsRect(from, to, rectangle) {
  if (pointInRect(from, rectangle) || pointInRect(to, rectangle)) return true;
  const topLeft = { x: rectangle.x, y: rectangle.y };
  const topRight = { x: rectangle.x + rectangle.width, y: rectangle.y };
  const bottomLeft = { x: rectangle.x, y: rectangle.y + rectangle.height };
  const bottomRight = { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height };
  return segmentsIntersect(from, to, topLeft, topRight)
    || segmentsIntersect(from, to, topRight, bottomRight)
    || segmentsIntersect(from, to, bottomRight, bottomLeft)
    || segmentsIntersect(from, to, bottomLeft, topLeft);
}

function segmentsIntersect(leftFrom, leftTo, rightFrom, rightTo) {
  const cross = (origin, first, second) => (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  const onSegment = (origin, end, value) => value.x >= Math.min(origin.x, end.x) && value.x <= Math.max(origin.x, end.x)
    && value.y >= Math.min(origin.y, end.y) && value.y <= Math.max(origin.y, end.y);
  const leftA = cross(leftFrom, leftTo, rightFrom);
  const leftB = cross(leftFrom, leftTo, rightTo);
  const rightA = cross(rightFrom, rightTo, leftFrom);
  const rightB = cross(rightFrom, rightTo, leftTo);
  if (((leftA > 0 && leftB < 0) || (leftA < 0 && leftB > 0))
    && ((rightA > 0 && rightB < 0) || (rightA < 0 && rightB > 0))) return true;
  return (leftA === 0 && onSegment(leftFrom, leftTo, rightFrom))
    || (leftB === 0 && onSegment(leftFrom, leftTo, rightTo))
    || (rightA === 0 && onSegment(rightFrom, rightTo, leftFrom))
    || (rightB === 0 && onSegment(rightFrom, rightTo, leftTo));
}

function distancePointToRect(value, rectangle) {
  const deltaX = Math.max(rectangle.x - value.x, 0, value.x - (rectangle.x + rectangle.width));
  const deltaY = Math.max(rectangle.y - value.y, 0, value.y - (rectangle.y + rectangle.height));
  return Math.hypot(deltaX, deltaY);
}

function distancePointToSegment(value, from, to) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(value.x - from.x, value.y - from.y);
  const progress = clamp(((value.x - from.x) * deltaX + (value.y - from.y) * deltaY) / lengthSquared, 0, 1);
  return Math.hypot(value.x - (from.x + deltaX * progress), value.y - (from.y + deltaY * progress));
}

function pointInRect(value, rectangle) {
  return value.x >= rectangle.x && value.x <= rectangle.x + rectangle.width
    && value.y >= rectangle.y && value.y <= rectangle.y + rectangle.height;
}

function interiorAt(game, currentId, foot) {
  const current = game.interiors.find((entry) => entry.id === currentId);
  if (current && contains(current.bounds, foot)) return current;
  return game.interiors.find((entry) => intersects(foot, entry.access)) ?? null;
}

function playerFootRect(player) {
  return { x: player.x + player.footbox.x, y: player.y + player.footbox.y, width: player.footbox.width, height: player.footbox.height };
}

function followExtentOrigin(value, boundsStart, boundsSize, visibleSpan, zoom) {
  const quantum = Math.max(1, Math.round(1 / zoom));
  if (visibleSpan >= boundsSize) {
    return Math.round((boundsStart + (boundsSize - visibleSpan) / 2) / quantum) * quantum;
  }
  const lower = boundsStart;
  const upper = boundsStart + boundsSize - visibleSpan;
  const firstAligned = Math.ceil(lower / quantum) * quantum;
  const lastAligned = Math.floor(upper / quantum) * quantum;
  if (firstAligned <= lastAligned) {
    return clamp(Math.round(value / quantum) * quantum, firstAligned, lastAligned);
  }
  return Math.round((lower + upper) / (2 * quantum)) * quantum;
}

function updateCamera(state, game) {
  if (state.camera.mode === 'overview') return state;
  const foot = playerFootRect(state.player);
  const lead = DIRECTION_VECTOR[state.player.direction] ?? DIRECTION_VECTOR.down;
  const view = state.viewport;
  const minimum = minimumView(game);
  const authoredDead = game.camera.follow.deadZone;
  const dead = {
    left: authoredDead.x * view.width / minimum.width,
    right: (authoredDead.x + authoredDead.width) * view.width / minimum.width,
    top: authoredDead.y * view.height / minimum.height,
    bottom: (authoredDead.y + authoredDead.height) * view.height / minimum.height,
  };
  const lookAhead = game.camera.follow.lookAhead;
  const zoom = state.camera.zoom;
  let x = state.camera.x;
  let y = state.camera.y;
  const screenX = (foot.x - x) * zoom;
  const screenY = (foot.y - y) * zoom;
  if (screenX < dead.left) x = foot.x - dead.left / zoom + lead.x * lookAhead;
  if (screenX + foot.width * zoom > dead.right) x = foot.x + foot.width - dead.right / zoom + lead.x * lookAhead;
  if (screenY < dead.top) y = foot.y - dead.top / zoom + lead.y * lookAhead;
  if (screenY + foot.height * zoom > dead.bottom) y = foot.y + foot.height - dead.bottom / zoom + lead.y * lookAhead;
  const bounds = game.camera.overview.bounds;
  x = followExtentOrigin(x, bounds.x, bounds.width, view.width / zoom, zoom);
  y = followExtentOrigin(y, bounds.y, bounds.height, view.height / zoom, zoom);
  return { ...state, camera: { ...state.camera, x, y, zoom } };
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function finite(value, fallback) { return Number.isFinite(value) ? value : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
