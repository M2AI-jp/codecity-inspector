import path from 'node:path';
import { scanRepository } from './scanner.mjs';

function stronglyConnectedComponents(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.status === 'resolved' && adjacency.has(edge.from) && adjacency.has(edge.to)) {
      adjacency.get(edge.from).push(edge.to);
    }
  }

  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(node) {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbour of adjacency.get(node) ?? []) {
      if (!indexes.has(neighbour)) {
        visit(neighbour);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(neighbour)));
      } else if (onStack.has(neighbour)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(neighbour)));
      }
    }

    if (lowLinks.get(node) === indexes.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component.sort());
    }
  }

  for (const node of adjacency.keys()) {
    if (!indexes.has(node)) visit(node);
  }

  return components.filter((component) => {
    if (component.length > 1) return true;
    return (adjacency.get(component[0]) ?? []).includes(component[0]);
  });
}

function baseNameWithoutTestMarkers(filePath) {
  const extension = path.extname(filePath);
  return path.basename(filePath, extension).replace(/\.(?:test|spec)$/i, '').toLowerCase();
}

function associateTests(nodes, edges) {
  const tests = nodes.filter((node) => node.isTest);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourcesByBaseName = new Map();
  for (const node of nodes) {
    if (node.isTest) continue;
    const baseName = baseNameWithoutTestMarkers(node.path);
    const matches = sourcesByBaseName.get(baseName) ?? [];
    matches.push(node);
    sourcesByBaseName.set(baseName, matches);
  }
  const associations = [];
  const seen = new Set();
  const add = (source, test, evidence) => {
    const key = `${source}\0${test}`;
    if (seen.has(key)) return;
    seen.add(key);
    associations.push({ source, test, evidence });
  };

  for (const edge of edges) {
    if (edge.status !== 'resolved') continue;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (from?.isTest && to && !to.isTest) add(to.id, from.id, 'test-directly-imports-source');
  }

  for (const test of tests) {
    const testBase = baseNameWithoutTestMarkers(test.path);
    if (!testBase) continue;
    const candidates = sourcesByBaseName.get(testBase) ?? [];
    if (candidates.length === 1) add(candidates[0].id, test.id, 'unique-filename-match');
  }
  return associations.sort((left, right) => `${left.source}:${left.test}`.localeCompare(`${right.source}:${right.test}`));
}

function computeReachability(nodes, edges, entrypoints) {
  if (entrypoints.length === 0) {
    return new Map(nodes.map((node) => [node.id, 'unknown']));
  }
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (edge.status === 'resolved' && adjacency.has(edge.from) && adjacency.has(edge.to)) {
      adjacency.get(edge.from).push(edge.to);
    }
  }
  const reached = new Set();
  const pending = entrypoints.map((entry) => entry.path);
  while (pending.length > 0) {
    const current = pending.pop();
    if (reached.has(current) || !adjacency.has(current)) continue;
    reached.add(current);
    pending.push(...adjacency.get(current));
  }
  return new Map(nodes.map((node) => [node.id, reached.has(node.id) ? 'reachable' : 'not-reached-from-known-entrypoints']));
}

function districtFor(filePath) {
  const [first] = filePath.split('/');
  return filePath.includes('/') ? first : 'root';
}

function displayName(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

export function buildInspection(scan) {
  const cycles = stronglyConnectedComponents(scan.nodes, scan.edges)
    .map((members, index) => ({ id: `cycle-${index + 1}`, members, evidence: 'static-local-dependency-cycle' }));
  const cycleMembers = new Set(cycles.flatMap((cycle) => cycle.members));
  const testAssociations = associateTests(scan.nodes, scan.edges);
  const testedSources = new Set(testAssociations.map((association) => association.source));
  const reachability = computeReachability(scan.nodes, scan.edges, scan.entrypoints);
  const unresolvedLinks = scan.edges
    .filter((edge) => edge.status === 'unresolved')
    .map((edge) => ({
      from: edge.from,
      targetHint: edge.targetHint,
      kind: edge.kind,
      status: edge.status,
      evidence: 'missing-supported-in-root-literal'
    }));
  const unknownDependencies = scan.edges
    .filter((edge) => !['resolved', 'unresolved'].includes(edge.status))
    .map((edge) => ({ from: edge.from, targetHint: edge.targetHint, kind: edge.kind, status: edge.status }));
  const unresolvedByNode = new Map();
  for (const link of unresolvedLinks) unresolvedByNode.set(link.from, (unresolvedByNode.get(link.from) ?? 0) + 1);

  const buildings = scan.nodes.map((node) => {
    const unresolved = unresolvedByNode.get(node.id) ?? 0;
    const inCycle = cycleMembers.has(node.id);
    const hasAssociatedTest = testedSources.has(node.id);
    let state = 'mapped';
    if (unresolved > 0) state = 'unresolved-link';
    else if (inCycle) state = 'structural-warning';
    else if (!node.isTest && !hasAssociatedTest) state = 'unverified';

    return {
      id: node.id,
      name: displayName(node.path),
      path: node.path,
      district: districtFor(node.path),
      kind: node.kind,
      bytes: node.bytes,
      isTest: node.isTest,
      state,
      evidence: {
        unresolvedLinks: unresolved,
        cycle: inCycle,
        associatedTest: hasAssociatedTest,
        reachability: reachability.get(node.id)
      }
    };
  });

  const unknowns = [
    'No target code was executed, so runtime behavior and user journeys are unknown.',
    'A file without an associated test is unverified, not broken.'
  ];
  if (scan.entrypoints.length === 0) unknowns.push('No package.json entrypoint was resolved; entrypoint reachability is unknown.');
  if (scan.summary.truncated) unknowns.push('Repository scanning was truncated by configured limits; omitted files were not judged.');
  if (unknownDependencies.some((edge) => edge.status === 'not-scanned')) {
    unknowns.push('Some supported local dependency targets existed but were outside the scanned set.');
  }
  if (unknownDependencies.some((edge) => edge.status === 'outside-root')) {
    unknowns.push('Some relative dependencies left the repository boundary and were not inspected; they are not classified as broken.');
  }
  if (unknownDependencies.some((edge) => ['alias-unknown', 'external-or-alias'].includes(edge.status))) {
    unknowns.push('Some non-relative dependency literals may be packages or configured aliases and were not resolved.');
  }
  if (unknownDependencies.some((edge) => edge.status === 'runtime-unknown')) {
    unknowns.push('Some dependency targets are computed at runtime and remain unknown.');
  }
  if (unknownDependencies.some((edge) => edge.status === 'unsupported')) {
    unknowns.push('Some dependency literal schemes are outside this scanner\'s supported local-resolution rules.');
  }

  const localStatuses = new Set(['resolved', 'unresolved', 'not-scanned', 'outside-root']);
  const localLinks = scan.edges.filter((edge) => localStatuses.has(edge.status)).length;

  return {
    schemaVersion: 2,
    repository: scan.repository,
    summary: {
      filesDiscovered: scan.summary.filesDiscovered,
      filesScanned: scan.summary.filesScanned,
      bytesRead: scan.summary.bytesRead,
      omittedFiles: scan.summary.omittedFiles,
      edgesOmitted: scan.summary.edgesOmitted ?? 0,
      truncated: scan.summary.truncated,
      truncation: scan.summary.truncation ?? { files: scan.summary.truncated },
      dependencyLinks: scan.edges.length,
      localLinks,
      unresolvedLinks: unresolvedLinks.length,
      unknownDependencies: unknownDependencies.length,
      cycles: cycles.length,
      testAssociations: testAssociations.length,
      entrypoints: scan.entrypoints.length
    },
    city: {
      buildings,
      connections: scan.edges
        .filter((edge) => edge.status === 'resolved')
        .map(({ from, to, kind }) => ({ from, to, kind, state: 'mapped' }))
    },
    graph: {
      nodes: scan.nodes,
      edges: scan.edges,
      entrypoints: scan.entrypoints
    },
    inspection: {
      observed: {
        unresolvedLinks,
        skipped: scan.skips,
        skipCounts: scan.skipCounts
      },
      inferred: {
        cycles,
        testAssociations,
        reachability: Object.fromEntries(reachability)
      },
      unknownDependencies,
      unknown: unknowns
    },
    limitations: scan.limitations
  };
}

export async function inspectRepository(repositoryPath, options = {}) {
  return buildInspection(await scanRepository(repositoryPath, options));
}
