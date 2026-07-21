import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_ASSETS } from '../public/fable5-v2/site-runtime.mjs';
import { parseCliArgs, startServer } from '../src/server.mjs';
import { buildTownPayload } from '../src/town/index.mjs';

const PUBLIC_ROOT = fileURLToPath(new URL('../public', import.meta.url));

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

async function serverFixture({ withEntrypoint = true } = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'codecity-server-'));
  const repo = path.join(workspace, 'repo');
  const publicRoot = path.join(workspace, 'public');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(publicRoot, { recursive: true });
  await writeFile(path.join(repo, 'src', 'index.js'), "export const secret = 'SOURCE_MUST_NOT_LEAK';\n");
  if (withEntrypoint) await writeFile(path.join(repo, 'package.json'), '{"main":"src/index.js"}\n');
  await writeFile(path.join(publicRoot, 'index.html'), '<h1>CodeCity</h1>');
  await writeFile(path.join(publicRoot, 'app.js'), 'document.body.dataset.ready = "yes";');
  await writeFile(path.join(publicRoot, 'world-runtime.mjs'), 'export const ready = true;');
  await writeFile(path.join(publicRoot, 'site-runtime.mjs'), 'export const sitesReady = true;');
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

test('target-town production asset contracts match the packaged PNG bytes, hashes, and dimensions', async () => {
  for (const contract of Object.values(PRODUCTION_ASSETS)) {
    const bytes = await readFile(path.join(PUBLIC_ROOT, contract.url.slice(1)));
    assert.equal(bytes.length, contract.bytes, contract.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), contract.sha256, contract.id);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], contract.id);
    assert.equal(bytes.readUInt32BE(16), contract.width, contract.id);
    assert.equal(bytes.readUInt32BE(20), contract.height, contract.id);
  }
  assert.equal(Object.isFrozen(PRODUCTION_ASSETS), true);
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
  assert.match(page.headers['content-security-policy'], /img-src 'self' data: blob:/);

  const api = await rawRequest(port, '/api/city');
  assert.equal(api.status, 200);
  assert.equal(JSON.parse(api.body).repository.name, 'repo');
  assert.equal(api.body.includes('SOURCE_MUST_NOT_LEAK'), false);

  const head = await rawRequest(port, '/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.match(head.headers['content-type'], /text\/javascript/);
  const moduleHead = await rawRequest(port, '/world-runtime.mjs', 'HEAD');
  assert.equal(moduleHead.status, 200);
  assert.match(moduleHead.headers['content-type'], /text\/javascript/);
  const siteModuleHead = await rawRequest(port, '/site-runtime.mjs', 'HEAD');
  assert.equal(siteModuleHead.status, 200);
  assert.match(siteModuleHead.headers['content-type'], /text\/javascript/);
});

test('serves the exact WorldPlan v2 payload without leaking source', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({ ...fixture, repoPath: fixture.repo, port: 0 });
  t.after(running.close);
  const port = running.server.address().port;

  const api = await rawRequest(port, '/api/town');
  assert.equal(api.status, 200);
  assert.match(api.headers['content-type'], /application\/json/);
  assert.equal(api.body.includes('SOURCE_MUST_NOT_LEAK'), false);

  const town = JSON.parse(api.body);
  assert.deepEqual(Object.keys(town), [
    'schemaVersion', 'repository', 'habitability', 'facts', 'worldPlan'
  ]);
  assert.equal(town.schemaVersion, 2);
  assert.equal(town.repository.name, 'repo');

  assert.equal(Number.isInteger(town.habitability.level), true);
  assert.equal(town.habitability.level >= 0 && town.habitability.level <= 5, true);
  assert.equal(typeof town.habitability.levelName, 'string');
  assert.equal(typeof town.habitability.canLive, 'boolean');

  assert.equal(Array.isArray(town.facts), true);
  assert.equal(town.facts.length, town.worldPlan.facts.length);
  assert.equal(town.worldPlan.schemaVersion, 2);
  assert.equal(typeof town.worldPlan.seed, 'string');
  assert.equal(typeof town.worldPlan.generatorVersion, 'string');
  assert.equal(Array.isArray(town.worldPlan.buildings), true);
  assert.equal(typeof town.worldPlan.validation, 'object');
  assert.notEqual(town.worldPlan.validation, null);
  assert.equal(town.worldPlan.validation.ok, true);

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

test('serves the target-town n=1 shell, runtime modules, and exact production assets', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({ repoPath: fixture.repo, port: 0 });
  t.after(running.close);
  const port = running.server.address().port;

  const page = await rawRequest(port, '/fable5-v2/');
  assert.equal(page.status, 200);
  assert.match(page.body, /CodeCity Inspector — 古町の宿屋/);
  assert.match(page.body, /\/fable5-v2\/app\.js/);

  for (const modulePath of [
    '/fable5-v2/app.js',
    '/fable5-v2/site-runtime.mjs',
    '/fable5-v2/world-runtime.mjs'
  ]) {
    const response = await rawRequest(port, modulePath, 'HEAD');
    assert.equal(response.status, 200, modulePath);
    assert.equal(response.body, '');
    assert.match(response.headers['content-type'], /text\/javascript/, modulePath);
  }

  for (const contract of Object.values(PRODUCTION_ASSETS)) {
    const response = await rawRequest(port, contract.url, 'HEAD');
    assert.equal(response.status, 200, contract.id);
    assert.equal(Number(response.headers['content-length']), contract.bytes, contract.id);
    assert.equal(response.headers['content-type'], 'image/png', contract.id);
  }

  const removedLegacyChannel = await rawRequest(port, '/api/town/legacy');
  assert.equal(removedLegacyChannel.status, 404);
});

test('refuses to return a town payload whose WorldPlan did not pass validation', async (t) => {
  const fixture = await serverFixture();
  const running = await startServer({
    ...fixture,
    repoPath: fixture.repo,
    port: 0,
    townPayloadBuilder: async () => ({
      schemaVersion: 2,
      worldPlan: { validation: { ok: false } }
    })
  });
  t.after(running.close);

  const response = await rawRequest(running.server.address().port, '/api/town');
  assert.equal(response.status, 500);
  assert.equal(response.body, 'Unable to generate town\n');
  assert.equal(response.body.includes('validation'), false);

  const head = await rawRequest(running.server.address().port, '/api/town', 'HEAD');
  assert.equal(head.status, 500);
  assert.equal(head.body, '');
});

test('revalidates the WorldPlan and requires the top-level facts to be its exact fact table', async (t) => {
  const fixture = await serverFixture();
  let requestIndex = 0;
  const running = await startServer({
    ...fixture,
    repoPath: fixture.repo,
    port: 0,
    townPayloadBuilder: async (repoPath, inspection) => {
      const payload = structuredClone(await buildTownPayload(repoPath, inspection));
      if (requestIndex++ === 0) {
        const fileBuilding = payload.worldPlan.buildings.find(({ files }) => files.length > 0);
        fileBuilding.rooms = [];
      } else {
        payload.facts = [];
      }
      return payload;
    }
  });
  t.after(running.close);
  const port = running.server.address().port;

  const forgedVerdict = await rawRequest(port, '/api/town');
  assert.equal(forgedVerdict.status, 500);
  assert.equal(forgedVerdict.body, 'Unable to generate town\n');

  const mismatchedFacts = await rawRequest(port, '/api/town');
  assert.equal(mismatchedFacts.status, 500);
  assert.equal(mismatchedFacts.body, 'Unable to generate town\n');
});

test('a repository with buildings but no entrypoint returns an honest uninhabitable town', async (t) => {
  const fixture = await serverFixture({ withEntrypoint: false });
  const running = await startServer({ ...fixture, repoPath: fixture.repo, port: 0 });
  t.after(running.close);

  const response = await rawRequest(running.server.address().port, '/api/town');
  assert.equal(response.status, 200);
  const town = JSON.parse(response.body);
  assert.equal(town.habitability.canLive, false);
  assert.ok(town.habitability.blockers.some((entry) => /入口/.test(entry)));
  assert.equal(town.worldPlan.validation.ok, true);
  assert.ok(town.worldPlan.validation.issues.some((entry) => entry.code === 'REACHABLE' && entry.severity === 'warning'));
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
