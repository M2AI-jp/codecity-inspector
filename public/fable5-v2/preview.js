const SIZE = Object.freeze({ width: 1280, height: 800 });
const BACKPLATE = '/fable5-v2/assets/backplates/old-town-v1.png';
const INN_CUTAWAY = '/fable5-v2/assets/backplates/old-town-inn-cutaway-v1.png';
const HARBOR_BACKPLATE = '/fable5-v2/assets/backplates/harbor-day-v1.png';
const SNOW_BACKPLATE = '/fable5-v2/assets/backplates/snow-day-v1.png';
const WOODLAND_BACKPLATE = '/fable5-v2/assets/backplates/woodland-day-v1.png';
const OLD_TOWN_NIGHT_BACKPLATE = '/fable5-v2/assets/backplates/old-town-night-v1.png';
const PLAYER = '/fable5-v2/assets/characters/player-inspector-idle-v1.png';
export const CUTAWAY_TRANSITION_MS = 460;
export const FACILITY_LABEL_DISTANCE = 118;
export const DEAD_BUILDING = Object.freeze({ x: 350, y: 588, label: '閉鎖 · 未到達・要確認' });

export const TEMPLATE_GAME_BUNDLE = Object.freeze({
  id: 'bundle.game.fable5-four-district-template',
  program: Object.freeze({
    sceneTemplateId: 'program.scene.four-district-tour',
    playerControllerId: 'program.player.point-and-keyboard-navigation',
    cutawayControllerId: 'program.building.same-map-cutaway',
    soundControllerId: 'program.sound.local-web-audio'
  }),
  media: Object.freeze({
    backplates: Object.freeze([BACKPLATE, HARBOR_BACKPLATE, SNOW_BACKPLATE, WOODLAND_BACKPLATE, OLD_TOWN_NIGHT_BACKPLATE]),
    cutaway: INN_CUTAWAY,
    player: PLAYER
  })
});

export function easeInOutCubic(progress) {
  const value = Math.max(0, Math.min(1, progress));
  return value < .5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2;
}

export function cutawayOpacity(from, to, elapsedMs, durationMs = CUTAWAY_TRANSITION_MS, easing = 'ease-in-out-cubic') {
  const progress = Math.max(0, Math.min(1, elapsedMs / Math.max(1, durationMs)));
  return from + (to - from) * (easing === 'linear' ? progress : easeInOutCubic(progress));
}

export function facilityLabelFor(distance, { name, enterable = false, active = false, status = 'inactive' }) {
  if (distance > FACILITY_LABEL_DISTANCE) return '';
  if (enterable) return `${name} · 入れる`;
  if (status === 'unreached') return '閉鎖 · 未到達・要確認';
  return active ? name : '';
}

export const SOUND_CUES = Object.freeze({
  enter: Object.freeze([{ frequency: 196, endFrequency: 294, delay: 0, duration: .16, gain: .035 }, { frequency: 392, endFrequency: 494, delay: .09, duration: .19, gain: .025 }]),
  exit: Object.freeze([{ frequency: 294, endFrequency: 196, delay: 0, duration: .2, gain: .03 }]),
  interact: Object.freeze([{ frequency: 523, endFrequency: 659, delay: 0, duration: .09, gain: .022 }])
});

const nodes = (entries) => Object.freeze(entries.map(([id, x, y]) => Object.freeze({ id, x, y })));
export const NAV_NODES = nodes([
  ['start', 502, 492], ['west-road', 342, 494], ['inn-turn', 274, 435], ['inn-doorstep', 217, 416], ['inn-threshold', 204, 357], ['inn-floor', 185, 340], ['inn-counter', 140, 325],
  ['dead-sign', 350, 556], ['plaza-entry', 628, 452], ['plaza', 644, 375], ['hall', 642, 268], ['well', 785, 393], ['east-road', 835, 476], ['shop-turn', 1040, 453], ['shop', 1116, 409], ['old-exit', 1180, 492]
]);
export const NAV_EDGES = Object.freeze([['start', 'west-road'], ['west-road', 'inn-turn'], ['west-road', 'dead-sign'], ['inn-turn', 'inn-doorstep'], ['inn-doorstep', 'inn-threshold'], ['inn-threshold', 'inn-floor'], ['inn-floor', 'inn-counter'], ['start', 'plaza-entry'], ['plaza-entry', 'plaza'], ['plaza', 'hall'], ['plaza', 'well'], ['plaza-entry', 'east-road'], ['east-road', 'shop-turn'], ['shop-turn', 'shop'], ['shop-turn', 'well'], ['shop-turn', 'old-exit']]);
const HARBOR_NODES = nodes([['harbor-start', 700, 280], ['harbor-landing', 650, 350], ['harbor-yard', 502, 382], ['harbor-dockmaster', 355, 405], ['harbor-pier', 510, 520], ['harbor-exit', 645, 675]]);
const HARBOR_EDGES = Object.freeze([['harbor-start', 'harbor-landing'], ['harbor-landing', 'harbor-yard'], ['harbor-yard', 'harbor-dockmaster'], ['harbor-yard', 'harbor-pier'], ['harbor-pier', 'harbor-exit']]);
const SNOW_NODES = nodes([['snow-start', 640, 560], ['snow-pass', 640, 402], ['snow-fork', 770, 355], ['snow-scout', 1050, 330], ['snow-exit', 1160, 355]]);
const SNOW_EDGES = Object.freeze([['snow-start', 'snow-pass'], ['snow-pass', 'snow-fork'], ['snow-fork', 'snow-scout'], ['snow-scout', 'snow-exit']]);
const WOODLAND_NODES = nodes([['woodland-start', 1100, 400], ['woodland-crossing', 955, 402], ['woodland-square', 735, 405], ['woodland-ranger', 670, 395], ['woodland-return', 260, 430]]);
const WOODLAND_EDGES = Object.freeze([['woodland-start', 'woodland-crossing'], ['woodland-crossing', 'woodland-square'], ['woodland-square', 'woodland-ranger'], ['woodland-square', 'woodland-return']]);
const DISTRICTS = Object.freeze({
  'old-town': { name: '旧市街', detail: '時計塔から石畳の巡回を始める', asset: BACKPLATE, start: 'start', nodes: NAV_NODES, edges: NAV_EDGES },
  harbor: { name: '港湾地区', detail: '桟橋の荷役人を訪ねる', asset: HARBOR_BACKPLATE, start: 'harbor-start', nodes: HARBOR_NODES, edges: HARBOR_EDGES },
  snow: { name: '雪原の見張り台', detail: '標識のそばの観測者を訪ねる', asset: SNOW_BACKPLATE, start: 'snow-start', nodes: SNOW_NODES, edges: SNOW_EDGES },
  woodland: { name: '林間の小径', detail: '森の案内人と話す', asset: WOODLAND_BACKPLATE, start: 'woodland-start', nodes: WOODLAND_NODES, edges: WOODLAND_EDGES }
});
// API failure keeps the scene, movement, cutaway, and sound bundle playable,
// but these demo conversations are explicitly not repository evidence.
export const ZONES = Object.freeze([
  { id: 'hall', district: 'old-town', name: '市庁舎', prompt: 'アート見本を見る', speaker: 'デモの記録官', place: '時計塔の玄関', text: '「これは場面テンプレートの操作見本です。」', evidenceKind: 'unknown', evidence: 'デモ：検査事実ではありません。', node: 'hall' },
  { id: 'inn', district: 'old-town', name: '宿屋', prompt: '宿の主人と話す', speaker: '宿の主人（デモ）', place: '宿屋のカウンター', text: '「屋根のカットアウェイと効果音の操作見本です。」', evidenceKind: 'unknown', evidence: 'デモ：検査事実ではありません。', node: 'inn-counter' },
  { id: 'well', district: 'old-town', name: '井戸', prompt: '配置見本を見る', speaker: 'アートデモ', place: '広場の井戸', text: '「旧市街の配置テンプレートです。」', evidenceKind: 'unknown', evidence: 'デモ：検査事実ではありません。', node: 'well' },
  { id: 'shop', district: 'old-town', name: '商店', prompt: '配置見本を見る', speaker: 'アートデモ', place: 'ランタン店の店先', text: '「旧市街の配置テンプレートです。」', evidenceKind: 'unknown', evidence: 'デモ：検査事実ではありません。', node: 'shop' },
  { id: 'harbor-witness', district: 'harbor', name: '港の荷役人', prompt: '港のアート見本を見る', speaker: 'アートデモ', place: '桟橋の荷揚げ場', text: '「港湾地区の場面テンプレートです。」', evidenceKind: 'unknown', evidence: 'デモ：検査事実ではありません。', node: 'harbor-dockmaster' },
  { id: 'snow-witness', district: 'snow', name: '雪原の観測者', prompt: '雪原のアート見本を見る', speaker: 'アートデモ', place: '見張りの標識', text: '「雪原地区の場面テンプレートです。」', evidenceKind: 'unknown', evidence: 'デモ：検査事実ではありません。', node: 'snow-scout' },
  { id: 'woodland-witness', district: 'woodland', name: '森の案内人', prompt: '林間のアート見本を見る', speaker: 'アートデモ', place: '林間の稽古場', text: '「林間地区の場面テンプレートです。」', evidenceKind: 'unknown', evidence: 'デモ：検査事実ではありません。', node: 'woodland-ranger' }
]);
const TRAVELS = Object.freeze({
  'old-town': { node: 'old-exit', label: '港の桟橋', prompt: '港湾地区へ出発する', destination: 'harbor' },
  harbor: { node: 'harbor-exit', label: '雪原の街道', prompt: '雪原の見張り台へ出発する', destination: 'snow' },
  snow: { node: 'snow-exit', label: '林間の小径', prompt: '林間の小径へ出発する', destination: 'woodland' },
  woodland: { node: 'woodland-return', label: '巡回の標', prompt: '4地区の巡回を完了する', final: true }
});
const INN_INTERIOR_NODES = new Set(['inn-threshold', 'inn-floor', 'inn-counter']);
const INN_EDGE = Object.freeze(['inn-doorstep', 'inn-threshold']);
const SUPPORTED_NON_LEDGER_VERBS = new Set([
  'inspect-entry-tags', 'watch-forms', 'talk-neighbor', 'talk-innkeeper',
  'use-telescope', 'read-away-sign', 'inspect-closure-sign', 'inspect-field-notice'
]);
const FACILITY_NAMES = Object.freeze({
  town_hall: '市庁舎', gate: '街の門', dojo: '道場', inn: '宿屋', house: '住居',
  survey_tower: '測量塔', dock: '港', guild: '会館', market: '商店', well: '井戸'
});
const INSPECT_VERBS = Object.freeze(['inspect-entry-tags', 'read-away-sign', 'inspect-field-notice']);
const DYNAMIC_SLOTS = Object.freeze([
  { id: 'well', district: 'old-town', node: 'well', place: '広場の井戸', facilityKinds: ['well'], pathPattern: /(?:^|[/_.-])(?:well|env|config)(?:$|[/_.-])/i, verbTiers: [['use-telescope'], ['watch-forms']] },
  { id: 'shop', district: 'old-town', node: 'shop', place: 'ランタン店の店先', facilityKinds: ['shop'], pathPattern: /(?:^|[/_.-])(?:shop|market|ui|component)(?:$|[/_.-])/i, verbTiers: [INSPECT_VERBS, ['talk-neighbor']] },
  { id: 'harbor-witness', district: 'harbor', node: 'harbor-dockmaster', place: '桟橋の荷揚げ場', facilityKinds: ['dock', 'warehouse'], pathPattern: /(?:^|[/_.-])(?:harbor|dock|deploy|release)(?:$|[/_.-])/i, verbTiers: [['inspect-entry-tags'], INSPECT_VERBS] },
  { id: 'snow-witness', district: 'snow', node: 'snow-scout', place: '見張りの標識', facilityKinds: ['watchtower'], pathPattern: /(?:^|[/_.-])(?:watch|monitor|log|observ)/i, verbTiers: [['watch-forms'], ['use-telescope']] },
  { id: 'woodland-witness', district: 'woodland', node: 'woodland-ranger', place: '林間の稽古場', facilityKinds: ['dojo'], pathPattern: /(?:^|[/_.-])(?:dojo|test|garden|forest|wood)(?:$|[/_.-])/i, verbTiers: [['talk-neighbor'], INSPECT_VERBS] }
]);

function basename(value, fallback = '名称不明') {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? fallback;
}

function compareCodeUnits(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function evidenceKindForFact(fact) {
  for (const kind of ['observed', 'inferred', 'unknown']) {
    if (Array.isArray(fact?.evidence?.[kind]) && fact.evidence[kind].some((value) => typeof value === 'string' && value.length > 0)) return kind;
  }
  return null;
}

function buildingName(building) {
  const facility = FACILITY_NAMES[building?.facilityKind];
  const file = basename(building?.files?.[0], '');
  return facility ? (file ? `${facility}（${file}）` : facility) : file || basename(building?.id, '検査対象');
}

function factSubject(fact, building) {
  const params = fact?.params ?? {};
  const candidate = params.path ?? params.source ?? params.from ?? params.test ?? params.members?.[0] ?? building?.files?.[0];
  return basename(candidate, buildingName(building));
}

function canonicalFactText(fact, building) {
  const params = fact?.params ?? {}, subject = factSubject(fact, building);
  const target = basename(params.targetHint ?? params.to, '参照先');
  const members = Array.isArray(params.members) && params.members.length > 0
    ? params.members.map((value) => basename(value)).join('と') : subject;
  const generated = ({
    entrypoint: `${subject} は、静的検査で入口として観測されています。`,
    unresolved: `${subject} から ${target} への参照先は解決できていません。`,
    cycle: `${members} の参照関係から循環が推定されています。`,
    test_association: `${subject} と ${basename(params.test, 'テスト')} の対応が推定されています。`,
    unverified: `${subject} に対応するテストは確認できていません。壊れているとは断定できません。`,
    unreached: `確認済みの入口から ${subject} へ至る静的な道筋は見つかっていません。`,
    runtime_unknown: `${subject} の実行時の状態は、静的検査だけでは分かりません。`,
    truncation: '検査上限に達した範囲は不明のままです。',
    facility_present: `${FACILITY_NAMES[params.kind ?? params.facilityKind] ?? subject} に対応する構造が観測されています。`,
    facility_absent: `${FACILITY_NAMES[params.kind ?? params.facilityKind] ?? subject} に対応する構造は確認できていません。`,
    survey_scope: `${subject} について、この検査範囲で分かることだけを表示しています。`,
    external: `${subject} は検査対象の外部にあり、詳細は不明です。`
  })[fact?.type];
  if (generated) return generated;
  const saying = fact?.sayings?.primary;
  return typeof saying === 'string' && saying.length > 0 && !/^fact\.[a-z0-9_.-]+$/.test(saying)
    ? saying : `${subject} について、追加の確認が必要です。`;
}

function deterministicScore(seed, slotId, buildingId) {
  let hash = 2166136261;
  for (const character of `${seed}\0${slotId}\0${buildingId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function knownFactsFor(building, factById) {
  return [...new Set(Array.isArray(building?.interaction?.factRefs) ? building.interaction.factRefs : [])]
    .map((id) => factById.get(id))
    .filter((fact) => fact && evidenceKindForFact(fact));
}

function pickFact(seed, slotId, building, factById) {
  return knownFactsFor(building, factById)
    .sort((left, right) => deterministicScore(seed, slotId, `${building.id}\0${left.id}`)
      - deterministicScore(seed, slotId, `${building.id}\0${right.id}`) || compareCodeUnits(left.id, right.id))[0] ?? null;
}

function verbPrompt(verb) {
  return ({
    'inspect-entry-tags': '入口の記録を確かめる', 'watch-forms': '関係を観察する',
    'talk-neighbor': '記録を聞く', 'talk-innkeeper': '宿の主人に聞く',
    'use-telescope': '検査範囲を確かめる', 'read-away-sign': '留守札を読む',
    'inspect-closure-sign': '閉鎖看板を読む', 'inspect-field-notice': '掲示を読む',
    'receive-journal': '検査記録を開く'
  })[verb] ?? '検査記録を確かめる';
}

function zoneFor(slot, building, fact, npcs) {
  const name = buildingName(building), kind = evidenceKindForFact(fact);
  const resident = npcs.find((npc) => npc?.home === building.id
    && (!building.speakerRole || npc.role === building.speakerRole))
    ?? npcs.find((npc) => npc?.home === building.id);
  const speakerRole = building.speakerRole ?? resident?.role;
  const speaker = ({
    'keeper.inn': '宿の主人', 'keeper.town_hall': '市庁舎の記録官', witness: `${name}の証言者`
  })[speakerRole] ?? (resident ? `${name}の担当者` : 'リポジトリ検査記録');
  const summary = canonicalFactText(fact, building);
  const saying = fact?.sayings?.primary;
  const body = typeof saying === 'string' && saying.length > 0 && !/^fact\.[a-z0-9_.-]+$/.test(saying)
    ? saying : summary;
  return Object.freeze({
    id: slot.id, district: slot.district, node: slot.node, name,
    prompt: verbPrompt(building.interaction?.verb), speaker,
    place: `${slot.place} · ${name}`, text: `「${body}」`,
    evidenceKind: kind, evidence: `${{ observed: '観測', inferred: '推定', unknown: '不明' }[kind]}：${summary}`,
    buildingId: building.id, factId: fact.id
  });
}

function exactEnterablePrefab(building) {
  const events = new Set(Array.isArray(building?.eventIds) ? building.eventIds : []);
  return building?.prefabId === 'prefab.service.inn.enterable'
    && building.access === 'enterable'
    && building.behaviorId === 'behavior.building.enterable-service'
    && building.animationSetId === 'animation.building.cutaway.fade'
    && Number.isInteger(building.cutawayDurationMs) && building.cutawayDurationMs > 0
    && ['ease-in-out-cubic', 'linear'].includes(building.cutawayEasing)
    && building.soundSetId === 'sound.building.inn.entry'
    && building.speakerRole === 'keeper.inn'
    && building.labelMode === 'proximity'
    && building.collisionExterior === 'solid-footprint'
    && building.collisionEntrance === 'door'
    && building.collisionInterior === 'walkable'
    && ['event.facility.enter', 'event.facility.talk-keeper', 'event.facility.exit'].every((eventId) => events.has(eventId));
}

function exactClosedPrefab(building) {
  const events = new Set(Array.isArray(building?.eventIds) ? building.eventIds : []);
  return building?.prefabId === 'prefab.module.closed-unreached'
    && building.access === 'closed'
    && building.behaviorId === 'behavior.building.closed-evidence-sign'
    && building.animationSetId === 'animation.building.closed.idle'
    && building.soundSetId === 'sound.building.closed-sign'
    && building.labelMode === 'proximity'
    && building.collisionExterior === 'solid-footprint'
    && building.collisionEntrance === 'blocked'
    && building.collisionInterior === 'none'
    && events.has('event.facility.inspect-closure-sign');
}

function candidatesForVerb(slot, candidates) {
  for (const tier of slot.verbTiers) {
    const preferred = candidates.filter((building) => tier.includes(building.interaction?.verb));
    if (preferred.length > 0) return preferred;
  }
  return candidates;
}

function candidatesForSlot(slot, candidates) {
  const facilityMatches = candidates.filter((building) => slot.facilityKinds.includes(building.facilityKind));
  if (facilityMatches.length > 0) return candidatesForVerb(slot, facilityMatches);
  const pathMatches = candidates.filter((building) => (building.files ?? []).some((path) => slot.pathPattern.test(path)));
  if (pathMatches.length > 0) return candidatesForVerb(slot, pathMatches);
  return candidatesForVerb(slot, candidates);
}

function matchingClosedSign(plan, building, factById) {
  const roomPropIds = new Set((building.rooms ?? []).flatMap((room) => Array.isArray(room?.props) ? room.props : []));
  const buildingFactIds = new Set(knownFactsFor(building, factById).map(({ id }) => id));
  return (plan.props ?? []).find((prop) => roomPropIds.has(prop?.id)
    && prop.assetId === 'structure.signpost_broken'
    && prop.kind === 'closed-unreached-needs-confirmation'
    && buildingFactIds.has(prop.factRef)) ?? null;
}

function demoBinding() {
  return Object.freeze({
    mode: 'art-demo', repositoryName: null, seed: 'art-demo', assetBundle: TEMPLATE_GAME_BUNDLE,
    zones: ZONES,
    inn: Object.freeze({ demo: true, name: '宿屋', cutawayDurationMs: CUTAWAY_TRANSITION_MS, cutawayEasing: 'ease-in-out-cubic', soundSetId: 'sound.demo.local', labelMode: 'proximity' }),
    closed: Object.freeze({ demo: true, name: '閉鎖', labelMode: 'proximity', evidence: 'デモ：検査事実ではありません。' }),
    edgesByDistrict: Object.freeze({ 'old-town': NAV_EDGES, harbor: HARBOR_EDGES, snow: SNOW_EDGES, woodland: WOODLAND_EDGES })
  });
}

export function bindTemplateTour(payload) {
  const plan = payload?.worldPlan;
  if (!plan || !Array.isArray(plan.buildings) || !Array.isArray(plan.facts)) return demoBinding();
  const seed = typeof plan.seed === 'string' && plan.seed.length > 0 ? plan.seed : 'missing-seed';
  const factById = new Map(plan.facts.filter((fact) => typeof fact?.id === 'string').map((fact) => [fact.id, fact]));
  const npcs = Array.isArray(plan.npcs) ? plan.npcs : [];
  const townHalls = plan.buildings.filter((building) => building?.facilityKind === 'town_hall' && building?.interaction?.verb === 'receive-journal');
  const townHall = townHalls.length === 1 ? townHalls[0] : null;
  const inn = plan.buildings.filter(exactEnterablePrefab)
    .sort((left, right) => deterministicScore(seed, 'inn', left.id) - deterministicScore(seed, 'inn', right.id) || compareCodeUnits(left.id, right.id))[0] ?? null;
  const closedPairs = plan.buildings.filter(exactClosedPrefab).map((building) => ({ building, sign: matchingClosedSign(plan, building, factById) })).filter(({ sign }) => sign);
  closedPairs.sort((left, right) => deterministicScore(seed, 'closed', left.building.id) - deterministicScore(seed, 'closed', right.building.id) || compareCodeUnits(left.building.id, right.building.id));
  const closedPair = closedPairs[0] ?? null;
  const used = new Set([townHall?.id, inn?.id, closedPair?.building.id].filter(Boolean));
  const zones = [];
  const fixed = [
    { slot: { id: 'hall', district: 'old-town', node: 'hall', place: '時計塔の玄関' }, building: townHall },
    { slot: { id: 'inn', district: 'old-town', node: 'inn-counter', place: '宿屋のカウンター' }, building: inn }
  ];
  for (const { slot, building } of fixed) {
    const fact = building && pickFact(seed, slot.id, building, factById);
    if (building && fact) zones.push(zoneFor(slot, building, fact, npcs));
  }
  if (closedPair) {
    const fact = factById.get(closedPair.sign.factRef);
    if (fact && evidenceKindForFact(fact)) zones.push(zoneFor({
      id: 'closed-sign', district: 'old-town', node: 'dead-sign', place: '潰れた建物の閉鎖看板'
    }, closedPair.building, fact, npcs));
  }
  const candidates = plan.buildings.filter((building) => !used.has(building?.id)
    && building?.interaction?.verb !== 'receive-journal'
    && SUPPORTED_NON_LEDGER_VERBS.has(building?.interaction?.verb)
    && knownFactsFor(building, factById).length > 0);
  for (const slot of DYNAMIC_SLOTS) {
    const available = candidates.filter((candidate) => !used.has(candidate.id));
    const building = candidatesForSlot(slot, available)
      .sort((left, right) => deterministicScore(seed, slot.id, left.id) - deterministicScore(seed, slot.id, right.id) || compareCodeUnits(left.id, right.id))[0];
    if (!building) continue;
    const fact = pickFact(seed, slot.id, building, factById);
    if (!fact) continue;
    used.add(building.id);
    zones.push(zoneFor(slot, building, fact, npcs));
  }
  const closedFact = closedPair ? factById.get(closedPair.sign.factRef) : null;
  const oldTownEdges = inn ? NAV_EDGES : Object.freeze(NAV_EDGES.filter(([from, to]) => from !== INN_EDGE[0] || to !== INN_EDGE[1]));
  return Object.freeze({
    mode: 'repository', repositoryName: payload.repository?.name ?? null, seed, assetBundle: TEMPLATE_GAME_BUNDLE,
    zones: Object.freeze(zones),
    inn: inn ? Object.freeze({
      buildingId: inn.id, factId: pickFact(seed, 'inn', inn, factById)?.id ?? null,
      name: buildingName(inn), animationSetId: inn.animationSetId,
      cutawayDurationMs: inn.cutawayDurationMs, cutawayEasing: inn.cutawayEasing,
      soundSetId: inn.soundSetId, labelMode: inn.labelMode,
      collisionExterior: inn.collisionExterior, collisionEntrance: inn.collisionEntrance,
      collisionInterior: inn.collisionInterior, eventIds: Object.freeze([...inn.eventIds])
    }) : null,
    closed: closedPair && closedFact ? Object.freeze({
      buildingId: closedPair.building.id, factId: closedFact.id, signId: closedPair.sign.id,
      name: buildingName(closedPair.building), soundSetId: closedPair.building.soundSetId,
      labelMode: closedPair.building.labelMode, evidenceKind: evidenceKindForFact(closedFact),
      evidence: canonicalFactText(closedFact, closedPair.building),
      collisionExterior: closedPair.building.collisionExterior, collisionEntrance: closedPair.building.collisionEntrance,
      collisionInterior: closedPair.building.collisionInterior, eventIds: Object.freeze([...closedPair.building.eventIds])
    }) : null,
    edgesByDistrict: Object.freeze({ 'old-town': oldTownEdges, harbor: HARBOR_EDGES, snow: SNOW_EDGES, woodland: WOODLAND_EDGES })
  });
}

export function separateFacts(facts = []) { const groups = { observed: [], inferred: [], unknown: [] }; for (const fact of facts) for (const kind of Object.keys(groups)) for (const sentence of fact?.evidence?.[kind] ?? []) if (typeof sentence === 'string' && !groups[kind].includes(sentence)) groups[kind].push(sentence); return groups; }
export function humanizeEvidence(value) { if (typeof value !== 'string') return JSON.stringify(value); const exact = { 'inspection.entrypoint.observed': '静的検査で、街への入口として直接確認しました。', 'inspection.unresolved.observed': '静的な参照先の解決を試み、見つからない状態を直接確認しました。', 'inspection.cycle.inferred': '確認した参照関係から、循環している構造を推定しました。', 'inspection.test_association.inferred': 'ファイル名と参照関係から、テストとの対応を推定しました。', 'inspection.file.unverified': '対応するテストは、この検査では確認できていません。', 'inspection.reachability.unreached.inferred': '確認済みの入口からの静的な道筋がないと推定しました。' }[value]; if (exact) return exact; const facility = value.match(/^facility\.(present|absent)\.(observed|inferred|unknown)$/); if (facility) { const stateCopy = facility[1] === 'present' ? '施設がある状態' : '施設がない状態', classCopy = { observed: '直接確認した証拠があります。', inferred: '観測から推定した証拠があります。', unknown: 'まだ確認できない点が残っています。' }[facility[2]]; return `${stateCopy}について、${classCopy}`; } if (/observed$/.test(value)) return '静的検査で直接確認した追加の記録があります。'; if (/inferred$/.test(value)) return '確認済みの関係から推定した追加の記録があります。'; return 'この検査だけでは確認できない追加の項目があります。'; }
export function shortestRoute(fromId, targetId, graphNodes = NAV_NODES, graphEdges = NAV_EDGES) { const byId = new Map(graphNodes.map((node) => [node.id, node])), links = new Map(graphNodes.map((node) => [node.id, []])); for (const [a, b] of graphEdges) { links.get(a).push(b); links.get(b).push(a); } const queue = [[fromId]], seen = new Set([fromId]); while (queue.length) { const path = queue.shift(), last = path.at(-1); if (last === targetId) return path.map((id) => byId.get(id)); for (const next of links.get(last)) if (!seen.has(next)) { seen.add(next); queue.push([...path, next]); } } return [byId.get(fromId)]; }
export function directionalTarget(fromId, dx, dy, graphNodes = NAV_NODES, graphEdges = NAV_EDGES) { const origin = graphNodes.find((node) => node.id === fromId), nearby = graphEdges.flatMap(([a, b]) => a === fromId ? [b] : b === fromId ? [a] : []); if (!origin) return null; return nearby.map((id) => graphNodes.find((node) => node.id === id)).reduce((best, candidate) => { const length = Math.hypot(candidate.x - origin.x, candidate.y - origin.y) || 1, score = ((candidate.x - origin.x) * dx + (candidate.y - origin.y) * dy) / length; return score > (best?.score ?? .3) ? { candidate, score } : best; }, null)?.candidate ?? null; }

if (typeof document !== 'undefined') {
const canvas = document.querySelector('#town-canvas'), context = canvas.getContext('2d', { alpha: false });
const ui = { repository: document.querySelector('#repository-name'), mode: document.querySelector('#tour-mode'), objective: document.querySelector('#objective'), nearby: document.querySelector('#nearby'), interact: document.querySelector('#interact'), sound: document.querySelector('#sound-toggle'), completion: document.querySelector('#completion'), status: document.querySelector('#screen-reader-status'), summary: document.querySelector('#facts-summary'), facts: Object.fromEntries(['observed', 'inferred', 'unknown'].map((kind) => [kind, document.querySelector(`#facts-${kind}`)])), dialogue: document.querySelector('#dialogue'), dialoguePlace: document.querySelector('#dialogue-place'), dialogueSpeaker: document.querySelector('#dialogue-speaker'), dialogueBody: document.querySelector('#dialogue-body'), dialogueEvidence: document.querySelector('#dialogue-evidence'), dialogueClose: document.querySelector('#dialogue-close'), scene: document.querySelector('#scene-overlay'), sceneName: document.querySelector('#scene-name'), sceneDetail: document.querySelector('#scene-detail') };
const state = { district: 'old-town', player: { x: 502, y: 492, node: 'start' }, route: [], nearby: null, travel: null, complete: new Set(), moving: false, innOpen: false, innFade: 0, innTransition: null, deadNearby: false, dialogue: null, nightReturn: false, finished: false };
let gameBinding = null;
const backdrops = Object.fromEntries(Object.entries(DISTRICTS).map(([id, definition]) => { const image = new Image(); image.src = definition.asset; return [id, image]; }));
const innCutaway = new Image(), nightReturn = new Image(), sprite = new Image(); innCutaway.src = INN_CUTAWAY; nightReturn.src = OLD_TOWN_NIGHT_BACKPLATE; sprite.src = PLAYER;
function createSoundEngine() {
  let audioContext = null, activated = false, muted = false;
  const contextForPlayback = () => {
    if (!activated || muted) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    try { audioContext ??= new AudioContext(); } catch { return null; }
    return audioContext;
  };
  return {
    async prime() {
      activated = true;
      const current = contextForPlayback();
      if (current?.state === 'suspended') try { await current.resume(); } catch { /* Sound is optional. */ }
    },
    play(name) {
      const current = contextForPlayback(), cue = SOUND_CUES[name];
      if (!current || current.state !== 'running' || !cue) return;
      for (const note of cue) {
        const start = current.currentTime + note.delay, end = start + note.duration;
        try {
          const oscillator = current.createOscillator(), gain = current.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(note.frequency, start);
          oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, end);
          gain.gain.setValueAtTime(.0001, start);
          gain.gain.exponentialRampToValueAtTime(note.gain, start + Math.min(.025, note.duration / 3));
          gain.gain.exponentialRampToValueAtTime(.0001, end);
          oscillator.connect(gain).connect(current.destination);
          oscillator.start(start); oscillator.stop(end + .01);
        } catch { /* The game stays playable when Web Audio is unavailable. */ }
      }
    },
    toggle() { muted = !muted; return muted; }
  };
}
const sound = createSoundEngine();
const scene = () => {
  const definition = DISTRICTS[state.district];
  return { ...definition, edges: gameBinding?.edgesByDistrict?.[state.district] ?? definition.edges };
};
const currentZones = () => (gameBinding?.zones ?? []).filter((zone) => zone.district === state.district), nodeById = (id) => scene().nodes.find((node) => node.id === id);
function announce(message) { ui.status.textContent = ''; requestAnimationFrame(() => { ui.status.textContent = message; }); }
function nodeForPoint(point) { return scene().nodes.reduce((best, node) => Math.hypot(node.x - point.x, node.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? node : best); }
function zoneNearPlayer() { return currentZones().find((zone) => Math.hypot(nodeById(zone.node).x - state.player.x, nodeById(zone.node).y - state.player.y) < 46); }
function activeTravel() { return currentZones().some((zone) => !state.complete.has(zone.id)) ? null : TRAVELS[state.district]; }
function travelNearPlayer() { const travel = activeTravel(), node = travel && nodeById(travel.node); return node && Math.hypot(node.x - state.player.x, node.y - state.player.y) < 46 ? travel : null; }
function isNearDeadBuilding() { return Boolean(gameBinding?.closed) && state.district === 'old-town' && Math.hypot(DEAD_BUILDING.x - state.player.x, DEAD_BUILDING.y - state.player.y) <= FACILITY_LABEL_DISTANCE; }
function setInnOpen(open, time = performance.now()) {
  if (!gameBinding?.inn) open = false;
  if (state.innOpen === open) return;
  state.innOpen = open;
  state.innTransition = { from: state.innFade, to: open ? 1 : 0, startedAt: time };
  if (gameBinding.inn.soundSetId) sound.play(open ? 'enter' : 'exit');
  announce(open ? '宿屋に入りました。屋根が開いて室内が見えます。' : '宿屋を出ました。屋根が閉じます。');
}
function updateCutaway(time) {
  const transition = state.innTransition;
  if (!transition) return;
  const elapsed = time - transition.startedAt;
  const duration = gameBinding?.inn?.cutawayDurationMs ?? CUTAWAY_TRANSITION_MS;
  state.innFade = cutawayOpacity(transition.from, transition.to, elapsed, duration, gameBinding?.inn?.cutawayEasing);
  if (elapsed >= duration) { state.innFade = transition.to; state.innTransition = null; }
}
function setRoute(target) { if (state.dialogue || state.finished) return; state.route = shortestRoute(nodeForPoint(state.player).id, target.id, scene().nodes, scene().edges).slice(1); state.moving = state.route.length > 0; }
function actionLabel(label = '調べる') { ui.interact.replaceChildren(document.createTextNode(`${label} `), Object.assign(document.createElement('kbd'), { textContent: 'E' })); }
function updateHud() {
  if (state.finished) {
    state.nearby = null; state.travel = null; state.deadNearby = false;
    ui.objective.textContent = '4地区の巡回を完了した';
    ui.nearby.textContent = '夜の旧市街へ戻りました。完成版の旅はここから続きます。';
    ui.interact.disabled = true; actionLabel('完了'); return;
  }
  const next = currentZones().find((zone) => !state.complete.has(zone.id)), availableTravel = activeTravel();
  state.nearby = zoneNearPlayer(); state.travel = travelNearPlayer(); state.deadNearby = isNearDeadBuilding();
  ui.objective.textContent = next ? `${next.name}へ向かう — ${next.prompt}` : `${availableTravel.label}へ向かう — ${availableTravel.prompt}`;
  ui.nearby.textContent = state.nearby
    ? (state.complete.has(state.nearby.id) ? `${state.nearby.name}は調査済みです。次の目的地へ向かってください。` : `${state.nearby.name}：${state.nearby.prompt}（Eで調べる）`)
    : state.travel ? `${state.travel.label}：${state.travel.prompt}（Eで出発）`
      : gameBinding?.inn && state.district === 'old-town' && state.player.node === 'inn-doorstep' ? `${gameBinding.inn.name} · 入れる。扉の奥をタップ、または ↑ / W で入室。`
        : gameBinding?.inn && state.district === 'old-town' && state.innOpen ? `${gameBinding.inn.name}の中です。カウンターをタップして奥へ（↑ / Wでも可）`
          : state.deadNearby ? `閉鎖看板：${gameBinding.closed.evidence}`
            : '道に沿って、目的地を選んでください。';
  const enabled = Boolean(state.nearby && !state.complete.has(state.nearby.id)) || Boolean(state.travel);
  ui.interact.disabled = !enabled;
  actionLabel(state.travel ? (state.travel.final ? '完了する' : '出発') : '調べる');
}
function drawObjectiveAffordance(node, travel = false) {
  const pulse = .72 + Math.sin(performance.now() / 240) * .2;
  context.save(); context.globalAlpha = pulse; context.strokeStyle = travel ? '#79d4e2' : '#ffd66c'; context.lineWidth = 3;
  context.beginPath(); context.arc(node.x, node.y - 44, 11, 0, Math.PI * 2); context.stroke();
  context.beginPath(); context.moveTo(node.x - 5, node.y - 27); context.lineTo(node.x, node.y - 19); context.lineTo(node.x + 5, node.y - 27); context.stroke(); context.restore();
}
function drawProximityLabel(label, node, tone = '#fff1bc') {
  if (!label) return;
  context.save(); context.font = 'bold 13px system-ui'; context.textAlign = 'center';
  const width = Math.ceil(context.measureText(label).width) + 24, x = Math.max(8, Math.min(SIZE.width - width - 8, node.x - width / 2)), y = node.y - 86;
  context.fillStyle = '#101714e8'; context.strokeStyle = '#b99555cc'; context.lineWidth = 1;
  context.beginPath(); context.roundRect(x, y, width, 25, 6); context.fill(); context.stroke();
  context.fillStyle = tone; context.fillText(label, x + width / 2, y + 17); context.restore();
}
function drawDoorAffordance(node) {
  context.save(); context.translate(node.x, node.y - 36); context.globalAlpha = .72; context.strokeStyle = '#ffe08a'; context.lineWidth = 3;
  context.beginPath(); context.moveTo(-8, -6); context.lineTo(0, 2); context.lineTo(8, -6); context.stroke();
  context.beginPath(); context.moveTo(-6, 3); context.lineTo(0, 9); context.lineTo(6, 3); context.stroke(); context.restore();
}
function drawDeadBuildingSign() {
  if (!gameBinding?.closed) return;
  const { x, y } = DEAD_BUILDING;
  context.save(); context.translate(x, y); context.rotate(-.09);
  context.fillStyle = '#2b211b'; context.fillRect(-16, -4, 4, 28); context.fillRect(12, -4, 4, 28);
  context.fillStyle = '#5b3d28'; context.strokeStyle = '#b08754'; context.lineWidth = 2; context.fillRect(-28, -18, 56, 25); context.strokeRect(-28, -18, 56, 25);
  context.beginPath(); context.moveTo(-4, -18); context.lineTo(2, -7); context.lineTo(-1, 7); context.strokeStyle = '#2e2119'; context.stroke();
  context.fillStyle = '#e7c890'; context.font = 'bold 12px system-ui'; context.textAlign = 'center'; context.fillText('閉鎖', 0, -1); context.restore();
  if (gameBinding.closed.labelMode === 'proximity') drawProximityLabel(facilityLabelFor(Math.hypot(x - state.player.x, y - state.player.y), { name: gameBinding.closed.name, status: 'unreached' }), { x, y }, '#c7cce0');
}
function draw() {
  context.imageSmoothingEnabled = false;
  context.drawImage(state.nightReturn ? nightReturn : backdrops[state.district], 0, 0, SIZE.width, SIZE.height);
  if (gameBinding?.inn && state.district === 'old-town' && state.innFade > 0) { context.save(); context.globalAlpha = state.innFade; context.drawImage(innCutaway, 0, 0, SIZE.width, SIZE.height); context.restore(); }
  if (!state.nightReturn) {
    const next = currentZones().find((zone) => !state.complete.has(zone.id));
    if (next) { const markerId = next.id === 'inn' && !state.innOpen ? 'inn-doorstep' : next.node; drawObjectiveAffordance(nodeById(markerId)); }
    const travel = activeTravel(); if (travel) { const travelNode = nodeById(travel.node); drawObjectiveAffordance(travelNode, true); drawProximityLabel(facilityLabelFor(Math.hypot(travelNode.x - state.player.x, travelNode.y - state.player.y), { name: travel.label, active: true }), travelNode, '#a9ebf2'); }
    if (state.district === 'old-town') {
      const doorway = nodeById('inn-doorstep');
      if (gameBinding?.inn && !state.innOpen) { drawDoorAffordance(doorway); if (gameBinding.inn.labelMode === 'proximity') drawProximityLabel(facilityLabelFor(Math.hypot(doorway.x - state.player.x, doorway.y - state.player.y), { name: gameBinding.inn.name, enterable: true }), doorway); }
      drawDeadBuildingSign();
    }
    if (next && next.id !== 'inn') { const nextNode = nodeById(next.node); drawProximityLabel(facilityLabelFor(Math.hypot(nextNode.x - state.player.x, nextNode.y - state.player.y), { name: next.name, active: true }), nextNode); }
  }
  context.save(); context.globalAlpha = .42; context.fillStyle = '#090c0b'; context.beginPath(); context.ellipse(state.player.x, state.player.y + 7, 15, 6, 0, 0, Math.PI * 2); context.fill(); context.restore();
  context.drawImage(sprite, Math.round(state.player.x - 32), Math.round(state.player.y - 88), 64, 96);
}
function move(delta) { if (state.dialogue) { state.moving = false; return; } const destination = state.route[0]; if (!destination) { state.moving = false; return; } const distance = Math.hypot(destination.x - state.player.x, destination.y - state.player.y); if (distance <= delta) { state.player.x = destination.x; state.player.y = destination.y; state.player.node = destination.id; state.route.shift(); setInnOpen(Boolean(gameBinding?.inn) && state.district === 'old-town' && INN_INTERIOR_NODES.has(state.player.node)); } else { state.player.x += (destination.x - state.player.x) / distance * delta; state.player.y += (destination.y - state.player.y) / distance * delta; } state.moving = state.route.length > 0; updateHud(); }
let previous = performance.now(); function frame(time) { updateCutaway(time); move(Math.min(14, (time - previous) * .13)); previous = time; draw(); requestAnimationFrame(frame); }
function openDialogue(zone) { state.dialogue = zone; state.route = []; state.moving = false; ui.dialoguePlace.textContent = zone.place; ui.dialogueSpeaker.textContent = zone.speaker; ui.dialogueBody.textContent = zone.text; ui.dialogueEvidence.textContent = zone.evidence; ui.dialogueEvidence.className = `dialogue-evidence ${zone.evidenceKind}`; ui.dialogue.hidden = false; announce(`${zone.place}。${zone.speaker}との会話を開きました。EscapeまたはEnterで閉じます。`); }
function closeDialogue() { if (!state.dialogue) return; const zone = state.dialogue; state.dialogue = null; ui.dialogue.hidden = true; updateHud(); canvas.focus(); announce(`${zone.speaker}との会話を閉じました。`); }
function transitionTo(destination) { state.district = destination; const entry = scene().nodes.find((node) => node.id === scene().start); state.player = { x: entry.x, y: entry.y, node: entry.id }; state.route = []; state.innOpen = false; state.innFade = 0; state.innTransition = null; ui.sceneName.textContent = scene().name; ui.sceneDetail.textContent = scene().detail; ui.scene.hidden = false; window.setTimeout(() => { ui.scene.hidden = true; }, 1250); updateHud(); announce(`${scene().name}に到着しました。${scene().detail}`); }
function interact() { if (state.travel) { sound.play('interact'); if (state.travel.final) { state.nightReturn = true; state.finished = true; state.district = 'old-town'; state.player = { x: 502, y: 492, node: 'start' }; state.route = []; state.innOpen = false; state.innFade = 0; state.innTransition = null; ui.completion.hidden = false; ui.sceneName.textContent = '旧市街の夜'; ui.sceneDetail.textContent = '4地区の巡回を終え、灯りの街へ戻った。'; ui.scene.hidden = false; window.setTimeout(() => { ui.scene.hidden = true; }, 1250); updateHud(); announce('4地区の巡回を完了し、夜の旧市街へ戻りました。'); } else transitionTo(state.travel.destination); return; } const zone = state.nearby; if (!zone || state.complete.has(zone.id)) return; const expected = currentZones().find((item) => !state.complete.has(item.id)); if (zone !== expected) { announce(`先に${expected.name}へ向かってください。`); return; } sound.play('interact'); state.complete.add(zone.id); openDialogue(zone); updateHud(); }
function stepByKey(key) { const directions = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }, direction = directions[key]; if (state.finished || !direction) return false; const target = directionalTarget(nodeForPoint(state.player).id, ...direction, scene().nodes, scene().edges); if (target) setRoute(target); return true; }
canvas.addEventListener('pointerdown', (event) => { if (state.dialogue) return; void sound.prime(); const box = canvas.getBoundingClientRect(), point = { x: (event.clientX - box.left) * SIZE.width / box.width, y: (event.clientY - box.top) * SIZE.height / box.height }; setRoute(nodeForPoint(point)); canvas.focus(); });
window.addEventListener('keydown', (event) => { const key = event.key.length === 1 ? event.key.toLowerCase() : event.key; if (state.dialogue && ['Escape', 'Enter'].includes(key)) { event.preventDefault(); closeDialogue(); return; } if (state.dialogue) return; if (['e', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(key)) void sound.prime(); if (['e', 'Enter', ' '].includes(key)) { event.preventDefault(); interact(); return; } if (stepByKey(key)) event.preventDefault(); });
ui.interact.addEventListener('click', () => { void sound.prime(); interact(); });
ui.dialogueClose.addEventListener('click', closeDialogue);
ui.sound.addEventListener('click', () => {
  const muted = sound.toggle();
  ui.sound.setAttribute('aria-pressed', String(muted));
  ui.sound.textContent = muted ? '🔇 効果音 OFF' : '🔊 効果音 ON';
  ui.sound.setAttribute('aria-label', muted ? '効果音をオンにする' : '効果音をミュートする');
  if (!muted) void sound.prime().then(() => sound.play('interact'));
});
function renderFactLists(factRecords, { demo = false } = {}) {
  const facts = separateFacts(factRecords);
  for (const list of Object.values(ui.facts)) list.replaceChildren();
  ui.summary.textContent = demo
    ? '/api/town を取得できないため、検査事実は表示しません。'
    : `検査結果（観測 ${facts.observed.length}・推定 ${facts.inferred.length}・不明 ${facts.unknown.length}）`;
  for (const [kind, list] of Object.entries(facts)) {
    for (const sentence of list.slice(0, 4)) {
      const item = document.createElement('li'); item.textContent = humanizeEvidence(sentence); ui.facts[kind].append(item);
    }
    if (!list.length) {
      const item = document.createElement('li');
      item.textContent = demo ? 'アートデモは検査事実として数えません。' : 'この区分の記録はありません。';
      ui.facts[kind].append(item);
    }
  }
}
async function loadTourBinding() {
  try {
    const response = await fetch('/api/town');
    if (!response.ok) throw new Error('town unavailable');
    const town = await response.json(), binding = bindTemplateTour(town);
    if (binding.mode !== 'repository') throw new Error('WorldPlan unavailable');
    ui.repository.textContent = `調査対象：${binding.repositoryName ?? '名称不明のリポジトリ'}`;
    if (ui.mode) ui.mode.textContent = `リポジトリ連動 · seed ${binding.seed} · ${binding.zones.length} 件の実ファクトを場面に結合`;
    renderFactLists(town.worldPlan?.facts ?? town.facts ?? []);
    return binding;
  } catch {
    const binding = demoBinding();
    ui.repository.textContent = 'アートデモ：検査結果は未取得';
    if (ui.mode) ui.mode.textContent = 'デモモード · 会話と配置は検査事実ではありません';
    renderFactLists([], { demo: true });
    return binding;
  }
}
function imageReady(image) {
  return image.complete && image.naturalWidth > 0
    ? Promise.resolve()
    : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); });
}
const assetsReady = Promise.all([...Object.values(backdrops), innCutaway, nightReturn, sprite].map(imageReady));
Promise.all([assetsReady, loadTourBinding()]).then(([, binding]) => {
  gameBinding = binding;
  updateHud();
  requestAnimationFrame(frame);
});
}
