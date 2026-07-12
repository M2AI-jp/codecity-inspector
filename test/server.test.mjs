import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCliArgs, startServer } from '../src/server.mjs';

function rawRequest(port, requestPath, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path: requestPath, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function serverFixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codecity-server-'));
  const repo = path.join(workspace, 'repo');
  const publicRoot = path.join(workspace, 'public');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(publicRoot, { recursive: true });
  await writeFile(path.join(repo, 'src', 'index.js'), "export const secret = 'SOURCE_MUST_NOT_LEAK';\n");
  await writeFile(path.join(publicRoot, 'index.html'), '<h1>CodeCity</h1>');
  await writeFile(path.join(publicRoot, 'app.js'), 'document.body.dataset.ready = "yes";');
  const outside = path.join(workspace, 'outside.txt');
  await writeFile(outside, 'OUTSIDE_SECRET');
  await symlink(outside, path.join(publicRoot, 'leak.txt'));
  return { repo, publicRoot };
}

test('CLI parsing accepts explicit local options and rejects invalid ports', () => {
  const parsed = parseCliArgs(['--repo', '.', '--port=4567', '--open']);
  assert.equal(parsed.repoPath, process.cwd());
  assert.equal(parsed.port, 4567);
  assert.equal(parsed.open, true);
  assert.throws(() => parseCliArgs(['--port', '0']), /1 to 65535/);
  assert.throws(() => parseCliArgs(['--unknown']), /Unknown option/);
});

test('serves the city report and assets on loopback without source bodies', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({ ...fixture, repoPath: fixture.repo, port: 0 });
  t.after(running.close);
  assert.equal(running.server.address().address, '127.0.0.1');
  const port = running.server.address().port;

  const page = await rawRequest(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /CodeCity/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);

  const api = await rawRequest(port, '/api/city');
  assert.equal(api.status, 200);
  assert.equal(JSON.parse(api.body).repository.name, 'repo');
  assert.equal(api.body.includes('SOURCE_MUST_NOT_LEAK'), false);

  const head = await rawRequest(port, '/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.match(head.headers['content-type'], /text\/javascript/);
});

test('serves the town model, habitability, and validated layout without leaking source', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({ ...fixture, repoPath: fixture.repo, port: 0 });
  t.after(running.close);
  const port = running.server.address().port;

  const api = await rawRequest(port, '/api/town');
  assert.equal(api.status, 200);
  assert.match(api.headers['content-type'], /application\/json/);
  assert.equal(api.body.includes('SOURCE_MUST_NOT_LEAK'), false);

  const town = JSON.parse(api.body);
  assert.equal(town.schemaVersion, 1);
  assert.equal(town.repository.name, 'repo');
  assert.equal(typeof town.generatorVersion, 'string');
  assert.equal(typeof town.seed, 'string');

  assert.equal(Array.isArray(town.model.facilities), true);
  assert.equal(typeof town.model.guild, 'object');
  assert.equal(typeof town.model.external, 'object');
  assert.equal(typeof town.model.summary, 'object');

  assert.equal(Number.isInteger(town.habitability.level), true);
  assert.equal(town.habitability.level >= 0 && town.habitability.level <= 5, true);
  assert.equal(typeof town.habitability.levelName, 'string');
  assert.equal(typeof town.habitability.canLive, 'boolean');

  assert.equal(Array.isArray(town.layout.buildings), true);
  assert.equal(typeof town.layout.validation, 'object');
  assert.notEqual(town.layout.validation, null);

  // Deterministic: an unchanged repository yields a byte-identical payload.
  const repeat = await rawRequest(port, '/api/town');
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body, api.body);

  // HEAD mirrors GET headers with an empty body (same guards as /api/city).
  const townHead = await rawRequest(port, '/api/town', 'HEAD');
  assert.equal(townHead.status, 200);
  assert.equal(townHead.body, '');
  assert.match(townHead.headers['content-type'], /application\/json/);

  const post = await rawRequest(port, '/api/town', 'POST');
  assert.equal(post.status, 405);
});

test('rescans the repository after each completed city request and recovers from scan errors', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({ ...fixture, repoPath: fixture.repo, port: 0 });
  t.after(running.close);
  const port = running.server.address().port;

  const first = await rawRequest(port, '/api/city');
  assert.equal(first.status, 200);
  assert.equal(JSON.parse(first.body).summary.filesScanned, 1);

  await writeFile(path.join(fixture.repo, 'src', 'added.ts'), 'export const added: boolean = true;\n');
  const second = await rawRequest(port, '/api/city');
  assert.equal(second.status, 200);
  const updated = JSON.parse(second.body);
  assert.equal(updated.summary.filesScanned, 2);
  assert.equal(updated.city.buildings.some((building) => building.path === 'src/added.ts'), true);

  const unavailable = `${fixture.repo}-unavailable`;
  await rename(fixture.repo, unavailable);
  const failed = await rawRequest(port, '/api/city');
  assert.equal(failed.status, 500);
  assert.equal(failed.body, 'Unable to inspect repository\n');

  await rename(unavailable, fixture.repo);
  const recovered = await rawRequest(port, '/api/city');
  assert.equal(recovered.status, 200);
  assert.equal(JSON.parse(recovered.body).summary.filesScanned, 2);
});

test('rejects encoded traversal, symlink escape, and state-changing methods', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({ ...fixture, repoPath: fixture.repo, port: 0 });
  t.after(running.close);
  const port = running.server.address().port;

  assert.equal((await rawRequest(port, '/..%2Foutside.txt')).status, 403);
  assert.equal((await rawRequest(port, '/%2e%2e/outside.txt')).status, 403);
  assert.equal((await rawRequest(port, '/leak.txt')).status, 404);
  assert.equal((await rawRequest(port, '/api/city', 'POST')).status, 405);
});

test('rejects DNS-rebinding Host headers and accepts only the actual loopback origin', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({ ...fixture, repoPath: fixture.repo, port: 0 });
  t.after(running.close);
  const port = running.server.address().port;

  assert.equal((await rawRequest(port, '/api/city', 'GET', { Host: `127.0.0.1:${port}` })).status, 200);
  assert.equal((await rawRequest(port, '/api/city', 'GET', { Host: `evil.example:${port}` })).status, 421);
  assert.equal((await rawRequest(port, '/api/city', 'GET', { Host: `localhost:${port}` })).status, 421);
  assert.equal((await rawRequest(port, '/api/city', 'GET', { Host: `127.0.0.1:${port + 1}` })).status, 421);
});
