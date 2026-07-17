import {
  FACILITY_ANCHORS,
  PLAYER_START_NODE_ID,
  WORLD_EFFECTS,
  WORLD_MAP,
  WORLD_NPCS,
  WORLD_PROPS,
  WORLD_STRUCTURES,
  WORLD_DISTRICTS,
  auditWorldMap,
  computeWorldCamera,
  createInterpolatedMovement,
  directionBetweenPoints,
  districtForPoint,
  groundAssetAt as worldGroundAssetAt,
  groundTransformAt as worldGroundTransformAt,
  nearestFacilityAnchor,
  nearestNavigationNode,
  navigationEdgeBetween,
  navigationNodeById,
  nextNodeForDirection,
  sampleInterpolatedMovement,
  screenToWorld,
  shortestNavigationPath,
  worldToScreen
} from './world-runtime.mjs';
import {
  SITE_CANVAS,
  SITE_RENDER_LAYERS,
  authoredTilePlacement,
  auditRuntimeAssetUsage,
  auditSiteRecipes,
  characterFrameRect,
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
  assetError: document.getElementById('asset-error'),
  assetErrorText: document.getElementById('asset-error-text'),
  help: document.getElementById('world-help'),
  status: document.getElementById('world-status'),
  districtBanner: document.getElementById('district-banner'),
  interactionPrompt: document.getElementById('interaction-prompt'),
  interactionPromptText: document.getElementById('interaction-prompt-text'),
  journeyKicker: document.getElementById('journey-kicker'),
  journeyTitle: document.getElementById('journey-title'),
  journeyCopy: document.getElementById('journey-copy'),
  journeySteps: {
    walk: document.getElementById('journey-step-walk'),
    route: document.getElementById('journey-step-route'),
    evidence: document.getElementById('journey-step-evidence'),
    return: document.getElementById('journey-step-return')
  },
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
  facilityPresence: document.getElementById('facility-presence'),
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
const initialNode = navigationNodeById(PLAYER_START_NODE_ID)
  ?? nearestNavigationNode(FACILITY_ANCHORS.town_hall.x, FACILITY_ANCHORS.town_hall.y);
const directionForKey = Object.freeze({
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right'
});

const state = {
  town: null,
  worldReady: false,
  assets: null,
  assetError: null,
  view: 'world',
  camera: null,
  anchors: Object.values(FACILITY_ANCHORS),
  hoveredAnchor: null,
  selectedAnchor: FACILITY_ANCHORS.dojo,
  nearbyAnchor: null,
  worldNodeId: initialNode.id,
  worldPosition: { x: initialNode.x, y: initialNode.y },
  worldDirection: 'down',
  worldMovement: null,
  worldMovementEdge: null,
  worldQueue: [],
  worldHeldDirection: null,
  worldPendingDirection: null,
  worldReturn: null,
  siteRecipe: null,
  siteNodeId: null,
  sitePosition: null,
  siteDirection: 'up',
  siteMovement: null,
  siteQueue: [],
  drawerOpener: null,
  lastTimestamp: 0,
  lastFrameAt: -Infinity,
  lastDistrictId: null,
  journey: {
    stage: 'reach_dojo',
    walked: false,
    bridgeCrossed: false,
    stairsUsed: false,
    evidenceViewed: false,
    returnedToWorld: false,
    secondFacilityVisited: false
  }
};

const FACILITY_ROLES = Object.freeze({
  town_hall: 'リポジトリ全体', gate: '起動入口', guild: 'ローカル接続',
  pub: '公開インターフェース', shop: 'パッケージ', inn: 'アプリケーション入口',
  dock: '配布・デプロイ', dojo: 'テスト', well: '環境変数・秘密情報',
  workshop: 'ビルド工程', warehouse: 'データ保存', watchtower: 'ログ・監視',
  house: '通常モジュール', ruin: '古い実装・未使用候補'
});

function announce(message) {
  elements.status.textContent = '';
  window.requestAnimationFrame(() => { elements.status.textContent = message; });
}

function facilityState(facility) {
  if ((facility?.evidence?.observed?.length ?? 0) > 0) {
    return Object.freeze({ id: 'observed', label: '観測済み', color: '#9dcc88', symbol: '●' });
  }
  if ((facility?.evidence?.inferred?.length ?? 0) > 0) {
    return Object.freeze({ id: 'inferred', label: '推測あり', color: '#f0c968', symbol: '▲' });
  }
  return Object.freeze({ id: 'unknown', label: '未確認', color: '#a9b8ca', symbol: '?' });
}

function announceWorldArrival() {
  const anchor = state.nearbyAnchor;
  if (anchor) {
    const status = facilityState(facilityForAnchor(anchor));
    announce(`${anchor.label}の入口に到着しました（${status.label}）。EnterまたはSpaceで調べられます。`);
    return;
  }
  announce(`${districtLabel(state.worldPosition)}に到着しました。次の金色の足あとを選べます。`);
}

function evidenceCount(facility) {
  return ['observed', 'inferred', 'unknown']
    .reduce((total, key) => total + (facility?.evidence?.[key]?.length ?? 0), 0);
}

function humanizeEvidence(value) {
  const text = String(value);
  const patterns = [
    [/^(\d+) test file\(s\) observed: (.+)\.$/, (match) => `${match[1]}件のテストファイルを観測しました: ${match[2]}`],
    [/^package\.json declares a "test" script\.$/, () => 'package.json に test スクリプトが宣言されています。'],
    [/^(\d+) source\/test association\(s\) inferred from direct imports or unique filename matching\.$/, (match) => `直接importまたは一意なファイル名から、${match[1]}件のソース／テスト対応を推測しました。`],
    [/^whether these tests currently pass was not executed; target-repo tests are never run by this tool\. Untested is not broken\.$/, () => 'テストが現在成功するかは未確認です。対象コードは実行しておらず、未テストを故障とは判定しません。'],
    [/^repository "([^"]+)" was scanned\.$/, (match) => `リポジトリ「${match[1]}」を読み取り専用で観測しました。`],
    [/^(\d+) of (\d+) discovered file\(s\) were scanned\.$/, (match) => `発見した${match[2]}ファイルのうち${match[1]}ファイルを静的に読み取りました。`],
    [/^git commit history, issues, and releases were not read; only static file contents were scanned\.$/, () => 'commit履歴・Issue・Releaseは読んでいません。静的なファイル内容だけを観測しました。'],
    [/^no external code-gen contractor reports were supplied\.$/, () => '外部コード生成ワーカーの報告は入力されていません。'],
    [/^no observed or inferred signal for "([^"]+)" was found in this scan\.$/, () => 'この検査では、この施設を示す観測・推測が見つかりませんでした。'],
    [/^entrypoint "([^"]+)" resolved via ([^.]+)\.$/, (match) => `入口「${match[1]}」を ${match[2]} から観測しました。`],
    [/^whether the entrance actually starts successfully when run is unknown; this tool never executes target code\.$/, () => '入口が実行時に正常起動するかは未確認です。対象コードは実行していません。']
  ];
  for (const [pattern, format] of patterns) {
    const match = text.match(pattern);
    if (match) return format(match);
  }
  return text;
}

function facilityForAnchor(anchor) {
  return state.town?.model?.facilities?.find((facility) => facility.kind === anchor?.kind) ?? null;
}

function districtLabel(point) {
  return districtForPoint(point?.x, point?.y, WORLD_DISTRICTS)?.label ?? '街道';
}

function evidenceItems(target, items, emptyLabel) {
  target.replaceChildren();
  const values = Array.isArray(items) && items.length > 0 ? items : [emptyLabel];
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = humanizeEvidence(value);
    target.append(item);
  }
}

function selectedFacility() {
  return facilityForAnchor(state.selectedAnchor);
}

function journeyTargetAnchor() {
  if (['reach_dojo', 'inspect_dojo', 'return_world'].includes(state.journey.stage)) return FACILITY_ANCHORS.dojo;
  if (state.journey.stage === 'reach_house') return FACILITY_ANCHORS.house;
  return null;
}

function markJourneySteps() {
  const routeDone = state.journey.bridgeCrossed && state.journey.stairsUsed;
  const values = {
    walk: { done: state.journey.walked, current: !state.journey.walked },
    route: { done: routeDone, current: state.journey.walked && !routeDone },
    evidence: { done: state.journey.evidenceViewed, current: routeDone && !state.journey.evidenceViewed },
    return: { done: state.journey.secondFacilityVisited, current: state.journey.evidenceViewed && !state.journey.secondFacilityVisited }
  };
  for (const [key, value] of Object.entries(values)) {
    elements.journeySteps[key].classList.toggle('is-done', value.done);
    elements.journeySteps[key].classList.toggle('is-current', value.current);
  }
}

function updateJourney() {
  const messages = {
    reach_dojo: ['最初の調査', '橋と階段の先、道場へ', '金色の足あとを追って、テストの状態を調べましょう。'],
    inspect_dojo: ['道場に到着', '入口の奥で根拠を開く', '光る入口まで歩き、Enterで観測・推測・未確認を開きます。'],
    return_world: ['根拠を確認', '街へ戻る', '閉じる／Escで街へ戻り、次の施設へ向かいましょう。'],
    reach_house: ['次の調査', '森の住宅へ向かう', '街へ戻れました。金色の足あとを追って別の施設へ。'],
    complete: ['調査の一周を完了', '街は自由に歩けます', 'ほかの施設も、入口から同じ方法で根拠を調べられます。']
  };
  const [kicker, title, copy] = messages[state.journey.stage] ?? messages.reach_dojo;
  elements.journeyKicker.textContent = kicker;
  elements.journeyTitle.textContent = title;
  elements.journeyCopy.textContent = copy;
  markJourneySteps();
  draw(state.lastTimestamp);
}

function updateInteractionPrompt() {
  if (state.view === 'site') {
    const nearEvidence = currentSiteNearEvidence();
    elements.interactionPrompt.hidden = !nearEvidence;
    elements.interactionPromptText.textContent = nearEvidence ? '観測・推測・未確認の根拠を開く' : '';
    return;
  }
  const anchor = state.nearbyAnchor;
  elements.interactionPrompt.hidden = !anchor;
  if (anchor) {
    const facility = facilityForAnchor(anchor);
    const status = facilityState(facility).label;
    elements.interactionPromptText.textContent = `${anchor.label}を調べる · ${status}`;
  }
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
  elements.facilityKind.textContent = FACILITY_ROLES[facility.kind] ?? facility.kind;
  elements.facilityPresence.textContent = `${facilityState(facility).symbol} ${facilityState(facility).label}`;
  elements.facilityCount.textContent = String(evidenceCount(facility));
  evidenceItems(elements.evidenceObserved, facility.evidence?.observed, '観測された根拠はありません。');
  evidenceItems(elements.evidenceInferred, facility.evidence?.inferred, '推測された根拠はありません。');
  evidenceItems(elements.evidenceUnknown, facility.evidence?.unknown, '未確認事項はありません。');
  const routes = siteRecipesForFacility(facility.kind);
  elements.siteEnterButton.hidden = state.view === 'site' || routes.length === 0;
  elements.siteEnterButton.textContent = routes.length > 1
    ? '4つの調査区画から選ぶ'
    : facility.present === true ? 'この施設を歩いて調べる' : '未確認区画を歩いて根拠を見る';
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
  elements.overviewButton.textContent = state.view === 'overview' ? '街へ戻る' : '街を見渡す';
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
  elements.siteChoiceTitle.textContent = recipes.length > 1 ? '森につながる4つの住宅区画' : '調査区画';
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

function openCurrentEvidence() {
  if (state.view === 'site' && state.siteRecipe?.facilityKind === 'dojo') {
    state.journey.evidenceViewed = true;
    state.journey.stage = 'return_world';
    updateJourney();
  }
  openJournal(elements.canvas);
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
  const camera = computeWorldCamera({
    mode: state.view === 'world' ? 'follow' : 'overview',
    viewportWidth: elements.canvas.width,
    viewportHeight: elements.canvas.height,
    focusX: state.worldPosition.x,
    focusY: state.worldPosition.y,
    worldWidth: WORLD_MAP.width,
    worldHeight: WORLD_MAP.height
  });
  if (state.view !== 'world') return camera;
  const scale = 1.4;
  const sourceWidth = Math.min(WORLD_MAP.width, elements.canvas.width / scale);
  const sourceHeight = Math.min(WORLD_MAP.height, elements.canvas.height / scale);
  const sourceX = Math.max(0, Math.min(WORLD_MAP.width - sourceWidth, state.worldPosition.x - sourceWidth / 2));
  const sourceY = Math.max(0, Math.min(WORLD_MAP.height - sourceHeight, state.worldPosition.y - sourceHeight / 2));
  return Object.freeze({
    ...camera,
    scale,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destX: (elements.canvas.width - sourceWidth * scale) / 2,
    destY: (elements.canvas.height - sourceHeight * scale) / 2,
    destWidth: sourceWidth * scale,
    destHeight: sourceHeight * scale
  });
}

function roundedRectangle(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawWorldAnchor(anchor, active, target, timestamp) {
  const screen = worldToScreen(state.camera, anchor);
  if (!screen) return;
  if (screen.x < -130 || screen.y < -80 || screen.x > elements.canvas.width + 130 || screen.y > elements.canvas.height + 80) return;
  const facility = facilityForAnchor(anchor);
  const status = facilityState(facility);
  const pulse = target ? 4 + Math.sin(timestamp / 180) * 3 : 0;
  const radius = (active ? 17 : 12) + pulse;
  const glow = context.createRadialGradient(screen.x, screen.y, 1, screen.x, screen.y, radius + 12);
  glow.addColorStop(0, target ? 'rgba(255, 239, 168, .94)' : `${status.color}cc`);
  glow.addColorStop(0.42, target ? 'rgba(240, 201, 104, .52)' : `${status.color}55`);
  glow.addColorStop(1, 'rgba(240, 201, 104, 0)');
  context.fillStyle = glow;
  context.beginPath();
  context.arc(screen.x, screen.y, radius + 12, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = target ? '#fff0ad' : status.color;
  context.lineWidth = target ? 2 : 1;
  context.beginPath();
  context.arc(screen.x, screen.y, active ? 8 : 5, 0, Math.PI * 2);
  context.stroke();

  const label = `${status.symbol} ${anchor.label}`;
  context.font = '700 11px system-ui, sans-serif';
  const labelWidth = Math.ceil(context.measureText(label).width) + 16;
  const labelX = screen.x - labelWidth / 2;
  const labelY = screen.y - (target ? 48 : 37);
  roundedRectangle(labelX, labelY, labelWidth, 23, 7);
  context.fillStyle = target ? 'rgba(44, 34, 12, .96)' : 'rgba(8, 13, 8, .88)';
  context.fill();
  context.strokeStyle = target ? '#f5d77e' : `${status.color}aa`;
  context.stroke();
  context.fillStyle = target ? '#fff1bd' : '#eee7d4';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, screen.x, labelY + 12);
  if (target) {
    context.fillStyle = '#f5d77e';
    context.beginPath();
    context.moveTo(screen.x, labelY + 31);
    context.lineTo(screen.x - 6, labelY + 25);
    context.lineTo(screen.x + 6, labelY + 25);
    context.closePath();
    context.fill();
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

function drawWorldGroundTile(images, cellX, cellY) {
  const assetId = worldGroundAssetAt(cellX, cellY);
  if (!assetId) return;
  const pixelX = cellX * WORLD_MAP.cellSize;
  const pixelY = cellY * WORLD_MAP.cellSize;
  if (['field.tree', 'field.rock'].includes(assetId)) {
    context.drawImage(images.get('field.grass'), pixelX, pixelY, 64, 64);
  }
  const transform = worldGroundTransformAt(cellX, cellY);
  context.save();
  context.translate(pixelX + 32, pixelY + 32);
  context.rotate((transform?.quarterTurns ?? 0) * Math.PI / 2);
  if (transform?.flipX) context.scale(-1, 1);
  context.drawImage(images.get(assetId), -32, -32, 64, 64);
  context.restore();
}

function worldPlacement(entry) {
  return {
    x: entry.x * WORLD_MAP.cellSize + (entry.offsetX ?? 0),
    y: entry.y * WORLD_MAP.cellSize + (entry.offsetY ?? 0),
    depth: entry.y * WORLD_MAP.cellSize + WORLD_MAP.cellSize + (entry.offsetY ?? 0)
  };
}

function drawWorldProp(images, entry) {
  const placement = worldPlacement(entry);
  context.save();
  context.translate(placement.x + 32, placement.y + 32);
  if (entry.flipX) context.scale(-1, 1);
  context.drawImage(images.get(entry.assetId), -32, -32, 64, 64);
  context.restore();
}

function drawWorldRouteGuidance(timestamp) {
  const target = journeyTargetAnchor();
  if (!target || state.view !== 'world') return;
  const path = shortestNavigationPath(state.worldNodeId, target.nodeId);
  for (let index = 1; index < path.length; index += 1) {
    const node = path[index];
    const previous = path[index - 1];
    const edge = navigationEdgeBetween(previous.id, node.id);
    const pulse = 0.74 + Math.sin(timestamp / 180 + index * 0.65) * 0.2;
    context.globalAlpha = pulse;
    context.fillStyle = edge?.type === 'bridge' ? '#9ed8e6' : edge?.type === 'stairs' ? '#fff0ae' : '#efca69';
    context.beginPath();
    context.ellipse(node.x, node.y - 3, edge?.type === 'walk' ? 4 : 7, edge?.type === 'walk' ? 3 : 5, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function drawWorldPlayer(images, timestamp) {
  context.save();
  const aura = context.createRadialGradient(
    state.worldPosition.x, state.worldPosition.y - 7, 3,
    state.worldPosition.x, state.worldPosition.y - 7, 29
  );
  aura.addColorStop(0, 'rgba(151, 231, 235, .42)');
  aura.addColorStop(1, 'rgba(151, 231, 235, 0)');
  context.fillStyle = aura;
  context.beginPath();
  context.arc(state.worldPosition.x, state.worldPosition.y - 7, 29, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(5, 9, 5, .65)';
  context.beginPath();
  context.ellipse(state.worldPosition.x, state.worldPosition.y - 2, 12, 6, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#9ee8ed';
  context.lineWidth = 3;
  context.beginPath();
  context.ellipse(state.worldPosition.x, state.worldPosition.y - 2, 15, 8, 0, 0, Math.PI * 2);
  context.stroke();
  drawCharacter(
    images.get('character.player'),
    state.worldDirection,
    movementFrame(state.worldMovement, timestamp),
    state.worldPosition.x,
    state.worldPosition.y
  );
  context.fillStyle = '#b5f2f1';
  context.beginPath();
  context.moveTo(state.worldPosition.x, state.worldPosition.y - 49);
  context.lineTo(state.worldPosition.x - 5, state.worldPosition.y - 57);
  context.lineTo(state.worldPosition.x + 5, state.worldPosition.y - 57);
  context.closePath();
  context.fill();
  context.font = '800 10px system-ui, sans-serif';
  roundedRectangle(state.worldPosition.x - 24, state.worldPosition.y - 77, 48, 19, 6);
  context.fillStyle = 'rgba(7, 16, 15, .94)';
  context.fill();
  context.strokeStyle = '#9ee8ed';
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = '#d9ffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('あなた', state.worldPosition.x, state.worldPosition.y - 67);
  context.restore();
}

function drawWorld(timestamp) {
  state.camera = worldCamera();
  const images = state.assets.images;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = false;
  const backdrop = context.createLinearGradient(0, 0, elements.canvas.width, elements.canvas.height);
  backdrop.addColorStop(0, '#34452a');
  backdrop.addColorStop(1, '#111a11');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  context.save();
  context.beginPath();
  context.rect(state.camera.destX, state.camera.destY, state.camera.destWidth, state.camera.destHeight);
  context.clip();
  context.translate(state.camera.destX - state.camera.sourceX * state.camera.scale, state.camera.destY - state.camera.sourceY * state.camera.scale);
  context.scale(state.camera.scale, state.camera.scale);

  const firstColumn = Math.max(0, Math.floor(state.camera.sourceX / WORLD_MAP.cellSize));
  const lastColumn = Math.min(WORLD_MAP.columns - 1, Math.ceil((state.camera.sourceX + state.camera.sourceWidth) / WORLD_MAP.cellSize));
  const firstRow = Math.max(0, Math.floor(state.camera.sourceY / WORLD_MAP.cellSize));
  const lastRow = Math.min(WORLD_MAP.rows - 1, Math.ceil((state.camera.sourceY + state.camera.sourceHeight) / WORLD_MAP.cellSize));
  for (let y = firstRow; y <= lastRow; y += 1) {
    for (let x = firstColumn; x <= lastColumn; x += 1) drawWorldGroundTile(images, x, y);
  }

  drawWorldRouteGuidance(timestamp);
  for (const entry of WORLD_PROPS.filter((item) => item.layer === 'rear')) drawWorldProp(images, entry);

  const depthItems = [
    ...WORLD_STRUCTURES.map((entry, index) => ({ type: 'structure', entry, depth: entry.baselineY, index })),
    ...WORLD_PROPS.filter((item) => !['rear', 'front'].includes(item.layer)).map((entry, index) => ({
      type: 'prop', entry, depth: worldPlacement(entry).depth, index
    })),
    ...WORLD_NPCS.map((entry, index) => ({ type: 'npc', entry, depth: entry.y * 64 + 52, index })),
    { type: 'player', entry: null, depth: state.worldPosition.y, index: 0 }
  ].sort((left, right) => left.depth - right.depth
    || ({ structure: 0, prop: 1, npc: 2, player: 3 }[left.type] - { structure: 0, prop: 1, npc: 2, player: 3 }[right.type])
    || left.index - right.index);

  for (const item of depthItems) {
    if (item.type === 'structure') {
      const facility = item.entry.facilityKind ? facilityForAnchor(FACILITY_ANCHORS[item.entry.facilityKind]) : null;
      context.save();
      context.fillStyle = 'rgba(3, 7, 3, .38)';
      context.beginPath();
      context.ellipse(item.entry.x + 128, item.entry.baselineY - 6, 105, 18, 0, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = item.entry.facilityKind && facility?.present !== true ? 0.78 : 1;
      context.drawImage(images.get(item.entry.assetId), item.entry.x, item.entry.y, 256, 256);
      context.restore();
    } else if (item.type === 'prop') drawWorldProp(images, item.entry);
    else if (item.type === 'npc') {
      const facility = item.entry.facilityKind ? facilityForAnchor(FACILITY_ANCHORS[item.entry.facilityKind]) : null;
      const feetX = item.entry.x * 64 + 32 + (item.entry.offsetX ?? 0) * 1.75;
      const feetY = item.entry.y * 64 + 52;
      context.save();
      if (item.entry.facilityKind && facility?.present !== true) context.globalAlpha = 0.58;
      drawCharacter(images.get(item.entry.assetId), item.entry.direction ?? 'down', 'idle', feetX, feetY);
      context.restore();
      if (item.entry.facilityKind && facility?.present !== true) {
        context.fillStyle = '#a9b8ca';
        context.beginPath();
        context.arc(feetX, feetY - 47, 7, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#111820';
        context.font = '800 9px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('?', feetX, feetY - 47);
      }
    } else drawWorldPlayer(images, timestamp);
  }

  for (const entry of WORLD_PROPS.filter((item) => item.layer === 'front')) drawWorldProp(images, entry);
  const effectFrame = effectFrameRect(Math.floor(timestamp / 160));
  for (const entry of WORLD_EFFECTS) {
    context.drawImage(
      images.get(entry.assetId),
      effectFrame.x, effectFrame.y, effectFrame.width, effectFrame.height,
      entry.x * 64 + 16, entry.y * 64 + 16, 32, 32
    );
  }
  context.restore();

  const target = journeyTargetAnchor();
  for (const anchor of state.anchors) {
    const active = anchor.kind === state.selectedAnchor?.kind || anchor.kind === state.nearbyAnchor?.kind;
    drawWorldAnchor(anchor, active, anchor.kind === target?.kind, timestamp);
  }
}

function drawSite(timestamp) {
  const recipe = state.siteRecipe;
  const images = state.assets.images;
  const scale = Math.min(elements.canvas.width / SITE_CANVAS.width, elements.canvas.height / SITE_CANVAS.height);
  const camera = Object.freeze({
    scale,
    destX: (elements.canvas.width - SITE_CANVAS.width * scale) / 2,
    destY: (elements.canvas.height - SITE_CANVAS.height * scale) / 2,
    destWidth: SITE_CANVAS.width * scale,
    destHeight: SITE_CANVAS.height * scale,
    viewportWidth: elements.canvas.width,
    viewportHeight: elements.canvas.height
  });
  state.camera = camera;
  context.setTransform(1, 0, 0, 1, 0, 0);
  const backdrop = context.createRadialGradient(
    elements.canvas.width / 2, elements.canvas.height / 2, 20,
    elements.canvas.width / 2, elements.canvas.height / 2, Math.max(elements.canvas.width, elements.canvas.height)
  );
  backdrop.addColorStop(0, '#34452b');
  backdrop.addColorStop(1, '#0d140d');
  context.fillStyle = backdrop;
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

  const evidencePath = shortestSitePath(recipe, state.siteNodeId, recipe.evidenceNodeId);
  for (let index = 1; index < evidencePath.length; index += 1) {
    const node = evidencePath[index];
    context.globalAlpha = 0.66 + Math.sin(timestamp / 170 + index) * 0.2;
    context.fillStyle = '#f1cc6c';
    context.beginPath();
    context.ellipse(node.x * 64 + 32, node.y * 64 + 36, 5, 3, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  const evidenceNode = siteNodeById(recipe, recipe.evidenceNodeId);
  if (evidenceNode) {
    const pulse = 9 + Math.sin(timestamp / 160) * 3;
    context.strokeStyle = '#ffe7a0';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(evidenceNode.x * 64 + 32, evidenceNode.y * 64 + 47, pulse, 0, Math.PI * 2);
    context.stroke();
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
      context.fillStyle = 'rgba(5, 9, 5, .64)';
      context.beginPath();
      context.ellipse(state.sitePosition.x * 64 + 32, state.sitePosition.y * 64 + 50, 13, 6, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#ffe28a';
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(state.sitePosition.x * 64 + 32, state.sitePosition.y * 64 + 50, 16, 8, 0, 0, Math.PI * 2);
      context.stroke();
      drawCharacter(
        images.get('character.player'),
        state.siteDirection,
        movementFrame(state.siteMovement, timestamp),
        state.sitePosition.x * 64 + 32,
        state.sitePosition.y * 64 + 52
      );
      const playerX = state.sitePosition.x * 64 + 32;
      const playerY = state.sitePosition.y * 64 + 52;
      context.font = '800 10px system-ui, sans-serif';
      roundedRectangle(playerX - 24, playerY - 76, 48, 19, 6);
      context.fillStyle = 'rgba(7, 16, 15, .94)';
      context.fill();
      context.strokeStyle = '#9ee8ed';
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = '#d9ffff';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('あなた', playerX, playerY - 66);
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

  const facility = facilityForAnchor(FACILITY_ANCHORS[recipe.facilityKind]);
  const status = facilityState(facility);
  const label = `${status.symbol} ${status.label} · ${FACILITY_ROLES[recipe.facilityKind] ?? recipe.facilityKind}`;
  context.font = '700 11px system-ui, sans-serif';
  const width = Math.ceil(context.measureText(label).width) + 18;
  roundedRectangle(camera.destX + 12, camera.destY + 12, width, 25, 7);
  context.fillStyle = 'rgba(8, 13, 8, .9)';
  context.fill();
  context.strokeStyle = status.color;
  context.stroke();
  context.fillStyle = '#f5edda';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText(label, camera.destX + 21, camera.destY + 25);
}

function draw(timestamp = 0) {
  if (!state.worldReady || !state.assets || !context) return;
  if (state.view === 'site' && state.assets && state.siteRecipe) drawSite(timestamp);
  else drawWorld(timestamp);
}

function updateNearbyAnchor() {
  state.nearbyAnchor = nearestFacilityAnchor(
    state.worldPosition.x,
    state.worldPosition.y,
    state.anchors,
    46
  );
  if (state.nearbyAnchor) state.selectedAnchor = state.nearbyAnchor;
  updateFacilityDetail();
  updateInteractionPrompt();
}

function updateDistrictBanner() {
  const district = districtForPoint(state.worldPosition.x, state.worldPosition.y, WORLD_DISTRICTS);
  if (!district || district.id === state.lastDistrictId) return;
  state.lastDistrictId = district.id;
  elements.districtBanner.textContent = district.label;
  elements.districtBanner.hidden = false;
  window.clearTimeout(state.districtBannerTimer);
  state.districtBannerTimer = window.setTimeout(() => { elements.districtBanner.hidden = true; }, 1300);
}

function startNextWorldSegment(timestamp) {
  if (state.worldMovement || state.worldQueue.length === 0) return;
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
  state.worldMovementEdge = edge.type;
  state.worldMovement = createInterpolatedMovement(state.worldPosition, target, timestamp, Math.max(105, Math.min(165, distance * 2)));
  state.journey.walked = true;
  markJourneySteps();
  elements.canvas.dataset.moving = 'true';
}

function queueWorldPath(path, timestamp = performance.now()) {
  state.worldQueue = path.slice(1);
  const started = state.worldQueue.length > 0;
  startNextWorldSegment(timestamp);
  return started;
}

function startNextSiteSegment(timestamp) {
  if (state.siteMovement || state.siteQueue.length === 0) return;
  const target = state.siteQueue.shift();
  state.siteDirection = directionBetweenPoints(state.sitePosition, target, state.siteDirection);
  state.siteNodeId = target.id;
  state.siteMovement = createInterpolatedMovement(state.sitePosition, target, timestamp, 135);
}

function queueSitePath(path, timestamp = performance.now()) {
  state.siteQueue = path.slice(1);
  startNextSiteSegment(timestamp);
}

function updateMovements(timestamp) {
  if (state.worldMovement) {
    const sample = sampleInterpolatedMovement(state.worldMovement, timestamp);
    state.worldPosition = { x: sample.x, y: sample.y };
    state.worldDirection = sample.direction;
    if (sample.done) {
      state.worldPosition = { ...state.worldMovement.to };
      state.worldMovement = null;
      if (state.worldMovementEdge === 'bridge') state.journey.bridgeCrossed = true;
      if (state.worldMovementEdge === 'stairs') state.journey.stairsUsed = true;
      state.worldMovementEdge = null;
      updateNearbyAnchor();
      updateDistrictBanner();
      updateSummary();
      updateJourney();
      if (state.worldQueue.length > 0) startNextWorldSegment(timestamp);
      else {
        delete elements.canvas.dataset.moving;
        const queuedDirection = state.worldPendingDirection ?? state.worldHeldDirection;
        state.worldPendingDirection = null;
        if (queuedDirection) moveWorldDirection(queuedDirection, timestamp);
        else announceWorldArrival();
      }
    }
  }
  if (state.siteMovement) {
    const sample = sampleInterpolatedMovement(state.siteMovement, timestamp);
    state.sitePosition = { x: sample.x, y: sample.y };
    state.siteDirection = sample.direction;
    if (sample.done) {
      state.sitePosition = { ...state.siteMovement.to };
      state.siteMovement = null;
      updateInteractionPrompt();
      if (state.siteQueue.length > 0) startNextSiteSegment(timestamp);
    }
  }
}

function animationTick(timestamp) {
  if (timestamp - state.lastFrameAt < 40) {
    window.requestAnimationFrame(animationTick);
    return;
  }
  state.lastFrameAt = timestamp;
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
  state.view = 'world';
  elements.canvas.dataset.mode = 'world';
  updateNearbyAnchor();
  updateSummary();
  return true;
}

function toggleOverview() {
  if (state.view === 'site') returnToWorld();
  state.view = state.view === 'overview' ? 'world' : 'overview';
  state.worldMovement = null;
  state.worldMovementEdge = null;
  state.worldQueue = [];
  state.worldHeldDirection = null;
  state.worldPendingDirection = null;
  delete elements.canvas.dataset.moving;
  elements.canvas.dataset.mode = state.view;
  updateSummary();
  draw(state.lastTimestamp);
  announce(state.view === 'overview' ? '街の全景を表示しました。' : '歩いていた場所へ戻りました。');
}

function moveWorldDirection(direction, timestamp = performance.now()) {
  if (!beginWorldExploration()) return;
  if (state.worldMovement) {
    state.worldPendingDirection = direction;
    return;
  }
  const next = nextNodeForDirection(state.worldNodeId, direction);
  state.worldDirection = direction;
  if (next.id !== state.worldNodeId) queueWorldPath([nearestNavigationNode(state.worldPosition.x, state.worldPosition.y), next], timestamp);
  else draw(state.lastTimestamp);
}

function moveSiteDirection(direction) {
  if (state.siteMovement) {
    state.siteQueue = [];
    return;
  }
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
  if (!anchor) {
    announce('施設名の表示がある入口まで移動してください。');
    return;
  }
  state.selectedAnchor = anchor;
  const recipes = siteRecipesForFacility(facility?.kind ?? anchor.kind);
  if (recipes.length === 1) enterSite(recipes[0].id);
  else showSiteChoice(recipes);
}

function enterSite(siteId) {
  const recipe = siteRecipeById(siteId);
  if (!recipe || !canPlay()) return;
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
  if (recipe.facilityKind === 'dojo' && state.journey.stage === 'reach_dojo') state.journey.stage = 'inspect_dojo';
  if (recipe.facilityKind === 'house' && state.journey.stage === 'reach_house') {
    state.journey.secondFacilityVisited = true;
    state.journey.stage = 'complete';
  }
  elements.canvas.dataset.mode = 'site';
  closeJournal({ restoreFocus: false });
  closeSiteChoice({ restoreFocus: false });
  updateFacilityDetail();
  updateSummary();
  updateInteractionPrompt();
  updateJourney();
  elements.canvas.focus();
  const facility = facilityForAnchor(anchor);
  const prefix = facility?.present === true ? '' : '未確認区画の';
  announce(`${prefix}${recipe.label}に入りました。光る入口まで歩くと根拠を確認できます。`);
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
    state.selectedAnchor = state.anchors.find((anchor) => anchor.kind === saved.selectedKind) ?? state.selectedAnchor;
  }
  if (state.journey.evidenceViewed && !state.journey.returnedToWorld) {
    state.journey.returnedToWorld = true;
    state.journey.stage = 'reach_house';
    state.selectedAnchor = FACILITY_ANCHORS.house;
  } else if (state.journey.stage === 'inspect_dojo') state.journey.stage = 'reach_dojo';
  elements.canvas.dataset.mode = 'world';
  updateNearbyAnchor();
  updateSummary();
  updateInteractionPrompt();
  updateJourney();
  elements.canvas.focus();
  announce(state.journey.stage === 'reach_house' ? '街へ戻りました。次は森の住宅へ向かいます。' : '同じ街道の位置へ戻りました。');
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
    const point = screenToSite(state.camera, screen);
    if (!point) return;
    const target = nearestSiteNode(state.siteRecipe, point.x / 64, point.y / 64);
    const path = shortestSitePath(state.siteRecipe, state.siteNodeId, target.id);
    if (state.siteMovement) state.siteQueue = path.slice(1);
    else queueSitePath(path);
    elements.canvas.focus();
    return;
  }
  const world = screenToWorld(state.camera, screen);
  if (!world || !beginWorldExploration()) return;
  const target = nearestNavigationNode(world.x, world.y);
  const path = shortestNavigationPath(state.worldNodeId, target.id);
  const anchor = nearestFacilityAnchor(world.x, world.y, state.anchors, 52 / state.camera.scale);
  if (anchor) state.selectedAnchor = anchor;
  const started = queueWorldPath(path);
  updateFacilityDetail();
  elements.canvas.focus();
  if (started) {
    announce(anchor ? `${anchor.label}へ向かっています。近くでEnterまたはSpaceを押してください。` : `${districtLabel(target)}へ移動しています。`);
  } else announceWorldArrival();
}

function handleCanvasMove(event) {
  if (!state.worldReady || state.view === 'site' || !state.camera) return;
  const world = screenToWorld(state.camera, canvasPoint(event));
  const next = world ? nearestFacilityAnchor(world.x, world.y, state.anchors, 44 / state.camera.scale) : null;
  if (next?.kind === state.hoveredAnchor?.kind) return;
  state.hoveredAnchor = next;
  elements.canvas.title = next?.label ?? '';
  draw(state.lastTimestamp);
}

function handleCanvasKey(event) {
  const direction = directionForKey[event.key];
  if (direction) {
    event.preventDefault();
    if (state.view === 'site') moveSiteDirection(direction);
    else {
      state.worldHeldDirection = direction;
      moveWorldDirection(direction);
    }
    return;
  }
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (state.view === 'site') {
    if (currentSiteNearEvidence()) openCurrentEvidence();
    else announce('施設の奥まで歩くと、根拠を確認できます。');
  } else if (beginWorldExploration()) tryEnterSelectedFacility();
}

async function loadTown() {
  try {
    const response = await fetch('/api/town/legacy', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.town = await response.json();
    updateNearbyAnchor();
  } catch {
    state.town = null;
    state.nearbyAnchor = null;
    announce('検査情報を取得できませんでした。施設は未確認として表示します。');
  }
  updateSummary();
  updateFacilityDetail();
}

async function loadAssets() {
  try {
    const siteAudit = auditSiteRecipes();
    const usageAudit = auditRuntimeAssetUsage();
    const worldAudit = auditWorldMap();
    if (!siteAudit.ok || !usageAudit.ok || !worldAudit.ok) throw new Error('街の地理または素材の検証に失敗しました。');
    state.assets = await loadForgeAssetImages();
    state.worldReady = true;
    elements.loading.hidden = true;
    resizeCanvas();
    updateNearbyAnchor();
    updateDistrictBanner();
    updateJourney();
  } catch (error) {
    state.assets = null;
    state.worldReady = false;
    state.assetError = error;
    elements.loading.hidden = true;
    elements.assetErrorText.textContent = error?.message || '承認済み素材を読み込めません。';
    elements.assetError.hidden = false;
    announce('街を開けませんでした。承認済み素材を確認してください。');
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
window.addEventListener('keyup', (event) => {
  const direction = directionForKey[event.key];
  if (direction && state.worldHeldDirection === direction) state.worldHeldDirection = null;
});
elements.overviewButton.addEventListener('click', toggleOverview);
elements.backButton.addEventListener('click', returnToWorld);
elements.journalButton.addEventListener('click', () => openJournal(elements.journalButton));
elements.journalClose.addEventListener('click', () => closeJournal());
elements.siteEnterButton.addEventListener('click', () => {
  const facility = selectedFacility();
  const kind = facility?.kind ?? state.selectedAnchor?.kind;
  if (!kind) return;
  const recipes = siteRecipesForFacility(kind);
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
  else if (state.view === 'overview') toggleOverview();
});

elements.canvas.dataset.mode = 'world';
updateSummary();
updateFacilityDetail();
updateJourney();
window.requestAnimationFrame(animationTick);

Promise.allSettled([loadTown(), loadAssets()]).then(() => {
  if (!state.worldReady) return;
  elements.canvas.focus();
  announce('街が開きました。矢印キー、WASD、または金色の道のクリックで歩けます。');
});
