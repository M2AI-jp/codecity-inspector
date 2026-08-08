/**
 * Public boundary for 20-semantics. Keep consumers on this file; internal
 * service/data/configuration modules are implementation details.
 */
export {
  normalizeSemanticModel as inferSemanticModel,
} from './service/normalize-semantic-model.mjs';
