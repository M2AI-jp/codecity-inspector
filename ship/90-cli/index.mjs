import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRepository } from '../10-inspect/index.mjs';
import { inferSemanticModel } from '../20-semantics/index.mjs';
import { buildTownModel } from '../30-town-domain/index.mjs';
import { generateWorldPlan } from '../40-worldgen/index.mjs';
import { loadAssets } from '../50-art/index.mjs';
import { compileWorldPlan } from '../60-compiler/index.mjs';
import { startLocalServer } from '../80-local-server/index.mjs';

const SHIP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const ART_ROOT = path.join(SHIP_ROOT, '50-art');
const ASSET_ROOT = path.join(ART_ROOT, 'assets');
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function writeLine(value) {
  console.log([...String(value).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]+/gu, '�')].slice(0, 2048).join(''));
}

function relativePath(value) {
  if (typeof value !== 'string' || !value || /[%\\?#:\u0000-\u001f]/u.test(value)
      || value.split('/').some(part => !part || part.startsWith('.'))) {
    throw new TypeError('配信ファイルのパスが不正です。');
  }
  return value;
}

// Only explicitly selected shipping artifacts enter the in-memory allowlist.
// Customer repository files never pass through this reader or HTTP server.
function readArtifact(root, relative, expectedSha256) {
  relativePath(relative);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('配信元が通常のディレクトリではありません。');
  let source = root;
  for (const component of relative.split('/')) {
    source = path.join(source, component);
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error('配信ファイルにシンボリックリンクは使えません。');
  }
  const descriptor = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor);
    const realRoot = fs.realpathSync(root);
    const realSource = fs.realpathSync(source);
    const canonical = fs.lstatSync(realSource);
    if (!realSource.startsWith(`${realRoot}${path.sep}`)
        || canonical.ino !== before.ino || canonical.dev !== before.dev
        || !before.isFile() || before.size > MAX_FILE_BYTES) {
      throw new Error('配信ファイルを安全に読み込めません。');
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error('配信ファイルが読み取り中に変化しました。');
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('配信ファイルが読み取り中に変化しました。');
    if (expectedSha256 && crypto.createHash('sha256').update(bytes).digest('hex') !== expectedSha256.toLowerCase()) {
      throw new Error('アセットが台帳の検証後に変化しました。');
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function sceneSnapshots(scene) {
  const snapshots = {
    'index.html': readArtifact(path.join(SHIP_ROOT, '80-local-server'), 'index.html'),
    'app.mjs': readArtifact(path.join(SHIP_ROOT, '80-local-server'), 'app.mjs'),
    'runtime.mjs': readArtifact(path.join(SHIP_ROOT, '70-runtime'), 'index.mjs'),
  };
  const destinations = new Map();
  for (const asset of scene.assets) {
    const source = relativePath(asset.path);
    const location = asset.url ?? asset.path;
    // Accept manifest-relative names or existing /assets/ names; always emit
    // an absolute same-origin URL below the one asset namespace.
    if (typeof location !== 'string') throw new TypeError('アセットのURLが不正です。');
    const relative = relativePath(location.replace(/^\/?assets\//u, ''));
    if (path.posix.extname(relative) !== '.png') throw new Error('アセットはPNGである必要があります。');
    const destination = `assets/${relative}`;
    if (destinations.has(destination) && destinations.get(destination) !== asset.sha256) {
      throw new Error('異なるアセットの配信先が重複しています。');
    }
    if (!destinations.has(destination)) snapshots[destination] = readArtifact(ASSET_ROOT, source, asset.sha256);
    destinations.set(destination, asset.sha256);
    asset.url = `/${destination}`;
    // A browser only needs its served URL, not a filesystem-relative path.
    delete asset.path;
  }
  snapshots['scene.json'] = Buffer.from(JSON.stringify(scene));
  return snapshots;
}

/** Safely read a repository, compile its town, then serve only generated data
 * and referenced shipping assets. The caller owns the returned close method. */
export async function runCodeCity({ repositoryPath = process.cwd(), port = 0 } = {}) {
  if (typeof repositoryPath !== 'string' || !repositoryPath.trim()) throw new TypeError('リポジトリのパスが必要です。');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('ポートは0から65535までの整数です。');
  const inspection = await inspectRepository(path.resolve(repositoryPath));
  if (inspection.evidence?.unknown?.some(entry => entry.claim === 'repository.root')) {
    throw new Error('指定されたリポジトリを安全に読み込めません。');
  }
  const semantics = inferSemanticModel(inspection);
  const town = buildTownModel(semantics);
  const worldPlan = generateWorldPlan({ town });
  const requiredIds = [...new Set([
    ...worldPlan.surfaces.map(surface => surface.assetId),
    ...worldPlan.places.flatMap(place => [
      place.assets.base, place.assets.upper, place.assets.foreground,
      place.interior.assetId, place.interior.foregroundAssetId, place.interior.floorAssetId,
    ]),
    worldPlan.player.assetId,
    ...worldPlan.people.map(person => person.assetId),
    ...worldPlan.props.map(prop => prop.assetId),
  ].filter(id => id !== null && id !== undefined))];
  const assets = loadAssets({
    manifestPath: path.join(ART_ROOT, 'manifest.json'),
    provenancePath: path.join(ART_ROOT, 'provenance.json'),
    assetRoot: ASSET_ROOT,
    requiredIds,
  });
  const scene = compileWorldPlan({ worldPlan, assets });
  return startLocalServer({
    snapshots: sceneSnapshots(scene), port,
    maxFileBytes: MAX_FILE_BYTES, maxTotalBytes: MAX_TOTAL_BYTES,
  });
}

/** CLI entry; an ephemeral loopback port is the default. */
export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
      writeLine('使い方: codecity [repositoryPath] [--port N]');
      writeLine('表示されたURLをブラウザで開いてください。終了は Ctrl+C。');
      return 0;
    }
    let repositoryPath;
    let port = 0;
    let portSeen = false;
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === '--port' && !portSeen && /^\d+$/u.test(argv[index + 1] ?? '')) {
        port = Number(argv[++index]);
        portSeen = true;
      } else if (argument.startsWith('-') || repositoryPath !== undefined) {
        throw new Error('使い方: codecity [repositoryPath] [--port N]');
      } else repositoryPath = argument;
    }
    writeLine('リポジトリから街を構成しています…');
    const running = await runCodeCity({ repositoryPath, port });
    writeLine(running.url);
    writeLine('ブラウザでURLを開いてください。終了は Ctrl+C。');
    return 0;
  } catch (error) {
    writeLine(`CodeCity: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
