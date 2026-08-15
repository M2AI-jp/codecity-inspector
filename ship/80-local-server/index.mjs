import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';

const HOST = '127.0.0.1';
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ALLOWED_FILES = 4096;
const MAX_REQUEST_PATH_BYTES = 8 * 1024;
const SHUTDOWN_PATH = '__codecity/shutdown';
const SHUTDOWN_HEADER = 'x-codecity-exit';
const SHUTDOWN_HEADER_VALUE = '1';

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
});

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; worker-src 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('port must be an integer from 0 through 65535');
  }
}

function assertMaxFileBytes(value) {
  if (!Number.isInteger(value) || value <= 0 || value > 1024 * 1024 * 1024) {
    throw new TypeError('maxFileBytes must be a positive bounded integer');
  }
}

function assertMaxTotalBytes(value, maxFileBytes) {
  if (!Number.isInteger(value) || value <= 0 || value > 1024 * 1024 * 1024 || value < maxFileBytes) {
    throw new TypeError('maxTotalBytes must be a bounded integer at least as large as maxFileBytes');
  }
}

function responseHeaders(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra };
}

function sendJson(res, status, code, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify({ error: code }), 'utf8');
  res.writeHead(status, responseHeaders({
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  }));
  res.end(body);
}

function rejectEncodedTraversal(rawPath) {
  // Encoded separators and dots are rejected before decoding.  This removes
  // parser disagreement between URL, POSIX, and Windows path semantics.
  return /%(?:2e|2f|5c)/iu.test(rawPath);
}

function requestedPath(rawUrl) {
  if (typeof rawUrl !== 'string' || Buffer.byteLength(rawUrl, 'utf8') > MAX_REQUEST_PATH_BYTES) {
    return { error: 'request_uri_too_long' };
  }
  const rawTarget = rawUrl.split(/[?#]/u, 1)[0];
  if (rejectEncodedTraversal(rawTarget)) return { error: 'forbidden_path' };
  let parsed;
  try {
    parsed = new URL(rawUrl, 'http://127.0.0.1');
  } catch {
    return { error: 'bad_request' };
  }
  const rawPath = rawTarget || parsed.pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { error: 'bad_request' };
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return { error: 'forbidden_path' };
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.startsWith('.'))) {
    return { error: 'forbidden_path' };
  }
  return { decoded };
}

function normalizeExpectedDigests(expectedSha256, allowedFiles) {
  if (expectedSha256 === undefined) return null;
  if (!isPlainObject(expectedSha256)) throw new TypeError('expectedSha256 must be a plain object');
  const expectedKeys = [...allowedFiles].sort();
  const actualKeys = Object.keys(expectedSha256).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new TypeError('expectedSha256 must cover exactly allowedFiles');
  for (const key of expectedKeys) if (!/^[a-f0-9]{64}$/iu.test(expectedSha256[key])) throw new TypeError('expectedSha256 entries must be SHA-256 hex digests');
  return Object.fromEntries(expectedKeys.map((key) => [key, expectedSha256[key].toLowerCase()]));
}

function normalizeAllowedFile(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('snapshot entries must be non-empty relative paths');
  const decoded = value.replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = decoded.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new TypeError('snapshot entries must not contain traversal or dotfiles');
  }
  return parts.join('/');
}

function loadSnapshotFiles(snapshots, maxFileBytes, maxTotalBytes, expectedSha256) {
  if (!isPlainObject(snapshots)) throw new TypeError('snapshots must be a plain object');
  const sourceKeys = Object.keys(snapshots);
  if (sourceKeys.length === 0 || sourceKeys.length > MAX_ALLOWED_FILES) throw new TypeError(`snapshots must contain 1 through ${MAX_ALLOWED_FILES} explicit paths`);
  const unique = [...new Set(sourceKeys.map(normalizeAllowedFile))].sort();
  if (unique.length !== sourceKeys.length || unique.some((key, index) => key !== sourceKeys.sort()[index])) throw new TypeError('snapshot paths must be unique canonical relative paths');
  const expected = normalizeExpectedDigests(expectedSha256, unique);
  const loaded = new Map();
  let totalBytes = 0;
  for (const relative of unique) {
    const source = snapshots[relative];
    if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) throw new TypeError('snapshot values must be byte arrays');
    const bytes = Buffer.from(source);
    if (bytes.length > maxFileBytes) throw new TypeError('snapshots contains a file larger than maxFileBytes');
    const mime = MIME_TYPES[path.extname(relative).toLowerCase()];
    if (!mime) throw new TypeError('snapshots contains an unsupported media type');
    if (expected) {
      const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== expected[relative]) throw new TypeError('snapshot bytes do not match expectedSha256');
    }
    totalBytes += bytes.length;
    if (totalBytes > maxTotalBytes) throw new TypeError('snapshots exceed maxTotalBytes');
    loaded.set(relative, { bytes, mime });
  }
  return loaded;
}

function errorResponse(res, error, allow = 'GET, HEAD') {
  const statuses = {
    bad_request: 400,
    request_uri_too_long: 414,
    forbidden_host: 403,
    forbidden_path: 403,
    not_found: 404,
    method_not_allowed: 405,
  };
  const status = statuses[error] ?? 500;
  sendJson(res, status, error, error === 'method_not_allowed' ? { Allow: allow } : {});
}

function requestHasExpectedHost(req, expectedHost) {
  if (typeof expectedHost !== 'string' || expectedHost.length === 0) return false;
  let rawHost = null;
  let rawHostCount = 0;
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() !== 'host') continue;
    rawHostCount += 1;
    rawHost = req.rawHeaders[index + 1];
  }
  return rawHostCount === 1
    && rawHost === expectedHost
    && req.headers.host === expectedHost;
}

function configureServer(files, control = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      if (!requestHasExpectedHost(req, control.expectedHost)) {
        res.shouldKeepAlive = false;
        errorResponse(res, 'forbidden_host');
        res.once('finish', () => req.destroy());
        return;
      }
      const parsed = requestedPath(req.url);
      if (parsed.error) {
        errorResponse(res, parsed.error);
        return;
      }
      const relative = parsed.decoded.replace(/^\/+/, '');
      if (relative === SHUTDOWN_PATH) {
        if (req.method !== 'POST') {
          res.shouldKeepAlive = false;
          errorResponse(res, 'method_not_allowed', 'POST');
          res.once('finish', () => req.destroy());
          return;
        }
        const origin = req.headers.origin;
        const shutdownHeader = req.headers[SHUTDOWN_HEADER];
        if (origin !== control.expectedOrigin || shutdownHeader !== SHUTDOWN_HEADER_VALUE) {
          res.shouldKeepAlive = false;
          errorResponse(res, 'forbidden_path');
          res.once('finish', () => req.destroy());
          return;
        }
        res.shouldKeepAlive = false;
        res.writeHead(204, responseHeaders({
          'Cache-Control': 'no-store',
          'Content-Length': 0,
        }));
        res.once('finish', () => {
          if (control.shutdownRequested) return;
          control.shutdownRequested = true;
          if (typeof control.onShutdown === 'function') void control.onShutdown();
        });
        res.end();
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.shouldKeepAlive = false;
        errorResponse(res, 'method_not_allowed');
        res.once('finish', () => req.destroy());
        return;
      }
      const loaded = files.get(relative);
      if (!loaded) {
        errorResponse(res, 'not_found');
        return;
      }
      res.writeHead(200, responseHeaders({
        'Cache-Control': 'no-store',
        'Content-Length': loaded.bytes.length,
        'Content-Type': loaded.mime,
      }));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(loaded.bytes);
    } catch {
      if (!res.headersSent) errorResponse(res, 'internal_error');
      else res.destroy();
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

function createLocalServer({
  snapshots,
  port = 0,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  expectedSha256,
  control,
} = {}) {
  assertPort(port);
  assertMaxFileBytes(maxFileBytes);
  assertMaxTotalBytes(maxTotalBytes, maxFileBytes);
  if (snapshots === undefined) throw new TypeError('snapshots are required');
  const files = loadSnapshotFiles(snapshots, maxFileBytes, maxTotalBytes, expectedSha256);
  return configureServer(files, control);
}

/** Start a loopback-only server and return its origin plus an idempotent close. */
export async function startLocalServer({ snapshots, expectedSha256, port = 0, maxFileBytes = DEFAULT_MAX_FILE_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES } = {}) {
  const control = { expectedHost: null, expectedOrigin: null, onShutdown: null, shutdownRequested: false };
  const server = createLocalServer({ snapshots, expectedSha256, port, maxFileBytes, maxTotalBytes, control });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', resolve);
      reject(error);
    };
    server.once('error', onError);
    // The host is intentionally a literal.  Callers cannot broaden binding.
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const expectedHost = `${HOST}:${actualPort}`;
  const origin = new URL(`http://${expectedHost}`).origin;
  control.expectedHost = expectedHost;
  control.expectedOrigin = origin;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (!server.listening) return;
    await new Promise((resolve) => server.close(() => resolve()));
  };
  control.onShutdown = close;
  return Object.freeze({
    close,
    origin,
  });
}
