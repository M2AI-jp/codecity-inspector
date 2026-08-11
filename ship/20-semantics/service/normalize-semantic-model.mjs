import {
  SEMANTIC_SCHEMA_VERSION,
} from '../configuration/semantic-config.mjs';
import {
  readEvidence,
  readRepository,
} from '../data/inspection-access.mjs';
import {
  buildCapabilities,
} from './capability-inference.mjs';
import {
  buildConnections,
} from './connection-inference.mjs';
import {
  buildSemanticFiles,
} from './file-semantics.mjs';
export function normalizeSemanticModel(source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('normalizeSemanticModel requires an InspectionReport object');
  }
  if (source.schemaVersion !== 1) {
    throw new TypeError(`Unsupported InspectionReport schemaVersion: ${String(source.schemaVersion)}`);
  }
  const files = buildSemanticFiles(source);
  const connections = buildConnections(source, files);
  const evidence = readEvidence(source);
  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    repository: readRepository(source),
    files,
    connections,
    capabilities: buildCapabilities(source, files, connections),
    evidence,
  };
}
