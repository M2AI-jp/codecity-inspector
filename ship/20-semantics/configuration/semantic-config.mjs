/**
 * Contract vocabulary for SemanticModel v1.
 *
 * Keeping these lists in one place makes the normalizer's output independent
 * of object insertion order and gives downstream modules a small, explicit
 * vocabulary to consume.
 */

export const SEMANTIC_SCHEMA_VERSION = 1;

export const ROLES = Object.freeze([
  'service',
  'interface',
  'data',
  'configuration',
  'test',
  'tooling',
  'module',
]);

export const CAPABILITY_NAMES = Object.freeze([
  'entrypoint',
  'persistence',
  'configuration',
  'build',
  'test',
  'observability',
  'recovery',
  'distribution',
  'externalConnections',
]);

export const CONNECTION_KINDS = Object.freeze([
  'http',
  'webhook',
  'external-api',
  'llm',
  'storage',
  'unknown',
]);

export const EVIDENCE_STATES = Object.freeze([
  'observed',
  'inferred',
  'unknown',
]);
