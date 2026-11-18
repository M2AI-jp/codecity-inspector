import { createDistrictContext } from './districts/context.mjs';
import { prepareDistrictLeaves } from './districts/leaves.mjs';
import { prepareDistrictCuts } from './districts/cuts.mjs';
import { prepareDistrictSubdivision } from './districts/subdivision.mjs';
import { addFlankDistricts, divideNorthernDistricts, divideSouthernDistricts } from './districts/regions.mjs';

// 補助状態を格子へ混ぜず、同じ乱数生成器で広場の脇・北・南の順に切り分ける。
export function divideDistricts(S) {
  const D = createDistrictContext(S);
  prepareDistrictLeaves(D);
  prepareDistrictCuts(D);
  prepareDistrictSubdivision(D);
  addFlankDistricts(D);
  divideNorthernDistricts(D);
  divideSouthernDistricts(D);
  const { leaves, courts, flankW, flankE } = D;
  Object.assign(S, { leaves, courts, flankW, flankE });
}
