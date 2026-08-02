#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_URL = 'http://127.0.0.1:4173/index.html';
const VIEWPORT = Object.freeze({ width: 320, height: 568, deviceScaleFactor: 1, mobile: false });
const KEY = Object.freeze({
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
});

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function parseArgs(argv) {
  const result = { stage: 'all', viewport: 'narrow', url: DEFAULT_URL, profile: null, performanceMs: 60_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--stage') result.stage = argv[++index];
    else if (value === '--viewport') result.viewport = argv[++index];
    else if (value === '--url') result.url = argv[++index];
    else if (value === '--profile') result.profile = resolve(argv[++index]);
    else if (value === '--performance-ms') result.performanceMs = Number(argv[++index]);
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!['all', 'journey', 'revisit'].includes(result.stage)) throw new Error('--stage must be all, journey, or revisit');
  if (!['narrow', 'default'].includes(result.viewport)) throw new Error('--viewport must be narrow or default');
  if (!Number.isFinite(result.performanceMs) || result.performanceMs < 1_000) throw new Error('--performance-ms must be at least 1000');
  if (result.stage !== 'all' && !result.profile) throw new Error('--profile is required for externally staged journey or revisit runs');
  return result;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolvePromise));
  const { port } = server.address();
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

class Cdp {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolvePromise, reject) => {
      this.socket.addEventListener('open', resolvePromise, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
    return this;
  }

  call(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() { this.socket.close(); }
}

async function launchChrome(profile) {
  await mkdir(profile, { recursive: true });
  const port = await freePort();
  const child = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--force-device-scale-factor=1', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 10_000;
  let version;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited during launch: ${stderr.slice(-1000)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) { version = await response.json(); break; }
    } catch { /* Chrome has not opened the loopback debugger yet. */ }
    await sleep(50);
  }
  if (!version?.webSocketDebuggerUrl) {
    child.kill('SIGTERM');
    throw new Error(`Chrome DevTools endpoint did not start: ${stderr.slice(-1000)}`);
  }
  const cdp = await new Cdp(version.webSocketDebuggerUrl).open();
  return { child, cdp, product: version.Browser };
}

async function stopChrome(browser) {
  await Promise.race([
    browser.cdp.call('Browser.close').catch(() => {}),
    sleep(1_000),
  ]);
  if (browser.child.exitCode === null) browser.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => browser.child.once('exit', resolvePromise)),
    sleep(3_000).then(() => browser.child.kill('SIGTERM')),
  ]);
  browser.cdp.close();
}

const INSTRUMENTATION = `(() => {
  const evidence = { drawUrls: {}, lastDraw: {}, keys: [], errors: [] };
  Object.defineProperty(window, '__codecityQa', { value: evidence });
  const original = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
    const url = String(image?.currentSrc || image?.src || 'unknown');
    evidence.drawUrls[url] = (evidence.drawUrls[url] || 0) + 1;
    if (args.length >= 8) evidence.lastDraw[url] = { x: args[4], y: args[5], width: args[6], height: args[7] };
    return original.call(this, image, ...args);
  };
  addEventListener('error', event => evidence.errors.push(String(event.error?.message || event.message || 'error')));
  addEventListener('unhandledrejection', event => evidence.errors.push(String(event.reason?.message || event.reason || 'rejection')));
  addEventListener('keydown', event => evidence.keys.push({ type: 'down', code: event.code, key: event.key }));
  addEventListener('keyup', event => evidence.keys.push({ type: 'up', code: event.code, key: event.key }));
})();`;

async function openPage(browser, url, viewport = VIEWPORT) {
  const { targetId } = await browser.cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.cdp.call('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params = {}) => browser.cdp.call(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  if (viewport) await call('Emulation.setDeviceMetricsOverride', viewport);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENTATION });
  await call('Page.navigate', { url });
  await call('Page.bringToFront');
  return { targetId, sessionId, call };
}

async function evaluate(page, expression, { awaitPromise = false } = {}) {
  const result = await page.call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(page, expression, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(page, expression)) return;
    await sleep(50);
  }
  const snapshot = await evaluate(page, `({ status: document.querySelector('#game-status')?.textContent || '', ui: document.querySelector('#game-ui')?.textContent || '', error: document.querySelector('#game-error')?.textContent || '' })`);
  throw new Error(`timed out waiting for ${description}: ${JSON.stringify(snapshot)}`);
}

async function keyEvent(page, code, type) {
  const key = KEY[code];
  await page.call('Input.dispatchKeyEvent', {
    type, key: key.key, code: key.code,
    windowsVirtualKeyCode: key.keyCode,
  });
}

async function press(page, code) {
  await keyEvent(page, code, 'rawKeyDown');
  await keyEvent(page, code, 'keyUp');
  await sleep(90);
}

async function moveAxis(page, code, distance, speed) {
  if (distance <= 0.25) return;
  await keyEvent(page, code, 'rawKeyDown');
  // The first animation frame after keyDown already advances one frame. Remove
  // that frame from the wall-clock hold so short orthogonal route segments do
  // not accumulate a one-pixel overshoot at every corner.
  await sleep(Math.max(1, Math.round(distance / speed * 1000 - 17)));
  await keyEvent(page, code, 'keyUp');
  await sleep(34);
}

async function visualPlayerFoot(page, scene) {
  const calls = await evaluate(page, `({ ...window.__codecityQa.lastDraw })`);
  const byPath = new Map(Object.entries(calls).map(([url, draw]) => [new URL(url).pathname, draw]));
  const playerAsset = scene.assets.find((asset) => asset.selector === scene.game.player.assetSelector);
  const referenceRenderable = scene.game.renderables.find((entry) => entry.assetSelector.startsWith('building:'));
  const referenceAsset = scene.assets.find((asset) => asset.selector === referenceRenderable?.assetSelector);
  const playerDraw = playerAsset ? byPath.get(new URL(playerAsset.url, DEFAULT_URL).pathname) : null;
  const referenceDraw = referenceAsset ? byPath.get(new URL(referenceAsset.url, DEFAULT_URL).pathname) : null;
  if (!playerDraw || !referenceDraw || !referenceRenderable) throw new Error('could not observe player and reference building draw positions');
  const camera = { x: referenceRenderable.position.x - referenceDraw.x, y: referenceRenderable.position.y - referenceDraw.y };
  return {
    x: playerDraw.x + camera.x + scene.game.player.footbox.x,
    y: playerDraw.y + camera.y + scene.game.player.footbox.y,
  };
}

async function moveToPoint(page, scene, target, speed) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await visualPlayerFoot(page, scene);
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const moveX = async () => { if (Math.abs(dx) > 0.75) await moveAxis(page, dx > 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(dx), speed); };
    const moveY = async () => { if (Math.abs(dy) > 0.75) await moveAxis(page, dy > 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(dy), speed); };
    if (Math.abs(dy) > Math.abs(dx)) { await moveY(); await moveX(); }
    else { await moveX(); await moveY(); }
    const observed = await visualPlayerFoot(page, scene);
    if (Math.abs(target.x - observed.x) <= 1.5 && Math.abs(target.y - observed.y) <= 1.5) return observed;
  }
  const diagnostics = await evaluate(page, `({ keys: window.__codecityQa.keys.slice(-8), draws: { ...window.__codecityQa.drawUrls }, visibility: document.visibilityState, errors: [...window.__codecityQa.errors] })`);
  throw new Error(`could not reach route point ${JSON.stringify(target)}; observed ${JSON.stringify(await visualPlayerFoot(page, scene))}; diagnostics=${JSON.stringify(diagnostics)}`);
}

function collisionFree(scene, point) {
  const foot = { x: point.x, y: point.y, width: scene.game.player.footbox.width, height: scene.game.player.footbox.height };
  if (foot.x < 0 || foot.y < 0 || foot.x + foot.width > scene.game.worldSize.width || foot.y + foot.height > scene.game.worldSize.height) return false;
  return !scene.game.collisions.some((rect) => foot.x < rect.x + rect.width && foot.x + foot.width > rect.x && foot.y < rect.y + rect.height && foot.y + foot.height > rect.y);
}

function safeCorner(scene, point, next) {
  if (!next) return point;
  const vertical = next.x === point.x && next.y !== point.y;
  const horizontal = next.y === point.y && next.x !== point.x;
  if (!vertical && !horizontal) return point;
  // Two pixels leave one full pixel of safety after Canvas/world rounding.
  for (const offset of [-2, 2, -1, 1, 0]) {
    const candidate = vertical ? { x: point.x + offset, y: point.y } : { x: point.x, y: point.y + offset };
    const distance = vertical ? Math.abs(next.y - point.y) : Math.abs(next.x - point.x);
    let clear = true;
    for (let step = 0; step <= distance; step += 1) {
      const ratio = distance === 0 ? 0 : step / distance;
      const sample = vertical
        ? { x: candidate.x, y: point.y + (next.y - point.y) * ratio }
        : { x: point.x + (next.x - point.x) * ratio, y: candidate.y };
      if (!collisionFree(scene, sample)) { clear = false; break; }
    }
    if (clear) return candidate;
  }
  return point;
}

async function followRoute(page, scene, route, start, speed) {
  let current = { ...start };
  for (let index = 0; index < route.points.length; index += 1) {
    const point = safeCorner(scene, route.points[index], route.points[index + 1]);
    current = await moveToPoint(page, scene, point, speed);
  }
  return current;
}

async function confirmThree(page) {
  await press(page, 'Enter');
  await press(page, 'Enter');
  await press(page, 'Enter');
}

function category(asset) {
  if (asset.usage?.kind === 'character') return 'character';
  if (asset.usage?.kind === 'building') return 'building';
  if (['terrain', 'road', 'water'].includes(asset.usage?.kind)) return 'map';
  if (['prop', 'light', 'quest', 'effect'].includes(asset.usage?.kind)) return 'object';
  return null;
}

function drawnSelectors(scene, drawUrls) {
  const paths = new Set(Object.entries(drawUrls).filter(([, count]) => count > 0).map(([url]) => new URL(url).pathname));
  return scene.assets.filter((asset) => paths.has(new URL(asset.url, DEFAULT_URL).pathname)).map((asset) => asset.selector).sort();
}

async function pageEvidence(page, scene) {
  const observed = await evaluate(page, `(() => {
    const canvas = document.querySelector('#game-canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparent = 0, nonBlack = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] !== 0) nonTransparent += 1;
      if (pixels[index] || pixels[index + 1] || pixels[index + 2]) nonBlack += 1;
    }
    return {
      status: document.querySelector('#game-status')?.textContent || '',
      ui: document.querySelector('#game-ui')?.textContent || '',
      error: document.querySelector('#game-error')?.textContent || '',
      canvas: { width: canvas.width, height: canvas.height, nonTransparent, nonBlack, imageRendering: getComputedStyle(canvas).imageRendering },
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      drawUrls: { ...window.__codecityQa.drawUrls }, errors: [...window.__codecityQa.errors],
    };
  })()`);
  const selectors = drawnSelectors(scene, observed.drawUrls);
  const categories = Object.fromEntries(['character', 'building', 'map', 'object'].map((name) => [name, selectors.filter((selector) => category(scene.assets.find((asset) => asset.selector === selector)) === name)]));
  return { ...observed, drawnSelectors: selectors, categories };
}

async function measureRaf(page, milliseconds) {
  return evaluate(page, `new Promise(resolve => {
    const duration = ${JSON.stringify(milliseconds)};
    const intervals = [];
    let first = null, previous = null;
    const sample = now => {
      if (first === null) first = now;
      if (previous !== null) intervals.push(now - previous);
      previous = now;
      if (now - first < duration) requestAnimationFrame(sample);
      else {
        const sorted = intervals.slice().sort((a, b) => a - b);
        const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] || null;
        resolve({ requestedMs: duration, observedMs: now - first, frames: intervals.length, p95Ms: p95, over100ms: intervals.filter(value => value > 100).length, maxMs: Math.max(0, ...intervals) });
      }
    };
    requestAnimationFrame(sample);
  })`, { awaitPromise: true });
}

async function runJourney(browser, url, scene, performanceMs, viewport) {
  const page = await openPage(browser, url, viewport === 'narrow' ? VIEWPORT : null);
  await waitFor(page, `document.querySelector('#game-status')?.textContent.includes('遊べます')`, 'runtime start', 15_000);
  const initial = await pageEvidence(page, scene);
  if (initial.errors.length || initial.error) throw new Error(`page startup error: ${initial.error || initial.errors.join('; ')}`);
  if (viewport === 'narrow' && (initial.viewport.width !== 320 || initial.viewport.height !== 568)) throw new Error(`narrow viewport mismatch: ${JSON.stringify(initial.viewport)}`);
  if (viewport === 'default' && initial.viewport.width === 320 && initial.viewport.height === 568) throw new Error(`default viewport was not independently observed: ${JSON.stringify(initial.viewport)}`);
  if (initial.canvas.width !== 384 || initial.canvas.height !== 216 || initial.canvas.nonBlack === 0 || !['pixelated', 'crisp-edges'].includes(initial.canvas.imageRendering)) throw new Error(`canvas evidence failed: ${JSON.stringify(initial.canvas)}`);

  let point = { x: scene.game.spawn.x + scene.game.player.footbox.x, y: scene.game.spawn.y + scene.game.player.footbox.y };
  const routes = scene.nav.routes?.journey ?? [];
  if (routes.length !== 5) throw new Error(`expected five journey routes, received ${routes.length}`);
  point = await followRoute(page, scene, routes[0], point, scene.game.player.speeds.run);
  await confirmThree(page);
  await waitFor(page, `document.querySelector('#game-ui')?.textContent.includes('街で確かめて')`, 'accepted request');
  const investigationEvidence = [];
  const choices = ['見た', 'そうらしい', 'わからない'];
  for (let index = 1; index <= 3; index += 1) {
    point = await followRoute(page, scene, routes[index], point, scene.game.player.speeds.run);
    await press(page, 'Enter');
    for (let move = 0; move < index - 1; move += 1) await press(page, 'ArrowDown');
    await press(page, 'Enter');
    const feedback = await evaluate(page, `document.querySelector('#game-ui')?.textContent || ''`);
    investigationEvidence.push({ questId: scene.game.quests[index - 1].id, choice: choices[index - 1], feedback });
    await press(page, 'Enter');
  }
  await waitFor(page, `document.querySelector('#game-ui')?.textContent.includes('調査の記録を待っています')`, 'three completed investigations');
  point = await followRoute(page, scene, routes[4], point, scene.game.player.speeds.run);
  const beforeReport = await pageEvidence(page, scene);
  const effectSelector = scene.game.renderables.find((entry) => entry.effect)?.assetSelector;
  if (!effectSelector || beforeReport.drawnSelectors.includes(effectSelector)) throw new Error('lantern effect was already drawn before report');
  await confirmThree(page);
  await waitFor(page, `document.querySelector('#game-ui')?.textContent.includes('街のようすが')`, 'reported town change');
  const afterReport = await pageEvidence(page, scene);
  if (!afterReport.drawnSelectors.includes(effectSelector)) throw new Error('lantern effect was not drawn after report');
  for (const name of ['character', 'building', 'map', 'object']) if (afterReport.categories[name].length === 0) throw new Error(`approved ${name} category was not drawn`);
  const performance = await measureRaf(page, performanceMs);
  if (performanceMs === 60_000 && (performance.p95Ms > 33.4 || performance.over100ms !== 0)) throw new Error(`rAF budget failed: ${JSON.stringify(performance)}`);
  const npc = await observeResidentDialogue(page, scene, point);
  await waitFor(page, `document.querySelector('#game-ui')?.textContent.includes('同じ街へ戻れます')`, 'saved exit');
  return { initial, investigations: investigationEvidence, beforeReport: { lanternDrawn: false }, afterReport: { lanternDrawn: true, ...afterReport }, npc, performance, exitObserved: true };
}

async function runDefaultViewportProbe(browser, url, scene) {
  const page = await openPage(browser, url, null);
  await waitFor(page, `document.querySelector('#game-status')?.textContent.includes('遊べます')`, 'default-viewport runtime start', 15_000);
  const evidence = await pageEvidence(page, scene);
  if (evidence.viewport.width === 320 && evidence.viewport.height === 568) throw new Error('default Chrome viewport was not independently observed');
  if (evidence.canvas.nonBlack === 0) throw new Error('default-viewport canvas is blank');
  await browser.cdp.call('Target.closeTarget', { targetId: page.targetId });
  return evidence;
}

async function observeResidentDialogue(page, scene, current) {
  const residents = scene.game.npcs.filter((npc) => npc.kind === 'resident' && npc.cutawayId);
  const resident = residents.map((npc) => ({ npc, entrance: scene.game.entrances.find((entry) => entry.roomId === npc.cutawayId) }))
    .filter((entry) => entry.entrance).sort((left, right) => left.entrance.rect.x - right.entrance.rect.x)[0]?.npc;
  const entrance = scene.game.entrances.find((entry) => entry.roomId === resident?.cutawayId);
  const interior = scene.nav.routes?.interiors?.find((route) => route.roomId === resident?.cutawayId);
  if (!resident || !entrance || !interior) throw new Error('resident interior route is missing');
  const approach = [
    current,
    { x: 288, y: 448 }, { x: 288, y: 496 }, { x: entrance.rect.x + 2, y: 496 },
  ];
  let point = current;
  for (const target of approach.slice(1)) point = await moveToPoint(page, scene, target, scene.game.player.speeds.run);
  await moveAxis(page, 'ArrowUp', 31, scene.game.player.speeds.run);
  const entered = await visualPlayerFoot(page, scene);
  const room = scene.game.rooms.find((entry) => entry.id === entrance.roomId);
  const roomRenderable = scene.game.renderables.find((entry) => entry.roomId === entrance.roomId);
  const roomAsset = scene.assets.find((asset) => asset.selector === roomRenderable?.assetSelector);
  const roomDrawn = roomAsset ? await evaluate(page, `Object.keys(window.__codecityQa.drawUrls).some(url => new URL(url).pathname === ${JSON.stringify(new URL(roomAsset.url, DEFAULT_URL).pathname)})`) : false;
  const insideBounds = room && entered.x >= room.bounds.x && entered.y >= room.bounds.y
    && entered.x + scene.game.player.footbox.width <= room.bounds.x + room.bounds.width
    && entered.y + scene.game.player.footbox.height <= room.bounds.y + room.bounds.height;
  if (!roomDrawn || !insideBounds) throw new Error(`resident room did not activate at its entrance: observed ${JSON.stringify(entered)}`);
  for (const target of interior.points) point = await moveToPoint(page, scene, target, scene.game.player.speeds.run);
  await press(page, 'Enter');
  await waitFor(page, `document.querySelector('#game-ui')?.textContent.trim().length > 0`, 'resident dialogue');
  const dialogue = await evaluate(page, `document.querySelector('#game-ui')?.textContent || ''`);
  if (!dialogue.trim()) throw new Error('resident dialogue was empty');
  await press(page, 'Escape');
  await press(page, 'Escape');
  await press(page, 'Escape');
  return { dialogue, roomId: entrance.roomId, exited: true };
}

async function runRevisit(browser, url, scene, viewport) {
  const page = await openPage(browser, url, viewport === 'narrow' ? VIEWPORT : null);
  await waitFor(page, `document.querySelector('#game-status')?.textContent.includes('遊べます')`, 'runtime restart', 15_000);
  await waitFor(page, `document.querySelector('#game-ui')?.textContent.includes('同じ街へ戻れます')`, 'persisted exit');
  await press(page, 'Enter');
  await waitFor(page, `document.querySelector('#game-ui')?.textContent.includes('街のようすが')`, 'revisited completed town');
  const evidence = await pageEvidence(page, scene);
  const effectSelector = scene.game.renderables.find((entry) => entry.effect)?.assetSelector;
  if (!evidence.drawnSelectors.includes(effectSelector)) throw new Error('persisted lantern effect was not drawn on revisit');
  return { persistedExitObserved: true, revisitObserved: true, lanternRestored: true, page: evidence };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const profile = options.profile ?? await mkdtemp(`${tmpdir()}/codecity-chrome-profile-`);
  const sceneUrl = new URL('scene.json', options.url);
  const response = await fetch(sceneUrl);
  if (!response.ok) throw new Error(`scene fetch failed with ${response.status}`);
  const scene = await response.json();
  const evidence = { ok: true, stage: options.stage, profile, url: options.url, viewport: options.viewport, chrome: null, journey: null, revisit: null };
  if (options.stage === 'all' || options.stage === 'journey') {
    const browser = await launchChrome(profile);
    evidence.chrome = browser.product;
    try {
      if (options.viewport === 'narrow') evidence.defaultViewport = await runDefaultViewportProbe(browser, options.url, scene);
      evidence.journey = await runJourney(browser, options.url, scene, options.performanceMs, options.viewport);
    }
    finally { await stopChrome(browser); }
  }
  if (options.stage === 'all' || options.stage === 'revisit') {
    const browser = await launchChrome(profile);
    evidence.chrome = browser.product;
    try { evidence.revisit = await runRevisit(browser, options.url, scene, options.viewport); }
    finally { await stopChrome(browser); }
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message ?? error), stack: String(error?.stack ?? '') }, null, 2)}\n`);
  process.exitCode = 1;
});
