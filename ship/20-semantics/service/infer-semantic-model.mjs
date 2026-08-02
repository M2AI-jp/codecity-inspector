import {
  normalizeSemanticModel,
} from './normalize-semantic-model.mjs';

export function inferSemanticModel(inspection) {
  return normalizeSemanticModel({ inspection });
}
