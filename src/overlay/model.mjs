import { analyzeRepository } from '../analyze.mjs';
import { applyGroups } from './groups.mjs';

// Retain the complete ownership list in saved fuzz models, not just the eight top files.
export function analyzeOverlayModel(path) {
  const overlayFiles = {};
  const model = analyzeRepository(path, { onModules(_modules, groups) {
    for (const g of groups) Object.defineProperty(overlayFiles, g.path, { value: g.files.map((f) => f.path), enumerable: true });
  } });
  return { ...model, overlayFiles };
}
export const groupOverlayModel = (model, overlay) => applyGroups(model, overlay.groups, new Map(Object.entries(model.overlayFiles || {})));
