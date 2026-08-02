import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLocalServer, startLocalServer } from '../../../ship/80-local-server/index.mjs';

async function request(origin, method, pathname) {
  const originUrl = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: originUrl.hostname,
      method,
      path: pathname,
      port: originUrl.port,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        body: Buffer.concat(chunks),
        headers: res.headers,
        status: res.statusCode,
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'codecity-local-server-'));
  await fsp.writeFile(path.join(root, 'index.html'), '<h1>town</h1>');
  await fsp.writeFile(path.join(root, 'data.json'), '{"ok":true}');
  await fsp.writeFile(path.join(root, '.secret'), 'hidden');
  await fsp.mkdir(path.join(root, 'private'));
  await fsp.writeFile(path.join(root, 'private', 'secret.txt'), 'hidden');
  await fsp.writeFile(path.join(root, 'source.js'), 'SECRET_SOURCE');
  return root;
}

const ALLOWED_FILES = ['index.html', 'data.json'];

test('serves GET and HEAD on literal loopback with security headers', async () => {
  const root = await fixture();
  const running = await startLocalServer({ root, allowedFiles: ALLOWED_FILES, port: 0 });
  try {
    assert.match(running.origin, /^http:\/\/127\.0\.0\.1:\d+$/u);
    const get = await request(running.origin, 'GET', '/index.html');
    assert.equal(get.status, 200);
    assert.equal(get.body.toString(), '<h1>town</h1>');
    assert.equal(get.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(get.headers['x-content-type-options'], 'nosniff');
    assert.equal(get.headers['referrer-policy'], 'no-referrer');
    assert.equal(get.headers['cross-origin-resource-policy'], 'same-origin');
    assert.match(get.headers['content-security-policy'], /default-src 'self'/u);
    const head = await request(running.origin, 'HEAD', '/data.json');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-length'], String(Buffer.byteLength('{"ok":true}')));
  } finally {
    await running.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('rejects methods, traversal, dotfiles, directories, and unsupported MIME', async () => {
  const root = await fixture();
  await fsp.writeFile(path.join(root, 'program.bin'), 'not served');
  const running = await startLocalServer({ root, allowedFiles: ALLOWED_FILES });
  try {
    assert.equal((await request(running.origin, 'POST', '/index.html')).status, 405);
    assert.equal((await request(running.origin, 'GET', '/%2e%2e/index.html')).status, 403);
    assert.equal((await request(running.origin, 'GET', '/.secret')).status, 403);
    assert.equal((await request(running.origin, 'GET', '/private')).status, 404);
    assert.equal((await request(running.origin, 'GET', '/program.bin')).status, 404);
    assert.equal((await request(running.origin, 'GET', '/source.js')).status, 404);
    const error = await request(running.origin, 'GET', '/missing.json');
    assert.equal(error.status, 404);
    assert.deepEqual(JSON.parse(error.body), { error: 'not_found' });
    assert.doesNotMatch(error.body.toString(), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
    assert.throws(() => createLocalServer({ root, allowedFiles: ['program.bin'] }), /unsupported media type/);
  } finally {
    await running.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('rejects symlink roots and symlink path components', async (t) => {
  const root = await fixture();
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'codecity-local-server-outside-'));
  await fsp.writeFile(path.join(outside, 'outside.txt'), 'outside');
  const link = path.join(root, 'link.txt');
  const linkedRoot = `${root}-link`;
  try {
    await fsp.symlink(path.join(outside, 'outside.txt'), link);
    await fsp.symlink(root, linkedRoot);
  } catch (error) {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
    await t.skip(`symlink unavailable: ${error.code}`);
    return;
  }
  try {
    assert.throws(() => createLocalServer({ root: linkedRoot, allowedFiles: ALLOWED_FILES }), /symlink/i);
    assert.throws(() => createLocalServer({ root, allowedFiles: [...ALLOWED_FILES, 'link.txt'] }), /symlink/i);
    const running = await startLocalServer({ root, allowedFiles: ALLOWED_FILES });
    try {
      assert.equal((await request(running.origin, 'GET', '/link.txt')).status, 404);
    } finally {
      await running.close();
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
    await fsp.rm(linkedRoot, { recursive: true, force: true });
  }
});

test('enforces the configured file-size bound', async () => {
  const root = await fixture();
  await fsp.writeFile(path.join(root, 'large.txt'), '0123456789');
  assert.throws(
    () => createLocalServer({ root, allowedFiles: ['large.txt'], maxFileBytes: 5 }),
    /larger than maxFileBytes/
  );
  await fsp.rm(root, { recursive: true, force: true });
});

test('serves immutable startup snapshots and requires an explicit allowlist', async () => {
  const root = await fixture();
  assert.throws(() => createLocalServer({ root }), /allowedFiles/);
  const running = await startLocalServer({ root, allowedFiles: ['data.json'] });
  try {
    await fsp.writeFile(path.join(root, 'data.json'), '{"changed":true}');
    const response = await request(running.origin, 'GET', '/data.json');
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), '{"ok":true}');
  } finally {
    await running.close();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('optionally verifies the exact distribution bytes before serving', async () => {
  const root = await fixture();
  const expected = crypto.createHash('sha256').update('{"ok":true}').digest('hex');
  try {
    const running = await startLocalServer({ root, allowedFiles: ['data.json'], expectedSha256: { 'data.json': expected } });
    await running.close();
    assert.throws(
      () => createLocalServer({ root, allowedFiles: ['data.json'], expectedSha256: { 'data.json': '0'.repeat(64) } }),
      /expectedSha256/u
    );
    assert.throws(
      () => createLocalServer({ root, allowedFiles: ['data.json'], expectedSha256: {} }),
      /exactly allowedFiles/u
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('serves copied in-memory snapshots without a distribution directory', async () => {
  const bytes = Buffer.from('<h1>memory town</h1>');
  const expected = crypto.createHash('sha256').update(bytes).digest('hex');
  const running = await startLocalServer({
    snapshots: { 'index.html': bytes },
    expectedSha256: { 'index.html': expected },
  });
  try {
    assert.equal(running.server.root, null);
    bytes.fill(0);
    const response = await request(running.origin, 'GET', '/index.html');
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), '<h1>memory town</h1>');
  } finally {
    await running.close();
  }
});
