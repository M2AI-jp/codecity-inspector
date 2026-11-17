import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { artFrom, buildWorld } from './geometry.mjs';
import { reachGrid } from './reach.mjs';
import { tileReach } from './tile-reach.mjs';
import { overlayGround } from './terrain.mjs';
import { resolveAt, doorChoices } from './resolve.mjs';
import { propCells, coverOf } from '../town-grid.mjs';
import { loadProps } from '../layout/manifest.mjs';
import { hash32 } from '../layout/util.mjs';
import { KEEPER_BOX } from '../../web/config.js';

export const defaultManifest = () => JSON.parse(readFileSync(new URL('../../art/game/manifest.json', import.meta.url), 'utf8'));
const sign = (p) => ['sign-passed', 'sign-failed', 'sign-unverified'].includes(p.type);
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const layoutKey = (overlay) => hash({ seed: overlay.seed, groups: overlay.groups });
const xy = (x, y) => `${x},${y}`;

function cutCandidates(world) {
  // Candidate filter only; reach.cutTile verifies each cut on the full pixel graph.
  const n = world.cols * world.rows, time = new Int32Array(n), low = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1), child = new Int32Array(n), cuts = new Set();
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let stamp = 0;
  for (let root = 0; root < n; root++) {
    if (world.nav[root] || time[root]) continue;
    time[root] = low[root] = ++stamp;
    const stack = [[root, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1], [v, d] = frame;
      if (d < 8) {
        frame[1]++;
        if (!(world.edges[v] & (1 << d))) continue;
        const u = v + dirs[d][0] + dirs[d][1] * world.cols;
        if (!time[u]) {
          parent[u] = v; child[v]++; time[u] = low[u] = ++stamp; stack.push([u, 0]);
        } else if (u !== parent[v]) low[v] = Math.min(low[v], time[u]);
      } else {
        stack.pop();
        const p = parent[v];
        if (p >= 0) {
          low[p] = Math.min(low[p], low[v]);
          if (parent[p] >= 0 && low[v] >= time[p]) cuts.add(p);
        } else if (child[v] > 1) cuts.add(v);
      }
    }
  }
  return [...cuts].map((k) => ({ x: k % world.cols + .5, y: Math.floor(k / world.cols) + 1 }));
}

export function placeOverlay(base, overlay, manifest = defaultManifest()) {
  const hideDojoSigns = overlay.markers.some((m) => m.kind === 'record');
  const nativeSigns = base.props.filter(sign).map((p, i) => ({ ...p, overlayId: `native:dojo:${i}` }));
  const town = { ...base, ground: overlayGround(base), props: base.props.filter((p) => !sign(p)),
    unplaced: [...(base.unplaced || []).filter((u) => !u.overlay), ...overlay.rejected] };
  if (!hideDojoSigns) town.props.push(...nativeSigns);
  const data = { version: 1, layoutKey: layoutKey(overlay),
    ...(overlay.source ? { source: overlay.source } : {}), ...(overlay.title ? { title: overlay.title } : {}),
    hideDojoSigns, markers: [], people: [], goal: null, props: hideDojoSigns ? [] : [...nativeSigns], unplaced: [] };
  const { world, start } = buildWorld(town, artFrom(manifest));
  const reach = reachGrid(world, start);
  const propArt = loadProps(manifest), occupied = new Set(), reserved = new Set(), doors = new Set(), targets = [], addedRects = [];
  const keepTilePaths = tileReach(town, propArt);
  const reserve = (x0, y0, x1, y1, set = reserved) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set.add(xy(x, y));
  };
  for (const b of world.buildings) {
    const cover = coverOf(b.data, manifest.archetypes);
    for (let x = b.x; x < b.x + b.w; x++) reserve(x, b.y - (cover?.[x - b.x] ?? 2), x, b.y + b.h - 1, occupied);
    reserve(b.x, b.y + b.h, b.x + b.w - 1, b.y + b.h);
    reserve(b.doorX0 - 1, b.y + b.h, b.doorX1, b.y + b.h + 1);
  }
  for (const s of town.stairs || []) reserve(s.x - 1, s.y - 2, s.x + s.w, s.y + 2);
  for (const p of town.props) for (const [x, y] of propCells(p, propArt)) occupied.add(xy(x, y));
  reserve(Math.floor(start.x / 16), Math.floor(start.y / 16), Math.floor(start.x / 16), Math.floor(start.y / 16));
  for (const l of town.landmarks || []) if (l.keeper) {
    reserve(Math.floor(l.keeper.x), Math.floor(l.keeper.y), Math.floor(l.keeper.x), Math.floor(l.keeper.y), occupied);
  }
  const cellOK = (x, y) => x >= 0 && y >= 0 && x < town.cols && y < town.rows &&
    '.#:+'.includes(town.ground[y][x]) && !occupied.has(xy(x, y)) && !reserved.has(xy(x, y));
  const boxes = (p) => {
    const def = manifest.props[p.look || p.type];
    return (def?.solids || (def?.solid ? [def.solid] : [])).map(([x, y, w, h]) => ({ x: p.x * 16 + x, y: p.y * 16 + y, w, h }));
  };
  const clearRects = (rs) => rs.every((r) => !world.boxHits(r.x, r.y, r.x + r.w, r.y + r.h) &&
    !addedRects.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y));
  const accessible = (seen, extra = []) => [...targets, ...extra].every((p) => reach.near(seen, p.x * 16, p.y * 16));
  const reject = (v, scope, reason) => town.unplaced.push({ overlay: true, scope, id: v.id, reason });
  const nearby = (target, radius = 6) => {
    const out = [];
    for (let y = Math.max(0, Math.floor(target.y) - radius); y <= Math.min(town.rows - 1, Math.floor(target.y) + radius); y++) {
      for (let x = Math.max(0, Math.floor(target.x) - radius); x <= Math.min(town.cols - 1, Math.floor(target.x) + radius); x++) {
        out.push({ x: x + .5, y: y + 1 });
      }
    }
    return out.sort((a, b) => (a.x - target.x) ** 2 + (a.y - target.y) ** 2 -
      (b.x - target.x) ** 2 - (b.y - target.y) ** 2 || a.y - b.y || a.x - b.x);
  };
  const personSpot = (target, extra = [], commit = true) => {
    for (const p of nearby(target)) {
      p.y -= 5 / 16; // same standing feet as the runtime navPoint
      if (!cellOK(Math.floor(p.x), Math.floor(p.y))) continue;
      const r = { x: p.x * 16 + KEEPER_BOX[0], y: p.y * 16 + KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] };
      if (!clearRects([r]) || !reach.seen[Math.round(p.y * 16) * reach.W + Math.round(p.x * 16)]) continue;
      if (reach.attempt([r], (seen) => accessible(seen, [...extra, p]), commit)) {
        if (commit) addedRects.push(r);
        return p;
      }
    }
    return null;
  };
  const doorSpots = (b) => {
    const wb = world.buildings.find((w) => w.id === b.id), out = [];
    for (let dy = 0; dy <= 1; dy++) for (let offset = 0; offset <= 2; offset++) {
      out.push({ x: wb.doorX0 - 1.5 - offset, y: b.y + b.h + 1 + dy });
      out.push({ x: wb.doorX1 + 1.5 + offset, y: b.y + b.h + 1 + dy });
    }
    return out.filter((p) => p.x >= b.x - 2 && p.x <= b.x + b.w + 2);
  };
  let cuts;
  for (const m of overlay.markers) {
    const target = resolveAt(town, m.at, { kind: m.kind, markers: data.markers });
    if (target.reason) { reject(m, 'markers', target.reason); continue; }
    const type = m.kind === 'record' ? `sign-${m.state}` : m.kind === 'board' ? 'noticeboard' : 'gate';
    if (!manifest.props?.[type]) { reject(m, 'markers', `missing art: ${type}`); continue; }
    if (m.kind === 'gate' && !manifest.characters?.keepers?.gate) { reject(m, 'markers', 'missing art: gate keeper'); continue; }
    const choices = doorChoices(town, target);
    let placed = null;
    const candidates = m.kind === 'gate' ? (cuts ||= cutCandidates(world))
      .filter((p) => Math.hypot(p.x - target.x, p.y - target.y) <= 16)
      .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))
      .map((p) => ({ ...p, building: target.building?.id }))
      : choices.length ? choices.filter((b) => !doors.has(b.id)).flatMap((b) => doorSpots(b).map((p) => ({ ...p, building: b.id })))
        : nearby(target, 5);
    for (const pos of candidates) {
      if (pos.building && doors.has(pos.building)) continue;
      const prop = { type, look: type, x: pos.x, y: pos.y, overlayId: `marker:${m.id}` };
      const cells = propCells(prop, propArt), rs = boxes(prop);
      if (!cells.every(([x, y]) => cellOK(x, y)) || !clearRects(rs) || !keepTilePaths(cells)) continue;
      let keeper;
      if (m.kind === 'gate') {
        const def = manifest.props.gate, op = def.opening;
        if (!op || !manifest.characters?.keepers?.gate) continue;
        const top = pos.y * 16 - (def.origin?.[1] || 88), left = pos.x * 16 - (def.origin?.[0] || 48);
        if (world.buildings.some((b) => left < b.px + b.pw && left + (def.size?.[0] || 96) > b.px &&
          top < b.bottomPx && pos.y * 16 > b.py - (b.arch?.exteriorOrigin?.[1] || 0))) continue;
        if (!reach.cutTile(Math.floor(pos.x), Math.floor(pos.y - 1))) continue;
        // Both ends and every pixel of the central passage must remain walkable.
        const cx = Math.round(pos.x * 16 + op[0] + op[2] / 2);
        let through = true;
        for (let y = Math.round(pos.y * 16 + op[1] - 8); y <= Math.round(pos.y * 16 + op[1] + op[3] + 10); y++) {
          if (!reach.seen[y * reach.W + cx]) { through = false; break; }
        }
        if (!through) continue;
        keeper = personSpot({ x: pos.x + 3.5, y: pos.y + 1 }, [pos], false);
        if (!keeper) continue;
        const kr = { x: keeper.x * 16 + KEEPER_BOX[0], y: keeper.y * 16 + KEEPER_BOX[1], w: KEEPER_BOX[2], h: KEEPER_BOX[3] };
        if (rs.some((r) => r.x < kr.x + kr.w && r.x + r.w > kr.x && r.y < kr.y + kr.h && r.y + r.h > kr.y)) continue;
        rs.push(kr);
      }
      if (!reach.attempt(rs, (seen) => accessible(seen, [pos, ...(keeper ? [keeper] : [])]))) continue;
      keepTilePaths(cells, true);
      addedRects.push(...rs);
      for (const [x, y] of cells) occupied.add(xy(x, y));
      if (keeper) occupied.add(xy(Math.floor(keeper.x), Math.floor(keeper.y)));
      placed = { ...m, x: pos.x, y: pos.y, ...(pos.building ? { building: pos.building } : {}), ...(keeper ? { keeper } : {}) };
      town.props.push(prop); data.props.push(prop); data.markers.push(placed); targets.push(placed);
      if (keeper) targets.push(keeper);
      if (pos.building) doors.add(pos.building);
      break;
    }
    if (!placed) reject(m, 'markers', m.kind === 'gate' ? 'no safe walkable cut point for gate and keeper'
      : choices.length ? 'no safe free doorway in district' : 'no safe space near plaza or landmark');
  }
  for (const p of overlay.people) {
    const target = resolveAt(town, p.at, { kind: 'person', markers: data.markers });
    if (target.reason) { reject(p, 'people', target.reason); continue; }
    if (!manifest.characters?.townsfolk?.length) { reject(p, 'people', 'missing townsfolk art'); continue; }
    const pos = personSpot(target);
    if (!pos) { reject(p, 'people', 'no safe reachable space for person'); continue; }
    const person = { ...p, look: p.look ?? hash32(p.id), ...pos };
    data.people.push(person); targets.push(person); occupied.add(xy(Math.floor(pos.x), Math.floor(pos.y)));
  }
  if (overlay.goal) {
    const g = overlay.goal, target = resolveAt(town, g.at, { kind: 'goal', markers: data.markers });
    const pos = !target.reason && nearby(target).map((p) => ({ x: p.x, y: p.y - 5 / 16 })).find((p) =>
      cellOK(Math.floor(p.x), Math.floor(p.y)) && reach.seen[Math.round(p.y * 16) * reach.W + Math.round(p.x * 16)]);
    if (pos) data.goal = { ...g, ...pos };
    else reject(g, 'goal', target.reason || 'no reachable goal location');
  }
  data.unplaced = town.unplaced.filter((u) => u.overlay);
  data.revision = hash(data);
  town.overlay = data;
  return town;
}
