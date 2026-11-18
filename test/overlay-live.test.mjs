import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { readOverlay } from '../src/overlay/read.mjs';
import { placeOverlay, defaultManifest } from '../src/overlay/place.mjs';
import { createOverlaySession } from '../src/overlay/live.mjs';
import { serveTown } from '../src/serve.mjs';
import { diffById, Overlay } from '../web/overlay.js';
import { artFrom, buildWorld } from '../tools/check-play.mjs';
import { overlayPeople } from '../web/overlay-world.js';
import { fixture, simpleTown, record, parsed } from './helpers/overlay-fixtures.mjs';

const manifest = defaultManifest();

test('overlay: live state update changes only one resolved record and no positions', () => {
  const base = simpleTown(), original = parsed({ markers: [record('one'), record('two')] });
  const changed = parsed({ markers: [record('one', { building: 'b1' }, 'passed'), record('two')] });
  const before = placeOverlay(base, original, manifest).overlay, after = placeOverlay(base, changed, manifest).overlay;
  const diff = diffById(before.markers, after.markers);
  assert.deepEqual(diff.changed.map((m) => m.id), ['one']);
  assert.equal(diff.unchanged[0], before.markers[1]);
  assert.equal(diff.added.length + diff.removed.length, 0);
  assert.equal(before.layoutKey, after.layoutKey);
  assert.deepEqual(before.markers.map(({ id, x, y }) => ({ id, x, y })), after.markers.map(({ id, x, y }) => ({ id, x, y })));
});

test('overlay: live serving validates only the named file, retains good snapshots and rebuilds only seed/groups', async (t) => {
  const dir = fixture(t), file = join(dir, 'overlay.json'), baseTown = simpleTown();
  let input = { version: 1, seed: 'a', markers: [record('one')] }, builds = 0;
  writeFileSync(file, JSON.stringify(input));
  const overlay = readOverlay(file), town = placeOverlay(baseTown, overlay, manifest);
  const session = createOverlaySession({ file, overlay, baseTown, town, manifest, makeBase() { builds++; return simpleTown(); } });
  const { server, url } = await serveTown(town, { port: 0, ground: Buffer.from('test'), overlaySession: session });
  t.after(() => new Promise((ok) => server.close(ok)));
  const initial = await (await fetch(url + 'overlay.json')).json();
  input.markers[0].state = 'passed'; writeFileSync(file, JSON.stringify(input));
  const next = await (await fetch(url + 'overlay.json')).json();
  assert.notEqual(next.revision, initial.revision); assert.equal(next.layoutKey, initial.layoutKey); assert.equal(builds, 0);
  writeFileSync(file, '{');
  assert.equal((await fetch(url + 'overlay.json')).status, 422);
  assert.equal((await (await fetch(url + 'town.json')).json()).overlay.revision, next.revision);
  input.seed = 'b'; writeFileSync(file, JSON.stringify(input));
  assert.notEqual((await (await fetch(url + 'overlay.json')).json()).layoutKey, next.layoutKey); assert.equal(builds, 1);
  input.groups = [{ id: 'g', paths: ['src/**'] }]; writeFileSync(file, JSON.stringify(input));
  await fetch(url + 'overlay.json'); assert.equal(builds, 2);
  const forbidden = await new Promise((ok, fail) => {
    const req = request(url + 'overlay.json', { headers: { Host: 'example.invalid' } }, (res) => { res.resume(); ok(res.statusCode); });
    req.on('error', fail); req.end();
  });
  assert.equal(forbidden, 403);
  assert.equal((await fetch(url + 'overlay.json', { method: 'POST' })).status, 405);
  assert.equal((await fetch(url + 'overlay.json?path=/etc/passwd')).status, 200);
  assert.equal((await fetch(url + 'overlay.json/../private')).status, 404);
});

test('overlay: runtime retains unchanged objects, removes people collisions, and defers changes onto the player', () => {
  const base = simpleTown(), initial = { markers: [record('one'), record('two')],
    people: [{ id: 'a', name: 'A', at: { group: 'missing' } }, { id: 'b', name: 'B', at: { group: 'missing' } }] };
  const town = placeOverlay(base, parsed(initial), manifest), art = artFrom(manifest);
  art.townsfolk = [{}];
  const { world, start } = buildWorld(town, art), player = { x: start.x, y: start.y };
  const controller = Object.assign(Object.create(Overlay.prototype), {
    town, world, art, characters: [player], data: town.overlay, people: new Map(),
    markers: new Map(town.overlay.markers.map((m) => [m.id, m])),
    metrics: { updates: 0, markerChanges: 0, personChanges: 0, propChanges: 0, reloads: 0, deferred: 0 },
    title() {}, reload() { throw new Error('unexpected reload'); },
  });
  for (const p of overlayPeople(town.overlay)) controller.addPerson(p);
  const first = controller.people.get('person:a'), second = controller.people.get('person:b');
  const beforeMarkers = new Map(controller.markers), beforeProps = new Map(world.props.map((p) => [p.data.overlayId, p]));
  const renamed = { ...initial, people: [{ ...initial.people[0], name: 'A renamed' }, initial.people[1]] };
  assert.equal(controller.apply(placeOverlay(base, parsed(renamed), manifest).overlay), true);
  assert.notEqual(controller.people.get('person:a'), first);
  assert.equal(controller.people.get('person:b'), second);
  for (const [id, m] of beforeMarkers) assert.equal(controller.markers.get(id), m);
  for (const p of world.props) assert.equal(beforeProps.get(p.data.overlayId), p);
  assert.equal(world.rects.filter((r) => r.overlayPerson).length, 2);
  const removed = { ...initial, people: [initial.people[1]] };
  const next = placeOverlay(base, parsed(removed), manifest).overlay;
  assert.equal(controller.apply(next), true);
  assert.equal(world.rects.filter((r) => r.overlayPerson).length, 1);
  assert.equal(world.rects.some((r) => r.overlayPerson === 'person:a'), false);
  const addition = { ...initial, people: [...removed.people, { id: 'c', name: 'C', at: { group: 'missing' } }] };
  const addData = placeOverlay(base, parsed(addition), manifest).overlay;
  const person = addData.people.find((p) => p.id === 'c');
  player.x = person.x * 16; player.y = person.y * 16;
  const revision = controller.data.revision;
  assert.equal(controller.apply(addData), false); assert.equal(controller.data.revision, revision);
  assert.equal(controller.metrics.deferred, 1);
  player.x = start.x; player.y = start.y;
  assert.equal(controller.apply(addData), true);
  assert.equal(controller.people.has('person:c'), true);
  assert.equal(world.rects.filter((r) => r.overlayPerson).length, 2);
});
