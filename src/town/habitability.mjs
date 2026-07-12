// src/town/habitability.mjs
//
// Turns one TownModel (see ./schema.mjs) into a Habitability verdict: which
// rung of the Lv.0..Lv.5 ladder the scanned repository's town sits on, whether
// anyone can actually live there at all (canLive), the missing life-infra that
// blocks habitation, the non-blocking "dirt", any external contractor reports
// still awaiting inspection, and the town-language reasons behind the verdict.
//
// PURE and DETERMINISTIC: no I/O, no Date.now / Math.random / new Date(), and
// it never reads or runs target-repo code -- it only judges the already-derived
// TownModel. Built in parallel with the facility-detection module, so it
// depends ONLY on the frozen ./schema.mjs contract (FACILITY_KINDS /
// FACILITY_LABELS / HABITABILITY_LEVELS / GUILD_TABS + the TownModel &
// Habitability typedefs), never on that sibling's internals.
//
// GOAL is HABITABLE, not CLEAN: "dirt" (a ruin, an unassociated house/shop, a
// workshop with no dojo) never lowers the level or blocks canLive by itself.
// Only missing life-infra does -- no way in, a public service nobody can reach,
// nowhere to persist data, no config, no tests, no logs, no distribution.
//
// EVIDENCE SEPARATION stays load-bearing: a facility backed only by
// unknown-class evidence is NOT "broken", it is "not lit up yet" -- reported as
// a soft warning, never a blocker. Likewise external contractor self-reports
// ("完成しました") are ALWAYS pending-inspection and NEVER count toward the
// level; only observed real change does.

import {
  FACILITY_KINDS,
  FACILITY_LABELS,
  GUILD_TABS,
  HABITABILITY_LEVELS,
  deepFreeze,
  isFacilityKind,
  makeEvidence
} from './schema.mjs';

/** Banner shown whenever the town fails the minimum bar to be lived in. */
const HEADLINE_CANNOT_LIVE = 'このままだと誰も住めません！';

/**
 * Kinds that do NOT, by themselves, imply the town needs an entrance:
 * town_hall is repo metadata (always present), gate is the entrance itself, and
 * ruin is allowed dirt. Any OTHER present facility means real infrastructure
 * that someone or something must be able to reach -- so its presence without a
 * gate is a genuine "no way in" blocker.
 * @type {ReadonlySet<string>}
 */
const NON_ENTERABLE_KINDS = new Set(['town_hall', 'gate', 'ruin']);

/** The 接続者ギルド "state" (じょうたい) tab id -- last of GUILD_TABS by contract. */
const GUILD_STATE_TAB = GUILD_TABS[GUILD_TABS.length - 1];

// Present-form flag names (true === the safeguard EXISTS) tried, in order,
// across a pub's details bag and the guild's state tab. A pub warning fires
// only when one of these resolves to an explicit `false` (the state positively
// shows the safeguard is absent); an unresolved flag stays "unknown" and never
// raises a warning, honoring "unknown is not broken".
const COST_CONTROL_FLAGS = ['costControl', 'hasCostControl', 'costLimit', 'hasCostLimit', 'costCap', 'budget'];
const AUTH_FLAGS = ['auth', 'authentication', 'authenticated', 'hasAuth', 'requiresAuth'];
const LOGGING_FLAGS = ['logging', 'logs', 'logged', 'hasLogging', 'hasLogs'];

/**
 * @param {unknown} value
 * @returns {boolean} true only for a plain (non-array, non-null) object
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize a possibly-malformed Evidence bag into a fresh, well-shaped one.
 * Missing / non-array fields become empty arrays -- "signal absent", never an
 * error. Returns a new mutable bag (via makeEvidence) so merging can push.
 * @param {unknown} raw
 * @returns {import('./schema.mjs').Evidence}
 */
function normalizeEvidence(raw) {
  const evidence = makeEvidence();
  if (isPlainObject(raw)) {
    if (Array.isArray(raw.observed)) evidence.observed.push(...raw.observed);
    if (Array.isArray(raw.inferred)) evidence.inferred.push(...raw.inferred);
    if (Array.isArray(raw.unknown)) evidence.unknown.push(...raw.unknown);
  }
  return evidence;
}

/**
 * Build a kind -> Facility lookup covering EVERY FACILITY_KINDS id (missing
 * kinds default to an absent stand-in), tolerant of a partial or malformed
 * TownModel. Entries with an unrecognized kind are dropped (isFacilityKind
 * guards unvalidated scan data); duplicate entries for one kind are MERGED
 * (present OR'd, count summed, evidence concatenated, details shallow-merged)
 * rather than dropped, so no observed evidence is silently lost.
 * @param {unknown} rawFacilities
 * @returns {Map<string, import('./schema.mjs').Facility>}
 */
function buildFacilityIndex(rawFacilities) {
  const index = new Map(
    FACILITY_KINDS.map((kind) => [kind, { kind, present: false, count: 0, evidence: makeEvidence(), details: undefined }])
  );
  const list = Array.isArray(rawFacilities) ? rawFacilities : [];
  for (const raw of list) {
    if (!isPlainObject(raw) || !isFacilityKind(raw.kind)) continue;
    const merged = index.get(raw.kind);
    const evidence = normalizeEvidence(raw.evidence);
    merged.present = merged.present || raw.present === true;
    merged.count += Number.isFinite(raw.count) ? raw.count : 0;
    merged.evidence.observed.push(...evidence.observed);
    merged.evidence.inferred.push(...evidence.inferred);
    merged.evidence.unknown.push(...evidence.unknown);
    if (isPlainObject(raw.details)) merged.details = { ...(merged.details ?? {}), ...raw.details };
  }
  return index;
}

/**
 * A facility counts as present when its own flag says so OR it has a positive
 * count -- tolerates a TownModel where the two drifted rather than trusting a
 * single field blindly.
 * @param {import('./schema.mjs').Facility} facility
 * @returns {boolean}
 */
function isPresent(facility) {
  return facility.present === true || facility.count > 0;
}

/**
 * True when a facility's only backing is unknown-class evidence: static
 * scanning flagged it present, but nothing observed or inferred confirms it
 * actually works yet (e.g. reachability that could not be resolved). This is
 * the generic, vocabulary-free stand-in for "not lit up yet" -- reported as a
 * warning, never a blocker. "Untested" is not "broken".
 * @param {import('./schema.mjs').Facility} facility
 * @returns {boolean}
 */
function backedOnlyByUnknown(facility) {
  const { observed, inferred, unknown } = facility.evidence;
  return observed.length === 0 && inferred.length === 0 && unknown.length > 0;
}

/**
 * Resolve a boolean safeguard flag by trying several plausible key spellings
 * across several candidate source objects, in priority order. Returns the first
 * boolean found, or `undefined` when none of the sources declare any of the
 * keys -- an absent flag is a gap in what we could observe (unknown), NOT proof
 * the safeguard is missing.
 * @param {Array<unknown>} sources
 * @param {string[]} keys
 * @returns {boolean | undefined}
 */
function readBooleanFlag(sources, keys) {
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const key of keys) {
      if (typeof source[key] === 'boolean') return source[key];
    }
  }
  return undefined;
}

/**
 * Render one external contractor self-report as a pending-inspection line.
 * Per project rule a contractor's own "done / fixed / tested" claim is NEVER
 * itself evidence of a working town -- only observed real change is. So every
 * report becomes a pending line regardless of its declared status.
 * @param {import('./schema.mjs').ContractorReport} report
 * @returns {string}
 */
function describePendingInspection(report) {
  const source = typeof report.source === 'string' && report.source.trim() ? report.source.trim() : '外部';
  const subject = typeof report.subject === 'string' ? report.subject.trim() : '';
  const base = `役場には${source}工務店の完成報告があります。しかし、道場（検査）はまだ通っていません。`;
  return subject ? `${base}（報告内容: ${subject}）` : base;
}

/**
 * Assess how habitable a scanned repository's town is from its TownModel: the
 * Lv.0..Lv.5 level, whether it clears the minimum bar to be lived in at all
 * (canLive), the blockers that must be fixed first, non-blocking warnings
 * ("dirt"), pending contractor inspections, and the town-language reasons for
 * the verdict. Synchronous, pure, and deterministic -- same TownModel in, same
 * Habitability out -- with no reliance on anything beyond the schema contract.
 * @param {import('./schema.mjs').TownModel} townModel
 * @returns {import('./schema.mjs').Habitability}
 */
export function assessHabitability(townModel) {
  const facilities = buildFacilityIndex(townModel?.facilities);
  const at = (kind) => facilities.get(kind);

  const gate = at('gate');
  const inn = at('inn');
  const pub = at('pub');
  const warehouse = at('warehouse');
  const well = at('well');
  const dojo = at('dojo');
  const watchtower = at('watchtower');
  const dock = at('dock');

  const hasEntry = isPresent(gate);
  const hasInnOrPub = isPresent(inn) || isPresent(pub);
  // Any real building other than repo metadata (town_hall), the entrance
  // itself (gate), and allowed dirt (ruin) means the town needs a way in.
  const hasEnterableBuildings = FACILITY_KINDS.some((kind) => !NON_ENTERABLE_KINDS.has(kind) && isPresent(at(kind)));

  // --- Blockers: missing life-infra that must be fixed before anyone can live
  // here. Applied only when relevant to what the town actually claims to be --
  // dirt (ruin, weird huts, TODO grass) never appears here. --------------------
  const blockers = [];
  if (hasEnterableBuildings && !hasEntry) {
    blockers.push('入口がありません（誰も入れません）。建物はあるのに、門（エントリーポイント）が見つかりませんでした。');
  }
  const canLive = blockers.length === 0;

  // --- Warnings: allowed "dirt" and soft habitability notes. These NEVER
  // affect canLive; they do gate the very top of the ladder (Lv.5). -----------
  const warnings = [];

  if (isPresent(inn) && backedOnlyByUnknown(inn)) {
    warnings.push('宿屋はありますが、まだ灯りがついていません（到達性が「不明」のままで、実際に人が来られるか確認できていません）。');
  }

  if (isPresent(pub)) {
    // pub.details is the facility-level home for kind-specific state; the guild's
    // じょうたい (state) tab is a plausible second home for the same signal.
    // Neither shape is frozen, so both are read defensively and an absent flag
    // is treated as "unknown" -- a warning fires only on an explicit `false`.
    const guild = townModel?.guild;
    const guildState = isPlainObject(guild) ? (guild[GUILD_STATE_TAB] ?? guild.state) : undefined;
    const pubSources = [pub.details, guildState];
    if (readBooleanFlag(pubSources, COST_CONTROL_FLAGS) === false) {
      warnings.push('酒場（外部API / LLM連携）にコスト制限なし: 使いすぎても誰も止めてくれません。');
    }
    if (readBooleanFlag(pubSources, AUTH_FLAGS) === false) {
      warnings.push('酒場（外部API / LLM連携）に認証なし: 誰でも呼び出せてしまいます。');
    }
    if (readBooleanFlag(pubSources, LOGGING_FLAGS) === false) {
      warnings.push('酒場（外部API / LLM連携）にログなし: 何が起きたか、あとから誰にも分かりません。');
    }
  }

  if (hasInnOrPub && !isPresent(warehouse)) {
    warnings.push('記録を保存する倉庫（DB）が見当たりません。');
  }
  if (hasInnOrPub && !isPresent(well)) {
    warnings.push('設定や秘密情報を守る井戸（env / secrets）が見当たりません。');
  }

  // --- Pending inspections: external code-gen contractor self-reports. A
  // "完成しました" report is a claim awaiting town-hall + dojo confirmation,
  // never itself evidence, and NEVER counts toward the level. -----------------
  const contractorReports = Array.isArray(townModel?.external?.contractorReports)
    ? townModel.external.contractorReports
    : [];
  const pendingInspections = contractorReports.filter(isPlainObject).map(describePendingInspection);

  // --- Level ladder (Lv.0..Lv.5), climbed cumulatively and explained step by
  // step. Any blocker caps progress at Lv.1. ---------------------------------
  const reasons = [];
  const hasFacilityBeyondTownHall = FACILITY_KINDS.some((kind) => kind !== 'town_hall' && isPresent(at(kind)));

  let level = 0;
  if (!hasFacilityBeyondTownHall) {
    reasons.push(`${FACILITY_LABELS.town_hall}（リポジトリ）のほかに施設がまだ見当たりません。まずは建物を置きましょう。`);
  } else {
    level = 1;
    reasons.push('役場のほかにも施設が見つかりました。電気は通りましたが、街としてはまだこれからです。');

    if (!canLive) {
      reasons.push('生活に欠かせない入口などが足りないため、これ以上はレベルが上がりません（Lv.1 どまり）。');
    } else if (!(hasEntry && hasInnOrPub)) {
      const missing = [];
      if (!hasEntry) missing.push(`${FACILITY_LABELS.gate}（入口）`);
      if (!hasInnOrPub) missing.push(`${FACILITY_LABELS.inn}か${FACILITY_LABELS.pub}`);
      reasons.push(`${missing.join('と')}が揃うと、主要な動線が通ります。`);
    } else {
      level = 2;
      reasons.push('門（入口）と、宿屋または酒場が揃い、主要な動線が通る小村になりました。');

      // Life-infra implied by present facilities: a public service (inn / pub)
      // needs somewhere to persist data (warehouse) and to hold config (well).
      const lifeInfraSatisfied = !hasInnOrPub || (isPresent(warehouse) && isPresent(well));
      if (!lifeInfraSatisfied) {
        const missing = [];
        if (!isPresent(warehouse)) missing.push(`${FACILITY_LABELS.warehouse}（DB）`);
        if (!isPresent(well)) missing.push(`${FACILITY_LABELS.well}（env / secrets）`);
        reasons.push(`宿屋・酒場はありますが、${missing.join('と')}が見当たらないため、まだ安心して住める街ではありません。`);
      } else {
        level = 3;
        reasons.push('必要な生活インフラ（倉庫・井戸）が揃い、ここは住める街になりました。');

        if (!(isPresent(dojo) && isPresent(watchtower))) {
          const missing = [];
          if (!isPresent(dojo)) missing.push(`${FACILITY_LABELS.dojo}（テスト）`);
          if (!isPresent(watchtower)) missing.push(`${FACILITY_LABELS.watchtower}（ログ・監視）`);
          reasons.push(`${missing.join('と')}が加わると、検証と監視が働き、もっとにぎわいます。`);
        } else {
          level = 4;
          reasons.push('道場（テスト）と見張り台（ログ・監視）が揃い、にぎわう街になりました。');

          if (isPresent(dock) && warnings.length === 0) {
            level = 5;
            reasons.push('船着場（配布）も整い、気になる警告もありません。見せたくなる街です。');
          } else {
            const gap = [];
            if (!isPresent(dock)) gap.push(`${FACILITY_LABELS.dock}（配布）がまだ無い`);
            if (warnings.length > 0) gap.push('未解決の警告が残っている');
            reasons.push(`${gap.join('、')}ため、見せたくなる街まではあと少しです。`);
          }
        }
      }
    }
  }

  if (!canLive) reasons.unshift(HEADLINE_CANNOT_LIVE);

  return deepFreeze({
    level,
    levelName: HABITABILITY_LEVELS[level].name,
    canLive,
    blockers,
    warnings,
    pendingInspections,
    reasons
  });
}
