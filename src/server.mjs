#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectRepository } from './inspector.mjs';
import {
  FACILITY_KINDS,
  buildLegacyTownPayload,
  buildTownPayload,
  validateLayout,
  validateWorldPlan
} from './town/index.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');
const DEFAULT_REPOSITORY = path.join(PROJECT_ROOT, 'sample', 'tiny-town');
const DEFAULT_PORT = 4173;

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp']
]);

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function arrayOf(value, predicate) {
  return Array.isArray(value) && value.every(predicate);
}

const isString = (value) => typeof value === 'string';
const isStringArray = (value) => arrayOf(value, isString);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function hasExactOptionalKeys(value, required, optional) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = [...required, ...optional.filter((key) => Object.hasOwn(value, key))];
  return hasExactKeys(value, expected);
}

function isLegacyEvidence(value) {
  return hasExactKeys(value, ['observed', 'inferred', 'unknown'])
    && isStringArray(value.observed)
    && isStringArray(value.inferred)
    && isStringArray(value.unknown);
}

function isLegacyFacilityDetails(kind, details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false;
  switch (kind) {
    case 'town_hall':
      return hasExactKeys(details, ['repositoryName', 'contractorReportCount'])
        && (details.repositoryName === null || isString(details.repositoryName))
        && isNumber(details.contractorReportCount);
    case 'inn':
      return hasExactKeys(details, ['serviceBuildingCount', 'hasWebServerDep', 'sample'])
        && isNumber(details.serviceBuildingCount) && typeof details.hasWebServerDep === 'boolean'
        && isStringArray(details.sample);
    case 'pub':
      return hasExactKeys(details, ['llmSdks', 'externalServiceDeps', 'webhookHint', 'routeLikeBuildingCount'])
        && isStringArray(details.llmSdks) && isStringArray(details.externalServiceDeps)
        && typeof details.webhookHint === 'boolean' && isNumber(details.routeLikeBuildingCount);
    case 'guild':
      return hasExactKeys(details, ['memberCount', 'receptionCount', 'webhookHint'])
        && isNumber(details.memberCount) && isNumber(details.receptionCount)
        && typeof details.webhookHint === 'boolean';
    case 'dock':
      return hasExactKeys(details, ['flags', 'active'])
        && hasExactKeys(details.flags, ['reactNativeOrExpo', 'electron', 'hasBinField', 'isPublishablePackage'])
        && Object.values(details.flags).every((value) => typeof value === 'boolean')
        && isStringArray(details.active);
    case 'warehouse':
      return hasExactKeys(details, ['dbDeps', 'dataBuildingCount', 'sample'])
        && isStringArray(details.dbDeps) && isNumber(details.dataBuildingCount) && isStringArray(details.sample);
    case 'well':
      return hasExactKeys(details, ['hasEnvFiles', 'hasDotenvDep', 'configurationBuildingCount', 'sample'])
        && typeof details.hasEnvFiles === 'boolean' && typeof details.hasDotenvDep === 'boolean'
        && isNumber(details.configurationBuildingCount) && isStringArray(details.sample);
    case 'workshop':
      return hasExactKeys(details, ['hasBuild', 'hasCI'])
        && typeof details.hasBuild === 'boolean' && typeof details.hasCI === 'boolean';
    case 'dojo':
      return hasExactKeys(details, ['testBuildingCount', 'hasTestScript', 'testAssociations', 'sample'])
        && isNumber(details.testBuildingCount) && typeof details.hasTestScript === 'boolean'
        && isNumber(details.testAssociations) && isStringArray(details.sample);
    case 'watchtower':
      return hasExactKeys(details, ['loggerDeps']) && isStringArray(details.loggerDeps);
    case 'house':
    case 'shop':
      return hasExactKeys(details, ['sample']) && isStringArray(details.sample);
    case 'ruin':
      return hasExactOptionalKeys(details, ['flavor'], ['sample'])
        && typeof details.flavor === 'boolean'
        && (!Object.hasOwn(details, 'sample') || isStringArray(details.sample));
    case 'gate':
      return hasExactKeys(details, ['entrypoints', 'declaredEntries'])
        && arrayOf(details.entrypoints, (entry) => hasExactKeys(entry, ['path', 'evidence'])
          && (entry.path === undefined || isString(entry.path))
          && (entry.evidence === undefined || isString(entry.evidence)))
        && arrayOf(details.declaredEntries, (entry) => hasExactKeys(entry, ['declared', 'path'])
          && isString(entry.declared) && isString(entry.path));
    default:
      return false;
  }
}

function isLegacyFacility(facility) {
  return hasExactOptionalKeys(facility, ['kind', 'present', 'count', 'evidence'], ['details'])
    && FACILITY_KINDS.includes(facility.kind)
    && typeof facility.present === 'boolean'
    && isNumber(facility.count)
    && isLegacyEvidence(facility.evidence)
    && (!Object.hasOwn(facility, 'details') || isLegacyFacilityDetails(facility.kind, facility.details));
}

function isLegacyGuild(guild) {
  return hasExactKeys(guild, ['なかま', 'うけつけ', 'いらい', 'もちもの', 'じょうたい'])
    && arrayOf(guild.なかま, (entry) => hasExactKeys(entry, ['name', 'type', 'evidenceClass'])
      && isString(entry.name) && isString(entry.type) && isString(entry.evidenceClass))
    && arrayOf(guild.うけつけ, (entry) => hasExactKeys(entry, ['path', 'name', 'kind', 'evidenceClass'])
      && [entry.path, entry.name, entry.kind].every((value) => value === undefined || isString(value))
      && isString(entry.evidenceClass))
    && arrayOf(guild.いらい, (entry) => hasExactKeys(entry, ['label', 'direction', 'evidenceClass', 'note'])
      && [entry.label, entry.direction, entry.evidenceClass, entry.note].every(isString))
    && arrayOf(guild.もちもの, (entry) => hasExactKeys(entry, ['category', 'items', 'evidenceClass', 'note'])
      && isString(entry.category) && isStringArray(entry.items)
      && isString(entry.evidenceClass) && isString(entry.note))
    && arrayOf(guild.じょうたい, (entry) => hasExactKeys(entry, ['label', 'value', 'evidenceClass', 'note'])
      && [entry.label, entry.value, entry.evidenceClass, entry.note].every(isString));
}

function isLegacyModel(model) {
  return hasExactKeys(model, ['facilities', 'guild', 'external', 'summary'])
    && arrayOf(model.facilities, isLegacyFacility)
    && model.facilities.length === FACILITY_KINDS.length
    && model.facilities.every((facility, index) => facility.kind === FACILITY_KINDS[index])
    && isLegacyGuild(model.guild)
    && hasExactKeys(model.external, ['contractorReports'])
    && arrayOf(model.external.contractorReports, (entry) => hasExactKeys(entry, ['source', 'subject', 'status'])
      && [entry.source, entry.subject, entry.status].every(isString))
    && hasExactKeys(model.summary, [
      'filesDiscovered', 'filesScanned', 'entrypoints', 'cycles', 'testAssociations',
      'unresolvedLinks', 'facilitiesPresent', 'facilitiesTotal', 'contractorReportsPending'
    ])
    && Object.values(model.summary).every(isNumber);
}

function isLegacyLayoutShape(layout) {
  return hasExactKeys(layout, [
    'townId', 'repoFingerprint', 'generatorVersion', 'seed', 'map', 'districts',
    'buildings', 'roads', 'npcs', 'props', 'connections', 'validation'
  ])
    && [layout.townId, layout.repoFingerprint, layout.generatorVersion, layout.seed].every(isString)
    && hasExactKeys(layout.map, ['widthTiles', 'heightTiles', 'tileSize', 'terrain'])
    && [layout.map.widthTiles, layout.map.heightTiles, layout.map.tileSize].every(isNumber)
    && arrayOf(layout.map.terrain, (row) => isStringArray(row))
    && arrayOf(layout.districts, (entry) => hasExactKeys(entry, ['id', 'kind', 'x', 'y', 'widthTiles', 'heightTiles'])
      && isString(entry.id) && isString(entry.kind)
      && [entry.x, entry.y, entry.widthTiles, entry.heightTiles].every(isNumber))
    && arrayOf(layout.buildings, (entry) => hasExactKeys(entry, ['id', 'facilityKind', 'x', 'y', 'footprint', 'entrance', 'state'])
      && isString(entry.id) && isString(entry.facilityKind) && isString(entry.state)
      && [entry.x, entry.y].every(isNumber)
      && hasExactKeys(entry.footprint, ['widthTiles', 'heightTiles'])
      && [entry.footprint.widthTiles, entry.footprint.heightTiles].every(isNumber)
      && hasExactKeys(entry.entrance, ['x', 'y', 'direction'])
      && [entry.entrance.x, entry.entrance.y].every(isNumber) && isString(entry.entrance.direction))
    && arrayOf(layout.roads, (entry) => hasExactKeys(entry, ['id', 'fromBuildingId', 'toBuildingId', 'tiles'])
      && [entry.id, entry.fromBuildingId, entry.toBuildingId].every(isString)
      && arrayOf(entry.tiles, (tile) => Array.isArray(tile) && tile.length === 2 && tile.every(isNumber)))
    && arrayOf(layout.npcs, (entry) => hasExactKeys(entry, ['id', 'role', 'x', 'y', 'facing'])
      && [entry.id, entry.role, entry.facing].every(isString) && [entry.x, entry.y].every(isNumber))
    && arrayOf(layout.props, (entry) => hasExactKeys(entry, ['id', 'kind', 'x', 'y'])
      && [entry.id, entry.kind].every(isString) && [entry.x, entry.y].every(isNumber))
    && arrayOf(layout.connections, (entry) => hasExactKeys(entry, ['from', 'to', 'kind'])
      && [entry.from, entry.to, entry.kind].every(isString))
    && hasExactKeys(layout.validation, [
      'ok', 'issues', 'densityScore', 'walkable', 'importantBuildingsReachable', 'noOverlap'
    ])
    && typeof layout.validation.ok === 'boolean'
    && isNumber(layout.validation.densityScore)
    && [layout.validation.walkable, layout.validation.importantBuildingsReachable, layout.validation.noOverlap]
      .every((value) => typeof value === 'boolean')
    && arrayOf(layout.validation.issues, (entry) => hasExactKeys(entry, ['code', 'message', 'severity'])
      && [entry.code, entry.message, entry.severity].every(isString));
}

function isLegacyPayloadShape(payload) {
  return hasExactKeys(payload, [
    'schemaVersion', 'repository', 'generatorVersion', 'seed', 'habitability', 'model', 'layout'
  ])
    && payload.schemaVersion === 1
    && hasExactKeys(payload.repository, ['name'])
    && isString(payload.repository.name)
    && isString(payload.generatorVersion)
    && isString(payload.seed)
    && hasExactKeys(payload.habitability, [
      'level', 'levelName', 'canLive', 'blockers', 'warnings', 'pendingInspections', 'reasons'
    ])
    && isNumber(payload.habitability.level)
    && isString(payload.habitability.levelName)
    && typeof payload.habitability.canLive === 'boolean'
    && ['blockers', 'warnings', 'pendingInspections', 'reasons']
      .every((key) => isStringArray(payload.habitability[key]))
    && isLegacyModel(payload.model)
    && isLegacyLayoutShape(payload.layout);
}

export function isValidLegacyTownPayload(payload) {
  if (!isLegacyPayloadShape(payload)) return false;
  const validation = validateLayout(payload.layout);
  return validation.ok === true
    && JSON.stringify(validation) === JSON.stringify(payload.layout.validation);
}

function containedBy(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function setSafetyHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function hasExpectedLoopbackHost(request, server) {
  const address = server.address();
  if (!address || typeof address === 'string') return false;
  return request.headers.host === `127.0.0.1:${address.port}`;
}

function sendJson(response, status, value, headOnly = false) {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('Cache-Control', 'no-store');
  response.end(headOnly ? undefined : body);
}

function sendText(response, status, message, headOnly = false) {
  const body = `${message}\n`;
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(headOnly ? undefined : body);
}

async function resolveStaticFile(publicRoot, requestTarget) {
  const rawPath = requestTarget.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { status: 400 };
  }
  if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return { status: 403 };
  if (segments.length === 0 || decoded.endsWith('/')) segments.push('index.html');

  const lexicalCandidate = path.resolve(publicRoot, ...segments);
  if (!containedBy(publicRoot, lexicalCandidate)) return { status: 403 };
  try {
    const stat = await lstat(lexicalCandidate);
    if (!stat.isFile()) return { status: 404 };
    const actualCandidate = await realpath(lexicalCandidate);
    if (!containedBy(publicRoot, actualCandidate)) return { status: 403 };
    return { status: 200, filePath: actualCandidate, size: stat.size };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { status: 404 };
    return { status: 403 };
  }
}

export function parseCliArgs(argv) {
  const result = { repoPath: DEFAULT_REPOSITORY, port: DEFAULT_PORT, open: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--open') result.open = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--repo') {
      if (!argv[index + 1]) throw new Error('--repo requires a directory path');
      result.repoPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--repo=')) result.repoPath = path.resolve(argument.slice('--repo='.length));
    else if (argument === '--port') {
      if (!argv[index + 1]) throw new Error('--port requires a number');
      result.port = Number(argv[index + 1]);
      index += 1;
    } else if (argument.startsWith('--port=')) result.port = Number(argument.slice('--port='.length));
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isSafeInteger(result.port) || result.port < 1 || result.port > 65_535) {
    throw new Error('--port must be an integer from 1 to 65535');
  }
  return result;
}

export async function startServer({
  repoPath = DEFAULT_REPOSITORY,
  port = DEFAULT_PORT,
  publicRoot = DEFAULT_PUBLIC_ROOT,
  scannerOptions = {},
  townPayloadBuilder = buildTownPayload,
  legacyTownPayloadBuilder = buildLegacyTownPayload
} = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('Invalid port');
  const actualPublicRoot = await realpath(path.resolve(publicRoot));
  if (!(await lstat(actualPublicRoot)).isDirectory()) throw new Error('Public root must be a directory');
  let inFlightInspection = null;
  const inspectCurrentRepository = () => {
    if (inFlightInspection) return inFlightInspection;
    const inspection = inspectRepository(repoPath, scannerOptions);
    inFlightInspection = inspection;
    inspection.then(
      () => {
        if (inFlightInspection === inspection) inFlightInspection = null;
      },
      () => {
        if (inFlightInspection === inspection) inFlightInspection = null;
      }
    );
    return inspection;
  };

  const server = createServer(async (request, response) => {
    setSafetyHeaders(response);
    if (!hasExpectedLoopbackHost(request, server)) {
      sendText(response, 421, 'Request host rejected');
      return;
    }
    const headOnly = request.method === 'HEAD';
    if (request.method !== 'GET' && !headOnly) {
      response.setHeader('Allow', 'GET, HEAD');
      sendText(response, 405, 'Method not allowed');
      return;
    }

    if (request.url?.split(/[?#]/, 1)[0] === '/api/city') {
      try {
        sendJson(response, 200, await inspectCurrentRepository(), headOnly);
      } catch {
        sendText(response, 500, 'Unable to inspect repository', headOnly);
      }
      return;
    }

    if (request.url?.split(/[?#]/, 1)[0] === '/api/town') {
      try {
        const inspection = await inspectCurrentRepository();
        const payload = await townPayloadBuilder(repoPath, inspection);
        const validation = validateWorldPlan(payload?.worldPlan, { inspection });
        const factsMatch = Array.isArray(payload?.facts)
          && JSON.stringify(payload.facts) === JSON.stringify(payload?.worldPlan?.facts);
        const validationMatches = JSON.stringify(validation) === JSON.stringify(payload?.worldPlan?.validation);
        if (!hasExactKeys(payload, ['schemaVersion', 'repository', 'habitability', 'facts', 'worldPlan'])
          || payload.schemaVersion !== 2 || !factsMatch || !validationMatches || validation.ok !== true) {
          throw new Error('Town payload contains an invalid WorldPlan');
        }
        sendJson(response, 200, payload, headOnly);
      } catch {
        sendText(response, 500, 'Unable to generate town', headOnly);
      }
      return;
    }

    if (request.url?.split(/[?#]/, 1)[0] === '/api/town/legacy') {
      try {
        const inspection = await inspectCurrentRepository();
        const payload = await legacyTownPayloadBuilder(repoPath, inspection);
        if (!isValidLegacyTownPayload(payload)) {
          throw new Error('Legacy town payload contains an invalid layout');
        }
        sendJson(response, 200, payload, headOnly);
      } catch {
        sendText(response, 500, 'Unable to generate legacy town', headOnly);
      }
      return;
    }

    const result = await resolveStaticFile(actualPublicRoot, request.url ?? '/');
    if (result.status !== 200) {
      sendText(response, result.status, result.status === 404 ? 'Not found' : 'Request rejected', headOnly);
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', CONTENT_TYPES.get(path.extname(result.filePath).toLowerCase()) ?? 'application/octet-stream');
    response.setHeader('Content-Length', result.size);
    response.setHeader('Cache-Control', 'no-cache');
    if (headOnly) {
      response.end();
      return;
    }
    const stream = createReadStream(result.filePath);
    stream.on('error', () => {
      if (!response.headersSent) sendText(response, 500, 'Unable to read asset');
      else response.destroy();
    });
    stream.pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    server,
    url,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function printHelp() {
  process.stdout.write(`CodeCity Inspector\n\nUsage: codecity [--repo PATH] [--port PORT] [--open]\n\nThe target repository is read as data only. Its code is never executed.\n`);
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }
  try {
    const running = await startServer(options);
    process.stdout.write(`CodeCity Inspector: ${running.url}\nRepository: ${path.basename(path.resolve(options.repoPath))}\nPress Ctrl+C to stop.\n`);
    if (options.open) {
      const opener = spawn('open', [running.url], { detached: true, stdio: 'ignore' });
      opener.unref();
    }
  } catch (error) {
    process.stderr.write(`Unable to start CodeCity Inspector: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
