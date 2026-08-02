/**
 * Public boundary for 20-semantics. Keep consumers on this file; internal
 * service/data/configuration modules are implementation details.
 */
export {
  inferSemanticModel,
} from './service/infer-semantic-model.mjs';
export {
  normalizeSemanticModel,
} from './service/normalize-semantic-model.mjs';
