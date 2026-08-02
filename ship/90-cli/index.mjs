import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { inspectRepository } from '../10-inspect/index.mjs';
import { inferSemanticModel } from '../20-semantics/index.mjs';
import { buildTownModel } from '../30-town-domain/index.mjs';
import { generateWorldPlan } from '../40-worldgen/index.mjs';
import { loadAssetManifest, validateAssetManifest } from '../50-art/index.mjs';
import { compileScene } from '../60-scene-compiler/index.mjs';
import { startLocalServer } from '../80-local-server/index.mjs';

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const DEFAULT_MAX_ARTIFACT_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACT_TOTAL_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_ASSET_TOTAL_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_SCENE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_DISTRIBUTION_BYTES = 20 * 1024 * 1024;
const MAX_BINDINGS_BYTES = 1024 * 1024;
const MAX_RUNTIME_ARTIFACTS = 4_096;
const CLI_MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SHIPPING_ART_ROOT = path.resolve(CLI_MODULE_ROOT, '../50-art');
const DEFAULT_ASSET_ROOT = path.join(DEFAULT_SHIPPING_ART_ROOT, 'assets');
const DEFAULT_ASSET_MANIFEST = path.join(DEFAULT_SHIPPING_ART_ROOT, 'manifest.json');
const DEFAULT_SCENE_BINDINGS = path.join(DEFAULT_SHIPPING_ART_ROOT, 'scene-bindings.json');
const DEFAULT_RUNTIME_ARTIFACT_ROOT = path.resolve(CLI_MODULE_ROOT, '../70-game-runtime');
const DEFAULT_RUNTIME_ARTIFACT_ALLOWLIST = Object.freeze(['app.mjs', 'index.html', 'index.mjs', 'state.mjs', 'styles.css']);

export class CliError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details = {}) {
  throw new CliError(code, message, details);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function writeLine(line, writer = console.log) {
  writer(String(line));
}

function progressWriter(options) {
  return typeof options?.write === 'function' ? options.write : console.log;
}

function normalizePort(value) {
  if (value === undefined) return 4173;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('INVALID_PORT', 'ポートは0から65535までの整数です。');
  return port;
}

function normalizedRepositoryPath(value) {
  const requested = value === undefined ? process.cwd() : value;
  if (typeof requested !== 'string' || requested.trim() === '') fail('REPOSITORY_REQUIRED', '測量する土地の場所がありません。');
  return path.resolve(requested);
}

function parsePortFlag(argv, index) {
  if (index + 1 >= argv.length) fail('INVALID_ARGS', '--port の次に番号が必要です。');
  const raw = argv[index + 1];
  if (typeof raw !== 'string' || raw.startsWith('-')) fail('INVALID_ARGS', '--port の次に番号が必要です。');
  return { port: normalizePort(raw), next: index + 1 };
}

/** Parse the six supported flags. There are no subcommands. */
export function parseCliArgs(argv = []) {
  if (!Array.isArray(argv)) fail('INVALID_ARGS', '街の指示を読み取れません。');
  const result = { repositoryPath: undefined, noOpen: false, port: 4173, shot: false, text: false, help: false };
  let portSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else if (argument === '--no-open') {
      if (result.noOpen) fail('INVALID_ARGS', '--no-open が重複しています。');
      result.noOpen = true;
    } else if (argument === '--shot') {
      if (result.shot) fail('INVALID_ARGS', '--shot が重複しています。');
      result.shot = true;
    } else if (argument === '--text') {
      if (result.text) fail('INVALID_ARGS', '--text が重複しています。');
      result.text = true;
    } else if (argument === '--port') {
      if (portSeen) fail('INVALID_ARGS', '--port が重複しています。');
      portSeen = true;
      const parsed = parsePortFlag(argv, index);
      result.port = parsed.port;
      index = parsed.next;
    } else if (typeof argument === 'string' && argument.startsWith('-')) {
      fail('INVALID_ARGS', `知らない旗です: ${argument}`);
    } else if (result.repositoryPath !== undefined) {
      fail('INVALID_ARGS', '測量する場所は一つだけ指定できます。');
    } else {
      result.repositoryPath = argument;
    }
  }
  if (result.help && argv.some((argument) => argument !== '--help' && argument !== '-h')) {
    fail('INVALID_ARGS', '--help と他の指示は一緒に使いません。');
  }
  return Object.freeze(result);
}

function helpText() {
  return [
    'あなたのリポジトリを街にします。',
    '',
    '使い方: npx codecity [repositoryPath] [--no-open] [--port N] [--shot] [--text]',
    '  --no-open  ブラウザを開かず、127.0.0.1 の場所だけ表示します。',
    '  --port N    127.0.0.1 の待ち受けポートを指定します。',
    '  --shot      描画器が承認済みでないため、現在は正直に停止します。',
    '  --text      観測事実・推定・未確認を分けた報告書を表示します。',
    '',
    '次の一歩: npx codecity ./あなたのリポジトリ --no-open',
  ].join('\n');
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function assertRegularDirectory(target, label) {
  const stat = lstatOrNull(target);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail('INVALID_DIRECTORY', `${label} は通常のディレクトリである必要があります。`);
}

function normalizeArtifactPath(value) {
  if (typeof value !== 'string' || value.trim() === '') fail('INVALID_ARTIFACT_ALLOWLIST', '実行成果物の許可リストに空の名前があります。');
  const normalized = value.replaceAll('\\', '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))) {
    fail('INVALID_ARTIFACT_ALLOWLIST', '実行成果物の許可リストに危険なパスがあります。');
  }
  if (normalized === 'scene.json') fail('INVALID_ARTIFACT_ALLOWLIST', 'scene.json は自動生成専用です。');
  return segments.join('/');
}

function assertSafeArtifactComponents(root, relative) {
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    const stat = lstatOrNull(current);
    if (!stat) fail('ARTIFACT_MISSING', `許可された実行成果物が見つかりません: ${relative}`);
    if (stat.isSymbolicLink()) fail('ARTIFACT_SYMLINK', '実行成果物のパスにシンボリックリンクは使えません。');
  }
  return current;
}

function readApprovedArtifact(sourceRoot, relative, maxBytes, { expectedSha256 = null } = {}) {
  const source = assertSafeArtifactComponents(sourceRoot, relative);
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isFile()) fail('ARTIFACT_INVALID', `許可された実行成果物が通常のファイルではありません: ${relative}`);
  if (sourceStat.size > maxBytes) fail('ARTIFACT_TOO_LARGE', `実行成果物が大きすぎます: ${relative}`);
  const sourceDescriptor = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const checked = fs.fstatSync(sourceDescriptor);
    if (!checked.isFile() || checked.ino !== sourceStat.ino || checked.dev !== sourceStat.dev) fail('ARTIFACT_CHANGED', '実行成果物が読み取り中に変化しました。');
    if (checked.size > maxBytes) fail('ARTIFACT_TOO_LARGE', `実行成果物が大きすぎます: ${relative}`);
    const bytes = Buffer.alloc(checked.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(sourceDescriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) fail('ARTIFACT_CHANGED', '実行成果物が読み取り中に変化しました。');
      offset += count;
    }
    const finalStat = fs.fstatSync(sourceDescriptor);
    if (finalStat.size !== checked.size || finalStat.mtimeMs !== checked.mtimeMs) fail('ARTIFACT_CHANGED', '実行成果物が読み取り中に変化しました。');
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (expectedSha256 !== null && actualSha256 !== expectedSha256.toLowerCase()) fail('ASSET_CHANGED', '承認済みアセットが検証後に変化しました。');
    return { bytes, byteLength: bytes.length, sha256: actualSha256 };
  } finally {
    fs.closeSync(sourceDescriptor);
  }
}

function collectSceneAssets({ sceneBundle, assetRoot, occupiedEntries, maxAssetFileBytes = DEFAULT_MAX_ARTIFACT_FILE_BYTES, maxAssetTotalBytes = DEFAULT_MAX_ASSET_TOTAL_BYTES }) {
  const sourceRoot = path.resolve(assetRoot);
  assertRegularDirectory(sourceRoot, '承認済みアセットディレクトリ');
  if (!Number.isInteger(maxAssetFileBytes) || maxAssetFileBytes <= 0 || maxAssetFileBytes > 1024 * 1024 * 1024) fail('INVALID_ASSET_LIMIT', 'アセット1件の上限が不正です。');
  if (!Number.isInteger(maxAssetTotalBytes) || maxAssetTotalBytes <= 0 || maxAssetTotalBytes > 1024 * 1024 * 1024 || maxAssetTotalBytes < maxAssetFileBytes) fail('INVALID_ASSET_LIMIT', 'アセット全体の上限が不正です。');
  const occupied = new Set(occupiedEntries);
  const byDestination = new Map();
  for (const asset of sceneBundle.assets) {
    const sourceRelative = normalizeArtifactPath(asset.path);
    const destinationRelative = normalizeArtifactPath(asset.url);
    if (path.posix.extname(destinationRelative).toLowerCase() !== '.png') fail('ASSET_URL_INVALID', 'アセットの配布URLは.pngで終わる必要があります。');
    if (occupied.has(destinationRelative)) fail('DISTRIBUTION_PATH_COLLISION', `実行成果物とアセットの配布先が衝突しています: ${destinationRelative}`);
    const previous = byDestination.get(destinationRelative);
    if (previous && previous.sha256 !== asset.sha256) fail('DISTRIBUTION_PATH_COLLISION', `異なるアセットが同じ配布先を使っています: ${destinationRelative}`);
    if (!previous) byDestination.set(destinationRelative, { sourceRelative, sha256: asset.sha256 });
  }
  let total = 0;
  const entries = [...byDestination.keys()].sort();
  const sha256ByFile = {};
  const snapshots = {};
  for (const destinationRelative of entries) {
    const asset = byDestination.get(destinationRelative);
    const loaded = readApprovedArtifact(sourceRoot, asset.sourceRelative, maxAssetFileBytes, { expectedSha256: asset.sha256 });
    total += loaded.byteLength;
    sha256ByFile[destinationRelative] = loaded.sha256;
    snapshots[destinationRelative] = loaded.bytes;
    if (total > maxAssetTotalBytes) fail('ASSET_TOTAL_TOO_LARGE', '出荷アセットの合計が10MB予算を超えています。');
  }
  return { entries, sha256ByFile, snapshots, totalBytes: total };
}

async function collectRuntimeArtifacts({ runtimeArtifactRoot, runtimeArtifactAllowlist, maxArtifactFileBytes = DEFAULT_MAX_ARTIFACT_FILE_BYTES, maxArtifactTotalBytes = DEFAULT_MAX_ARTIFACT_TOTAL_BYTES }) {
  if (typeof runtimeArtifactRoot !== 'string' || runtimeArtifactRoot.trim() === '') fail('RUNTIME_ARTIFACT_REQUIRED', '承認済みの実行成果物ディレクトリが必要です。');
  const sourceRoot = path.resolve(runtimeArtifactRoot);
  assertRegularDirectory(sourceRoot, '実行成果物ディレクトリ');
  if (!Number.isInteger(maxArtifactFileBytes) || maxArtifactFileBytes <= 0 || maxArtifactFileBytes > 1024 * 1024 * 1024) fail('INVALID_ARTIFACT_LIMIT', '実行成果物1件の上限が不正です。');
  if (!Number.isInteger(maxArtifactTotalBytes) || maxArtifactTotalBytes <= 0 || maxArtifactTotalBytes > 1024 * 1024 * 1024 || maxArtifactTotalBytes < maxArtifactFileBytes) fail('INVALID_ARTIFACT_LIMIT', '実行成果物全体の上限が不正です。');
  if (!Array.isArray(runtimeArtifactAllowlist) || runtimeArtifactAllowlist.length === 0) fail('RUNTIME_ARTIFACT_ALLOWLIST_REQUIRED', '実行成果物の許可リストが必要です。');
  if (runtimeArtifactAllowlist.length > MAX_RUNTIME_ARTIFACTS) fail('RUNTIME_ARTIFACT_ALLOWLIST_TOO_LARGE', '実行成果物の許可リストが大きすぎます。');
  const entries = [...new Set(runtimeArtifactAllowlist.map(normalizeArtifactPath))].sort();
  if (entries.length !== runtimeArtifactAllowlist.length) fail('INVALID_ARTIFACT_ALLOWLIST', '実行成果物の許可リストに重複があります。');
  if (!entries.includes('index.html')) fail('RUNTIME_ENTRY_REQUIRED', '実行成果物の許可リストに index.html が必要です。');
  let total = 0;
  const sha256ByFile = {};
  const snapshots = {};
  for (const relative of entries) {
    const loaded = readApprovedArtifact(sourceRoot, relative, maxArtifactFileBytes);
    total += loaded.byteLength;
    sha256ByFile[relative] = loaded.sha256;
    snapshots[relative] = loaded.bytes;
    if (total > maxArtifactTotalBytes) fail('ARTIFACT_TOTAL_TOO_LARGE', '実行成果物の合計が大きすぎます。');
  }
  return { entries, sha256ByFile, snapshots, totalBytes: total };
}

function reportText(report, town, worldPlan) {
  const evidence = report.evidence ?? { observed: [], inferred: [], unknown: [] };
  const line = (label, value) => `${label}: ${value}`;
  return [
    `街 ${town.repository.name}`,
    line('観測', evidence.observed.length),
    line('推定', evidence.inferred.length),
    line('未確認', evidence.unknown.length),
    line('施設', worldPlan.occupancy.filter((entry) => entry.state === 'occupied').flatMap((entry) => entry.occupants).length),
    line('区画', worldPlan.plots.length),
    '',
    '観測事実',
    ...evidence.observed.map((entry) => `  ✓ ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`),
    '推定',
    ...evidence.inferred.map((entry) => `  △ ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`),
    '未確認',
    ...evidence.unknown.map((entry) => `  ○ ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`),
  ].join('\n');
}

function defaultBrowserOpener(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== HOST || parsed.pathname !== '/index.html') fail('BROWSER_ORIGIN_INVALID', 'ブラウザは生成した127.0.0.1の入口だけを開けます。');
  if (process.platform === 'darwin') return execFileAsync('open', [url]);
  if (process.platform === 'win32') return execFileAsync('cmd', ['/c', 'start', '', url]);
  return execFileAsync('xdg-open', [url]);
}

function assertBrowserUrl(url, origin) {
  const parsed = new URL(url);
  const expected = new URL(`${origin}/index.html`);
  if (parsed.protocol !== 'http:' || parsed.hostname !== HOST || parsed.origin !== expected.origin || parsed.pathname !== '/index.html') {
    fail('BROWSER_ORIGIN_INVALID', 'ブラウザは生成した127.0.0.1の入口だけを開けます。');
  }
}

function normalizeManifestInput(options) {
  const load = (manifestPath, loadOptions) => {
    try {
      return loadAssetManifest(manifestPath, loadOptions);
    } catch (error) {
      fail(error?.code ?? 'ASSET_MANIFEST_INVALID', '承認済みアセット台帳を読めません。', { issues: error?.issues ?? [], cause: error?.code });
    }
  };
  const assetRoot = options.assetRoot === undefined ? DEFAULT_ASSET_ROOT : options.assetRoot;
  if (typeof assetRoot !== 'string' || assetRoot.trim() === '') fail('ASSET_ROOT_REQUIRED', '承認済みアセットのルートが必要です。');
  const manifestPath = options.assetManifestPath === undefined && options.assetManifest === undefined
    ? DEFAULT_ASSET_MANIFEST
    : options.assetManifestPath;
  if (manifestPath !== undefined) {
    if (typeof manifestPath !== 'string' || manifestPath.trim() === '') fail('ASSET_MANIFEST_REQUIRED', '承認済みアセット台帳の場所がありません。');
    if (!fs.existsSync(path.resolve(manifestPath))) fail('ASSET_MANIFEST_REQUIRED', '承認済みアセット台帳がありません。デモ素材は使いません。');
    return { manifest: load(path.resolve(manifestPath), { assetRoot, verifyFiles: true }), assetRoot };
  }
  if (typeof options.assetManifest === 'string') {
    return { manifest: load(path.resolve(options.assetManifest), { assetRoot, verifyFiles: true }), assetRoot };
  }
  if (!isRecord(options.assetManifest)) fail('ASSET_MANIFEST_REQUIRED', '承認済みアセット台帳がありません。デモ素材は使いません。');
  try {
    return { manifest: validateAssetManifest(options.assetManifest, { assetRoot, verifyFiles: true }), assetRoot };
  } catch (error) {
    fail(error?.code ?? 'ASSET_MANIFEST_INVALID', '承認済みアセット台帳を検証できません。', { issues: error?.issues ?? [], cause: error?.code });
  }
}

function readBoundedRootedJson(sourceRoot, source, maxBytes) {
  assertRegularDirectory(sourceRoot, 'アセット台帳ディレクトリ');
  const canonicalRoot = fs.realpathSync(path.resolve(sourceRoot));
  const absolute = path.resolve(source);
  const relative = path.relative(canonicalRoot, absolute).replaceAll(path.sep, '/');
  if (relative === '' || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    fail('SCENE_BINDINGS_OUTSIDE_ASSET_ROOT', '街とアセットを結ぶ許可台帳は承認済みアセットのルート内に置いてください。');
  }
  const normalized = normalizeArtifactPath(relative);
  const safe = assertSafeArtifactComponents(canonicalRoot, normalized);
  const descriptor = fs.openSync(safe, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > maxBytes) fail('SCENE_BINDINGS_TOO_LARGE', '街とアセットを結ぶ許可台帳が大きすぎます。');
    const canonicalFile = fs.realpathSync(safe);
    const canonicalStat = fs.lstatSync(canonicalFile);
    if (!canonicalFile.startsWith(`${canonicalRoot}${path.sep}`) || !canonicalStat.isFile() || canonicalStat.dev !== opened.dev || canonicalStat.ino !== opened.ino) {
      fail('SCENE_BINDINGS_CHANGED', '街とアセットを結ぶ許可台帳が読み取り中に変化しました。');
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) fail('SCENE_BINDINGS_CHANGED', '街とアセットを結ぶ許可台帳が読み取り中に変化しました。');
      offset += count;
    }
    const finalStat = fs.fstatSync(descriptor);
    if (finalStat.size !== opened.size || finalStat.mtimeMs !== opened.mtimeMs) fail('SCENE_BINDINGS_CHANGED', '街とアセットを結ぶ許可台帳が読み取り中に変化しました。');
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    fs.closeSync(descriptor);
  }
}

function normalizeBindingsInput(options, assetRoot) {
  const read = (source, root = assetRoot) => {
    try {
      return readBoundedRootedJson(root, source, MAX_BINDINGS_BYTES);
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail('SCENE_BINDINGS_INVALID', '街とアセットを結ぶ許可台帳を読めません。', { cause: error?.code });
    }
  };
  const bindingsPath = options.sceneBindingsPath === undefined && options.sceneBindings === undefined
    ? DEFAULT_SCENE_BINDINGS
    : options.sceneBindingsPath;
  if (bindingsPath !== undefined) {
    if (typeof bindingsPath !== 'string' || bindingsPath.trim() === '') fail('SCENE_BINDINGS_REQUIRED', '街とアセットを結ぶ許可台帳の場所がありません。');
    if (!fs.existsSync(path.resolve(bindingsPath))) fail('SCENE_BINDINGS_REQUIRED', '街とアセットを結ぶ許可台帳がありません。');
    const root = options.sceneBindingsPath === undefined && options.sceneBindings === undefined
      ? DEFAULT_SHIPPING_ART_ROOT
      : assetRoot;
    return read(bindingsPath, root);
  }
  if (typeof options.sceneBindings === 'string') return read(options.sceneBindings);
  if (!isRecord(options.sceneBindings)) fail('SCENE_BINDINGS_REQUIRED', '街とアセットを結ぶ許可台帳がありません。');
  return options.sceneBindings;
}

/** Build the read-only inspection/domain/world pipeline. No files are written. */
export async function buildCodeCity({ repositoryPath, seed, inspectionOptions = {} } = {}) {
  const root = normalizedRepositoryPath(repositoryPath);
  const report = await inspectRepository(root, inspectionOptions);
  const semanticModel = inferSemanticModel(report);
  const townModel = buildTownModel(semanticModel);
  const worldPlan = generateWorldPlan({ town: townModel, seed });
  return Object.freeze({ report, semanticModel, townModel, worldPlan, repositoryRoot: root });
}

/** Compose the complete pipeline into immutable memory and optionally start 127.0.0.1. */
export async function runCodeCity(options = {}) {
  for (const key of ['distributionRoot', 'runtimeArtifactRoot', 'runtimeArtifactAllowlist']) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      fail('COMPOSITION_INPUT_FORBIDDEN', `${key} は製品の不変なメモリ配布契約では指定できません。`);
    }
  }
  const write = progressWriter(options);
  const noOpen = options.noOpen === true;
  const text = options.text === true;
  const shot = options.shot === true;
  const port = normalizePort(options.port);
  if (shot) fail('SHOT_UNAVAILABLE', '絵を書き出す描画器がまだ承認されていないため、--shot は実行できません。');
  const built = await buildCodeCity(options);
  const { report, semanticModel, townModel, worldPlan } = built;
  writeLine(`${townModel.repository.name}を測量しています…`, write);
  writeLine(`✓ 土地を見た        ${report.summary?.filesInspected ?? report.files?.length ?? 0} ファイル`, write);
  writeLine(`✓ 水の道を引いた    ${worldPlan.water?.path?.length ?? 0} の道標`, write);
  writeLine(`✓ 街道を通した      ${worldPlan.plots.length} の区画`, write);
  writeLine(`✓ 建物を建てた      ${worldPlan.occupancy.filter((entry) => entry.state === 'occupied').flatMap((entry) => entry.occupants).length} 施設`, write);
  writeLine(`✓ 住民を呼んだ      ${worldPlan.npcs?.length ?? 0} 人`, write);
  if (text) {
    writeLine(reportText(report, townModel, worldPlan), write);
    writeLine(`127.0.0.1 は --text のため起動していません。`, write);
    writeLine('次の一歩: 承認済みアセットを用意して、もう一度 npx codecity を実行してください。', write);
    return Object.freeze({ ...built, origin: null, server: null, sceneBundle: null, distributionRoot: null, close: async () => {} });
  }

  if (worldPlan.questSites.length !== 3 || townModel.investigations.candidates.length !== 3) {
    fail('THREE_INVESTIGATIONS_REQUIRED', '根拠のある調査依頼が三件そろわないため、遊べる街としては起動しません。');
  }

  const { manifest: assetManifest, assetRoot } = normalizeManifestInput(options);
  const sceneBindings = normalizeBindingsInput(options, assetRoot);
  const sceneBundle = compileScene({ worldPlan, assetManifest, assetRoot, bindings: sceneBindings });
  let running = null;
  let artifactEntries;
  let assetEntries;
  let close;
  try {
    // Runtime code is a fixed package-owned input. Public callers cannot turn
    // a customer repository or arbitrary local directory into served files.
    const runtimeCopy = await collectRuntimeArtifacts({
      runtimeArtifactRoot: DEFAULT_RUNTIME_ARTIFACT_ROOT,
      runtimeArtifactAllowlist: DEFAULT_RUNTIME_ARTIFACT_ALLOWLIST,
      maxArtifactFileBytes: options.maxArtifactFileBytes,
      maxArtifactTotalBytes: options.maxArtifactTotalBytes,
    });
    artifactEntries = runtimeCopy.entries;
    const assetCopy = collectSceneAssets({
      sceneBundle,
      assetRoot,
      occupiedEntries: artifactEntries,
      maxAssetFileBytes: options.maxAssetFileBytes,
      maxAssetTotalBytes: options.maxAssetTotalBytes,
    });
    assetEntries = assetCopy.entries;
    const sceneBytes = Buffer.from(`${JSON.stringify(sceneBundle)}\n`, 'utf8');
    if (sceneBytes.length > DEFAULT_MAX_SCENE_BYTES) fail('SCENE_TOO_LARGE', '街の設計図が配布上限を超えています。');
    const snapshots = {
      ...runtimeCopy.snapshots,
      ...assetCopy.snapshots,
      'scene.json': sceneBytes,
    };
    const expectedSha256 = {
      ...runtimeCopy.sha256ByFile,
      ...assetCopy.sha256ByFile,
      'scene.json': crypto.createHash('sha256').update(sceneBytes).digest('hex'),
    };
    running = await startLocalServer({
      snapshots,
      expectedSha256,
      maxFileBytes: DEFAULT_MAX_SCENE_BYTES,
      maxTotalBytes: DEFAULT_MAX_DISTRIBUTION_BYTES,
      port,
    });
    let closed = false;
    close = async () => {
      if (closed) return;
      closed = true;
      await running?.close();
    };
  } catch (error) {
    await running?.close();
    throw error;
  }
  const browserUrl = `${running.origin}/index.html`;
  writeLine(`http://${HOST}:${new URL(running.origin).port} でお待ちしています。`, write);
  writeLine('（このツールはコードを外部に送信しません）', write);
  writeLine('次の一歩: ブラウザで門をくぐり、掲示板の依頼を受けてください。', write);
  if (!noOpen) {
    try {
      const opener = options.openBrowser ?? defaultBrowserOpener;
      if (typeof opener !== 'function') fail('BROWSER_OPENER_INVALID', 'ブラウザの開き方がありません。');
      assertBrowserUrl(browserUrl, running.origin);
      await opener(browserUrl);
    } catch (error) {
      await close();
      throw error;
    }
  }
  return Object.freeze({ ...built, sceneBundle, distributionRoot: null, artifactEntries, assetEntries, origin: running.origin, browserUrl, server: running.server, close });
}

/** CLI entry point; returns a process-style exit code and never swallows failures. */
export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const write = progressWriter(dependencies);
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.help) {
      writeLine(helpText(), write);
      return 0;
    }
    await runCodeCity({ ...dependencies, ...parsed, write });
    return 0;
  } catch (error) {
    const code = error instanceof CliError ? error.code : 'CLI_FAILED';
    writeLine(`街の門番: ${error instanceof Error ? error.message : String(error)}`, write);
    writeLine(`（コード: ${code}）`, write);
    writeLine('127.0.0.1 は起動していません。', write);
    writeLine('次の一歩: 指示と承認済み素材を確認して、もう一度実行してください。', write);
    return 1;
  }
}
