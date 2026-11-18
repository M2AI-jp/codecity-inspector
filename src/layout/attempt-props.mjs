import { FACILITY_NAME, LANDMARK } from './constants.mjs';
import { placeProps } from './props.mjs';
import { makeRng } from './util.mjs';
import { placementKey } from './grid/placement.mjs';
import { canalRoadSideProblem } from './canal/validate.mjs';

// 小物を同じ乱数列で置き、城の予約と水路を再検査して未配置の理由を集める。
export function placeAttemptProps(S) {
  const { P, F, seed, spawn, propArt, landmarks, dock, canal, repo, goalSpec,
    rejectedPlacements, byPath, lms, facSpecs, art, water, opts } = S;
  const placedProps = placeProps(P, F, makeRng(seed ^ 0x9e3779b9), spawn, {
    overlay: opts.overlay, propArt, landmarks, dock, bridgeProps: canal?.bridgeProps || [], mouthProps: canal?.mouthProps || [], bridgeCells: canal?.bridgeCells || [],
    bridgeDeckCells: canal?.bridgeDeckCells || [], canalCells: canal?.cells || [],
    hasReadme: !!(repo.readme?.title?.trim() || repo.readme?.excerpt?.trim()),
  });
  if (goalSpec && canal?.cells?.length && canalRoadSideProblem(canal.cells, canal.crossings, {
    g: F.g, id: P.id, inC: (x, y) => x >= F.crop.x0 && x <= F.crop.x1 && y >= F.crop.y0 && y <= F.crop.y1,
  })) {
    const p = P.placed.find((p) => p.spec.goalSite);
    rejectedPlacements.add(placementKey(P.cols, P.rows, p.spec, p.x, p.y));
    return false;
  }
  const placedFacilitySources = new Set(P.placed.map((p) => p.spec.sourceFacility).filter(Boolean));
  const placedLandmarkIds = new Set(placedProps.landmarks.map((l) => l.id));
  const unplaced = [];
  for (const u of P.groupUnplaced || []) unplaced.push({ ...u, modules: [...new Set(u.modules.filter((p) => byPath.has(p)))] });
  if (canal?.unplaced) unplaced.push(canal.unplaced);
  for (const f of repo.facilities || []) {
    const facilityName = FACILITY_NAME[f.archetype] || LANDMARK[f.archetype]?.name;
    if (!facilityName) continue;
    const landmarkIndex = lms.indexOf(f);
    const landmarkId = landmarkIndex >= 0 ? `f${facSpecs.length + landmarkIndex + 1}` : null;
    const placed = LANDMARK[f.archetype]
      ? landmarkId !== null && placedLandmarkIds.has(landmarkId)
      : placedFacilitySources.has(f);
    if (placed) continue;
    let reason;
    if (LANDMARK[f.archetype]) {
      const prop = LANDMARK[f.archetype].prop;
      if (!propArt[prop]) reason = `小物 ${prop} の絵が manifest にない`;
      else if (f.archetype === 'gate' && !(F.exits || []).length) reason = '門を置ける南北の出口がない';
      else if (f.archetype === 'gate') reason = '出口ごとに門の絵・柱・土道・門番を置ける場所がない';
      else reason = '広場または緑地に井戸小屋と井戸番を置ける場所がない';
    } else if (!art[f.archetype]?.footprint) {
      reason = `施設 ${f.archetype} の絵が manifest にない`;
    } else if (f.archetype === 'dock' && !water) {
      reason = '水辺の地面がない';
    } else {
      reason = '施設を配置できる建物の場所がない';
    }
    unplaced.push({
      archetype: f.archetype,
      name: f.name || facilityName,
      reason,
      evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 20) : [],
      evidenceCount: f.evidenceCount ?? (f.evidence || []).length,
    });
  }
  Object.assign(S, { placedProps, unplaced });
  return true;
}
