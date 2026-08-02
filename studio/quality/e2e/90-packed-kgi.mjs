#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HARNESS_70 = resolve(dirname(fileURLToPath(import.meta.url)), '70-browser-journey.mjs');
const PRODUCT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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

async function expectedPackedInventory() {
  const packageJson = JSON.parse(await readFile(join(PRODUCT_ROOT, 'package.json'), 'utf8'));
  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) throw new Error('package.json files allowlist is missing');
  const expected = new Set(['package/package.json']);
  async function add(absolute, relative) {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`package.json files allowlist resolves through a symlink: ${relative}`);
    if (info.isFile()) { expected.add(`package/${relative}`); return; }
    if (!info.isDirectory()) throw new Error(`package.json files allowlist contains a non-file: ${relative}`);
    const names = await readdir(absolute); names.sort();
    for (const name of names) await add(join(absolute, name), `${relative.replace(/\/$/u, '')}/${name}`);
  }
  for (const entry of packageJson.files) {
    const normalized = typeof entry === 'string' ? entry.replace(/\/$/u, '') : '';
    if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '.' || part === '..')) throw new Error(`unsafe package.json files entry: ${entry}`);
    await add(join(PRODUCT_ROOT, normalized), normalized);
  }
  return [...expected].sort();
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
  if (license.appliesToManifestVersion !== manifest.manifestVersion) throw new Error('packed license does not apply to the packed manifest version');
  const manifestCustody = manifest.assets.map((asset) => ({
    id: asset.id,
    assetSha256: asset.sha256,
    source: asset.provenance?.source,
    sourceSha256: asset.provenance?.sourceSha256,
    kind: asset.provenance?.kind,
    custody: asset.provenance?.custody,
    evidence: asset.provenance?.evidence,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const provenanceCustody = provenance.assets.map((asset) => ({
    id: asset.id,
    assetSha256: asset.assetSha256,
    source: asset.source,
    sourceSha256: asset.sourceSha256,
    kind: asset.kind,
    custody: asset.custody,
    evidence: asset.evidence,
  })).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(manifestCustody.map(({ id }) => id)).size !== manifest.assets.length
    || new Set(provenanceCustody.map(({ id }) => id)).size !== provenance.assets.length
    || JSON.stringify(manifestCustody) !== JSON.stringify(provenanceCustody)) {
    throw new Error('packed provenance does not exactly match manifest asset identity, asset hash, source hash, and custody fields');
  }
  if (manifest.assets.some((asset) => asset.license?.name !== license.name || asset.license?.holder !== license.holder)) {
    throw new Error('packed license does not exactly cover every manifest asset license field');
  }
  for (const asset of manifest.assets) {
    if (typeof asset.path !== 'string' || !/^[a-z0-9][a-z0-9_-]*\.png$/u.test(asset.path)) throw new Error(`packed manifest contains an unsafe asset path: ${asset.path}`);
    const packedPath = `package/ship/50-art/assets/${asset.path}`;
    if (await sha256File(join(extraction, packedPath)) !== asset.sha256) throw new Error(`packed asset hash mismatch: ${asset.path}`);
  }
  const expectedInventory = await expectedPackedInventory();
  if (new Set(expectedInventory).size !== expectedInventory.length || JSON.stringify(inventory) !== JSON.stringify(expectedInventory)) {
    const expected = new Set(expectedInventory); const actual = new Set(inventory);
    throw new Error(`tar inventory differs from exact allowlist; extra=${inventory.filter((entry) => !expected.has(entry)).join(',')}; missing=${expectedInventory.filter((entry) => !actual.has(entry)).join(',')}`);
  }
  const trustedInventory = {};
  for (const entry of expectedInventory) {
    const relative = entry.slice('package/'.length);
    const workspacePath = join(PRODUCT_ROOT, relative);
    const packedPath = join(extraction, entry);
    const [workspaceStat, packedStat] = await Promise.all([lstat(workspacePath), lstat(packedPath)]);
    if (workspaceStat.isSymbolicLink() || packedStat.isSymbolicLink() || !workspaceStat.isFile() || !packedStat.isFile()) {
      throw new Error(`trusted inventory entry is not a regular file: ${entry}`);
    }
    const [workspaceSha256, packedSha256] = await Promise.all([sha256File(workspacePath), sha256File(packedPath)]);
    if (workspaceSha256 !== packedSha256) throw new Error(`packed entry does not match trusted workspace bytes: ${entry}`);
    trustedInventory[entry] = workspaceSha256;
  }

  const anchorPaths = {
    approvedManifest: join(PRODUCT_ROOT, 'studio/art-department/v1/approved/manifest.json'),
    approvalRecord: join(PRODUCT_ROOT, 'studio/art-department/v1/approvals/h1-v1.json'),
    candidateBatch: join(PRODUCT_ROOT, 'studio/art-department/v1/candidates/index.json'),
    sceneBindings: join(PRODUCT_ROOT, 'ship/50-art/scene-bindings.json'),
  };
  const anchorEntries = await Promise.all(Object.entries(anchorPaths).map(async ([name, path]) => {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`owner anchor is not a regular file: ${name}`);
    return [name, { value: JSON.parse(await readFile(path, 'utf8')), sha256: await sha256File(path) }];
  }));
  const anchors = Object.fromEntries(anchorEntries);
  const approvedManifest = anchors.approvedManifest.value;
  const approvalRecord = anchors.approvalRecord.value;
  const candidateBatch = anchors.candidateBatch.value;
  const sceneBindings = anchors.sceneBindings.value;
  if (anchors.approvalRecord.sha256 !== approvedManifest.approvalRecordSha256
    || anchors.approvalRecord.sha256 !== provenance.approvalRecordSha256
    || anchors.candidateBatch.sha256 !== approvedManifest.candidateBatchSha256
    || anchors.candidateBatch.sha256 !== provenance.candidateBatchSha256
    || anchors.candidateBatch.sha256 !== approvalRecord.candidateBatch?.sha256) {
    throw new Error('owner anchor root hashes do not match approved, packed, and H1 records');
  }
  if (approvalRecord.decision !== 'accepted-for-functional-v1'
    || approvalRecord.approvedBy !== 'human-owner'
    || approvalRecord.actorType !== 'human'
    || approvalRecord.authority !== 'owner'
    || approvalRecord.candidateBatch?.path !== 'studio/art-department/v1/candidates/index.json'
    || approvalRecord.candidateBatch?.selectorCount !== 60) {
    throw new Error('H1 owner anchor is not an accepted human-owner functional-v1 decision');
  }
  const selectors = Object.keys(sceneBindings.selectors ?? {}).sort();
  const approvedAssets = approvedManifest.assets ?? [];
  const approvalRecords = approvalRecord.records ?? [];
  const candidateEntries = candidateBatch.entries ?? [];
  if (selectors.length !== 60 || approvedAssets.length !== 60 || approvalRecords.length !== 60 || candidateEntries.length !== 60) {
    throw new Error('owner anchors and scene bindings do not cover exactly 60 selectors');
  }
  const packedById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
  const approvedBySelector = new Map(approvedAssets.map((asset) => [asset.selector, asset]));
  const approvalBySelector = new Map(approvalRecords.map((record) => [record.selector, record]));
  const candidateBySelector = new Map(candidateEntries.map((entry) => [entry.selector, entry]));
  if (packedById.size !== 60 || approvedBySelector.size !== 60 || approvalBySelector.size !== 60 || candidateBySelector.size !== 60
    || JSON.stringify(selectors) !== JSON.stringify([...approvedBySelector.keys()].sort())
    || JSON.stringify(selectors) !== JSON.stringify([...approvalBySelector.keys()].sort())
    || JSON.stringify(selectors) !== JSON.stringify([...candidateBySelector.keys()].sort())) {
    throw new Error('owner anchors contain duplicate or mismatched selector identities');
  }
  for (const selector of selectors) {
    const packedAsset = packedById.get(sceneBindings.selectors[selector]);
    const approvedAsset = approvedBySelector.get(selector);
    const approvedRecord = approvalBySelector.get(selector);
    const candidate = candidateBySelector.get(selector);
    if (!packedAsset || !approvedAsset || !approvedRecord || !candidate
      || approvedAsset.path !== `assets/${packedAsset.path}`
      || approvedAsset.sha256 !== packedAsset.sha256
      || approvedAsset.sha256 !== approvedRecord.candidateSha256
      || approvedAsset.sha256 !== candidate.candidateSha256
      || approvedAsset.approvalRecordId !== approvedRecord.recordId
      || packedAsset.approval?.recordId !== approvedRecord.recordId
      || packedAsset.approval?.assetId !== packedAsset.id
      || packedAsset.approval?.assetSha256 !== packedAsset.sha256
      || packedAsset.approval?.sourceSha256 !== packedAsset.provenance?.sourceSha256
      || packedAsset.approval?.decision !== 'accepted'
      || packedAsset.approval?.approvedBy !== 'human-owner'
      || packedAsset.approval?.actorType !== 'human'
      || packedAsset.approval?.authority !== 'owner'
      || approvedRecord.decision !== 'accepted'
      || approvedRecord.source !== packedAsset.provenance?.source
      || approvedRecord.sourceSha256 !== packedAsset.provenance?.sourceSha256) {
      throw new Error(`packed asset does not match approved human-owner anchor: ${selector}`);
    }
  }
  const anchorHashes = Object.fromEntries(anchorEntries.map(([name, entry]) => [name, entry.sha256]));
  return {
    sha256: await sha256File(tarball), inventoryCount: inventory.length, inventory, exactAllowlistMatched: true,
    trustedInventoryHashesMatched: true, trustedInventory: { hashCount: Object.keys(trustedInventory).length, sha256ByEntry: trustedInventory },
    approvedMasterHashesMatched: true, anchorHashes,
    custody: { counts: { manifest: manifest.assets.length, license: license.assetCount, provenance: provenance.assets.length }, hashes, packedAssetHashesMatched: true },
  };
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

async function prepareCliBrowser(work, profile) {
  const port = await freePort();
  const bin = join(work, `browser-opener-${port}`);
  const pidFile = join(work, `chrome-${port}.pid`);
  await mkdir(bin);
  const opener = join(bin, 'open');
  await writeFile(opener, `#!/usr/bin/env node\nimport { spawn } from 'node:child_process';\nimport { writeFile } from 'node:fs/promises';\nconst url = process.argv[2];\nif (!url || new URL(url).hostname !== '127.0.0.1') process.exit(64);\nconst child = spawn(process.env.CODECITY_KGI_CHROME, ['--headless=new', '--remote-debugging-port=' + process.env.CODECITY_KGI_DEBUG_PORT, '--user-data-dir=' + process.env.CODECITY_KGI_PROFILE, '--force-device-scale-factor=1', '--hide-scrollbars', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-extensions', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-service-autorun', '--password-store=basic', '--use-mock-keychain', '--no-first-run', '--no-default-browser-check', url], { detached: true, stdio: 'ignore' });\nawait writeFile(process.env.CODECITY_KGI_PID_FILE, String(child.pid));\nchild.unref();\n`, { mode: 0o700 });
  await chmod(opener, 0o700);
  return { port, cdpUrl: `http://127.0.0.1:${port}`, profile, pidFile, bin };
}

async function connectCliBrowser(launch) {
  let version;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { const response = await fetch(`${launch.cdpUrl}/json/version`); if (response.ok) { version = await response.json(); break; } } catch {}
    await sleep(25);
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('CLI-opened Chrome did not expose CDP');
  const pid = Number(await readFile(launch.pidFile, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('CLI browser opener did not record a valid Chrome pid');
  return { pid, cdp: await new Cdp(version.webSocketDebuggerUrl).open(), product: version.Browser, cdpUrl: launch.cdpUrl };
}

async function stopChrome(browser) {
  await Promise.race([browser.cdp.call('Browser.close').catch(() => {}), sleep(1000)]);
  try { process.kill(browser.pid, 0); process.kill(browser.pid, 'SIGTERM'); } catch {}
  browser.cdp.close();
}

async function firstMovement(browser, url, t0) {
  let targetId;
  const timing = {
    t0,
    targetFoundAt: null,
    readyObservedAt: null,
    firstPlayerDrawObservedAt: null,
    arrowDownSentAt: null,
    movementDetectedAt: null,
  };
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await fetch(`${browser.cdpUrl}/json/list`);
    if (response.ok) {
      const targets = await response.json();
      const matches = targets.filter((target) => target.type === 'page' && target.url === url);
      if (matches.length > 1) throw new Error('CLI opened more than one matching browser target');
      if (matches.length === 1) {
        const at = performance.now();
        targetId = matches[0].id;
        timing.targetFoundAt = { at, elapsedMs: at - t0 };
        break;
      }
    }
    await sleep(25);
  }
  if (!targetId) throw new Error(`CLI-opened browser target was not found: ${JSON.stringify(timing)}`);
  const { sessionId } = await browser.cdp.call('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params = {}) => browser.cdp.call(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable');
  await call('Runtime.evaluate', { expression: `(() => { if (window.__p6) return; const q={player:null}; Object.defineProperty(window,'__p6',{value:q}); const draw=CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(String(image?.currentSrc||image?.src).includes('player--default.png')&&args.length>=8)q.player={x:args[4],y:args[5]};return draw.call(this,image,...args)} })()` });
  await call('Page.bringToFront');
  let initial;
  let lastSnapshot = null;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await call('Runtime.evaluate', { expression: `({ready:document.querySelector('#game-status')?.textContent.includes('遊べます'),player:window.__p6?.player,error:document.querySelector('#game-error')?.textContent||''})`, returnByValue: true });
    lastSnapshot = result.result.value;
    const observedAt = performance.now();
    if (lastSnapshot?.ready && timing.readyObservedAt === null) timing.readyObservedAt = { at: observedAt, elapsedMs: observedAt - t0 };
    if (lastSnapshot?.player && timing.firstPlayerDrawObservedAt === null) timing.firstPlayerDrawObservedAt = { at: observedAt, elapsedMs: observedAt - t0 };
    if (lastSnapshot?.error) throw new Error(`packed browser failed: ${lastSnapshot.error}; timing=${JSON.stringify(timing)}`);
    if (lastSnapshot?.ready && lastSnapshot.player) { initial = lastSnapshot.player; break; }
    await sleep(20);
  }
  if (!initial) throw new Error(`packed browser did not become playable: snapshot=${JSON.stringify(lastSnapshot)}; timing=${JSON.stringify(timing)}`);
  const arrowDownAt = performance.now();
  timing.arrowDownSentAt = { at: arrowDownAt, elapsedMs: arrowDownAt - t0 };
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  let moved;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await call('Runtime.evaluate', { expression: 'window.__p6.player', returnByValue: true });
    const player = result.result.value;
    if (player && (player.x !== initial.x || player.y !== initial.y)) {
      const at = performance.now();
      moved = player;
      timing.movementDetectedAt = { at, elapsedMs: at - t0 };
      break;
    }
    await sleep(10);
  }
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  if (!moved) throw new Error(`real held-arrow input did not move the packed runtime: timing=${JSON.stringify(timing)}`);
  const t1 = performance.now();
  const elapsedMs = t1 - t0;
  if (elapsedMs >= 3000) throw new Error(`first real movement exceeded 3000ms: ${elapsedMs}; timing=${JSON.stringify(timing)}`);
  await browser.cdp.call('Target.detachFromTarget', { sessionId });
  return { t0, t1, elapsedMs, timing, targetId, cliOpenedTarget: true, initial, moved };
}

function startNpx({ tarball, repo, port, cwd, cache, browserLaunch }) {
  const packageSpec = `file:${tarball}`;
  const child = spawn('npx', ['--offline', '--yes', `--package=${packageSpec}`, '--', 'codecity', repo, '--port', String(port)], {
    cwd, env: { ...process.env, PATH: `${browserLaunch.bin}:${process.env.PATH}`, CODECITY_KGI_CHROME: CHROME, CODECITY_KGI_DEBUG_PORT: String(browserLaunch.port), CODECITY_KGI_PROFILE: browserLaunch.profile, CODECITY_KGI_PID_FILE: browserLaunch.pidFile, npm_config_cache: cache, npm_config_offline: 'true', npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false' },
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
      const family = await processFamilyPids(pid);
      const sample = family.length === 0
        ? { code: 1, signal: null, stdout: '', stderr: 'process family was not observable' }
        : await command('/usr/bin/nice', ['-n', '10', '/usr/bin/nettop', '-n', '-x', '-d', '-L', '1', '-s', '1', ...family.flatMap((familyPid) => ['-p', String(familyPid)])]);
      record.samples.push({ observedAt, family, ...sample });
      await sleep(Date.now() - record.startedAt < 5000 ? 100 : 1000);
    }
  })();
  return record;
}

async function processFamilyPids(rootPid) {
  const listed = await command('/bin/ps', ['-Ao', 'pid=,ppid=']);
  if (listed.code !== 0) return [];
  const children = new Map();
  const observedPids = new Set();
  for (const line of listed.stdout.trim().split('\n')) {
    const [childPid, parentPid] = line.trim().split(/\s+/u).map(Number);
    if (!Number.isInteger(childPid) || !Number.isInteger(parentPid)) continue;
    observedPids.add(childPid);
    const values = children.get(parentPid) ?? [];
    values.push(childPid);
    children.set(parentPid, values);
  }
  if (!observedPids.has(rootPid)) return [];
  const family = [];
  const pending = [rootPid];
  while (pending.length > 0) {
    const current = pending.shift();
    family.push(current);
    pending.push(...(children.get(current) ?? []));
  }
  return family;
}

function connectionRows(stdout) {
  return stdout.trim().split('\n').slice(1).map((line) => {
    const columns = line.split(',');
    return { line, socket: columns[1] ?? '', interface: columns[2] ?? '' };
  }).filter(({ socket }) => socket.includes('<->'));
}

function networkSummary(samples) {
  const successful = samples.filter((sample) => sample.code === 0 && sample.stdout.startsWith('time,'));
  const rows = successful.flatMap((sample) => connectionRows(sample.stdout));
  const violations = rows.filter(({ socket, interface: networkInterface }) => networkInterface !== 'lo0' || !/^tcp4 127\.0\.0\.1:\d+<->(?:127\.0\.0\.1:\d+|\*:\*)$/u.test(socket));
  const failedSamples = samples.filter((sample) => sample.family.length === 0 || sample.code !== 0 || !sample.stdout.startsWith('time,'));
  const fullyObserved = samples.length > 0 && failedSamples.length === 0 && successful.length === samples.length;
  return { status: fullyObserved ? 'observed' : 'blocked', sampleCount: samples.length, successfulSampleCount: successful.length, failedSampleCount: failedSamples.length, connectionRowCount: rows.length, loopbackOnly: fullyObserved && violations.length === 0, violations, failedSamples, samples };
}

function assertNetworkCapture(capture, label) {
  if (capture.status !== 'observed' || capture.sampleCount === 0 || capture.successfulSampleCount !== capture.sampleCount || capture.failedSampleCount !== 0) throw new Error(`${label} network capture was blocked or incomplete`);
  if (!capture.loopbackOnly) throw new Error(`${label} network capture found non-loopback traffic: ${capture.violations.map(({ line }) => line).join(' | ')}`);
}

async function stopNettopCapture(record) {
  record.stopped = true;
  await record.task;
  return networkSummary(record.samples);
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
  const serverNetworkCapture = record.serverNettop ? await stopNettopCapture(record.serverNettop) : null;
  if (isRunning()) {
    try { process.kill(-record.child.pid, 'SIGINT'); } catch {}
  }
  if (isRunning()) await Promise.race([new Promise((done) => record.child.once('exit', done)), sleep(5000)]);
  if (isRunning()) throw new Error('packed npx did not stop after SIGINT');
  const networkCapture = await stopNettopCapture(record.nettop);
  return { pid: record.child.pid, exitCode: record.child.exitCode, signal: record.child.signalCode, stdoutTail: record.stdout.slice(-4000), stderrTail: record.stderr.slice(-4000), networkCapture, serverNetworkCapture };
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

async function runHarness(stage, browser, url) {
  const result = await command(process.execPath, [HARNESS_70, '--stage', stage, '--viewport', 'narrow', '--cdp-url', browser.cdpUrl, '--url', url, '--performance-ms', '1000'], { cwd: tmpdir() });
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
  const profile = join(work, 'chrome-profile');
  const cwd = join(work, 'cwd');
  await Promise.all([mkdir(cache), mkdir(profile), mkdir(cwd)]);
  const evidence = {
    format: 'codecity.packed-kgi-evidence', schemaVersion: 1, ok: false, work, inputs: options,
    limitations: [
      'This is one two-entry small-repository fixture run; it does not generalize to empty, representative, arbitrary, or every repository.',
      'The journey uses the CLI-opened Chrome process but separate page targets after the first-movement proof.',
      'Browser request evidence covers the instrumented page targets; it does not observe every Chrome background-process socket and cannot prove absence of all browser background communication.',
    ],
  };
  let first = null; let second = null; let browser = null;
  try {
    evidence.tarball = await tarEvidence(options.tarball, work);
    evidence.repositoryBefore = await snapshotRepository(options.repo);
    const firstBrowserLaunch = await prepareCliBrowser(work, profile);
    const t0 = performance.now();
    evidence.startupTiming = { t0, npxSpawnedAt: null, urlAnnouncedAt: null, cdpConnectedAt: null };
    first = startNpx({ ...options, cwd, cache, browserLaunch: firstBrowserLaunch });
    { const at = performance.now(); evidence.startupTiming.npxSpawnedAt = { at, elapsedMs: at - t0 }; }
    const url = await waitForUrl(first, options.port);
    { const at = performance.now(); evidence.startupTiming.urlAnnouncedAt = { at, elapsedMs: at - t0 }; }
    browser = await connectCliBrowser(firstBrowserLaunch);
    { const at = performance.now(); evidence.startupTiming.cdpConnectedAt = { at, elapsedMs: at - t0 }; }
    evidence.chrome = browser.product;
    evidence.acquisition = { command: ['npx', '--offline', '--yes', `--package=file:${options.tarball}`, '--', 'codecity', options.repo, '--port', String(options.port)], cwd, cache, pid: first.child.pid, url, browserOpenedByCli: true, prelaunchedBrowser: false };
    evidence.firstMovement = await firstMovement(browser, url, t0);
    evidence.socketsFirst = await socketEvidence(first.child.pid, options.port);
    if (!evidence.socketsFirst.lsof.loopbackOnly) throw new Error('listener was not proven loopback-only');
    if (!evidence.socketsFirst.serverPid) throw new Error('listener process was not identified');
    first.serverNettop = startNettopCapture(evidence.socketsFirst.serverPid);
    evidence.journey = await runHarness('journey', browser, url);
    await stopChrome(browser); browser = null;
    evidence.firstProcess = await stopProcess(first); first = null;
    assertNetworkCapture(evidence.firstProcess.networkCapture, 'first npx');
    assertNetworkCapture(evidence.firstProcess.serverNetworkCapture, 'first server');
    try { await fetch(url); throw new Error('listener remained reachable after SIGINT'); } catch (error) { if (error.message === 'listener remained reachable after SIGINT') throw error; }
    const secondBrowserLaunch = await prepareCliBrowser(work, profile);
    second = startNpx({ ...options, cwd, cache, browserLaunch: secondBrowserLaunch });
    const restartUrl = await waitForUrl(second, options.port);
    browser = await connectCliBrowser(secondBrowserLaunch);
    evidence.socketsRestart = await socketEvidence(second.child.pid, options.port);
    if (!evidence.socketsRestart.lsof.loopbackOnly) throw new Error('restart listener was not proven loopback-only');
    if (!evidence.socketsRestart.serverPid) throw new Error('restart listener process was not identified');
    second.serverNettop = startNettopCapture(evidence.socketsRestart.serverPid);
    evidence.revisit = await runHarness('revisit', browser, restartUrl);
    await stopChrome(browser); browser = null;
    evidence.secondProcess = await stopProcess(second); second = null;
    assertNetworkCapture(evidence.secondProcess.networkCapture, 'restart npx');
    assertNetworkCapture(evidence.secondProcess.serverNetworkCapture, 'restart server');
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
