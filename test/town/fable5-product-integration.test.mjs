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

test('a scoped saved session restores quest and settings while keeping the unapproved city-hall route unavailable', () => {
  let quest = accepted(startInnDialogue(createInvestigationState()));
  quest = accepted(chooseInvestigationQuestion(quest, 'observed'));
  for (const clueId of ['clue-streetlamp', 'clue-well', 'clue-east-shop']) {
    quest = accepted(recordInvestigationClue(quest, clueId, [`evidence:${clueId}`]));
  }

  const cityHall = getBuilding('city-hall');
  assert.equal(canEnter('city-hall', cityHall.exterior.entrance.approachPoint), false);
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
