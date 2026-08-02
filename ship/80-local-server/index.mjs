import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HOST = '127.0.0.1';
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ALLOWED_FILES = 4096;
const MAX_REQUEST_PATH_BYTES = 8 * 1024;
const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
});

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
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

function absoluteRoot(root) {
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('root must be a non-empty directory path');
  const requested = path.resolve(root);
  let rootStat;
  try {
    rootStat = fs.lstatSync(requested);
  } catch {
    throw new TypeError('root must be an existing regular directory');
  }
  if (rootStat.isSymbolicLink()) throw new TypeError('root must not contain symlinks');
  if (!rootStat.isDirectory()) throw new TypeError('root must be an existing regular directory');
  // Canonicalize trusted parent components (for example macOS /tmp) while
  // retaining the explicit final-root symlink rejection above.
  try {
    return fs.realpathSync(requested);
  } catch {
    throw new TypeError('root must be an existing regular directory');
  }
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
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

function relativeFile(root, decoded) {
  const relative = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(root, ...relative.split('/'));
  if (!withinRoot(root, candidate) || candidate === root) return { error: 'forbidden_path' };
  return { candidate, relative };
}

function assertSafePathComponents(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    if (!part) continue;
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return { error: 'forbidden_path' };
  }
  return { candidate: current };
}

function normalizeAllowedFile(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('allowedFiles entries must be non-empty relative paths');
  const decoded = value.replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = decoded.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new TypeError('allowedFiles entries must not contain traversal or dotfiles');
  }
  return parts.join('/');
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

function loadAllowedFiles(root, allowedFiles, maxFileBytes, maxTotalBytes, expectedSha256) {
  if (!Array.isArray(allowedFiles) || allowedFiles.length === 0 || allowedFiles.length > MAX_ALLOWED_FILES) {
    throw new TypeError(`allowedFiles must contain 1 through ${MAX_ALLOWED_FILES} explicit paths`);
  }
  const unique = [...new Set(allowedFiles.map(normalizeAllowedFile))].sort();
  if (unique.length !== allowedFiles.length) throw new TypeError('allowedFiles entries must be unique');
  const expected = normalizeExpectedDigests(expectedSha256, unique);
  const loaded = new Map();
  let totalBytes = 0;
  for (const relative of unique) {
    loaded.set(relative, loadAllowedFile(root, relative, maxFileBytes, expected?.[relative]));
    totalBytes += loaded.get(relative).bytes.length;
    if (totalBytes > maxTotalBytes) throw new TypeError('allowedFiles exceed maxTotalBytes');
  }
  return loaded;
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

function loadAllowedFile(root, relative, maxFileBytes, expectedSha256) {
  let safe;
  try {
    safe = assertSafePathComponents(root, relative);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new TypeError('allowedFiles must name existing regular files');
    throw error;
  }
  if (safe.error) throw new TypeError('allowedFiles must not traverse symlinks');
  let descriptor;
  try {
    descriptor = fs.openSync(safe.candidate, fs.constants.O_RDONLY | O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new TypeError('allowedFiles must name regular files');
    const canonicalCandidate = fs.realpathSync(safe.candidate);
    if (!withinRoot(root, canonicalCandidate)) throw new TypeError('allowedFiles must remain inside root');
    const canonicalStat = fs.lstatSync(canonicalCandidate);
    if (!canonicalStat.isFile() || canonicalStat.isSymbolicLink()
        || canonicalStat.dev !== stat.dev || canonicalStat.ino !== stat.ino) {
      throw new TypeError('allowedFiles changed while being loaded');
    }
    const extension = path.extname(relative).toLowerCase();
    const mime = MIME_TYPES[extension];
    if (!mime) throw new TypeError('allowedFiles contains an unsupported media type');
    if (stat.size > maxFileBytes) throw new TypeError('allowedFiles contains a file larger than maxFileBytes');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new TypeError('allowedFiles changed while being loaded');
      offset += count;
    }
    const finalStat = fs.fstatSync(descriptor);
    if (finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) {
      throw new TypeError('allowedFiles changed while being loaded');
    }
    if (expectedSha256 !== undefined) {
      const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== expectedSha256) throw new TypeError('allowedFiles bytes do not match expectedSha256');
    }
    return Object.freeze({ bytes, mime });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new TypeError('allowedFiles must name existing regular files');
    if (error?.code === 'ELOOP' || error?.code === 'EACCES' || error?.code === 'EPERM') throw new TypeError('allowedFiles must not traverse symlinks');
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function errorResponse(res, error) {
  const statuses = {
    bad_request: 400,
    request_uri_too_long: 414,
    forbidden_path: 403,
    not_found: 404,
    method_not_allowed: 405,
    unsupported_media_type: 415,
    file_too_large: 413,
  };
  const status = statuses[error] ?? 500;
  sendJson(res, status, error, error === 'method_not_allowed' ? { Allow: 'GET, HEAD' } : {});
}

function configureServer(root, files) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.shouldKeepAlive = false;
        errorResponse(res, 'method_not_allowed');
        res.once('finish', () => req.destroy());
        return;
      }
      const parsed = requestedPath(req.url);
      if (parsed.error) {
        errorResponse(res, parsed.error);
        return;
      }
      const mapped = relativeFile(root, parsed.decoded);
      if (mapped.error) {
        errorResponse(res, mapped.error);
        return;
      }
      const loaded = files.get(mapped.relative);
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

/** Create an unlistening HTTP server configured for one explicit root. */
export function createLocalServer({
  root,
  allowedFiles,
  snapshots,
  port = 0,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  expectedSha256,
} = {}) {
  assertPort(port);
  assertMaxFileBytes(maxFileBytes);
  assertMaxTotalBytes(maxTotalBytes, maxFileBytes);
  if (snapshots !== undefined && (root !== undefined || allowedFiles !== undefined)) throw new TypeError('use either snapshots or root/allowedFiles, not both');
  const snapshotMode = snapshots !== undefined;
  const resolvedRoot = snapshotMode ? path.parse(process.cwd()).root : absoluteRoot(root);
  const files = snapshotMode
    ? loadSnapshotFiles(snapshots, maxFileBytes, maxTotalBytes, expectedSha256)
    : loadAllowedFiles(resolvedRoot, allowedFiles, maxFileBytes, maxTotalBytes, expectedSha256);
  const server = configureServer(resolvedRoot, files);
  Object.defineProperties(server, {
    root: { configurable: false, enumerable: true, value: snapshotMode ? null : resolvedRoot, writable: false },
    port: { configurable: false, enumerable: true, value: port, writable: false },
  });
  return server;
}

/** Start a loopback-only server and return its origin plus an idempotent close. */
export async function startLocalServer(options = {}) {
  const server = createLocalServer(options);
  const port = options.port ?? 0;
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
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (!server.listening) return;
    await new Promise((resolve) => server.close(() => resolve()));
  };
  return Object.freeze({
    close,
    origin: `http://${HOST}:${actualPort}`,
    server,
  });
}
