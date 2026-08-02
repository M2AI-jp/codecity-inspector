import {
  SEMANTIC_SCHEMA_VERSION,
} from '../configuration/semantic-config.mjs';
import {
  canonicalDigest,
} from '../interface/canonical.mjs';
import {
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

export function normalizeSemanticModel({ inspection, annotations } = {}) {
  const source = inspection ?? {};
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('normalizeSemanticModel requires an InspectionReport object');
  }
  if (source.schemaVersion !== 1) {
    throw new TypeError(`Unsupported InspectionReport schemaVersion: ${String(source.schemaVersion)}`);
  }
  const files = buildSemanticFiles(source, annotations);
  const connections = buildConnections(source, files);
  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    inspectionDigest: canonicalDigest(source),
    repository: readRepository(source),
    files,
    connections,
    capabilities: buildCapabilities(source, files, connections),
  };
}
