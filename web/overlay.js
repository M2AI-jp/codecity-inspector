import { Character } from './character.js';
import { TILE, KEEPER_BOX, FEET_W, FEET_H, FEET_UP } from './config.js';
import { overlayPeople, addOverlayPeople, reindexOverlayRects } from './overlay-world.js';
import { strHash } from './util.js';
import { placeBubble, playerRect } from './screen-space.js';
import { NoticeReader } from './notice-reader.js';

export function diffById(previous, next, key = 'id') {
  const before = new Map(previous.map((v) => [v[key], v])), after = new Map(next.map((v) => [v[key], v]));
  const added = [], changed = [], removed = [], unchanged = [];
  for (const [id, value] of after) {
    if (!before.has(id)) added.push(value);
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(value)) changed.push(value);
    else unchanged.push(before.get(id));
  }
  for (const [id, value] of before) if (!after.has(id)) removed.push(value);
  return { added, changed, removed, unchanged };
}

const rectangles = (props, people, art) => [
  ...props.flatMap((p) => {
    const def = art.props[p.look || p.type];
    return (def?.solids || (def?.solid ? [def.solid] : [])).map(([x, y, w, h]) => ({ x: p.x * TILE + x, y: p.y * TILE + y, w, h }));
  }),
  ...people.map((p) => ({ x: p.x * TILE + KEEPER_BOX[0], y: p.y * TILE + KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] })),
];
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export class Overlay {
  constructor({ town, world, art, characters, ui, reload = () => location.reload() }) {
    this.town = town; this.world = world; this.art = art; this.characters = characters; this.ui = ui; this.reload = reload;
    this.data = town.overlay; this.people = new Map(); this.markers = new Map(this.data.markers.map((m) => [m.id, m]));
    this.metrics = { polls: 0, updates: 0, markerChanges: 0, personChanges: 0, propChanges: 0, reloads: 0, deferred: 0 };
    for (const p of overlayPeople(this.data)) this.addPerson(p);
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/web/overlay.css'; document.head.append(css);
    this.panel = document.createElement('section'); this.panel.id = 'overlay-notice'; this.panel.setAttribute('aria-live', 'polite');
    this.heading = document.createElement('div'); this.heading.className = 'overlay-heading';
    this.body = document.createElement('div'); this.panel.append(this.heading, this.body);
    this.reader = new NoticeReader(this.panel);
    this.goalTag = document.createElement('div'); this.goalTag.id = 'overlay-goal';
    document.getElementById('ui').append(this.panel, this.goalTag);
    this.title();
    this.timer = setTimeout(() => this.poll(), 2000);
    window.addEventListener('pagehide', () => this.stop(), { once: true });
  }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  addPerson(p) {
    const sheet = p.gate ? this.art.keepers.gate : this.art.townsfolk[p.look % this.art.townsfolk.length];
    const c = new Character(p.x * TILE, p.y * TILE, sheet);
    c.overlayId = p.runtimeId; c.name = p.name; c.def = p;
    this.people.set(p.runtimeId, c); this.characters.push(c);
  }
  title() {
    const title = this.data.title;
    if (!title) { this.ui.renderRepo(); return; }
    const name = document.createElement('div'), sub = document.createElement('div');
    name.className = 'name'; sub.className = 'sub';
    name.textContent = title.text; sub.textContent = title.sub || '';
    this.ui.el.repo.replaceChildren(name, sub);
  }
  apply(next) {
    if (next.version !== 1 || !next.layoutKey || !next.revision) return false;
    if (next.layoutKey !== this.data.layoutKey) {
      this.metrics.reloads++; this.stop(); this.reload(); return true;
    }
    if (next.revision === this.data.revision) return false;
    const pd = diffById(this.data.props, next.props, 'overlayId');
    const oldPeople = overlayPeople(this.data), newPeople = overlayPeople(next);
    const nd = diffById(oldPeople, newPeople, 'runtimeId');
    const md = diffById(this.data.markers, next.markers);
    const prevRects = rectangles(this.data.props, oldPeople, this.art), nextRects = rectangles(next.props, newPeople, this.art);
    const geometryChanged = JSON.stringify(prevRects) !== JSON.stringify(nextRects);
    if (geometryChanged) {
      const changedRects = rectangles([...pd.added, ...pd.changed], [...nd.added, ...nd.changed], this.art);
      // A changed object waits until the player / a moving resident has left its new position.
      const blocked = this.characters.filter((c) => !c.overlayId).some((c) => changedRects.some((r) =>
        intersects(r, { x: c.x - FEET_W / 2, y: c.y - FEET_UP, w: FEET_W, h: FEET_H })));
      if (blocked) { this.metrics.deferred++; return false; }
    }
    const propIds = new Set([...pd.removed, ...pd.changed].map((p) => p.overlayId));
    const personIds = new Set([...nd.removed, ...nd.changed].map((p) => p.runtimeId));
    this.world.props = this.world.props.filter((p) => !propIds.has(p.data.overlayId));
    this.world.rects = this.world.rects.filter((r) => !propIds.has(r.overlayProp) && !personIds.has(r.overlayPerson));
    this.world.lights = this.world.lights.filter((l) => !propIds.has(l.overlayProp));
    reindexOverlayRects(this.world);
    for (const p of [...pd.added, ...pd.changed]) this.world.addProp(p, strHash(p.overlayId));
    for (let i = this.characters.length - 1; i >= 0; i--) if (personIds.has(this.characters[i].overlayId)) this.characters.splice(i, 1);
    for (const id of personIds) this.people.delete(id);
    const changedPeople = [...nd.added, ...nd.changed];
    addOverlayPeople(this.world, { people: changedPeople });
    for (const p of changedPeople) this.addPerson(p);
    if (geometryChanged) this.world.computeNav();
    for (const m of md.removed) this.markers.delete(m.id);
    for (const m of [...md.added, ...md.changed]) this.markers.set(m.id, m);
    const titleChanged = JSON.stringify(this.data.title) !== JSON.stringify(next.title);
    if (JSON.stringify(this.data.goal) === JSON.stringify(next.goal)) next.goal = this.data.goal;
    this.data = next; this.town.overlay = next;
    this.town.props = [...this.town.props.filter((p) => !p.overlayId), ...next.props];
    this.town.unplaced = [...(this.town.unplaced || []).filter((u) => !u.overlay), ...next.unplaced];
    if (titleChanged) this.title();
    this.metrics.updates++;
    this.metrics.markerChanges += md.added.length + md.changed.length + md.removed.length;
    this.metrics.personChanges += nd.added.length + nd.changed.length + nd.removed.length;
    this.metrics.propChanges += pd.added.length + pd.changed.length + pd.removed.length;
    return true;
  }
  async poll() {
    if (this.stopped) return;
    try {
      const response = await fetch('/overlay.json', { cache: 'no-store' });
      this.metrics.polls++;
      if (response.ok) this.apply(await response.json());
    } catch { /* Keep the last valid snapshot during a partial write or a stopped server. */ }
    if (!this.stopped) this.timer = setTimeout(() => this.poll(), 2000);
  }
  nearest(player) {
    let best = null, distance = 40;
    const items = [...this.markers.values(), ...[...this.people.values()].map((p) => p.def), ...(this.data.goal ? [this.data.goal] : [])];
    for (const item of items) {
      const d = Math.hypot(item.x * TILE - player.x, item.y * TILE - player.y);
      if (d < distance) { best = item; distance = d; }
    }
    return best;
  }
  update(view, player, item) {
    this.panel.classList.toggle('show', !!item);
    document.getElementById('ui')?.classList.toggle('overlay-talking', !!item);
    if (item !== this.active) {
      this.active = item;
      this.heading.textContent = item?.name || item?.label || '';
      this.body.replaceChildren(...(item?.lines || []).map((line) => {
        const p = document.createElement('p'); p.textContent = line; return p;
      }));
      this.reader.reset();
    }
    const lower = (player.ry - view.camY) * view.cssPerPx < window.innerHeight / 2;
    this.panel.classList.toggle('bottom', lower);
    this.reader.update(view, player);
    const g = this.data.goal;
    const x = g ? (g.x * TILE - view.camX) * view.cssPerPx : -100;
    const y = g ? (g.y * TILE - view.camY) * view.cssPerPx : -100;
    this.goalTag.classList.toggle('show', !!g && x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight);
    if (g) {
      this.goalTag.textContent = g.label;
      placeBubble(this.goalTag, x, y - 18, false, playerRect(view, player));
    }
  }
}

export function createOverlay(options) { return options.town.overlay ? new Overlay(options) : null; }
