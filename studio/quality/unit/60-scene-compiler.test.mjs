import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  compileScene,
  requiredAssetSelectors,
  SceneCompilerError,
  validateSceneBundle
} from '../../../ship/60-scene-compiler/index.mjs';
import { createTestOnlyWorldPlan } from '../fixtures/60-worldplan.fixture.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function testSheetPng() {
  const width = 192;
  const height = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG = testSheetPng();
const DIRECTIONS = ['north', 'south', 'east', 'west'];

function directionalAnimation(frameCount, fps) {
  return Object.fromEntries(DIRECTIONS.map((direction, row) => [
    direction,
    { frames: Array.from({ length: frameCount }, (_, index) => (row * 6) + index), fps },
  ]));
}

function usageForSelector(selector) {
  if (selector === 'player:default') return {
    kind: 'character', layer: 'actor',
    frame: { width: 32, height: 32, columns: 6, rows: 8 },
    collision: { kind: 'rect', x: 10, y: 24, width: 12, height: 7 },
    animations: {
      idle: directionalAnimation(2, 4),
      walk: directionalAnimation(4, 8),
      run: directionalAnimation(6, 12),
    },
  };
  if (selector.startsWith('npc:')) return {
    kind: 'character', layer: 'actor',
    frame: { width: 32, height: 32, columns: 6, rows: 8 },
    collision: { kind: 'rect', x: 10, y: 24, width: 12, height: 7 },
    animations: { idle: directionalAnimation(2, 4), walk: directionalAnimation(4, 8) },
  };
  const prefix = selector.split(':', 1)[0];
  const compatibility = {
    terrain: ['terrain', 'ground'], water: ['water', 'ground'], road: ['road', 'ground'],
    plot: ['terrain', 'ground'], building: ['building', 'object'], room: ['room', 'object'],
    prop: ['prop', 'object'], light: ['light', 'foreground'], quest: ['quest', 'foreground'],
    ui: ['ui', 'ui'], effect: ['effect', 'effect'],
  }[prefix];
  const usage = {
    kind: compatibility[0], layer: compatibility[1],
    frame: ['building', 'room', 'ui'].includes(prefix)
      ? { width: 192, height: 256, columns: 1, rows: 1 }
      : { width: 16, height: 16, columns: 12, rows: 16 },
    collision: { kind: 'none' },
  };
  if (prefix === 'building') {
    usage.collision = { kind: 'rect', x: 80, y: 224, width: 32, height: 32 };
    usage.entrance = { x: 88, y: 240, width: 16, height: 16 };
  }
  return usage;
}

function pivotForSelector(selector) {
  if (selector === 'player:default' || selector.startsWith('npc:')) return { x: 16, y: 31 };
  if (selector.startsWith('building:') || selector.startsWith('room:') || selector.startsWith('ui:')) return { x: 96, y: 255 };
  return { x: 8, y: 16 };
}

function assetRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codecity-scene-compiler-'));
  fs.writeFileSync(path.join(root, 'sheet.png'), PNG);
  return root;
}

function manifest(root, selectors) {
  const sha256 = crypto.createHash('sha256').update(PNG).digest('hex');
  return {
    format: 'codecity.asset-manifest', schemaVersion: 1, manifestVersion: '1.0.0', fallbackPolicy: 'none',
    assets: selectors.map((selector, index) => ({
      id: `asset-${index + 1}`,
      version: '1.0.0', status: 'accepted', accepted: true,
      path: 'sheet.png', url: '/assets/sheet.png', sha256,
      dimensions: { width: 192, height: 256 }, pivot: pivotForSelector(selector),
      usage: usageForSelector(selector),
      license: { spdx: 'CC0-1.0', holder: 'test owner' },
      provenance: { kind: 'test-only', source: 'test-only fixture', sourceSha256: 'b'.repeat(64), evidence: 'observed' },
      approval: {
        recordId: `approval-${index + 1}`, actorType: 'human', authority: 'owner',
        approvedBy: 'test owner', approvedAt: '2026-08-02T00:00:00.000Z', decision: 'accepted',
        assetId: `asset-${index + 1}`, assetSha256: sha256, sourceSha256: 'b'.repeat(64),
      }
    }))
  };
}

function bindingsFor(selectors) {
  return { format: 'codecity.scene-bindings', schemaVersion: 1, selectors: Object.fromEntries(selectors.map((selector, index) => [selector, `asset-${index + 1}`])) };
}

function serializedFixture() {
  return JSON.parse(JSON.stringify(createTestOnlyWorldPlan()));
}

function intersects(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function hasCollisionFreePoint(rectangle, collisions) {
  for (let y = Math.ceil(rectangle.y); y < rectangle.y + rectangle.height; y += 1) {
    for (let x = Math.ceil(rectangle.x); x < rectangle.x + rectangle.width; x += 1) {
      if (!collisions.some((collision) => intersects({ x, y, width: 1, height: 1 }, collision))) return true;
    }
  }
  return false;
}

test('compiles a complete logical SceneBundle with exact asset bindings', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const bundle = compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: bindingsFor(selectors) });
  assert.equal(bundle.format, 'codecity.scene-bundle');
  assert.equal(bundle.schemaVersion, 1);
  assert.ok(bundle.layers.roads.length > 0);
  assert.ok(bundle.layers.buildings.length > 0);
  assert.ok(bundle.rooms.length > 0);
  assert.ok(bundle.actors.length > 0);
  assert.ok(bundle.interactions.length > 0);
  assert.equal(bundle.questSites.length, 3);
  assert.equal(validateSceneBundle(bundle).ok, true);
  assert.equal(bundle.assets.every((asset) => asset.url === '/assets/sheet.png' && asset.sha256.length === 64 && asset.dimensions.width === 192), true);
});

test('compiled town covers the grid and every required interaction has a collision-free approach', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const bundle = compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: bindingsFor(selectors) });
  assert.equal(bundle.game.renderables.filter((entry) => entry.id.startsWith('terrain:')).length, plan.grid.columns * plan.grid.rows);
  assert.equal(bundle.game.entrances.every((entrance) => hasCollisionFreePoint(entrance.rect, bundle.game.collisions)), true);
  assert.equal(bundle.game.npcs.every((npc) => hasCollisionFreePoint(npc.interactionRect, bundle.game.collisions)), true);
  assert.equal(bundle.game.quests.every((quest) => !bundle.game.collisions.some((collision) => intersects(quest.rect, collision))), true);
  assert.equal(bundle.game.collisions.some((collision) => intersects(bundle.game.report.rect, collision)), false);
  assert.equal(bundle.game.collisions.some((collision) => intersects(bundle.game.request.rect, collision)), false);
  assert.notDeepEqual(bundle.game.request.rect, bundle.game.report.rect);
  const playerFoot = {
    x: bundle.game.spawn.x + bundle.game.player.footbox.x,
    y: bundle.game.spawn.y + bundle.game.player.footbox.y,
    width: bundle.game.player.footbox.width,
    height: bundle.game.player.footbox.height,
  };
  assert.equal(bundle.game.collisions.some((collision) => intersects(playerFoot, collision)), false);
  assert.equal(bundle.nav.routes.journey.length, 5);
  assert.equal(new Set(bundle.game.quests.map((quest) => quest.siteId)).size, 3);
  assert.deepEqual(bundle.nav.routes.journey.map((route) => route.to), [
    bundle.game.request.id,
    ...bundle.game.quests.map((quest) => quest.id),
    bundle.game.report.id,
  ]);
  assert.equal(bundle.nav.routes.journey[0].from, 'spawn');
  assert.equal(bundle.nav.routes.journey.at(-1).to, bundle.game.report.id);
  assert.equal(bundle.nav.routes.journey.every((route) => route.points.length > 0), true);
  assert.equal(bundle.nav.routes.interiors.length, bundle.game.npcs.filter((npc) => npc.cutawayId).length);
  assert.equal(bundle.nav.routes.interiors.every((route) => route.points.length > 0), true);
  assert.equal(bundle.layers.buildings.every((building) => bundle.collisions.solidRects.some((solid) => intersects(solid, building.collisionRect))), true);
});

test('the canonical repository inspection transition emits one conditional town-hall lantern effect', () => {
  const root = assetRoot();
  const plan = JSON.parse(JSON.stringify(createTestOnlyWorldPlan({ observedTransition: true })));
  const selectors = requiredAssetSelectors(plan);
  assert.ok(selectors.includes('effect:town_hall_lantern_lit'));
  const bundle = compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: bindingsFor(selectors) });
  const effect = bundle.game.renderables.filter((entry) => entry.effect === 'town_hall_lantern_lit');
  assert.equal(effect.length, 1);
  assert.equal(effect[0].assetSelector, 'effect:town_hall_lantern_lit');
});

test('same inputs produce byte-identical deterministic output', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const args = { worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: bindingsFor(selectors) };
  assert.equal(JSON.stringify(compileScene(args)), JSON.stringify(compileScene(args)));
});

test('missing semantic binding fails closed with no placeholder', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const bindings = bindingsFor(selectors);
  delete bindings.selectors[selectors.at(-1)];
  assert.throws(() => compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings }), (error) => error instanceof SceneCompilerError && error.code === 'ASSET_BINDINGS_INVALID' && error.issues.some(({ code }) => code === 'BINDING_MISSING'));
});

test('unknown asset ID and missing file are hard failures', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const bindings = bindingsFor(selectors);
  bindings.selectors[selectors[0]] = 'asset-does-not-exist';
  assert.throws(() => compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings }), (error) => error instanceof SceneCompilerError && error.code === 'ASSET_BINDINGS_INVALID' && error.issues.some(({ cause }) => cause === 'ASSET_NOT_FOUND'));
  fs.unlinkSync(path.join(root, 'sheet.png'));
  assert.throws(() => compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: bindingsFor(selectors) }), (error) => error instanceof SceneCompilerError && error.code === 'ASSET_MANIFEST_INVALID' && error.issues.some(({ code }) => code === 'ASSET_FILE_MISSING'));
});

test('bindings remain explicit and reject wildcard or fallback shortcuts', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const wildcard = bindingsFor(selectors);
  wildcard.selectors['npc:*'] = wildcard.selectors[selectors[0]];
  assert.throws(() => compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: wildcard }), (error) => error instanceof SceneCompilerError && error.code === 'BINDINGS_INVALID' && error.issues.some(({ code }) => code === 'WILDCARD_FORBIDDEN'));
  const fallback = bindingsFor(selectors);
  fallback.defaultAssetId = fallback.selectors[selectors[0]];
  assert.throws(() => compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: fallback }), (error) => error instanceof SceneCompilerError && error.code === 'BINDINGS_INVALID' && error.issues.some(({ code }) => code === 'FALLBACK_FORBIDDEN'));
});

test('a full frozen catalog is accepted, but every unused mapping is still validated', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const required = requiredAssetSelectors(plan);
  const extra = ['terrain:meadow', 'light:unknown', 'npc:http'].find((selector) => !required.includes(selector));
  assert.ok(extra);
  const full = [...required, extra].sort();
  const bundle = compileScene({ worldPlan: plan, assetManifest: manifest(root, full), assetRoot: root, bindings: bindingsFor(full) });
  assert.deepEqual(bundle.assets.map((asset) => asset.selector).sort(), [...required].sort());

  const unresolved = bindingsFor(full);
  unresolved.selectors[extra] = 'not-an-approved-asset';
  assert.throws(
    () => compileScene({ worldPlan: plan, assetManifest: manifest(root, full), assetRoot: root, bindings: unresolved }),
    (error) => error instanceof SceneCompilerError && error.code === 'ASSET_BINDINGS_INVALID' && error.issues.some(({ cause }) => cause === 'ASSET_NOT_FOUND'),
  );

  const mismatchedManifest = manifest(root, full);
  const mismatchedAsset = mismatchedManifest.assets[full.indexOf(extra)];
  mismatchedAsset.usage.kind = 'prop';
  mismatchedAsset.usage.layer = 'object';
  assert.throws(
    () => compileScene({ worldPlan: plan, assetManifest: mismatchedManifest, assetRoot: root, bindings: bindingsFor(full) }),
    (error) => error instanceof SceneCompilerError && error.code === 'ASSET_BINDINGS_INVALID' && error.issues.some(({ code }) => code === 'USAGE_INCOMPATIBLE'),
  );

  const unknown = bindingsFor(required);
  unknown.selectors['building:made_up'] = unknown.selectors[required[0]];
  assert.throws(
    () => compileScene({ worldPlan: plan, assetManifest: manifest(root, required), assetRoot: root, bindings: unknown }),
    (error) => error instanceof SceneCompilerError && error.code === 'BINDINGS_INVALID' && error.issues.some(({ code }) => code === 'SELECTOR_UNKNOWN'),
  );
});

test('bundle validation catches schema and binding tampering', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const bundle = compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: bindingsFor(selectors) });
  const broken = structuredClone(bundle);
  broken.schemaVersion = 2;
  delete broken.world.contentDigest;
  broken.layers.terrain.asset.assetId = 'not-canonical';
  const result = validateSceneBundle(broken);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(({ code }) => code === 'UNSUPPORTED_SCHEMA'));
  assert.ok(result.issues.some(({ code }) => code === 'CONTENT_DIGEST_INVALID'));
  assert.ok(result.issues.some(({ code }) => code === 'ASSET_REFERENCE_MISMATCH'));
});

test('malformed public route dependencies return validation issues instead of throwing', () => {
  const root = assetRoot();
  const plan = serializedFixture();
  const selectors = requiredAssetSelectors(plan);
  const bundle = compileScene({ worldPlan: plan, assetManifest: manifest(root, selectors), assetRoot: root, bindings: bindingsFor(selectors) });
  const mutations = [
    (copy) => { delete copy.game.player; },
    (copy) => { delete copy.game.spawn; },
    (copy) => { copy.game.quests = {}; },
    (copy) => { delete copy.game.request; },
    (copy) => { delete copy.game.report; },
    (copy) => { copy.nav.routes.journey[0].points = []; },
    (copy) => { copy.nav.routes.journey[0].points[0].x = -1; },
    (copy) => { delete copy.game.entrances[0].interiorSpawn; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(bundle);
    mutate(copy);
    let result;
    assert.doesNotThrow(() => { result = validateSceneBundle(copy); });
    assert.equal(result.ok, false);
  }
});
