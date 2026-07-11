(() => {
  'use strict';

  const canvas = document.querySelector('#city-canvas');
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;

  const elements = {
    state: document.querySelector('#map-state'),
    repo: document.querySelector('#repo-label'),
    services: document.querySelector('#service-list'),
    scanNote: document.querySelector('#scan-note'),
    reload: document.querySelector('#reload-button'),
    placeholder: document.querySelector('#building-placeholder'),
    details: document.querySelector('#building-details'),
    kind: document.querySelector('#building-kind'),
    title: document.querySelector('#building-title'),
    path: document.querySelector('#building-path'),
    facts: document.querySelector('#building-facts'),
    evidence: document.querySelector('#building-evidence'),
    buildingList: document.querySelector('#building-list'),
    previousDistrict: document.querySelector('#previous-district'),
    nextDistrict: document.querySelector('#next-district'),
    districtLabel: document.querySelector('#district-label')
  };

  const PAGE_SIZE = 24;
  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const PALETTE = {
    ink: '#18202a',
    snow: '#81909a',
    snowLight: '#9aa6aa',
    snowDark: '#687984',
    cliff: '#52606a',
    cliffDark: '#35434d',
    cliffLight: '#73818a',
    road: '#7b7d78',
    roadDark: '#4a5256',
    roadLight: '#9a9688',
    water: '#355f73',
    waterDark: '#243f50',
    waterLight: '#7195a0',
    timber: '#594b45',
    timberLight: '#8c7560',
    wall: '#9a9180',
    wallShade: '#706c66',
    window: '#f1b85e',
    windowLight: '#ffe296',
    unknown: '#d5bd68',
    observed: '#7faf8c',
    broken: '#cf6257',
    cycle: '#c87d49'
  };
  const ASSET_SPECS = Object.freeze({
    buildings: { src: '/assets/buildings-atlas.png', width: 1536, height: 1024 },
    terrain: { src: '/assets/terrain-snow.png', width: 1254, height: 1254 },
    props: { src: '/assets/props-atlas.png', width: 1252, height: 1252 },
    inspector: { src: '/assets/inspector-sprite.png', width: 1254, height: 1254 }
  });
  const BUILDING_CELL = 512;
  const PROP_CELL = 313;
  const BUILDING_BASE_RATIO = [0.80, 0.80, 0.79, 0.68, 0.66, 0.69];
  const BUILDING_SCALE = [1, 1.22, 1, 1.10, 1.08, 1.18];
  const BUILDING_ALPHA_BOUNDS = [
    [97, 150, 445, 408], [189, 147, 329, 407], [76, 165, 377, 403],
    [141, 92, 391, 350], [154, 116, 382, 337], [148, 78, 275, 352]
  ];
  const assets = {};
  const assetState = { ready: false, promise: null };

  const state = {
    report: null,
    buildings: [],
    lots: [],
    selected: -1,
    page: 0,
    byId: new Map(),
    lotByPageId: new Map(),
    outgoing: new Map(),
    unresolved: new Map(),
    unknownDependencies: new Map(),
    cycleMembership: new Map()
  };

  function assertInspectionReport(report) {
    if (!report || report.schemaVersion !== 2 || !Array.isArray(report.city?.buildings) ||
        !Array.isArray(report.city?.connections) || !Array.isArray(report.inspection?.observed?.unresolvedLinks) ||
        !Array.isArray(report.inspection?.unknownDependencies) || !Array.isArray(report.inspection?.observed?.skipped) ||
        !report.inspection?.observed?.skipCounts || !Array.isArray(report.inspection?.inferred?.cycles) || !Array.isArray(report.inspection?.inferred?.testAssociations) ||
        !report.inspection?.inferred?.reachability || !report.summary || !report.repository) {
      throw new Error('点検結果の形式がこの画面に対応していません');
    }
    return report;
  }

  function indexReport(report) {
    state.byId = new Map(report.city.buildings.map((building) => [building.id, building]));
    state.outgoing = new Map(report.city.buildings.map((building) => [building.id, []]));
    for (const connection of report.city.connections) {
      if (state.outgoing.has(connection.from)) state.outgoing.get(connection.from).push(connection);
    }
    state.unresolved = new Map(report.city.buildings.map((building) => [building.id, []]));
    for (const link of report.inspection.observed.unresolvedLinks) {
      if (state.unresolved.has(link.from)) state.unresolved.get(link.from).push(link);
    }
    state.unknownDependencies = new Map(report.city.buildings.map((building) => [building.id, []]));
    for (const dependency of report.inspection.unknownDependencies) {
      if (state.unknownDependencies.has(dependency.from)) state.unknownDependencies.get(dependency.from).push(dependency);
    }
    state.cycleMembership = new Map();
    report.inspection.inferred.cycles.forEach((cycle, cycleIndex) => {
      cycle.members.forEach((id) => state.cycleMembership.set(id, cycleIndex));
    });
  }

  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  function loadImage(name, spec) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (image.naturalWidth !== spec.width || image.naturalHeight !== spec.height) {
          const error = new Error(`${name} の寸法が不正です（${image.naturalWidth}x${image.naturalHeight}）`);
          error.kind = 'asset';
          reject(error);
          return;
        }
        assets[name] = image;
        resolve();
      };
      image.onerror = () => {
        const error = new Error(`${name} を読み込めませんでした`);
        error.kind = 'asset';
        reject(error);
      };
      image.src = spec.src;
    });
  }

  async function loadAssets() {
    if (assetState.ready) return;
    if (!assetState.promise) {
      assetState.promise = Promise.all(Object.entries(ASSET_SPECS).map(([name, spec]) => loadImage(name, spec)))
        .then(() => { assetState.ready = true; })
        .catch((error) => {
          assetState.promise = null;
          throw error;
        });
    }
    await assetState.promise;
  }

  function rect(x, y, width, height, fill) {
    context.fillStyle = fill;
    context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  }

  function polygon(points, fill) {
    context.fillStyle = fill;
    context.beginPath();
    context.moveTo(Math.round(points[0][0]), Math.round(points[0][1]));
    points.slice(1).forEach(([x, y]) => context.lineTo(Math.round(x), Math.round(y)));
    context.closePath();
    context.fill();
  }

  function steppedLine(points, outer, inner, width = 5) {
    context.lineJoin = 'miter';
    context.lineCap = 'square';
    context.strokeStyle = outer;
    context.lineWidth = width;
    context.beginPath();
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    context.stroke();
    context.strokeStyle = inner;
    context.lineWidth = Math.max(1, width - 3);
    context.stroke();
  }

  function drawCobblestonePath(points, seed, center = '#85867f') {
    const jittered = points.map(([x, y], index) => [
      x + ((seed >>> (index * 3)) % 3) - 1,
      y + ((seed >>> (index * 5 + 2)) % 3) - 1
    ]);
    steppedLine(jittered, '#4a5151', center, 5);
    context.save();
    context.globalAlpha = 0.78;
    for (let index = 0; index < jittered.length - 1; index += 1) {
      const [x1, y1] = jittered[index];
      const [x2, y2] = jittered[index + 1];
      const length = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let step = 6; step < length; step += 9) {
        const ratio = step / length;
        const x = Math.round(x1 + (x2 - x1) * ratio);
        const y = Math.round(y1 + (y2 - y1) * ratio);
        if ((hash(`${seed}:${index}:${step}`) & 3) !== 0) rect(x - 1, y - 1, 3, 1, '#b8b9ae');
      }
    }
    context.restore();
  }

  const COMPACT_SLOTS = [
    [12, 20], [67, 15], [128, 22], [190, 13], [253, 25],
    [34, 78], [98, 72], [162, 83], [235, 76],
    [9, 139], [71, 132], [137, 142], [207, 134], [269, 145],
    [33, 204], [103, 198], [174, 207], [246, 201],
    [8, 268], [68, 257], [132, 270], [198, 259], [260, 270], [307, 245]
  ];
  const SHOWCASE_SLOTS = [
    [20, 31], [123, 20], [231, 39], [53, 132], [178, 126], [255, 204],
    [24, 239], [128, 238], [228, 274], [288, 104], [94, 78], [178, 211]
  ];

  function createLots(buildings) {
    const lots = buildings.map((building, index) => {
      const page = Math.floor(index / PAGE_SIZE);
      const localIndex = index % PAGE_SIZE;
      const pageLength = Math.min(PAGE_SIZE, buildings.length - page * PAGE_SIZE);
      const showcase = pageLength <= 12;
      const [slotX, slotY] = (showcase ? SHOWCASE_SLOTS : COMPACT_SLOTS)[localIndex];
      const seed = hash(building.path);
      const width = showcase ? 68 + (seed % 12) : 42 + (seed % 8);
      const height = showcase ? 54 + ((seed >>> 4) % 10) : 37 + ((seed >>> 4) % 8);
      return {
        x: Math.min(slotX + (seed % 4), WIDTH - width - 5),
        y: slotY + ((seed >>> 8) % 4),
        width,
        height,
        spriteSize: showcase ? 122 : 78,
        page,
        building
      };
    });
    state.lotByPageId = new Map(lots.map((lot) => [`${lot.page}\0${lot.building.id}`, lot]));
    return lots;
  }

  function drawAtlasCell(image, index, columns, cellWidth, cellHeight, x, y, width, height, mirror = false) {
    const sourceX = (index % columns) * cellWidth;
    const sourceY = Math.floor(index / columns) * cellHeight;
    context.save();
    if (mirror) {
      context.translate(Math.round(x + width), 0);
      context.scale(-1, 1);
      context.drawImage(image, sourceX, sourceY, cellWidth, cellHeight, 0, Math.round(y), Math.round(width), Math.round(height));
    } else {
      context.drawImage(image, sourceX, sourceY, cellWidth, cellHeight, Math.round(x), Math.round(y), Math.round(width), Math.round(height));
    }
    context.restore();
  }

  function drawProp(index, x, y, size, mirror = false) {
    drawAtlasCell(assets.props, index, 4, PROP_CELL, PROP_CELL, x, y, size, size, mirror);
  }

  function drawTerrainTexture() {
    const cropWidth = 1120;
    const cropHeight = 980;
    const seed = hash(`terrain:${state.page}`);
    const sourceX = seed % (ASSET_SPECS.terrain.width - cropWidth + 1);
    const sourceY = (seed >>> 8) % (ASSET_SPECS.terrain.height - cropHeight + 1);
    context.save();
    if (seed & 1) {
      context.translate(WIDTH, 0);
      context.scale(-1, 1);
    }
    context.drawImage(assets.terrain, sourceX, sourceY, cropWidth, cropHeight, 0, 0, WIDTH, HEIGHT);
    context.restore();
  }

  function drawElevationBand(y, phase) {
    context.save();
    context.globalAlpha = 0.48;
    polygon([[0, y], [54, y - 5], [110, y + 1], [166, y - 6], [223, y], [279, y - 7], [334, y - 1], [334, y + 14], [279, y + 9], [223, y + 15], [166, y + 9], [110, y + 15], [54, y + 9], [0, y + 14]], PALETTE.cliffDark);
    context.restore();
    steppedLine([[0, y - 2], [54, y - 7], [110, y - 1], [166, y - 8], [223, y - 2], [279, y - 9], [334, y - 3]], '#35434d', '#aeb8b8', 4);
    for (let x = phase; x < 330; x += 58) drawProp(8, x, y - 22, 38, Boolean((x + phase) & 1));
  }

  function drawWater() {
    polygon([[338, 0], [WIDTH, 0], [WIDTH, HEIGHT], [341, HEIGHT], [347, 292], [338, 251], [349, 213], [340, 174], [350, 132], [341, 88], [350, 44]], PALETTE.waterDark);
    polygon([[347, 0], [WIDTH, 0], [WIDTH, HEIGHT], [350, HEIGHT], [356, 293], [347, 251], [358, 213], [349, 174], [359, 132], [350, 88], [359, 44]], PALETTE.water);
    for (let y = 8; y < HEIGHT; y += 17) rect(352 + (hash(`water:${state.page}:${y}`) % 11), y, 17, 2, PALETTE.waterLight);
  }

  function drawTerrain() {
    drawTerrainTexture();
    drawElevationBand(101, 4);
    drawElevationBand(226, 23);
    drawWater();
    drawProp(11, 139, 76, 47);
    drawProp(11, 38, 202, 47, true);
    drawProp(11, 265, 200, 47);
    drawProp(10, 317, 145, 69);

    context.save();
    context.globalAlpha = 0.34;
    polygon([[112, 130], [215, 121], [252, 154], [224, 195], [128, 200], [96, 164]], '#56636a');
    context.restore();
  }

  function lotForId(id) {
    return state.lotByPageId.get(`${state.page}\0${id}`);
  }

  function roadPoint(lot) {
    return [lot.x + Math.floor(lot.width / 2), lot.y + lot.height + 5];
  }

  function drawConnections() {
    for (const connection of state.report.city.connections) {
      const from = lotForId(connection.from);
      const to = lotForId(connection.to);
      if (!from || !to) continue;
      const [x1, y1] = roadPoint(from);
      const [x2, y2] = roadPoint(to);
      const bend = Math.round((y1 + y2) / 2);
      const sameCycle = state.cycleMembership.has(connection.from) &&
        state.cycleMembership.get(connection.from) === state.cycleMembership.get(connection.to);
      drawCobblestonePath([[x1, y1], [x1, bend], [x2, bend], [x2, y2]], hash(`${connection.from}:${connection.to}`), sameCycle ? '#b47c57' : '#85867f');
      if (sameCycle) {
        rect(x2 - 4, bend - 5, 1, 8, '#4a4039');
        polygon([[x2 - 3, bend - 5], [x2 + 4, bend - 2], [x2 - 3, bend]], PALETTE.cycle);
      }
    }

    for (const lot of state.lots.filter((candidate) => candidate.page === state.page)) {
      const links = state.unresolved.get(lot.building.id)?.filter((link) => link.status === 'unresolved');
      const [x, y] = roadPoint(lot);
      if (links?.length) {
        drawCobblestonePath([[x, y], [x + 11, y + 6]], hash(`broken:${lot.building.path}`));
        rect(x + 13, y + 3, 2, 9, '#493a35');
        polygon([[x + 15, y + 3], [x + 22, y + 6], [x + 15, y + 9]], PALETTE.broken);
      }

      const unknowns = state.unknownDependencies.get(lot.building.id) ?? [];
      if (unknowns.length) {
        drawCobblestonePath([[x - 2, y], [x - 11, y + 6]], hash(`unknown:${lot.building.path}`));
        rect(x - 16, y + 2, 2, 10, '#4a4039');
        polygon([[x - 14, y + 3], [x - 7, y + 6], [x - 14, y + 9]], PALETTE.unknown);
      }
    }

    // The eastern crossing is a real district route, not decoration.
    rect(318, 166, 66, 23, '#2c353c');
    rect(318, 169, 66, 17, '#7c6652');
    for (let x = 321; x < WIDTH; x += 7) rect(x, 169, 2, 17, '#4c4240');
    rect(318, 166, 66, 3, '#a69372');
    rect(318, 186, 66, 3, '#27343c');
  }

  function drawBackgroundProps() {
    drawProp(1, -13, -33, 108);
    drawProp(0, 20, -22, 94, true);
    drawProp(1, 278, -30, 105, true);
    drawProp(3, 149, 134, 71);
    drawProp(5, 90, 137, 47);
    drawProp(5, 214, 151, 47, true);
    drawProp(2, 68, 171, 59);
    drawProp(6, 269, 172, 60);
    drawProp(7, 233, 92, 48);
    drawProp(9, 6, 180, 64);
  }

  function buildingAtlasIndex(building) {
    if (building.isTest) return 3;
    const kindCell = { interface: 0, configuration: 1, service: 3, data: 4, cli: 5 }[building.kind];
    return Number.isInteger(kindCell) ? kindCell : hash(`${building.kind}\0${building.path}`) % 6;
  }

  function buildingSpriteGeometry(lot) {
    const atlasIndex = buildingAtlasIndex(lot.building);
    const baseX = lot.x + lot.width / 2;
    const baseY = lot.y + lot.height;
    const size = lot.spriteSize * BUILDING_SCALE[atlasIndex];
    const x = baseX - size / 2;
    const y = baseY - size * BUILDING_BASE_RATIO[atlasIndex];
    const [left, top, right, bottom] = BUILDING_ALPHA_BOUNDS[atlasIndex];
    return {
      atlasIndex, baseX, baseY, size, x, y,
      hitBounds: {
        left: x + left / BUILDING_CELL * size,
        top: y + top / BUILDING_CELL * size,
        right: x + right / BUILDING_CELL * size,
        bottom: y + bottom / BUILDING_CELL * size
      }
    };
  }

  function drawLotProp(lot, seed, front) {
    const choices = [2, 5, 6, 7, 8, 9, 13, 14];
    if (front && (seed & 3) !== 0) return;
    const index = choices[(seed >>> (front ? 5 : 1)) % choices.length];
    const size = lot.spriteSize > 100 ? 66 : 46;
    const side = ((seed >>> (front ? 8 : 3)) & 1) ? 1 : -1;
    const centerX = lot.x + lot.width / 2;
    const x = centerX + side * (lot.width / 2 + size * 0.12) - size / 2;
    const y = lot.y + lot.height - size * (front ? 0.44 : 0.61);
    drawProp(index, x, y, size, side < 0);
  }

  function drawBuilding(lot, index) {
    const { building, width } = lot;
    const seed = hash(building.path);
    const { atlasIndex, baseX, baseY, size: spriteSize, x: spriteX, y: spriteY } = buildingSpriteGeometry(lot);
    const selected = index === state.selected;

    polygon([[baseX, baseY - 9], [baseX + width / 2 + 7, baseY - 2], [baseX + width / 2 + 2, baseY + 7], [baseX - width / 2 - 2, baseY + 7], [baseX - width / 2 - 7, baseY - 2]], '#475257');
    polygon([[baseX, baseY - 6], [baseX + width / 2 + 3, baseY - 1], [baseX + width / 2 - 1, baseY + 4], [baseX - width / 2 + 1, baseY + 4], [baseX - width / 2 - 3, baseY - 1]], '#aeb5b2');
    drawCobblestonePath([[baseX, baseY], [baseX, baseY + 11]], hash(`apron:${building.path}`), '#8c8b82');
    drawLotProp(lot, seed, false);

    if (selected) {
      polygon([[baseX, baseY - 10], [baseX + width / 2 + 8, baseY], [baseX, baseY + 8], [baseX - width / 2 - 8, baseY]], '#4a3b27');
      polygon([[baseX, baseY - 7], [baseX + width / 2 + 3, baseY], [baseX, baseY + 5], [baseX - width / 2 - 3, baseY]], '#f0d27a');
    }
    drawAtlasCell(assets.buildings, atlasIndex, 3, BUILDING_CELL, BUILDING_CELL, spriteX, spriteY, spriteSize, spriteSize);
    drawLotProp(lot, seed, true);

    const accent = building.state === 'unresolved-link' ? PALETTE.broken
      : building.state === 'structural-warning' || building.evidence.associatedTest || building.isTest ? PALETTE.cycle
        : building.state === 'unverified' ? PALETTE.unknown : PALETTE.observed;
    const poleX = Math.round(baseX + width / 2 + 1);
    const poleY = Math.round(baseY - 16);
    rect(poleX, poleY, 1, 12, '#4a4039');
    polygon([[poleX + 1, poleY], [poleX + 7, poleY + 3], [poleX + 1, poleY + 6]], accent);
  }

  function drawInspector(lot) {
    if (!lot) return;
    const size = lot.spriteSize > 100 ? 58 : 46;
    const x = Math.max(-12, Math.min(WIDTH - size + 12, lot.x - size * 0.40));
    const y = Math.min(HEIGHT - size, lot.y + lot.height - size * 0.82);
    context.drawImage(assets.inspector, 0, 0, 1254, 1254, Math.round(x), Math.round(y), size, size);
  }

  function drawForeground() {
    drawProp(1, -54, HEIGHT - 130, 166);
    drawProp(0, 278, HEIGHT - 130, 158, true);
    drawProp(4, 86, HEIGHT - 82, 116);
    drawProp(13, 57, HEIGHT - 77, 86);
    drawProp(12, 245, HEIGHT - 69, 75);
  }

  function renderCity() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    if (!assetState.ready) return;
    drawTerrain();
    if (!state.report) return;
    drawConnections();
    drawBackgroundProps();
    const visible = state.lots
      .map((lot, index) => ({ lot, index }))
      .filter(({ lot }) => lot.page === state.page)
      .sort((left, right) => (left.lot.y + left.lot.height) - (right.lot.y + right.lot.height));
    visible.forEach(({ lot, index }) => drawBuilding(lot, index));
    drawForeground();
    drawInspector(state.lots[state.selected]?.page === state.page ? state.lots[state.selected] : null);
  }

  function pageCount() {
    return Math.max(1, Math.ceil(state.buildings.length / PAGE_SIZE));
  }

  function renderDistrictNavigation() {
    const count = pageCount();
    elements.districtLabel.textContent = count === 1 ? '中央街区' : `第${state.page + 1}街区 / 全${count}`;
    elements.previousDistrict.disabled = state.page <= 0;
    elements.nextDistrict.disabled = state.page >= count - 1;
  }

  function changeDistrict(nextPage) {
    state.page = Math.max(0, Math.min(nextPage, pageCount() - 1));
    const first = state.page * PAGE_SIZE;
    if (state.buildings[first]) selectBuilding(first);
    else {
      renderDistrictNavigation();
      renderCity();
    }
    canvas.focus();
  }

  function setMapState(type, title, detail) {
    elements.state.className = `map-state ${type || ''}`.trim();
    elements.state.hidden = false;
    elements.state.replaceChildren();
    if (type === 'loading') {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      elements.state.append(spinner);
    }
    const strong = document.createElement('strong');
    strong.textContent = title;
    const small = document.createElement('small');
    small.textContent = detail;
    elements.state.append(strong, small);
  }

  function service(icon, name, detail, status) {
    const item = document.createElement('div');
    item.className = `service ${status}`;
    const iconElement = document.createElement('span');
    iconElement.className = 'service-icon';
    iconElement.setAttribute('aria-hidden', 'true');
    iconElement.textContent = icon;
    const copy = document.createElement('span');
    const label = document.createElement('strong');
    label.textContent = name;
    const description = document.createElement('small');
    description.textContent = detail;
    copy.append(label, description);
    item.append(iconElement, copy);
    return item;
  }

  const SKIP_LABELS = Object.freeze({
    'parse-error-or-unsupported-syntax': '構文解析不能または非対応構文',
    'max-ast-nodes': 'AST走査上限',
    'max-directories': 'ディレクトリ走査上限',
    'max-entries': 'エントリ発見上限',
    'max-files': 'ファイル数上限',
    'max-file-bytes': '単一ファイル容量上限',
    'max-total-bytes': '総読取容量上限',
    'max-edges': '依存辺数上限',
    'file-unreadable': '読取不能ファイル',
    'directory-unreadable': '読取不能ディレクトリ',
    'non-regular-file': '通常ファイル以外',
    'ignored-directory': '対象外ディレクトリ',
    'symbolic-link': 'シンボリックリンク',
    'outside-root': 'リポジトリ境界外',
    'metadata-too-large': '大きすぎるメタデータ',
    'metadata-unreadable': '読取不能メタデータ'
  });

  function countOf(skipCounts, reason) {
    const count = Number(skipCounts[reason]);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  function renderScanFacets(report) {
    const { summary } = report;
    const truncation = summary.truncation ?? {};
    const skipCounts = report.inspection.observed.skipCounts;
    const facets = [service('読', 'ファイル読取', `${summary.filesScanned}/${summary.filesDiscovered}ファイル`, 'info')];
    const parseErrors = countOf(skipCounts, 'parse-error-or-unsupported-syntax');
    const astLimits = countOf(skipCounts, 'max-ast-nodes');
    if (parseErrors) facets.push(service('構', '構文解析', `${parseErrors}件を解析できず、依存関係は未確認`, 'warn'));
    if (astLimits) facets.push(service('木', 'AST走査上限', `${astLimits}件で走査を中断`, 'warn'));
    if (truncation.analysis && !parseErrors && !astLimits) facets.push(service('析', '解析中断', '理由件数は記録されていません', 'warn'));

    const directoryLimits = countOf(skipCounts, 'max-directories');
    const entryLimits = countOf(skipCounts, 'max-entries');
    if (truncation.traversal) facets.push(service('層', 'ディレクトリ上限', directoryLimits ? `${directoryLimits}地点で上限到達` : '上限到達を記録', 'warn'));
    if (truncation.discovery) facets.push(service('覧', 'エントリ上限', entryLimits ? `${entryLimits}地点で上限到達` : '上限到達を記録', 'warn'));

    if (summary.omittedFiles > 0) {
      const fileReasons = ['max-files', 'max-file-bytes', 'max-total-bytes', 'file-unreadable', 'non-regular-file']
        .map((reason) => [reason, countOf(skipCounts, reason)])
        .filter(([, count]) => count)
        .map(([reason, count]) => `${SKIP_LABELS[reason]} ${count}件`);
      facets.push(service('未', '未読ファイル', `${summary.omittedFiles}件${fileReasons.length ? `（${fileReasons.join('、')}）` : ''}`, 'warn'));
    } else if (truncation.files) {
      facets.push(service('未', 'ファイル走査中断', '未読件数は記録されていません', 'warn'));
    }

    if (summary.edgesOmitted > 0) facets.push(service('辺', '依存辺上限', `${summary.edgesOmitted}辺を未記録`, 'warn'));
    else if (truncation.edges) facets.push(service('辺', '依存辺走査中断', '未記録件数は記録されていません', 'warn'));
    return facets;
  }

  function renderScanNote(report) {
    const recorded = Object.entries(report.inspection.observed.skipCounts)
      .map(([reason, value]) => [reason, Number(value)])
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .map(([reason, count]) => `${SKIP_LABELS[reason] ?? reason} ${count}件`);
    if (recorded.length) {
      elements.scanNote.textContent = `記録された除外・中断理由: ${recorded.join(' / ')}。動的な実行時関係は未確認です。`;
      elements.scanNote.className = 'scan-warning';
    } else {
      elements.scanNote.textContent = '記録された除外・中断はありません。動的な実行時関係は未確認です。';
      elements.scanNote.className = '';
    }
  }

  function renderServices(report) {
    const modules = report.city.buildings.filter((building) => !building.isTest);
    const brokenLinks = report.inspection.observed.unresolvedLinks.filter((link) => link.status === 'unresolved').length;
    const cycleModules = modules.filter((building) => building.evidence.cycle).length;
    const inspected = modules.filter((building) => building.evidence.associatedTest).length;
    const uninspected = modules.length - inspected;
    elements.services.replaceChildren(
      service('水', '接続設備', brokenLinks ? `${brokenLinks}本のローカル接続切れを観測` : 'ローカル接続切れは未観測', brokenLinks ? 'fail' : 'ok'),
      service('道', '道路網（推定）', cycleModules ? `${cycleModules}棟が循環経路に参加と推定` : '循環経路は推定されませんでした', cycleModules ? 'warn' : 'ok'),
      service('検', 'テスト関連（推定）', `${inspected}棟に関連を推定 / ${uninspected}棟は未確認`, 'warn'),
      ...renderScanFacets(report)
    );
    renderScanNote(report);
  }

  function fact(label, value) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    return [term, description];
  }

  function evidence(text, kind = 'observed') {
    const item = document.createElement('div');
    item.className = `evidence ${kind}`;
    const copy = document.createElement('span');
    copy.textContent = text;
    item.append(copy);
    return item;
  }

  function unknownDependencyText(dependency) {
    const target = dependency.targetHint ? `: ${dependency.targetHint}` : '';
    const labels = {
      'outside-root': 'リポジトリ境界外の依存先は点検対象外です',
      'not-scanned': '依存先は存在しますが走査対象に入りませんでした',
      'runtime-unknown': '実行時に決まる依存先は未確認です',
      'alias-unknown': '設定依存のエイリアスを解決していません',
      'external-or-alias': '外部パッケージまたは設定依存のエイリアスは未確認です',
      unsupported: 'この依存形式は走査対象外です'
    };
    return `${labels[dependency.status] ?? `未確認の依存（${dependency.status}）`}${target}`;
  }

  function selectBuilding(index, focusDetails = false) {
    if (!state.buildings.length) return;
    state.selected = Math.max(0, Math.min(index, state.buildings.length - 1));
    state.page = Math.floor(state.selected / PAGE_SIZE);
    const building = state.buildings[state.selected];
    const connections = state.outgoing.get(building.id);
    const unresolved = state.unresolved.get(building.id);
    const unknownDependencies = state.unknownDependencies.get(building.id) ?? [];
    const reachability = state.report.inspection.inferred.reachability[building.id];
    elements.placeholder.hidden = true;
    elements.details.hidden = false;
    elements.kind.textContent = building.isTest ? '点検所' : building.kind.toUpperCase();
    elements.title.textContent = building.name;
    elements.path.textContent = building.path;
    elements.facts.replaceChildren(
      ...fact('ローカル接続', `${connections.length}件を観測`),
      ...fact('未確認の依存', `${unknownDependencies.length}件`),
      ...fact('テスト関連', building.isTest ? 'テストファイルと分類を推定' : building.evidence.associatedTest ? '関連テストを推定' : '未確認'),
      ...fact('循環経路', building.evidence.cycle ? '参加を推定' : '参加は未観測'),
      ...fact('到達性', reachability === 'reachable'
        ? '既知の入口から到達を推定'
        : reachability === 'not-reached-from-known-entrypoints'
          ? '既知の入口からは未到達'
          : '入口情報がなく未確認')
    );

    const evidenceItems = [];
    const missingLinks = unresolved.filter((link) => link.status === 'unresolved');
    if (missingLinks.length) missingLinks.forEach((link) => evidenceItems.push(evidence(`接続先が見つかりません: ${link.targetHint}`, 'failure')));
    else evidenceItems.push(evidence('未解決のローカルimportは観測されませんでした。'));
    unknownDependencies.forEach((dependency) => evidenceItems.push(evidence(unknownDependencyText(dependency), 'unknown')));
    if (building.evidence.cycle) evidenceItems.push(evidence('静的なimportグラフ上で循環経路に含まれます。', 'inferred'));
    if (reachability === 'not-reached-from-known-entrypoints') evidenceItems.push(evidence('既知のentrypointから静的importを辿って到達しませんでした。実行不能の断定ではありません。', 'inferred'));
    if (building.isTest) evidenceItems.push(evidence('ファイル名と配置からテストファイルと分類しました。実行・成功は確認していません。', 'inferred'));
    else if (building.evidence.associatedTest) evidenceItems.push(evidence('静的なimportまたは命名対応から関連テストを推定しました。実行・成功は確認していません。', 'inferred'));
    else evidenceItems.push(evidence('関連テストを観測できませんでした。故障を意味しません。', 'unknown'));
    elements.evidence.replaceChildren(...evidenceItems);
    canvas.setAttribute('aria-label', `${building.name}を選択中。${missingLinks.length ? '接続切れあり。' : ''}${unknownDependencies.length ? `未確認の依存${unknownDependencies.length}件。` : ''}${building.evidence.associatedTest || building.isTest ? 'テスト関連を推定。' : 'テスト関連は未確認。'}`);
    elements.buildingList.querySelectorAll('button').forEach((button, buttonIndex) => button.setAttribute('aria-current', buttonIndex === state.selected ? 'true' : 'false'));
    renderDistrictNavigation();
    renderCity();
    if (focusDetails) elements.title.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderBuildingList() {
    elements.buildingList.replaceChildren();
    state.buildings.forEach((building, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = building.name;
      button.title = building.path;
      button.setAttribute('aria-current', 'false');
      button.addEventListener('click', () => selectBuilding(index, true));
      elements.buildingList.append(button);
    });
  }

  function nearestBuilding(direction) {
    if (state.selected < 0) return state.page * PAGE_SIZE;
    const current = state.lots[state.selected];
    let best = state.selected;
    let bestDistance = Infinity;
    state.lots.forEach((candidate, index) => {
      if (index === state.selected || candidate.page !== current.page) return;
      const dx = candidate.x - current.x;
      const dy = candidate.y - current.y;
      const valid = (direction === 'left' && dx < 0) || (direction === 'right' && dx > 0) ||
        (direction === 'up' && dy < 0) || (direction === 'down' && dy > 0);
      if (!valid) return;
      const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
      const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      const distance = primary + secondary * 1.7;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  function canvasPoint(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * canvas.width / bounds.width,
      y: (event.clientY - bounds.top) * canvas.height / bounds.height
    };
  }

  canvas.addEventListener('click', (event) => {
    const point = canvasPoint(event);
    const candidates = state.lots
      .map((lot, index) => ({ lot, index }))
      .filter(({ lot }) => {
        if (lot.page !== state.page) return false;
        const bounds = buildingSpriteGeometry(lot).hitBounds;
        return point.x >= bounds.left - 3 && point.x <= bounds.right + 3 &&
          point.y >= bounds.top - 3 && point.y <= bounds.bottom + 4;
      })
      .sort((left, right) => (right.lot.y + right.lot.height) - (left.lot.y + left.lot.height));
    if (candidates.length) selectBuilding(candidates[0].index);
  });

  canvas.addEventListener('keydown', (event) => {
    const direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key];
    if (direction) {
      event.preventDefault();
      selectBuilding(nearestBuilding(direction));
    } else if (event.key === 'Enter' && state.selected >= 0) {
      event.preventDefault();
      selectBuilding(state.selected, true);
    }
  });

  async function loadCity() {
    setMapState('loading', '街を準備しています', '画像素材を確認してから、対象リポジトリを静的に測量します');
    elements.reload.disabled = true;
    elements.repo.textContent = '街の測量を準備しています…';
    try {
      await loadAssets();
      const response = await fetch('/api/city', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const report = assertInspectionReport(await response.json());
      state.report = report;
      state.buildings = report.city.buildings;
      state.lots = createLots(state.buildings);
      state.selected = -1;
      state.page = 0;
      indexReport(report);
      elements.repo.textContent = report.repository.name;
      renderServices(report);
      renderBuildingList();
      renderDistrictNavigation();
      renderCity();
      if (!state.buildings.length) {
        setMapState('warning', '建物を見つけられませんでした', '対応するJavaScript / TypeScriptファイルがないか、読取範囲をご確認ください');
        elements.placeholder.hidden = false;
        elements.details.hidden = true;
      } else {
        elements.state.hidden = true;
        selectBuilding(0);
      }
    } catch (error) {
      state.report = null;
      state.buildings = [];
      state.lots = [];
      state.selected = -1;
      state.page = 0;
      renderCity();
      const assetFailure = error?.kind === 'asset';
      elements.services.replaceChildren(service('！', assetFailure ? '画像素材エラー' : '測量エラー', assetFailure ? '必要なゲーム画像を読み込めませんでした' : 'サーバーから点検結果を受け取れませんでした', 'fail'));
      elements.buildingList.replaceChildren();
      renderDistrictNavigation();
      elements.placeholder.hidden = false;
      elements.details.hidden = true;
      elements.repo.textContent = assetFailure ? '画像素材を読み込めませんでした' : '測量できませんでした';
      elements.scanNote.textContent = '';
      setMapState('error', assetFailure ? 'ゲーム素材を読み込めませんでした' : '街を読み込めませんでした', assetFailure
        ? `${error.message} — 配布ファイルを確認して再測量してください`
        : `${error.message} — サーバーを確認して再測量してください`);
    } finally {
      elements.reload.disabled = false;
    }
  }

  elements.reload.addEventListener('click', loadCity);
  elements.previousDistrict.addEventListener('click', () => changeDistrict(state.page - 1));
  elements.nextDistrict.addEventListener('click', () => changeDistrict(state.page + 1));
  loadCity();
})();
