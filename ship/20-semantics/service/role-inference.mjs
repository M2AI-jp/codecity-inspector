import {
  ROLES,
} from '../configuration/semantic-config.mjs';
import {
  ROLE_SIGNAL_RULES,
} from '../data/role-rules.mjs';
import {
  basename,
  pathSegments,
} from '../data/inspection-access.mjs';
import {
  emptyEvidence,
  sortedUniqueStrings,
} from '../interface/canonical.mjs';

const ROLE_ORDER = new Map(ROLES.map((role, index) => [role, index]));

export function inferFileRole(file) {
  const evidence = emptyEvidence();
  const scores = new Map();

  if (file?.isTest === true) {
    addSignal(scores, 'test', 4, 'role.signal.test.file-flag');
  }

  const kind = typeof file?.kind === 'string' ? file.kind.toLowerCase() : '';
  const kindRole = kind === 'config' || kind === 'configuration'
    ? 'configuration'
    : kind === 'test' || kind === 'specification'
      ? 'test'
      : kind === 'data' || kind === 'dataset'
        ? 'data'
        : kind === 'tool' || kind === 'tooling'
          ? 'tooling'
          : kind === 'interface' || kind === 'api'
            ? 'interface'
            : kind === 'service'
              ? 'service'
              : null;
  if (kindRole !== null) {
    addSignal(scores, kindRole, kindRole === 'test' ? 5 : 2, `role.signal.kind.${kindRole}`);
  }

  const parts = pathSegments(file?.path);
  const name = basename(file?.path);
  const lowerPath = typeof file?.path === 'string' ? file.path.toLowerCase() : '';
  const extension = typeof file?.extension === 'string'
    ? file.extension.toLowerCase()
    : '';

  // A test tree remains a test tree even when its fixture/configuration files
  // also happen to match data or configuration lexical signals.
  if (parts.some((part) => ROLE_SIGNAL_RULES.test.segments.includes(part))
      || ROLE_SIGNAL_RULES.test.names.some((token) => name.includes(token))) {
    addSignal(scores, 'test', 6, 'role.signal.test.path-marker');
  }

  for (const role of ROLES.filter((candidate) => candidate !== 'module')) {
    const rules = ROLE_SIGNAL_RULES[role];
    if (rules === undefined) {
      continue;
    }
    for (const segment of rules.segments) {
      if (parts.includes(segment)) {
        addSignal(scores, role, 3, `role.signal.${role}.segment.${segment}`);
      }
    }
    for (const token of rules.names) {
      if (name.includes(token) || lowerPath.includes(token)) {
        addSignal(scores, role, 2, `role.signal.${role}.name.${token}`);
      }
    }
    for (const candidateExtension of rules.extensions) {
      if (extension === candidateExtension || name.endsWith(candidateExtension)) {
        addSignal(scores, role, 1, `role.signal.${role}.extension.${candidateExtension.slice(1)}`);
      }
    }
  }

  if (scores.size === 0) {
    evidence.unknown.push('role.unknown.no-signal');
    return { role: 'module', evidence };
  }

  const highestScore = Math.max(...[...scores.values()].map((value) => value.score));
  const highest = [...scores.entries()]
    .filter(([, value]) => value.score === highestScore)
    .sort(([left], [right]) => (ROLE_ORDER.get(left) ?? 99) - (ROLE_ORDER.get(right) ?? 99));

  if (highest.length !== 1) {
    const ambiguousRoles = highest.map(([role]) => role).sort();
    evidence.unknown.push(`role.ambiguous.${ambiguousRoles.join('+')}`);
    return { role: 'module', evidence };
  }

  const [role, signal] = highest[0];
  evidence.inferred.push(...signal.keys);
  evidence.inferred = sortedUniqueStrings(evidence.inferred);
  return { role, evidence };
}

function addSignal(scores, role, score, key) {
  const current = scores.get(role) ?? { score: 0, keys: [] };
  current.score += score;
  current.keys.push(key);
  // A path may match the same rule more than once; repeated evidence should
  // increase confidence only once per distinct machine key.
  current.keys = sortedUniqueStrings(current.keys);
  scores.set(role, current);
}
