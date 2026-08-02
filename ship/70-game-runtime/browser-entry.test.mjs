import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const app = read('app.mjs');
const css = read('styles.css');

test('browser entry has no external URL, CDN, font, or stylesheet dependency', () => {
  for (const source of [html, app, css]) {
    assert.doesNotMatch(source, /https?:\/\//iu);
    assert.doesNotMatch(source, /@import\b/iu);
  }
  assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\./iu);
  assert.doesNotMatch(app, /(?:fetch|XMLHttpRequest)\s*\(\s*['"](?:https?:|\/\/)/iu);
});

test('browser entry imports runtime, fetches and validates same-origin scene, and decodes assets', () => {
  assert.match(app, /from\s+['"]\.\/index\.mjs['"]/u);
  assert.match(app, /scene\.json/u);
  assert.match(app, /validateSceneBundle\s*\(/u);
  assert.match(app, /startGameRuntime\s*\(/u);
  assert.match(app, /location\.origin/u);
  assert.match(app, /activeWindow\.fetch\s*\(/u);
  assert.match(app, /new\s+activeWindow\.Image\s*\(/u);
  assert.match(app, /\.decode\s*\(/u);
  assert.match(app, /localStorage/u);
});

test('index has strict CSP and the required game DOM contract', () => {
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /default-src\s+'self'/u);
  assert.match(html, /connect-src\s+'self'/u);
  assert.match(html, /font-src\s+'none'/u);
  assert.match(html, /script-src\s+'self'/u);
  assert.match(html, /script-src-attr\s+'none'/u);
  assert.match(html, /style-src\s+'self'/u);
  for (const id of ['game-canvas', 'game-ui', 'game-status', 'game-error', 'game-help']) assert.match(html, new RegExp(`id=["']${id}["']`, 'u'));
  assert.match(html, /<canvas[^>]+width=["']384["'][^>]+height=["']216["']/u);
  assert.match(html, /type=["']module["'][^>]+src=["']\.\/app\.mjs["']/u);
});

test('canvas stays pixelated and never receives a fractional CSS scale', () => {
  const canvasRule = css.match(/#game-canvas\s*\{[^}]+\}/u)?.[0] ?? '';
  assert.match(canvasRule, /image-rendering:\s*pixelated/u);
  assert.match(canvasRule, /aspect-ratio:\s*384\s*\/\s*216/u);
  assert.match(canvasRule, /width:\s*auto/u);
  assert.match(canvasRule, /max-width:\s*none/u);
  assert.doesNotMatch(canvasRule, /width:\s*min\(100%/u);
});
