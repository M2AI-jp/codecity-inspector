// 施設の会話を組み立て、最後の行に選択肢があるかを返す。
import { fmtInt, mulberry32, strHash } from '../util.js';
import { san, spaceOut } from './text.js';
import { FACILITY_VOICE } from './facility-voices.js';

// ---------- facility keepers ----------
// 役場の書記・宿屋の番頭・酒場の主人・倉庫番・見張り台の番人・道場の検査官。facility.facts（src/facilities.mjs）の事実だけを話す。

// (the town hall already reports the whole town's unrecorded changes)
const FACILITY_WORKS = {
  inn: (n) => `ただいま改装中でございます。まだ記録していない変更が${n}個ございます。`,
  pub: (n) => `いま店の手入れ中でな。まだ記録していない変更が${n}個ある。`,
  warehouse: (n) => `棚を組みかえてる最中だ。まだ記録していない変更が${n}個。`,
  watchtower: (n) => `見張り台は修理中だ。まだ記録していない変更が${n}個ある。`,
  dojo: (n) => `いま、道場は手入れの最中です。まだ記録していない変更が${n}個あります。`,
  dock: (n) => `桟橋を直してる最中だ。まだ記録していない変更が${n}個ある。`,
  repair: (n) => `いま修理小屋も手入れ中だ。まだ記録していない変更が${n}個ある。`,
};

export function facilityLines(building, fac, town) {
  const v = FACILITY_VOICE[fac.archetype];
  const rng = mulberry32(strHash(`facility:${building.id}:${fac.archetype}`));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const facts = v.facts(fac.facts || {}, town).filter(Boolean);
  const dirty = building.module && building.module.works && building.module.works.dirty > 0 ? building.module.works.dirty : 0;
  if (dirty && FACILITY_WORKS[fac.archetype]) facts.unshift(FACILITY_WORKS[fac.archetype](fmtInt(dirty)));
  // 足りなければ、よく手を入れる人（施設の証拠に触れたコミット）
  const m = building.module || {};
  const a = (m.authors || []).filter((x) => x && x.name && x.commits > 0);
  if (facts.length < 2 && a.length) {
    // the keeper's own way of speaking (the watchtower guard, the warehouse keeper and the pub master are curt)
    const end = { pub: 'だ', warehouse: 'だ', watchtower: 'だ', repair: 'だ' }[fac.archetype] || 'です';
    facts.push(`よく顔を出すのは${san(a[0].name)}${end}（${fmtInt(a[0].commits)}回）。`);
  }
  return [pick(v.greet), pick(v.what), ...facts.slice(0, v.max || 4), pick(v.close)].map(spaceOut);
}

// The keeper's last line offers something (the pub master: the guild roster). web/ui.js shows the choice.
export function keeperOffer(building) {
  const fac = (building && building.data && building.data.facility) || (building && building.facility);
  return fac && FACILITY_VOICE[fac.archetype] && FACILITY_VOICE[fac.archetype].offer || null;
}
