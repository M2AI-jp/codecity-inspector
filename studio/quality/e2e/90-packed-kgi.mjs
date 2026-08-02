#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HARNESS_70 = resolve(dirname(fileURLToPath(import.meta.url)), '70-browser-journey.mjs');
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

function args(argv) {
  const value = { tarball: null, repo: null, port: null, evidence: null };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--tarball') value.tarball = resolve(argv[++index]);
    else if (name === '--repo') value.repo = resolve(argv[++index]);
    else if (name === '--port') value.port = Number(argv[++index]);
    else if (name === '--evidence') value.evidence = resolve(argv[++index]);
    else throw new Error(`unknown argument: ${name}`);
  }
  if (!value.tarball || !value.repo || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new Error('usage: 90-packed-kgi.mjs --tarball FILE --repo DIR --port 1..65535 [--evidence FILE]');
  }
  return value;
}

function command(executable, commandArgs, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(executable, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => done({ code, signal, stdout, stderr }));
  });
}

async function sha256File(path) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function snapshotRepository(root) {
  const entries = {};
  async function visit(absolute, relative) {
    const info = await lstat(absolute, { bigint: true });
    const common = {
      mode: Number(info.mode & 0o7777n), size: info.size.toString(),
      mtimeNs: info.mtimeNs.toString(),
    };
    if (info.isDirectory()) {
      entries[relative || '.'] = { type: 'directory', ...common };
      const names = await readdir(absolute);
      names.sort();
      for (const name of names) await visit(join(absolute, name), relative ? `${relative}/${name}` : name);
    } else if (info.isFile()) {
      entries[relative] = { type: 'file', sha256: await sha256File(absolute), ...common };
    } else if (info.isSymbolicLink()) {
      const target = await readlink(absolute);
      entries[relative] = { type: 'symlink', target, sha256: crypto.createHash('sha256').update(target).digest('hex'), ...common };
    } else {
      entries[relative] = { type: 'other', ...common };
    }
  }
  await visit(root, '');
  return entries;
}

function compareSnapshots(before, after) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const comparable = (entry) => entry?.type === 'directory' ? { ...entry, mtimeNs: undefined } : entry;
  const changed = names.filter((name) => JSON.stringify(comparable(before[name])) !== JSON.stringify(comparable(after[name])));
  return {
    identical: changed.length === 0,
    directoryMtimesIgnored: true,
    entryCountBefore: Object.keys(before).length,
    entryCountAfter: Object.keys(after).length,
    changed,
  };
}

async function tarEvidence(tarball, work) {
  const listed = await command('/usr/bin/tar', ['-tzf', tarball]);
  if (listed.code !== 0) throw new Error(`tar inventory failed: ${listed.stderr}`);
  const inventory = listed.stdout.trim().split('\n').filter(Boolean).sort();
  if (inventory.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) throw new Error('tar inventory contains unsafe paths');
  const extraction = join(work, 'packed');
  await mkdir(extraction);
  const unpacked = await command('/usr/bin/tar', ['-xzf', tarball, '-C', extraction]);
  if (unpacked.code !== 0) throw new Error(`tar extraction failed: ${unpacked.stderr}`);
  const product = join(extraction, 'package', 'ship', '50-art');
  const paths = {
    manifest: join(product, 'manifest.json'), license: join(product, 'license.json'), provenance: join(product, 'provenance.json'),
  };
  const [manifest, license, provenance] = await Promise.all(Object.values(paths).map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const hashes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await sha256File(path)])));
  if (manifest.assets?.length !== 60 || license.assetCount !== 60 || provenance.assets?.length !== 60) throw new Error('packed custody records do not cover exactly 60 assets');
  return { sha256: await sha256File(tarball), inventoryCount: inventory.length, inventory, custody: { counts: { manifest: manifest.assets.length, license: license.assetCount, provenance: provenance.assets.length }, hashes } };
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  return port;
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((done, reject) => { this.ws.addEventListener('open', done, { once: true }); this.ws.addEventListener('error', reject, { once: true }); });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`)); else pending.resolve(message.result);
    });
    return this;
  }
  call(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((done, reject) => { this.pending.set(id, { resolve: done, reject, method }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  }
  close() { this.ws.close(); }
}

async function prelaunchChrome(profile) {
  const port = await freePort();
  const child = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let version;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) { version = await response.json(); break; } } catch {}
    await sleep(25);
  }
  if (!version?.webSocketDebuggerUrl) { child.kill('SIGTERM'); throw new Error('prelaunched Chrome did not expose CDP'); }
  return { child, cdp: await new Cdp(version.webSocketDebuggerUrl).open(), product: version.Browser };
}

async function stopChrome(browser) {
  await Promise.race([browser.cdp.call('Browser.close').catch(() => {}), sleep(1000)]);
  if (browser.child.exitCode === null) browser.child.kill('SIGTERM');
  await Promise.race([new Promise((done) => browser.child.once('exit', done)), sleep(2000)]);
  browser.cdp.close();
}

async function firstMovement(browser, url, t0) {
  const { targetId } = await browser.cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.cdp.call('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params = {}) => browser.cdp.call(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const q={player:null}; Object.defineProperty(window,'__p6',{value:q}); const draw=CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(String(image?.currentSrc||image?.src).includes('player--default.png')&&args.length>=8)q.player={x:args[4],y:args[5]};return draw.call(this,image,...args)} })()` });
  await call('Page.navigate', { url }); await call('Page.bringToFront');
  let initial;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await call('Runtime.evaluate', { expression: `({ready:document.querySelector('#game-status')?.textContent.includes('遊べます'),player:window.__p6?.player,error:document.querySelector('#game-error')?.textContent||''})`, returnByValue: true });
    if (result.result.value?.error) throw new Error(`packed browser failed: ${result.result.value.error}`);
    if (result.result.value?.ready && result.result.value.player) { initial = result.result.value.player; break; }
    await sleep(20);
  }
  if (!initial) throw new Error('packed browser did not become playable');
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await sleep(180);
  let moved;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await call('Runtime.evaluate', { expression: 'window.__p6.player', returnByValue: true });
    const player = result.result.value;
    if (player && (player.x !== initial.x || player.y !== initial.y)) { moved = player; break; }
    await sleep(10);
  }
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  if (!moved) throw new Error('real held-arrow input did not move the packed runtime');
  const t1 = performance.now();
  const elapsedMs = t1 - t0;
  if (elapsedMs >= 3000) throw new Error(`first real movement exceeded 3000ms: ${elapsedMs}`);
  await browser.cdp.call('Target.closeTarget', { targetId });
  return { t0, t1, elapsedMs, initial, moved };
}

function startNpx({ tarball, repo, port, cwd, cache }) {
  const packageSpec = `file:${tarball}`;
  const child = spawn('npx', ['--offline', '--yes', `--package=${packageSpec}`, '--', 'codecity', repo, '--no-open', '--port', String(port)], {
    cwd, env: { ...process.env, npm_config_cache: cache, npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' },
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { child, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { record.stdout += chunk; }); child.stderr.on('data', (chunk) => { record.stderr += chunk; });
  record.nettop = startNettopCapture(child.pid);
  return record;
}

function startNettopCapture(pid) {
  const record = { stopped: false, samples: [], startedAt: Date.now() };
  record.task = (async () => {
    while (!record.stopped) {
      const observedAt = Date.now();
      const sample = await command('/usr/bin/nettop', ['-n', '-x', '-d', '-L', '1', '-s', '1', '-p', String(pid)]);
      record.samples.push({ observedAt, ...sample });
      await sleep(Date.now() - record.startedAt < 5000 ? 100 : 1000);
    }
  })();
  return record;
}

async function stopNettopCapture(record) {
  record.stopped = true;
  await record.task;
  const successful = record.samples.filter((sample) => sample.code === 0 && sample.stdout.startsWith('time,'));
  const dataRowCount = successful.reduce((count, sample) => count + Math.max(0, sample.stdout.trim().split('\n').length - 1), 0);
  return {
    status: successful.length > 0 ? 'observed' : 'blocked',
    sampleCount: record.samples.length,
    successfulSampleCount: successful.length,
    dataRowCount,
    samples: record.samples,
  };
}

async function waitForUrl(processRecord, port) {
  const expected = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (processRecord.child.exitCode !== null) throw new Error(`packed npx exited ${processRecord.child.exitCode}: ${processRecord.stderr.slice(-2000)}`);
    const match = processRecord.stdout.match(/http:\/\/127\.0\.0\.1:\d+/u);
    if (match) {
      if (match[0] !== expected) throw new Error(`CLI announced unexpected origin ${match[0]}`);
      return `${expected}/index.html`;
    }
    await sleep(25);
  }
  throw new Error(`packed npx did not announce loopback URL: ${processRecord.stderr.slice(-2000)}`);
}

async function stopProcess(record) {
  const isRunning = () => record.child.exitCode === null && record.child.signalCode === null;
  if (isRunning()) {
    try { process.kill(-record.child.pid, 'SIGINT'); } catch {}
  }
  if (isRunning()) await Promise.race([new Promise((done) => record.child.once('exit', done)), sleep(5000)]);
  if (isRunning()) throw new Error('packed npx did not stop after SIGINT');
  const networkCapture = await stopNettopCapture(record.nettop);
  return { pid: record.child.pid, exitCode: record.child.exitCode, signal: record.child.signalCode, stdoutTail: record.stdout.slice(-4000), stderrTail: record.stderr.slice(-4000), networkCapture };
}

async function socketEvidence(pid, port) {
  const lsof = await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN']);
  const loopbackOnly = lsof.code === 0 && lsof.stdout.includes(`127.0.0.1:${port}`) && !lsof.stdout.includes(`*:${port}`);
  const serverPid = Number(lsof.stdout.match(/^\S+\s+(\d+)\s+/mu)?.[1]);
  const nettop = await command('/usr/bin/nettop', ['-n', '-x', '-d', '-L', '1', '-s', '1', '-p', String(serverPid || pid)]);
  return {
    processPid: pid,
    serverPid: Number.isInteger(serverPid) ? serverPid : null,
    lsof: { code: lsof.code, stdout: lsof.stdout, stderr: lsof.stderr, loopbackOnly },
    nettop: nettop.code === 0 ? { status: 'observed', stdout: nettop.stdout, stderr: nettop.stderr } : { status: 'blocked', code: nettop.code, reason: nettop.stderr || 'nettop returned no evidence' },
  };
}

async function runHarness(stage, profile, url) {
  const result = await command(process.execPath, [HARNESS_70, '--stage', stage, '--viewport', 'narrow', '--profile', profile, '--url', url, '--performance-ms', '1000'], { cwd: tmpdir() });
  if (result.code !== 0) throw new Error(`browser ${stage} failed: ${result.stdout.slice(-4000)} ${result.stderr.slice(-2000)}`);
  const parsed = JSON.parse(result.stdout);
  if (!parsed.ok) throw new Error(`browser ${stage} reported failure`);
  return parsed;
}

async function main() {
  const options = args(process.argv.slice(2));
  const tarStat = await stat(options.tarball);
  const repoStat = await stat(options.repo);
  if (!tarStat.isFile() || !repoStat.isDirectory()) throw new Error('tarball must be a file and repo must be a directory');
  const work = await mkdtemp(join(tmpdir(), 'codecity-packed-kgi-'));
  const evidencePath = options.evidence ?? join(work, 'evidence.json');
  if (!evidencePath.startsWith(`${tmpdir()}/`)) throw new Error('evidence must be written outside the repository under the system temp directory');
  await mkdir(dirname(evidencePath), { recursive: true });
  const cache = join(work, 'npm-cache');
  const probeProfile = join(work, 'probe-profile');
  const profile = join(work, 'chrome-profile');
  const cwd = join(work, 'cwd');
  await Promise.all([mkdir(cache), mkdir(probeProfile), mkdir(profile), mkdir(cwd)]);
  const evidence = { format: 'codecity.packed-kgi-evidence', schemaVersion: 1, ok: false, work, inputs: options };
  let first = null; let second = null; let browser = null;
  try {
    evidence.tarball = await tarEvidence(options.tarball, work);
    evidence.repositoryBefore = await snapshotRepository(options.repo);
    browser = await prelaunchChrome(probeProfile);
    evidence.chrome = browser.product;
    const t0 = performance.now();
    first = startNpx({ ...options, cwd, cache });
    const url = await waitForUrl(first, options.port);
    evidence.acquisition = { command: ['npx', '--offline', '--yes', `--package=file:${options.tarball}`, '--', 'codecity', options.repo, '--no-open', '--port', String(options.port)], cwd, cache, pid: first.child.pid, url };
    evidence.firstMovement = await firstMovement(browser, url, t0);
    await stopChrome(browser); browser = null;
    evidence.socketsFirst = await socketEvidence(first.child.pid, options.port);
    if (!evidence.socketsFirst.lsof.loopbackOnly) throw new Error('listener was not proven loopback-only');
    evidence.journey = await runHarness('journey', profile, url);
    evidence.firstProcess = await stopProcess(first); first = null;
    try { await fetch(url); throw new Error('listener remained reachable after SIGINT'); } catch (error) { if (error.message === 'listener remained reachable after SIGINT') throw error; }
    second = startNpx({ ...options, cwd, cache });
    const restartUrl = await waitForUrl(second, options.port);
    evidence.socketsRestart = await socketEvidence(second.child.pid, options.port);
    if (!evidence.socketsRestart.lsof.loopbackOnly) throw new Error('restart listener was not proven loopback-only');
    evidence.revisit = await runHarness('revisit', profile, restartUrl);
    evidence.secondProcess = await stopProcess(second); second = null;
    evidence.repositoryAfter = await snapshotRepository(options.repo);
    evidence.repositoryIntegrity = compareSnapshots(evidence.repositoryBefore, evidence.repositoryAfter);
    if (!evidence.repositoryIntegrity.identical) throw new Error(`inspected repository changed: ${evidence.repositoryIntegrity.changed.join(', ')}`);
    evidence.ok = true;
  } catch (error) {
    evidence.error = { message: String(error?.message ?? error), stack: String(error?.stack ?? '') };
    throw error;
  } finally {
    if (browser) await stopChrome(browser).catch(() => {});
    if (first) evidence.firstProcessCleanup = await stopProcess(first).catch((error) => ({ error: String(error.message) }));
    if (second) evidence.secondProcessCleanup = await stopProcess(second).catch((error) => ({ error: String(error.message) }));
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ok: evidence.ok, evidencePath, error: evidence.error?.message ?? null })}\n`);
  }
}

main().catch(() => { process.exitCode = 1; });
