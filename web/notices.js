import { FACILITY_VOICE } from './dialogue/facility-voices.js';

// The sign reads the same recorded facts as the inspector; it does not infer a test result.
export function dojoNotice(town) {
  const dojo = town.buildings.find((b) => b.facility?.archetype === 'dojo');
  if (!dojo) return null;
  const facts = dojo.facility.facts || {};
  return {
    label: '道場の札',
    title: { passed: '検査通過済み', failed: '壊れている' }[facts.state] || '未確認',
    lines: FACILITY_VOICE.dojo.facts(facts),
  };
}
