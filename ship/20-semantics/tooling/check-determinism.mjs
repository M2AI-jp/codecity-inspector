import { inferSemanticModel } from '../index.mjs';

/** Small CI-friendly smoke check for byte determinism. */
export function assertByteDeterministic(inspection, annotations) {
  const first = JSON.stringify(inferSemanticModel(inspection));
  const second = JSON.stringify(inferSemanticModel(inspection));
  if (first !== second) {
    throw new Error('SemanticModel is not byte-deterministic');
  }
  return first;
}

export function assertNormalizedByteDeterministic(input) {
  const first = JSON.stringify(inferSemanticModel(input?.inspection));
  const second = JSON.stringify(inferSemanticModel(input?.inspection));
  if (first !== second) {
    throw new Error('SemanticModel is not byte-deterministic');
  }
  return first;
}
