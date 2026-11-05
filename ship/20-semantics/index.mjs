// Static inspection -> repository meaning. Every interpretation retains its
// source; file names and declared commands do not establish runtime health.
export function inferSemanticModel(inspection) {
  if (inspection?.schemaVersion !== 1) {
    throw new TypeError('Semantic interpretation requires InspectionReport v1');
  }
  const manifests = new Map(inspection.manifests.map((manifest) => [manifest.path, manifest]));
  const code = inspection.files.filter((file) => !['asset', 'documentation', 'lockfile'].includes(file.kind)
    && (/\.(?:[cm]?[jt]sx?|c|cc|cpp|cs|h|hpp|go|java|kt|php|py|rb|rs|sh|sql|swift|vue|svelte|html?|css|scss|sass|less)$/i.test(file.path)
      || workSignals(file.path).some((signal) => signal.activity !== 'development-work')
        && !/(?:^|\/)(?:license|licence|provenance|catalog)(?:[.-]|$)/i.test(file.path)));
  const codeIds = new Set(code.map((file) => file.id));
  const importedIds = new Set(inspection.graph.edges
    .filter((edge) => edge.kind === 'import' && edge.specifier?.startsWith('.') && codeIds.has(edge.from))
    .map((edge) => edge.to));
  const files = inspection.files.filter((file) => codeIds.has(file.id)
    || file.kind === 'manifest' && manifests.has(file.path)
    || importedIds.has(file.id) && /\.(?:json|ya?ml|toml|xml)$/i.test(file.path)
      && !/(?:^|\/)(?:license|licence|provenance|catalog)(?:[.-]|$)/i.test(file.path))
    .sort((a, b) => compare(a.path, b.path));
  const directories = new Set(files.map((file) => file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/')) : '.'));
  const fileById = new Map(files.map((file) => [file.id, file]));
  const groupsByKey = new Map();
  const groupByFileId = new Map();

  for (const file of files) {
    let directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    const parent = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '.';
    if (/(?:^|\/)bin$/.test(directory) && directories.has(parent)
        && inspection.graph.edges.some((edge) => edge.kind === 'import' && edge.from === file.id
          && /^\.\.\/[^/]+$/.test(edge.specifier) && fileById.has(edge.to))) directory = parent;
    const work = workSignals(file.path, manifests.get(file.path));
    const history = historySignals(file.path);
    const meaning = work.length ? 'development-work' : moduleMeaning(file.path);
    const key = directory;
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, {
        id: `group:${encodeURIComponent(key)}`,
        name: directory,
        meaning,
        sourcePaths: [],
        basis: [],
      });
    }
    const group = groupsByKey.get(key);
    const meanings = ['module', 'feature', 'ui', 'component', 'development-work'];
    if (meanings.indexOf(meaning) > meanings.indexOf(group.meaning)) group.meaning = meaning;
    group.sourcePaths.push(file.path);
    group.basis.push({ kind: 'file', path: file.path, fileKind: file.kind }, ...work);
    if (history.length) {
      group.history ??= { markers: [] };
      group.history.markers.push(...history.map((marker) => ({ path: file.path, marker })));
    }
    groupByFileId.set(file.id, group.id);
  }

  const linksByPair = new Map();
  for (const edge of inspection.graph.edges) {
    const fromGroupId = groupByFileId.get(edge.from);
    const toGroupId = groupByFileId.get(edge.to);
    if (edge.kind !== 'import' || !edge.specifier?.startsWith('.')
        || !fromGroupId || !toGroupId || fromGroupId === toGroupId) continue;
    const key = JSON.stringify([fromGroupId, toGroupId]);
    if (!linksByPair.has(key)) linksByPair.set(key, { fromGroupId, toGroupId, basis: [] });
    linksByPair.get(key).basis.push({
      kind: 'static-import',
      fromPath: fileById.get(edge.from).path,
      toPath: fileById.get(edge.to).path,
      specifier: edge.specifier,
    });
  }
  return {
    version: 1,
    repository: { name: inspection.repository.name, identity: inspection.repository.identity },
    groups: [...groupsByKey.values()],
    links: [...linksByPair.values()].sort((a, b) => compare(
      `${a.fromGroupId}\0${a.toGroupId}`, `${b.fromGroupId}\0${b.toGroupId}`,
    )),
  };
}

function workSignals(path, manifest) {
  const signals = [];
  const lower = path.toLowerCase();
  if (/(?:^|[^a-z0-9])(?:build|ci|dev|development|local-run|tooling|tools|cli)(?:[^a-z0-9]|$)/.test(lower)) {
    signals.push({ kind: 'work-path', path, activity: 'development-work' });
  }
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(lower)
      || /(?:^|\/)(?:\.gitlab-ci\.ya?ml|jenkinsfile)$/.test(lower)
      || /^\.circleci\/config\.ya?ml$/.test(lower)) {
    signals.push({ kind: 'work-path', path, activity: 'ci' });
  }
  if (/(?:^|\/)(?:makefile|cmakelists\.txt|dockerfile|compose\.ya?ml|docker-compose\.ya?ml)$/.test(lower)
      || /(?:^|\/)(?:vite|webpack|rollup|esbuild)\.config\.[^/]+$/.test(lower)
      || /^\.devcontainer\//.test(lower)) {
    signals.push({ kind: 'work-path', path, activity: 'development-environment' });
  }
  for (const [script, command] of Object.entries(manifest?.scripts ?? {}).sort(([a], [b]) => compare(a, b))) {
    const activity = /^(?:build|compile|bundle)(?::|$)/.test(script) ? 'build'
      : /^(?:dev|start|serve)(?::|$)/.test(script) ? 'local-run'
        : /^ci(?::|$)/.test(script) ? 'ci' : null;
    if (activity) signals.push({ kind: 'manifest-script', path, script, command, activity });
  }
  const bins = typeof manifest?.bin === 'string' ? { default: manifest.bin } : manifest?.bin ?? {};
  for (const [script, command] of Object.entries(bins).sort(([a], [b]) => compare(a, b))) {
    signals.push({ kind: 'manifest-bin', path, script, command, activity: 'cli' });
  }
  return signals;
}

function historySignals(path) {
  return [...new Set(path.toLowerCase().split(/[^a-z0-9]+/)
    .filter((token) => ['legacy', 'deprecated', 'archive', 'archived'].includes(token)))];
}

function moduleMeaning(path) {
  const segments = path.toLowerCase().split(/[^a-z0-9]+/);
  if (segments.some((segment) => /^(?:components?|widgets?)$/.test(segment))) return 'component';
  if (/\.(?:html?|css|scss|sass|less|vue|svelte)$/i.test(path)
      || segments.some((segment) => /^(?:ui|views?|pages?|screens?)$/.test(segment))) return 'ui';
  if (segments.some((segment) => /^(?:features?|services?|servers?|runtime|compiler|world(?:gen)?|inspect(?:ion)?|semantics?|domain)$/.test(segment))) return 'feature';
  return 'module';
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
