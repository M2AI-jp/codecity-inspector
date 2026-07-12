#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectRepository } from './inspector.mjs';
import { buildTownPayload } from './town/index.mjs';

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
  townPayloadBuilder = buildTownPayload
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
        if (payload?.layout?.validation?.ok !== true) {
          throw new Error('Town payload contains an invalid layout');
        }
        sendJson(response, 200, payload, headOnly);
      } catch {
        sendText(response, 500, 'Unable to generate town', headOnly);
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
