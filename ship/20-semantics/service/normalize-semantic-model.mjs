import {
  SEMANTIC_SCHEMA_VERSION,
} from '../configuration/semantic-config.mjs';
import {
  canonicalDigest,
  mergeEvidence,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';
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
const INSPECTION_COMPLETION_EVIDENCE_ID = 'repository.inspection.completed';
const INSPECTION_RUNTIME_UNKNOWN_EVIDENCE_ID = 'repository.inspection.runtime.unknown';

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
  const evidence = mergeEvidence(readEvidence(source));
  // Keep a visible unknown when a producer supplies an older or hand-built
  // InspectionReport without the completion address.  Static semantics may
  // never infer that the repository was inspected merely from filenames.
  if (!evidence.observed.includes(INSPECTION_COMPLETION_EVIDENCE_ID)) {
    evidence.unknown = sortedUniqueStrings([
      ...evidence.unknown,
      INSPECTION_RUNTIME_UNKNOWN_EVIDENCE_ID,
    ]);
  }
  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    inspectionDigest: canonicalDigest(source),
    repository: readRepository(source),
    files,
    connections,
    capabilities: buildCapabilities(source, files, connections),
    evidence,
  };
}
