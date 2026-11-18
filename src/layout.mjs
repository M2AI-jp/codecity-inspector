// RepoModel → Town（CONTRACTS.md）。同じ RepoModel（と同じ art manifest）からは常に同じ街ができる。
//
// 街のつくり（古い街並み。通りは街の端から端まで通さない）:
//   - 骨組み: 中央の広場（角に植え込み、役場の前は広場の石が通りまで張り出す）、広場の南の大通り（東西、
//     ゆるく曲がり段差がある）、広場の北の通り、広場の両わきの南北の通り、役場の脇から北へ・大通りから南へ
//     の南北の通り（北と南で位置がずれるので十字路にならない）。
//   - その外側の地区を、通りで切り分けていく（BSP）。南北・東西の切れ目は地区ごとに位置が違い、
//     通りは T 字に突き当たり、ところどころ1行ずれる。街区の深さと幅は毎回違い、深い街区には土の路地
//     （ときどき途中で行き止まり）、広い街区には南北の小路が抜ける。小さな街区のいくつかは小さな緑地。
//   - 建物は3/4見下ろしなので扉は必ず南。footprint のすぐ下の1行は端から端まで歩ける地面（通り・前庭）。
//     footprint の上は版ごとの cover だけを屋根の余白にし、同じ通りの隣は壁を接して置ける。
//   - 建物は広場に近い所から埋まり、地区（最上位ディレクトリ）は広場のまわりに扇形に並ぶ。
//     工房は広場の南の大通りの東側に集まり、廃屋は最後に（外縁に）置く。使わなかった通りは消え、
//     街のまわりは森になる。街の外へ出る道が何本か残る。
//   - 船着場（dock）があるときは、街の南の端が水辺になる: 船着場の前の岸の通り（石の岸壁）、その下の水、
//     水に突き出た桟橋（歩ける）、もやった舟。
//   - 井戸（well）は建物ではなく、広場か近くの緑地に立つ井戸小屋（town.landmarks と props の wellhouse）。
//   - 作業中の変更がある建物（module.works.dirty > 0）には足場・工事中の札・材木を置く（絵があるときだけ）。
//
// 建物の大きさは art/game/manifest.json の archetypes[key].variants[*].footprint を使い、無ければ下の表を使う。
// props の (x, y) は、その小物が立つ足元の中心（tile単位）。1×1なら (tx + 0.5, ty + 1)。
import { prepareAttemptSpecs } from './layout/attempt-specs.mjs';
import { prepareAttemptDemand } from './layout/attempt-demand.mjs';
import { selectAttemptGrid } from './layout/attempt-grid.mjs';
import { selectAttemptVariants } from './layout/attempt-variants.mjs';
import { acceptAttemptClearance } from './layout/attempt-clearance.mjs';
import { placeAttemptProps } from './layout/attempt-props.mjs';
import { writeAttemptTown } from './layout/attempt-town.mjs';
import { finishAttemptTown } from './layout/attempt-finish.mjs';

export { FACILITY_NAME, LANDMARK } from './layout/constants.mjs';
export { aggregate } from './layout/facilities.mjs';
export { chooseCanalRoute } from './layout/canal.mjs';
export { loadArt, loadProps, loadGround, propTiles } from './layout/manifest.mjs';

// ---------- 本体 ----------
export function layoutTown(repo, opts = {}) {
  for (const m of repo.modules || []) if (m.group !== undefined && typeof m.group !== 'string') {
    throw new TypeError(`layoutTown: ${m.path} の group は文字列で指定する`);
  }
  // 戸口前は初回の fit から双方向に確保する。後で変わる版と階段位置に
  // 衝突が残る場合だけ、版を固定／候補を除外して同じ種・順序で再試行する。
  const rejectedPlacements = new Set();
  const doorVariants = new Map();
  const stairReservations = new Map();
  if (opts.debug) opts.debug.doorRetries = 0;
  for (let attempt = 0; attempt < 128; attempt++) {
    const town = layoutAttempt(repo, opts, rejectedPlacements, doorVariants, stairReservations);
    if (town) {
      if (opts.debug) opts.debug.placementRetries = attempt;
      return town;
    }
  }
  throw new Error('layoutTown: 階段と戸口前を隠さない建物配置を128回で確保できなかった');
}

// 各段階は S に結果を残す。乱数と候補の順序を保ち、再試行の状態だけを次へ引き継ぐ。
function layoutAttempt(repo, opts, rejectedPlacements, doorVariants, stairReservations) {
  const S = { repo, opts, rejectedPlacements, doorVariants, stairReservations };
  prepareAttemptSpecs(S);
  prepareAttemptDemand(S);
  selectAttemptGrid(S);
  // 城を外した町の再試行にも、同じ除外候補・戸口の版・階段予約を引き継ぐ。
  if (!S.P && S.goalSpec) return layoutAttempt(repo, { ...opts, goalLook: undefined }, rejectedPlacements, doorVariants, stairReservations);
  if (!S.P) throw new Error('layoutTown: 建物を配置できなかった');
  selectAttemptVariants(S);
  if (!acceptAttemptClearance(S)) return null;
  if (!placeAttemptProps(S)) return null;
  writeAttemptTown(S);
  return finishAttemptTown(S);
}
