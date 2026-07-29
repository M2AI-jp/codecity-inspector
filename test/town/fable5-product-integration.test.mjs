import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canEnter, getBuilding, getInteraction } from '../../public/fable5-v2/building-runtime.mjs';
import { createFable5Persistence } from '../../public/fable5-v2/persistence.mjs';
import {
  chooseInvestigationQuestion,
  createInvestigationState,
  recordInvestigationClue,
  startInnDialogue,
  submitTownHallReport
} from '../../public/fable5-v2/quest-runtime.mjs';
import { ACTOR_CONTRACT } from '../../public/fable5-v2/world-runtime.mjs';
import {
  createFable5SessionState,
  restoreFable5SessionState
} from '../../public/fable5-v2/session-runtime.mjs';
import {
  AssetContractError,
  WORLD_PREFABS,
  drawWorldPrefabs
} from '../../public/fable5-v2/site-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function accepted(result) {
  assert.equal(result.ok, true, result.code ?? 'expected quest transition to succeed');
  return result.state;
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}

test('the shipped browser composition wires availability-gated buildings, quest persistence, and audio gesture gates', async () => {
  const [app, html, css] = await Promise.all([
    readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8'),
    readFile(path.join(ROOT, 'public/fable5-v2/index.html'), 'utf8'),
    readFile(path.join(ROOT, 'public/fable5-v2/styles.css'), 'utf8')
  ]);

  for (const moduleName of ['building-runtime.mjs', 'quest-runtime.mjs', 'persistence.mjs', 'audio-feedback.mjs', 'session-runtime.mjs']) {
    assert.match(app, new RegExp(`from './${moduleName.replace('.', '\\.')}'`), moduleName);
  }
  assert.ok(
    app.indexOf('const building = getBuildingInteraction') < app.indexOf("const legacy = nearbyInteraction(state.player, 'exterior')"),
    'building interactions must be queried before legacy closed-entrance copy'
  );
  assert.match(app, /legacy\?\.id === 'closed-townhall' \|\| legacy\?\.id === 'closed-house'/);
  assert.match(app, /enterBuilding\(state\.nearby\.buildingId, state\.player\)/);
  assert.match(app, /exitBuilding\(state\.nearby\.buildingId, state\.player\)/);
  assert.doesNotMatch(app, /state\.questStage|state\.foundClues/);
  assert.match(app, /createFable5Persistence\(/);
  assert.match(app, /restoreFable5SessionState\(loaded\.state\)/);
  assert.match(app, /createFable5SessionState\(\{/);
  assert.match(app, /audio: createAudioFeedback\(\{ storage: null \}\)/);
  assert.match(app, /state\.persistence\.reset\(\{ confirmed: true \}\)/);
  assert.match(app, /function resetCurrentSession\(\)/);
  assert.match(app, /function reportSaveFailure\(status\)/);
  assert.match(app, /state\.progressLoadStatus === 'storage-unavailable'/);
  assert.match(app, /function unlockAudioFromGesture\(\)/);
  assert.match(app, /button\.addEventListener\('pointerdown',[\s\S]*?unlockAudioFromGesture\(\)/);
  assert.match(app, /elements\.action\.addEventListener\('click',[\s\S]*?unlockAudioFromGesture\(\)/);
  assert.match(app, /drawWorldPrefabs\(context, state\.assets\.worldPrefabs\)/);
  assert.doesNotMatch(app, /state\.assets\.worldMaster|drawWorldImage\(/);
  assert.match(app, /公開待ちです/);

  for (const marker of [
    'id="audio-mute"',
    'id="audio-volume"',
    'id="restart-progress"',
    'id="quest-choice-panel"',
    'data-question="observed"',
    'data-question="inferred"',
    'data-question="unknown"',
    'id="report-panel"',
    'id="reset-panel"',
    'id="confirm-reset-button"',
    'id="interior-disclosure"'
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  assert.match(css, /\.quest-modal/);
  assert.match(css, /\.interior-disclosure/);
  assert.match(css, /\.audio-control/);
});

// REPLACES 'the innkeeper bust renders through the honest
// provisional/approved switch, never through the withdrawn production key':
// that test asserted the withdrawn legacy bust was wired back in through a
// second, separately-tracked state.assets.innkeeperBust channel, labelled
// "暫定素材" (provisional material), and drawn as a real speaking NPC. The
// product owner ruled that a disguised-as-shipped misrepresentation
// regardless of the honest-sounding label -- the underlying image was still
// withdrawn, not approved -- and required it withdrawn entirely, with no
// similar substitute ever rebuilt. This asserts the withdrawal is complete:
// none of that fallback's machinery remains reachable from the shipped
// runtime, and the pending-interior release gate other buildings rely on now
// covers the inn too, with no per-building carve-out.
test('the withdrawn innkeeper bust fallback has no surviving runtime code path', async () => {
  const [app, site, manifest, buildingRuntime] = await Promise.all([
    readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8'),
    readFile(path.join(ROOT, 'public/fable5-v2/site-runtime.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'public/fable5-v2/runtime-asset-manifest.mjs'), 'utf8'),
    readFile(path.join(ROOT, 'public/fable5-v2/building-runtime.mjs'), 'utf8')
  ]);

  for (const source of [app, site, manifest, buildingRuntime]) {
    assert.doesNotMatch(source, /FABLE5_INNKEEPER_RUNTIME_STATUS/);
    assert.doesNotMatch(source, /isInnkeeperReplacementApproved/);
  }
  assert.doesNotMatch(app, /function drawInnkeeperBust/);
  assert.doesNotMatch(app, /state\.assets\.innkeeperBust/);
  assert.doesNotMatch(app, /selectFable5CharacterFrame/);
  assert.doesNotMatch(app, /暫定素材/);
  assert.doesNotMatch(site, /innkeeperBust/);
  assert.doesNotMatch(buildingRuntime, /INN_RUNTIME_AVAILABILITY/);

  // The inn now carries exactly the same live availability gate as
  // city-hall and residence -- see building-runtime.mjs's INN_BUILDING.
  assert.match(
    buildingRuntime,
    /runtimeAvailability: pendingInteriorAvailability\(\s*INNKEEPER_REQUIRED_ASSET_KEYS/
  );

  // Pending-interior release gating (city-hall, residence, and now the inn)
  // must remain exactly as strict as before.
  assert.match(app, /if \(state\.mode === 'interior' && !isCustomerReachableInterior\(state\.buildingId\)\)/);
  assert.match(app, /drawUnavailableInteriorGate\(state\.buildingId\)/);
});

// See freshRuntimeSession()'s own comment in app.js: resetCurrentSession()
// used to reconstruct the "start over" session by hand instead of sharing
// restoreSessionProgress()'s helper, silently skipping the
// restoreFable5SessionState() flattening step and crashing on a real click
// of the "最初から" button with the exact same shape mismatch the boot path
// already guards against. This is a structural regression test for that fix:
// both callers must route through the one shared helper, and neither may
// hand createInitialFable5SessionState()'s nested envelope straight to
// applyRestoredSession().
test('resetCurrentSession() and restoreSessionProgress() share one session-flattening helper', async () => {
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');

  assert.match(app, /function freshRuntimeSession\(\) \{\s*const initial = createInitialFable5SessionState\(\);[\s\S]*?restoreFable5SessionState\(initial\.state\)/);
  const resetBody = app.slice(app.indexOf('function resetCurrentSession()'), app.indexOf('function chooseQuestion'));
  assert.match(resetBody, /const initialRuntime = freshRuntimeSession\(\);/, 'resetCurrentSession() must call the shared helper');
  assert.match(resetBody, /applyRestoredSession\(initialRuntime\)/, 'resetCurrentSession() must apply the flattened runtime session');
  assert.doesNotMatch(resetBody, /const initial = createInitialFable5SessionState\(\)/, 'resetCurrentSession() must not reconstruct the session by hand');
  assert.doesNotMatch(resetBody, /applyRestoredSession\(initial\.state\)/, 'resetCurrentSession() must never pass the nested envelope shape straight to applyRestoredSession()');
});

// REPLACES 'the innkeeper accepts the report as a provisional fallback so
// the quest loop has a reachable finish line': that test asserted the
// innkeeper offered to accept the city-hall report on city hall's behalf
// while city-hall's own approval was unmet. The product owner ruled that a
// disguised substitute for a still-unbuilt experience -- letting a
// vertical-slice loop appear "reachable end to end" only because an
// unauthorized NPC quietly stood in for the real, still-closed one -- and
// required it withdrawn entirely, with no similar substitute ever rebuilt
// (e.g. a different NPC taking over, or a text-only shortcut). This asserts
// no trace of that fallback remains reachable, and that the mission text
// stays honest that filing only ever happens at city hall.
test('quest completion has no substitute reporting route while city-hall is unapproved', async () => {
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');
  const buildingRuntime = await readFile(path.join(ROOT, 'public/fable5-v2/building-runtime.mjs'), 'utf8');

  for (const source of [app, buildingRuntime]) {
    assert.doesNotMatch(source, /report-to-innkeeper-fallback/);
    assert.doesNotMatch(source, /viaInnkeeper/);
  }
  assert.doesNotMatch(app, /reportViaInnkeeper/);
  assert.doesNotMatch(app, /宿屋へ戻り、宿帳係に報告する/);
  assert.match(app, /function showReportPanel\(\) \{/, 'showReportPanel() must take no arguments -- there is only one reporting route');
  assert.match(app, /speaker: '市庁舎の記録係'/, 'submitReport() must always credit city hall, never a substitute NPC');
  assert.match(app, /市庁舎の承認済み内装を準備中のため、報告ルートは公開待ちです/, 'the mission objective must stay honest that city hall is the only route');
});

test('the exterior prefab renderer fails before a partial draw when any manifest layer is absent', () => {
  const calls = [];
  const context = {
    drawImage(...args) {
      calls.push(args);
    }
  };
  const prefabImages = Object.fromEntries(
    WORLD_PREFABS.slice(0, -1).map(({ id }) => [id, { id }])
  );
  const missingPrefab = WORLD_PREFABS.at(-1);

  assert.throws(
    () => drawWorldPrefabs(context, prefabImages),
    (error) => error instanceof AssetContractError
      && error.issues.includes(`missing decoded prefab image: ${missingPrefab.id}`)
  );
  assert.deepEqual(calls, [], 'a partial prefab set must not produce a partial exterior');
});

test('door automation follows enabled enter and exit interactions by building id without bypassing availability', async () => {
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');

  assert.match(app, /const autoDoor = state\.nearby\?\.enabled === true/);
  assert.match(app, /state\.nearby\.kind === 'enter' \|\| state\.nearby\.kind === 'exit'/);
  assert.match(app, /const isAutoDoor = state\.nearby\.enabled === true\s*&& \(state\.nearby\.kind === 'enter' \|\| state\.nearby\.kind === 'exit'\)/);
  assert.match(app, /enterBuilding\(autoDoor\.buildingId, state\.player\)/);
  assert.match(app, /exitBuilding\(autoDoor\.buildingId, state\.player\)/);
  assert.doesNotMatch(app, /enterBuilding\('inn', state\.player\)/);
  assert.doesNotMatch(app, /exitBuilding\('inn', state\.player\)/);
});

test('release gates fail closed for pending interiors in the browser boundary and restore path', async () => {
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');

  assert.match(app, /function isCustomerReachableInterior\(buildingId\) \{\s*return getBuilding\(buildingId\)\?\.runtimeAvailability\?\.state === 'available';/);
  assert.match(app, /function enforceInteriorReleaseGate\(interaction\)/);
  assert.match(app, /if \(building\) return enforceInteriorReleaseGate\(building\);/);
  assert.match(app, /function transitionIsReleased\(transition\)/);
  assert.match(app, /if \(!transitionIsReleased\(transition\)\) \{\s*setStatus\(unavailableInteriorNotice\(transition\?\.buildingId\)\);/);
  assert.match(app, /function blockedSavedInteriorNotice\(savedState\)/);
  assert.match(app, /state\.progressLoadStatus = 'release-blocked-interior';/);
  assert.match(app, /blockedNearby\?\.kind === 'unavailable'/);
  assert.match(app, /function drawUnavailableInteriorGate\(buildingId\)/);
  assert.match(app, /if \(!transitionIsReleased\(pending\.transition\)\) \{/);
  assert.doesNotMatch(app, /function drawInferredInterior/);
});

test('failed progress saves debounce by attempt time while retaining successful-save semantics', async () => {
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');

  assert.match(app, /lastProgressSaveAttemptAt: 0/);
  assert.match(app, /function saveProgress\(\) \{\s*[\s\S]*?state\.lastProgressSaveAttemptAt = state\.lastTimestamp;/);
  assert.match(app, /if \(result\.status === 'saved'\) \{[\s\S]*?state\.lastProgressSavedAt = state\.lastTimestamp;/);
  assert.match(app, /if \(state\.progressDirty && timestamp - state\.lastProgressSaveAttemptAt >= 750\) saveProgress\(\);/);
  assert.doesNotMatch(app, /timestamp - state\.lastProgressSavedAt >= 750/);
  assert.match(app, /if \(!state\.saveFailureNotified\) \{\s*state\.saveFailureNotified = true;/);
  assert.match(app, /const recovered = state\.saveFailureNotified;\s*state\.saveFailureNotified = false;[\s\S]*?if \(recovered\) setStatus\('進行の保存を再開しました。'\);/);
});

test('the session snapshot strips state.player down to the {x, y, facing} save contract', async () => {
  // Regression test: state.player in the live browser runtime also carries
  // `moving` and `walkStartedAt` (see applyRestoredSession() and
  // updateMovement()), which exist only to drive this frame's walk
  // animation/footstep audio. session-runtime.mjs's validPlayer() requires
  // *exactly* the keys {x, y, facing} (see its exactKeys check), so passing
  // state.player through unfiltered made createFable5SessionState() -- and
  // therefore every single saveProgress() call -- fail with 'invalid-player'
  // starting from the very first frame (the freshly spawned player already
  // has those two extra keys). No progress was ever actually persisted,
  // and the failure silently degraded to a generic "check your browser
  // storage settings" notice that had nothing to do with storage. This
  // matched the exact shape-mismatch pattern that also caused the separate
  // "Cannot read properties of undefined (reading 'muted')" boot crash (see
  // restoreSessionProgress()'s use of restoreFable5SessionState() on a fresh
  // session), so both a passing shape here and a real save/reload round trip
  // in session-runtime.test.mjs are asserted.
  const app = await readFile(path.join(ROOT, 'public/fable5-v2/app.js'), 'utf8');

  assert.doesNotMatch(
    app,
    /createFable5SessionState\(\{\s*quest: state\.quest,\s*player: state\.player,/,
    'currentSessionSnapshot() must not hand the live, animation-augmented state.player object to the save contract'
  );
  assert.match(
    app,
    /player: \{ x: state\.player\.x, y: state\.player\.y, facing: state\.player\.facing \}/,
    'currentSessionSnapshot() must narrow state.player to exactly the {x, y, facing} save contract'
  );

  const liveShapedPlayer = { x: 644.75, y: 520, facing: 'west', moving: true, walkStartedAt: 17269.4 };
  const rejectedByContract = createFable5SessionState({
    quest: createInvestigationState(),
    player: liveShapedPlayer,
    mode: 'exterior',
    buildingId: null,
    zoom: 1,
    audioPreferences: { muted: false, volume: 0.45 }
  });
  assert.equal(rejectedByContract.ok, false, 'the save contract itself is expected to reject extra player keys');
  assert.equal(rejectedByContract.code, 'invalid-player');

  const acceptedAfterNarrowing = createFable5SessionState({
    quest: createInvestigationState(),
    player: { x: liveShapedPlayer.x, y: liveShapedPlayer.y, facing: liveShapedPlayer.facing },
    mode: 'exterior',
    buildingId: null,
    zoom: 1,
    audioPreferences: { muted: false, volume: 0.45 }
  });
  assert.equal(acceptedAfterNarrowing.ok, true, acceptedAfterNarrowing.code);
});

test('a scoped saved session restores quest and settings while keeping the unapproved city-hall route unavailable', () => {
  let quest = accepted(startInnDialogue(createInvestigationState()));
  quest = accepted(chooseInvestigationQuestion(quest, 'observed'));
  for (const clueId of ['clue-streetlamp', 'clue-well', 'clue-east-shop']) {
    quest = accepted(recordInvestigationClue(quest, clueId, [`evidence:${clueId}`]));
  }

  const cityHall = getBuilding('city-hall');
  assert.equal(canEnter('city-hall', cityHall.exterior.entrance.approachPoint), false);
  const cityHallEntry = getInteraction({
    mode: 'exterior',
    position: cityHall.exterior.entrance.approachPoint,
    questState: quest
  });
  assert.deepEqual(cityHallEntry, {
    id: 'unavailable-city-hall',
    kind: 'unavailable',
    label: cityHall.runtimeAvailability.reason,
    place: cityHall.label,
    buildingId: 'city-hall',
    distance: 0,
    enabled: false,
    quest: null
  });
  const residence = getBuilding('residence');
  const residenceEntry = getInteraction({
    mode: 'exterior',
    position: residence.exterior.entrance.approachPoint,
    questState: quest
  });
  assert.equal(residenceEntry.kind, 'unavailable');
  assert.equal(residenceEntry.label, residence.runtimeAvailability.reason);
  assert.equal(residenceEntry.enabled, false);
  const reportInteraction = getInteraction({
    mode: 'interior',
    buildingId: 'city-hall',
    position: cityHall.interior.interaction.point,
    questState: quest
  });
  assert.equal(reportInteraction.quest.action, 'submit-townhall-report');
  assert.equal(cityHall.interiorEvidence, 'inferred');

  const storage = memoryStorage();
  const persistence = createFable5Persistence({
    storage,
    repositoryIdentity: 'owner/repository',
    inspectionDigest: 'a'.repeat(64)
  });
  const session = createFable5SessionState({
    quest,
    player: { ...ACTOR_CONTRACT.spawn, facing: 'east' },
    mode: 'exterior',
    buildingId: null,
    zoom: 2,
    audioPreferences: { muted: true, volume: 0.3 }
  });
  assert.equal(session.ok, true);
  assert.equal(persistence.save(session.state).status, 'saved');
  const loaded = persistence.load();
  assert.equal(loaded.status, 'loaded');
  const restored = restoreFable5SessionState(loaded.state);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.player, { ...ACTOR_CONTRACT.spawn, facing: 'east' });
  assert.deepEqual(restored.state.audioPreferences, { muted: true, volume: 0.3 });

  const completed = submitTownHallReport(restored.state.quest, {
    answer: { questionId: restored.state.quest.questionId, clueCount: restored.state.quest.clues.length },
    result: { status: 'filed' }
  });
  assert.equal(completed.ok, true);

  storage.setItem(persistence.key, '{not json');
  assert.deepEqual(persistence.load(), { status: 'corrupt', key: persistence.key, state: null });
});
