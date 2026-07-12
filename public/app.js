// public/app.js — CodeCity Inspector placeholder frontend.
//
// Vanilla browser JS, no build step, no dependencies, no image assets. Fetches
// GET /api/town and renders it four ways: a procedurally-drawn pixel-grid town
// canvas, a habitability panel (incl. the "誰も住めません" headline), a
// building-details panel that splits a facility's evidence into observed /
// inferred / unknown, and the 5-tab 接続者ギルド roster modal.
//
// CSP contract (server sends: script-src 'self'; style-src 'self'; no
// unsafe-inline): this file is loaded as an external <script src="/app.js">,
// never writes el.style.* and sets no style attributes — every visual state is
// a class or the [hidden] attribute, owned by styles.css. The ONLY per-node
// geometry it sets is the canvas drawing-buffer resolution (canvas.width /
// canvas.height IDL properties) plus 2D canvas drawing, which CSP does not
// govern. The JP vocabulary below is mirrored from src/town/schema.mjs because
// that module lives outside the served public/ root and cannot be imported.

'use strict';

// ---------------------------------------------------------------------------
// Vocabulary mirrored from src/town/schema.mjs (frozen contract).
// ---------------------------------------------------------------------------

const FACILITY_LABELS = {
  inn: '宿屋', pub: '酒場', guild: '接続者ギルド', town_hall: '役場',
  dock: '船着場', warehouse: '倉庫', well: '井戸', workshop: '工房',
  dojo: '道場', watchtower: '見張り台', house: '住宅', shop: '商店',
  ruin: '廃屋', gate: '門'
};

const GUILD_TABS = ['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい'];
const EVIDENCE_LABELS = { observed: '観測', inferred: '推測', unknown: '不明' };

// Kept in sync with src/town/habitability.mjs; the same string is unshifted
// into reasons[] when !canLive, so we filter it out of the reasons list and
// show it once, prominently, in its dedicated headline element instead.
const HEADLINE_CANNOT_LIVE = 'このままだと誰も住めません！';

// One fill per TILE_TYPES id (12); unmapped ids get the loud fallback so a
// vocabulary drift is visible rather than silent.
const TILE_COLORS = {
  grass: '#4a8f3c', dirt: '#8a6a3f', path: '#c7ac7c', road: '#b89a63',
  sand: '#e3d2a0', water: '#3a72b0', bridge: '#9c7a4f', plaza: '#d8cdb0',
  floor: '#e9e4d6', wall: '#33302b', rock: '#8a8a86', tree: '#2f6b2a'
};
const UNKNOWN_TILE_COLOR = '#b23a9c';

// One tint per FACILITY_KINDS id (14).
const FACILITY_COLORS = {
  inn: '#b5651d', pub: '#a4478a', guild: '#6a4fb3', town_hall: '#c9a227',
  dock: '#2f6f8f', warehouse: '#7a6a4f', well: '#4a90a4', workshop: '#c97a3d',
  dojo: '#3f7d4f', watchtower: '#5a5a6a', house: '#8fae5f', shop: '#d98c3d',
  ruin: '#6b6459', gate: '#9c9c9c'
};
const UNKNOWN_FACILITY_COLOR = '#b23a9c';

// One fill per PROP_KINDS id (12).
const PROP_COLORS = {
  well: '#4a90a4', barrel: '#8a5a2f', crate: '#a4783f', signboard: '#caa863',
  lamp: '#e8c96a', plant: '#4f8f4a', todo_grass: '#c9c15a', scaffold: '#b08a52',
  fence: '#9c8a6a', flag: '#c94f4f', bench: '#7a5a3f', rubble: '#6b645a'
};
const DEFAULT_PROP_COLOR = '#8a7a5f';

// The last three NPC_ROLES are ambient mobs — drawn lighter and smaller than
// the facility-anchored roles (innkeeper, clerk, inspector, ...).
const NPC_MOB_ROLES = new Set(['townsfolk', 'traveler', 'child']);

const DIRECTION_VECTORS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentTown = null;
let selectedKind = null; // facilityKind driving both the details panel and the canvas outline
let activeGuildTab = GUILD_TABS[0];
let guildOpenerEl = null;

// ---------------------------------------------------------------------------
// DOM cache
// ---------------------------------------------------------------------------

const el = {};

function cacheDom() {
  el.repoName = document.getElementById('repo-name');
  el.seedBadge = document.getElementById('seed-badge');
  el.seedShort = document.getElementById('seed-short');
  el.levelBadge = document.getElementById('level-badge');
  el.levelNum = document.getElementById('level-num');
  el.levelName = document.getElementById('level-name');
  el.reloadBtn = document.getElementById('reload-btn');
  el.openGuildBtn = document.getElementById('open-guild-btn');
  el.errorBanner = document.getElementById('error-banner');
  el.canvas = document.getElementById('town-canvas');
  el.canvasEmptyState = document.getElementById('canvas-empty-state');

  el.cannotLiveHeadline = document.getElementById('cannot-live-headline');
  el.habLevelText = document.getElementById('hab-level-text');
  el.habCanLiveText = document.getElementById('hab-can-live-text');
  el.habBlockersList = document.getElementById('hab-blockers-list');
  el.habBlockersCount = document.getElementById('hab-blockers-count');
  el.habWarningsList = document.getElementById('hab-warnings-list');
  el.habWarningsCount = document.getElementById('hab-warnings-count');
  el.habPendingList = document.getElementById('hab-pending-list');
  el.habPendingCount = document.getElementById('hab-pending-count');
  el.habReasonsList = document.getElementById('hab-reasons-list');

  el.buildingDetailsEmpty = document.getElementById('building-details-empty');
  el.buildingDetailsContent = document.getElementById('building-details-content');
  el.bdFacilityLabel = document.getElementById('bd-facility-label');
  el.bdFacilityKind = document.getElementById('bd-facility-kind');
  el.bdFacilityPresent = document.getElementById('bd-facility-present');
  el.bdFacilityCount = document.getElementById('bd-facility-count');
  el.bdBuildingState = document.getElementById('bd-building-state');
  el.bdEvidenceObserved = document.getElementById('bd-evidence-observed');
  el.bdEvidenceInferred = document.getElementById('bd-evidence-inferred');
  el.bdEvidenceUnknown = document.getElementById('bd-evidence-unknown');
  el.facilityList = document.getElementById('facility-list');

  el.guildModal = document.getElementById('guild-modal');
  el.guildBackdrop = document.getElementById('guild-backdrop');
  el.guildCloseBtn = document.getElementById('guild-close-btn');
  el.guildUnavailable = document.getElementById('guild-unavailable');
  el.guildBody = document.getElementById('guild-body');
  el.guildTabs = Array.from(document.querySelectorAll('.guild-tab'));
  el.guildTabpanels = Array.from(document.querySelectorAll('.guild-tabpanel'));
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function init() {
  cacheDom();
  el.reloadBtn.addEventListener('click', loadTown);
  el.openGuildBtn.addEventListener('click', () => {
    if (currentTown) openGuildModal(currentTown.model, el.openGuildBtn);
  });
  el.canvas.addEventListener('click', onCanvasClick);
  el.guildBackdrop.addEventListener('click', closeGuildModal);
  el.guildCloseBtn.addEventListener('click', closeGuildModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.guildModal.hidden) closeGuildModal();
  });
  for (const tabBtn of el.guildTabs) {
    tabBtn.addEventListener('click', () => selectGuildTab(tabBtn.dataset.tab));
  }
  wireGuildTabKeyboardNav();
  loadTown();
}

async function loadTown() {
  showError(null);
  el.reloadBtn.disabled = true;
  try {
    let response;
    try {
      response = await fetch('/api/town', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    } catch {
      throw new Error('サーバーに接続できませんでした（/api/town）。');
    }
    if (!response.ok) throw new Error(`サーバーがエラーを返しました（HTTP ${response.status}）。`);
    const town = await response.json();
    if (!isValidTown(town)) throw new Error('/api/town の応答形式がこの画面の想定と一致しません。');
    currentTown = town;
    renderAll(town);
  } catch (err) {
    currentTown = null;
    showError(`町の読み込みに失敗しました: ${err && err.message ? err.message : err}`);
  } finally {
    el.reloadBtn.disabled = false;
  }
}

function isValidTown(town) {
  return Boolean(
    town && town.schemaVersion === 1 &&
    town.habitability && town.model && Array.isArray(town.model.facilities) &&
    town.layout && town.layout.map && Array.isArray(town.layout.map.terrain) &&
    Array.isArray(town.layout.buildings)
  );
}

function showError(message) {
  if (!message) {
    el.errorBanner.hidden = true;
    el.errorBanner.textContent = '';
    return;
  }
  el.errorBanner.hidden = false;
  el.errorBanner.textContent = message;
}

function renderAll(town) {
  renderHeader(town);
  drawTown(town.layout);
  renderHabitabilityPanel(town.habitability);
  renderFacilityList(town.model);
  selectKind(null);

  const pubPresent = Boolean(findFacility(town.model, 'pub') && findFacility(town.model, 'pub').present);
  el.openGuildBtn.disabled = !pubPresent;

  el.canvasEmptyState.hidden = (town.layout.buildings || []).length > 0;
}

function renderHeader(town) {
  el.repoName.textContent = (town.repository && town.repository.name) || '(不明なリポジトリ)';
  const seed = String(town.seed == null ? '' : town.seed);
  el.seedShort.textContent = seed.length > 10 ? `${seed.slice(0, 10)}…` : (seed || '----');
  el.seedBadge.title = seed ? `full seed: ${seed}` : '';

  const level = (town.habitability && town.habitability.level) || 0;
  el.levelBadge.dataset.level = String(level);
  el.levelNum.textContent = String(level);
  el.levelName.textContent = (town.habitability && town.habitability.levelName) || '-';
}

function findFacility(model, kind) {
  return (model && model.facilities ? model.facilities : []).find((f) => f.kind === kind) || null;
}

function findBuildingByKind(layout, kind) {
  if (kind == null) return null;
  return (layout && layout.buildings ? layout.buildings : []).find((b) => b.facilityKind === kind) || null;
}

// ===========================================================================
// Habitability panel (reads town.habitability)
// ===========================================================================

function renderHabitabilityPanel(hab) {
  if (!hab) return;

  el.cannotLiveHeadline.hidden = hab.canLive !== false;

  el.habLevelText.textContent = `Lv.${hab.level} ${hab.levelName || ''}`.trim();
  el.habCanLiveText.textContent = hab.canLive ? '住める' : '住めない';
  el.habCanLiveText.className = hab.canLive ? 'hab-can-live-yes' : 'hab-can-live-no';

  // The cannot-live headline owns HEADLINE_CANNOT_LIVE, so drop it from reasons.
  const reasons = (Array.isArray(hab.reasons) ? hab.reasons : []).filter((r) => r !== HEADLINE_CANNOT_LIVE);

  renderHabList(el.habBlockersList, hab.blockers, '(ブロッカーなし)');
  renderHabList(el.habWarningsList, hab.warnings, '(警告なし)');
  renderHabList(el.habPendingList, hab.pendingInspections, '(検査待ちなし)');
  renderHabList(el.habReasonsList, reasons, '(理由なし)');

  el.habBlockersCount.textContent = String((hab.blockers || []).length);
  el.habWarningsCount.textContent = String((hab.warnings || []).length);
  el.habPendingCount.textContent = String((hab.pendingInspections || []).length);
}

function renderHabList(ulEl, items, emptyText) {
  ulEl.textContent = '';
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'hab-list-empty';
    li.textContent = emptyText;
    ulEl.appendChild(li);
    return;
  }
  for (const item of list) {
    const li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : String(item);
    ulEl.appendChild(li);
  }
}

// ===========================================================================
// Facility list + building details (reads town.model.facilities, town.layout)
// ===========================================================================

function renderFacilityList(model) {
  el.facilityList.textContent = '';
  for (const facility of (model && model.facilities ? model.facilities : [])) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.kind = facility.kind;
    btn.dataset.present = String(Boolean(facility.present));
    btn.addEventListener('click', () => {
      selectKind(facility.kind);
      if (facility.kind === 'pub' && facility.present) openGuildModal(model, btn);
    });

    const label = document.createElement('span');
    label.textContent = `${FACILITY_LABELS[facility.kind] || facility.kind} (${facility.kind})`;
    const count = document.createElement('span');
    count.className = 'fl-count';
    count.textContent = facility.present ? `x${facility.count || 0}` : 'なし';

    btn.appendChild(label);
    btn.appendChild(count);
    li.appendChild(btn);
    el.facilityList.appendChild(li);
  }
}

// Single selection path shared by canvas clicks and facility-list clicks.
function selectKind(kind) {
  selectedKind = kind;
  renderBuildingDetails(kind);
  syncFacilityListSelection();
  if (currentTown) drawTown(currentTown.layout);
}

function syncFacilityListSelection() {
  for (const btn of el.facilityList.querySelectorAll('button')) {
    if (btn.dataset.kind === selectedKind) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  }
}

function renderBuildingDetails(kind) {
  const facility = kind == null ? null : findFacility(currentTown && currentTown.model, kind);
  if (!facility) {
    el.buildingDetailsEmpty.hidden = false;
    el.buildingDetailsContent.hidden = true;
    return;
  }
  el.buildingDetailsEmpty.hidden = true;
  el.buildingDetailsContent.hidden = false;

  el.bdFacilityLabel.textContent = FACILITY_LABELS[facility.kind] || facility.kind;
  el.bdFacilityKind.textContent = facility.kind;
  el.bdFacilityPresent.textContent = facility.present ? 'あり' : 'なし';
  el.bdFacilityCount.textContent = String(facility.count || 0);

  const building = findBuildingByKind(currentTown && currentTown.layout, kind);
  el.bdBuildingState.textContent = building ? (building.state || '-') : '（この街に建物なし）';

  const evidence = facility.evidence || { observed: [], inferred: [], unknown: [] };
  renderEvidenceList(el.bdEvidenceObserved, evidence.observed);
  renderEvidenceList(el.bdEvidenceInferred, evidence.inferred);
  renderEvidenceList(el.bdEvidenceUnknown, evidence.unknown);
}

function renderEvidenceList(ulEl, items) {
  ulEl.textContent = '';
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    const li = document.createElement('li');
    li.textContent = '(なし)';
    ulEl.appendChild(li);
    return;
  }
  for (const item of list) {
    const li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : JSON.stringify(item);
    ulEl.appendChild(li);
  }
}

// ===========================================================================
// 接続者ギルド roster modal (reads town.model.guild[tab])
// ===========================================================================

function openGuildModal(model, openerEl) {
  const pubFacility = findFacility(model, 'pub');
  const pubPresent = Boolean(pubFacility && pubFacility.present);

  guildOpenerEl = openerEl || document.activeElement;
  el.guildModal.hidden = false;

  if (!pubPresent || !model || !model.guild) {
    el.guildUnavailable.hidden = false;
    el.guildBody.hidden = true;
    el.guildCloseBtn.focus();
    return;
  }

  el.guildUnavailable.hidden = true;
  el.guildBody.hidden = false;

  for (const tab of GUILD_TABS) renderGuildTab(tab, model.guild[tab]);
  selectGuildTab(activeGuildTab || GUILD_TABS[0]);
  el.guildCloseBtn.focus();
}

function closeGuildModal() {
  el.guildModal.hidden = true;
  if (guildOpenerEl && typeof guildOpenerEl.focus === 'function') guildOpenerEl.focus();
  guildOpenerEl = null;
}

function selectGuildTab(tabName) {
  activeGuildTab = tabName;
  for (const btn of el.guildTabs) {
    const isActive = btn.dataset.tab === tabName;
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  }
  for (const panel of el.guildTabpanels) {
    panel.hidden = panel.dataset.tabpanel !== tabName;
  }
}

function wireGuildTabKeyboardNav() {
  const tabs = el.guildTabs;
  tabs.forEach((btn, index) => {
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const nextIndex = e.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      selectGuildTab(tabs[nextIndex].dataset.tab);
    });
  });
}

function renderGuildTab(tabName, items) {
  const panel = el.guildTabpanels.find((p) => p.dataset.tabpanel === tabName);
  if (!panel) return;
  const listEl = panel.querySelector('.guild-item-list');
  listEl.textContent = '';

  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'guild-empty';
    li.textContent = '(この街ではまだ登録がありません)';
    listEl.appendChild(li);
    return;
  }
  for (const item of list) {
    listEl.appendChild(tabName === 'もちもの' ? renderGuildBelongingItem(item) : renderGuildItem(item));
  }
}

function evidenceBadge(evidenceClass) {
  const cls = ['observed', 'inferred', 'unknown'].includes(evidenceClass) ? evidenceClass : 'unknown';
  const span = document.createElement('span');
  span.className = `evidence-badge evidence-badge-${cls}`;
  span.textContent = EVIDENCE_LABELS[cls];
  return span;
}

// Generic renderer for なかま {name,type} / うけつけ {path,name,kind} /
// いらい {label,direction,note} / じょうたい {label,value,note}. Probes common
// field names so it stays correct across all four real shapes (see
// src/town/detect.mjs) without hard-coding one of them.
function renderGuildItem(item) {
  const li = document.createElement('li');
  li.className = 'guild-item';
  if (!item || typeof item !== 'object') {
    li.textContent = String(item);
    return li;
  }

  const primary = document.createElement('div');
  primary.className = 'guild-item-primary';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'guild-item-name';
  nameSpan.textContent = String(item.name || item.label || item.path || '(不明な項目)');
  primary.appendChild(nameSpan);

  if (item.value !== undefined && item.value !== null && item.value !== '') {
    const valueSpan = document.createElement('span');
    valueSpan.className = 'guild-item-value';
    valueSpan.textContent = `：${item.value}`;
    primary.appendChild(valueSpan);
  }

  primary.appendChild(evidenceBadge(item.evidenceClass));
  li.appendChild(primary);

  const secondaryParts = [];
  if (item.type) secondaryParts.push(item.type);
  if (item.kind) secondaryParts.push(item.kind);
  if (item.direction) secondaryParts.push(item.direction);
  if (item.path && item.name) secondaryParts.push(item.path);
  if (secondaryParts.length > 0) {
    const secondary = document.createElement('div');
    secondary.className = 'guild-item-secondary';
    secondary.textContent = secondaryParts.join(' / ');
    li.appendChild(secondary);
  }

  if (item.note) {
    const note = document.createElement('div');
    note.className = 'guild-item-note';
    note.textContent = item.note;
    li.appendChild(note);
  }
  return li;
}

// もちもの items are { category, items: string[], evidenceClass, note } — the
// nested string items render as chips under the category header.
function renderGuildBelongingItem(item) {
  const li = document.createElement('li');
  li.className = 'guild-item';
  if (!item || typeof item !== 'object') {
    li.textContent = String(item);
    return li;
  }

  const primary = document.createElement('div');
  primary.className = 'guild-item-primary';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'guild-item-name';
  nameSpan.textContent = String(item.category || '(不明なカテゴリ)');
  primary.appendChild(nameSpan);
  primary.appendChild(evidenceBadge(item.evidenceClass));
  li.appendChild(primary);

  if (item.note) {
    const note = document.createElement('div');
    note.className = 'guild-item-note';
    note.textContent = item.note;
    li.appendChild(note);
  }

  const chipItems = Array.isArray(item.items) ? item.items : [];
  if (chipItems.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'guild-item-chips';
    for (const chipText of chipItems) {
      const chip = document.createElement('span');
      chip.className = 'guild-item-chip';
      chip.textContent = String(chipText);
      chips.appendChild(chip);
    }
    li.appendChild(chips);
  }
  return li;
}

// ===========================================================================
// Canvas town rendering (reads town.layout) — procedural, no image assets
// ===========================================================================

// FNV-1a-ish hash for stable per-tile dithering only (never layout logic).
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function clamp8(n) { return Math.max(0, Math.min(255, n)); }

// Lighten (amount>0) / darken (amount<0) a #rrggbb color by amount in -1..1.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp8(((n >> 16) & 255) + Math.round(255 * amount));
  const g = clamp8(((n >> 8) & 255) + Math.round(255 * amount));
  const b = clamp8((n & 255) + Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function drawTown(layout) {
  const ctx = el.canvas.getContext('2d');
  const map = layout && layout.map;
  if (!map || !Array.isArray(map.terrain)) {
    el.canvas.width = 1;
    el.canvas.height = 1;
    return;
  }
  const tileSize = map.tileSize || 16;
  const width = map.widthTiles * tileSize;
  const height = map.heightTiles * tileSize;
  if (el.canvas.width !== width) el.canvas.width = width;
  if (el.canvas.height !== height) el.canvas.height = height;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);

  drawTerrain(ctx, map, tileSize);
  drawRoadsOverlay(ctx, layout.roads || [], tileSize);
  for (const building of layout.buildings || []) {
    drawBuilding(ctx, building, tileSize, building.facilityKind === selectedKind);
  }
  drawProps(ctx, layout.props || [], tileSize);
  drawNpcs(ctx, layout.npcs || [], tileSize);

  el.canvas.setAttribute('aria-label', ariaSummary(currentTown));
}

function drawTerrain(ctx, map, tileSize) {
  const terrain = map.terrain;
  for (let y = 0; y < terrain.length; y += 1) {
    const row = terrain[y] || [];
    for (let x = 0; x < row.length; x += 1) {
      const base = TILE_COLORS[row[x]] || UNKNOWN_TILE_COLOR;
      const dither = (hash(`${x},${y},${row[x]}`) & 3) === 0;
      ctx.fillStyle = dither ? shade(base, -0.05) : base;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }
}

// A worn wheel-rut along each road polyline, on top of the plain road terrain.
function drawRoadsOverlay(ctx, roads, tileSize) {
  ctx.save();
  ctx.strokeStyle = 'rgba(74, 62, 42, 0.35)';
  ctx.lineWidth = Math.max(1, Math.round(tileSize * 0.12));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of roads) {
    const tiles = road && road.tiles;
    if (!tiles || tiles.length === 0) continue;
    ctx.beginPath();
    tiles.forEach(([x, y], i) => {
      const cx = x * tileSize + tileSize / 2;
      const cy = y * tileSize + tileSize / 2;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function drawHatching(ctx, px, py, pw, ph) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.lineWidth = 1;
  for (let d = -ph; d < pw + ph; d += 5) {
    ctx.beginPath();
    ctx.moveTo(px + d, py);
    ctx.lineTo(px + d + ph, py + ph);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBuilding(ctx, building, tileSize, isSelected) {
  const footprint = building.footprint || { widthTiles: 1, heightTiles: 1 };
  const px = building.x * tileSize;
  const py = building.y * tileSize;
  const pw = footprint.widthTiles * tileSize;
  const ph = footprint.heightTiles * tileSize;
  const fill = FACILITY_COLORS[building.facilityKind] || UNKNOWN_FACILITY_COLOR;

  ctx.save();
  if (building.state === 'vacant') ctx.globalAlpha = 0.55; // "not lit yet", never "broken"
  ctx.fillStyle = fill;
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();

  if (building.state === 'ruined' || building.state === 'under_construction') {
    drawHatching(ctx, px, py, pw, ph);
  }

  ctx.strokeStyle = isSelected ? '#ffe066' : shade(fill, -0.35);
  ctx.lineWidth = isSelected ? 3 : 1;
  ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, pw - ctx.lineWidth, ph - ctx.lineWidth);

  if (building.state === 'busy') {
    ctx.fillStyle = '#fff2b0';
    ctx.font = `${Math.max(8, Math.round(tileSize * 0.5))}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('*', px + pw - 2, py + 1);
  }

  const label = FACILITY_LABELS[building.facilityKind] || building.facilityKind;
  const fontSize = Math.max(7, Math.min(14, Math.floor(Math.min(pw, ph) * 0.42)));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.18));
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.strokeText(label, px + pw / 2, py + ph / 2);
  ctx.fillStyle = '#fbf6e8';
  ctx.fillText(label, px + pw / 2, py + ph / 2);

  if (building.entrance) drawEntranceMarker(ctx, building.entrance, tileSize);
}

function drawEntranceMarker(ctx, entrance, tileSize) {
  const ex = entrance.x * tileSize;
  const ey = entrance.y * tileSize;
  ctx.fillStyle = '#f4d27a';
  ctx.fillRect(ex + 1, ey + 1, tileSize - 2, tileSize - 2);
  ctx.strokeStyle = '#8a6a2f';
  ctx.lineWidth = 1;
  ctx.strokeRect(ex + 0.5, ey + 0.5, tileSize - 1, tileSize - 1);

  // Chevron pointing the way the door faces (toward the walkable side).
  const [dx, dy] = DIRECTION_VECTORS[entrance.direction] || [0, 1];
  const cx = ex + tileSize / 2;
  const cy = ey + tileSize / 2;
  const size = tileSize * 0.24;
  ctx.fillStyle = '#5a3f1f';
  ctx.beginPath();
  ctx.moveTo(cx + dx * size, cy + dy * size);
  ctx.lineTo(cx - dy * size * 0.7 - dx * size * 0.2, cy + dx * size * 0.7 - dy * size * 0.2);
  ctx.lineTo(cx + dy * size * 0.7 - dx * size * 0.2, cy - dx * size * 0.7 - dy * size * 0.2);
  ctx.closePath();
  ctx.fill();
}

function drawProps(ctx, props, tileSize) {
  const size = Math.max(3, Math.round(tileSize * 0.4));
  for (const prop of props) {
    const cx = prop.x * tileSize + tileSize / 2;
    const cy = prop.y * tileSize + tileSize / 2;
    ctx.fillStyle = PROP_COLORS[prop.kind] || DEFAULT_PROP_COLOR;
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - size / 2 + 0.5, cy - size / 2 + 0.5, size - 1, size - 1);
  }
}

function drawNpcs(ctx, npcs, tileSize) {
  for (const npc of npcs) {
    const isMob = NPC_MOB_ROLES.has(npc.role);
    const cx = npc.x * tileSize + tileSize / 2;
    const cy = npc.y * tileSize + tileSize / 2;
    const radius = tileSize * (isMob ? 0.2 : 0.3);
    ctx.beginPath();
    ctx.fillStyle = isMob ? '#fff3d6' : '#f2c14e';
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const [dx, dy] = DIRECTION_VECTORS[npc.facing] || [0, 1];
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * radius * 1.4, cy + dy * radius * 1.4);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.stroke();
  }
}

// Pointer -> tile coordinates, correct regardless of how CSS scales the canvas.
function tileFromEvent(canvas, tileSize, event) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const px = (event.clientX - rect.left) * (canvas.width / rect.width);
  const py = (event.clientY - rect.top) * (canvas.height / rect.height);
  const x = Math.floor(px / tileSize);
  const y = Math.floor(py / tileSize);
  if (x < 0 || y < 0) return null;
  return { x, y };
}

function buildingAtTile(layout, x, y) {
  for (const b of layout.buildings || []) {
    const fp = b.footprint || { widthTiles: 1, heightTiles: 1 };
    if (x >= b.x && x < b.x + fp.widthTiles && y >= b.y && y < b.y + fp.heightTiles) return b;
  }
  return null;
}

function onCanvasClick(evt) {
  const layout = currentTown && currentTown.layout;
  if (!layout || !layout.map) return;
  const tile = tileFromEvent(el.canvas, layout.map.tileSize || 16, evt);
  if (!tile) return;
  const building = buildingAtTile(layout, tile.x, tile.y);
  selectKind(building ? building.facilityKind : null);
  if (building && building.facilityKind === 'pub') {
    openGuildModal(currentTown.model, el.canvas);
  }
}

function ariaSummary(town) {
  if (!town) return '町の地図。';
  const { repository, habitability, layout } = town;
  const map = layout.map;
  const buildings = layout.buildings || [];
  const npcs = layout.npcs || [];
  const buildingNote = buildings.length === 0 ? '建物なし' : `建物${buildings.length}棟`;
  return `${(repository && repository.name) || ''} の街並み。` +
    `${map.widthTiles}×${map.heightTiles}タイル、${buildingNote}、NPC${npcs.length}体。` +
    `到達レベル Lv.${habitability.level}「${habitability.levelName}」（${habitability.canLive ? '居住可' : '居住不可'}）。`;
}

document.addEventListener('DOMContentLoaded', init);
