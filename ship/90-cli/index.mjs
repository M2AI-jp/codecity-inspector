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
import { loadAssetManifest } from '../50-art/index.mjs';
import { compileScene } from '../60-scene-compiler/index.mjs';
import { startLocalServer } from '../80-local-server/index.mjs';

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const DEFAULT_MAX_ARTIFACT_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_ARTIFACT_TOTAL_BYTES = 6 * 1024 * 1024;
const DEFAULT_MAX_ASSET_TOTAL_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_SCENE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_DISTRIBUTION_BYTES = 20 * 1024 * 1024;
const CLI_MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SHIPPING_ART_ROOT = path.resolve(CLI_MODULE_ROOT, '../50-art');
const DEFAULT_ASSET_ROOT = path.join(DEFAULT_SHIPPING_ART_ROOT, 'assets');
const DEFAULT_ASSET_MANIFEST = path.join(DEFAULT_SHIPPING_ART_ROOT, 'manifest.json');
const DEFAULT_RUNTIME_ARTIFACT_ROOT = path.resolve(CLI_MODULE_ROOT, '../70-game-runtime');
const DEFAULT_RUNTIME_ARTIFACT_ALLOWLIST = Object.freeze(['app.mjs', 'index.html', 'index.mjs', 'state.mjs', 'styles.css']);

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new CliError(code, message);
}

function writeLine(line) {
  console.log(String(line));
}

function normalizePort(value) {
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

/** Parse the supported flags. There are no subcommands. */
function parseCliArgs(argv = []) {
  if (!Array.isArray(argv)) fail('INVALID_ARGS', '街の指示を読み取れません。');
  const result = { repositoryPath: undefined, noOpen: false, port: 4173, help: false };
  let portSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else if (argument === '--no-open') {
      if (result.noOpen) fail('INVALID_ARGS', '--no-open が重複しています。');
      result.noOpen = true;
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
  return result;
}

function helpText() {
  return [
    'あなたのリポジトリを街にします。',
    '',
    '使い方: npx codecity [repositoryPath] [--no-open] [--port N]',
    '  --no-open  ブラウザを開かず、127.0.0.1 の場所だけ表示します。',
    '  --port N    127.0.0.1 の待ち受けポートを指定します。',
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

function readShippingArtifact(sourceRoot, relative, maxBytes, { expectedSha256 = null } = {}) {
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
    if (expectedSha256 !== null && actualSha256 !== expectedSha256.toLowerCase()) fail('ASSET_CHANGED', '出荷アセットが検証後に変化しました。');
    return { bytes, byteLength: bytes.length, sha256: actualSha256 };
  } finally {
    fs.closeSync(sourceDescriptor);
  }
}

function collectSceneAssets({ sceneBundle, assetRoot, occupiedEntries }) {
  const maxAssetFileBytes = DEFAULT_MAX_ARTIFACT_FILE_BYTES;
  const maxAssetTotalBytes = DEFAULT_MAX_ASSET_TOTAL_BYTES;
  const sourceRoot = path.resolve(assetRoot);
  assertRegularDirectory(sourceRoot, '出荷アセットディレクトリ');
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
    const loaded = readShippingArtifact(sourceRoot, asset.sourceRelative, maxAssetFileBytes, { expectedSha256: asset.sha256 });
    total += loaded.byteLength;
    sha256ByFile[destinationRelative] = loaded.sha256;
    snapshots[destinationRelative] = loaded.bytes;
    if (total > maxAssetTotalBytes) fail('ASSET_TOTAL_TOO_LARGE', '出荷アセットの合計が10MB予算を超えています。');
  }
  return { sha256ByFile, snapshots };
}

function collectRuntimeArtifacts() {
  const maxArtifactFileBytes = DEFAULT_MAX_ARTIFACT_FILE_BYTES;
  const maxArtifactTotalBytes = DEFAULT_MAX_ARTIFACT_TOTAL_BYTES;
  const sourceRoot = DEFAULT_RUNTIME_ARTIFACT_ROOT;
  assertRegularDirectory(sourceRoot, '実行成果物ディレクトリ');
  const entries = DEFAULT_RUNTIME_ARTIFACT_ALLOWLIST.map(normalizeArtifactPath).sort();
  let total = 0;
  const sha256ByFile = {};
  const snapshots = {};
  for (const relative of entries) {
    const loaded = readShippingArtifact(sourceRoot, relative, maxArtifactFileBytes);
    total += loaded.byteLength;
    sha256ByFile[relative] = loaded.sha256;
    snapshots[relative] = loaded.bytes;
    if (total > maxArtifactTotalBytes) fail('ARTIFACT_TOTAL_TOO_LARGE', '実行成果物の合計が大きすぎます。');
  }
  return { entries, sha256ByFile, snapshots };
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

function normalizeManifestInput() {
  if (!fs.existsSync(DEFAULT_ASSET_MANIFEST)) fail('ASSET_MANIFEST_REQUIRED', '出荷アセット台帳がありません。デモ素材は使いません。');
  try {
    return { manifest: loadAssetManifest(DEFAULT_ASSET_MANIFEST, DEFAULT_ASSET_ROOT), assetRoot: DEFAULT_ASSET_ROOT };
  } catch (error) {
    fail(error?.code ?? 'ASSET_MANIFEST_INVALID', '出荷アセット台帳を読めません。');
  }
}

/** Build the read-only inspection/domain/world pipeline. No files are written. */
async function buildCodeCity({ repositoryPath } = {}) {
  const root = normalizedRepositoryPath(repositoryPath);
  const report = await inspectRepository(root);
  const semanticModel = inferSemanticModel(report);
  const townModel = buildTownModel(semanticModel);
  const worldPlan = generateWorldPlan({ town: townModel });
  return { townModel, worldPlan };
}

/** Compose the complete pipeline into immutable memory and optionally start 127.0.0.1. */
async function runCodeCity({ repositoryPath, noOpen = false, port = 4173 } = {}) {
  const { townModel, worldPlan } = await buildCodeCity({ repositoryPath });
  writeLine(`${townModel.repository.name}を測量しています…`);

  if (worldPlan.investigations.length !== 3 || townModel.investigations.candidates.length !== 3) {
    fail('THREE_INVESTIGATIONS_REQUIRED', '根拠のある調査依頼が三件そろわないため、遊べる街としては起動しません。');
  }
  const { manifest: assetManifest, assetRoot } = normalizeManifestInput();
  const sceneBundle = compileScene({ worldPlan, assetManifest, assetRoot });
  let running = null;
  try {
    const runtimeCopy = collectRuntimeArtifacts();
    const assetCopy = collectSceneAssets({
      sceneBundle,
      assetRoot,
      occupiedEntries: runtimeCopy.entries,
    });
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
  } catch (error) {
    await running?.close();
    throw error;
  }
  const browserUrl = `${running.origin}/index.html`;
  writeLine(`http://${HOST}:${new URL(running.origin).port} でお待ちしています。`);
  writeLine('（このツールはコードを外部に送信しません）');
  writeLine('次の一歩: ブラウザで門をくぐり、掲示板の依頼を受けてください。');
  if (!noOpen) {
    try {
      assertBrowserUrl(browserUrl, running.origin);
      await defaultBrowserOpener(browserUrl);
    } catch (error) {
      await running.close();
      throw error;
    }
  }
}

/** CLI entry point; returns a process-style exit code and never swallows failures. */
export async function main(argv = process.argv.slice(2)) {
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.help) {
      writeLine(helpText());
      return 0;
    }
    await runCodeCity(parsed);
    return 0;
  } catch (error) {
    const code = error instanceof CliError ? error.code : 'CLI_FAILED';
    writeLine(`街の門番: ${error instanceof Error ? error.message : String(error)}`);
    writeLine(`（コード: ${code}）`);
    writeLine('127.0.0.1 は起動していません。');
    writeLine('次の一歩: 指示と出荷素材を確認して、もう一度実行してください。');
    return 1;
  }
}
