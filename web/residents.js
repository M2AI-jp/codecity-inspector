// 住人・番人・町の人を作る入口。公開名と生成順を保つ。
import { strHash } from './util.js';
import { KEEPER_BOX } from './config.js';
import { MAT } from './ground.js';
import { Walker } from './residents/walker.js';
import { KEEPER_ROLE, KEEPER_STAND_IN, kindOf, Keeper, LandmarkKeeper, keeperSheet } from './residents/keeper.js';
import { Local } from './residents/local.js';

export { Walker, KEEPER_ROLE, KEEPER_STAND_IN, kindOf, Keeper, LandmarkKeeper, Local };

// Every building with room inside gets the keeper of its kind; every outdoor facility
// (town.landmarks) its keeper beside it; every contributor walks the streets once, as
// townsfolk[look % count]; every external agent (town.contractors) sends one agent who walks
// among the buildings it worked on. Missing art means nobody is drawn for that slot — except
// with ?debug=1, where outlines stand in so the layout can be inspected.
export function createResidents(town, world, art, debug) {
  const out = { walkers: [], keepers: [], locals: [], contractors: [] };
  for (const b of world.buildings) {
    if (!b.keeperSpot || !b.module) continue;
    const kind = kindOf(b);
    const sheet = keeperSheet(art, kind);
    if (!sheet && !debug) continue;
    const k = new Keeper(kind, sheet, b, strHash(`keeper:${b.id}`));
    b.keeper = k;
    out.keepers.push(k);
  }
  for (const l of Array.isArray(town.landmarks) ? town.landmarks : []) {
    const kind = l && (l.archetype || (l.facility && l.facility.archetype));
    if (!kind || !KEEPER_ROLE[kind] || !l.keeper || !Number.isFinite(l.keeper.x) || !Number.isFinite(l.keeper.y)) continue;
    const sheet = keeperSheet(art, kind);
    if (!sheet && !debug) continue;
    out.keepers.push(new LandmarkKeeper(kind, sheet, l, world, strHash(`keeper:${l.id}`)));
  }
  // 番人は立ち止まる: 歩く人を作る前に、番人の当たりを足して道案内を作り直す。
  // 先に作ると、外に立つ番人（井戸・門など）と同じ所に町の人が出て、重なったまま動けなくなる。
  for (const k of out.keepers) world.addRect(k.x + KEEPER_BOX[0], k.y + KEEPER_BOX[1], KEEPER_BOX[2], KEEPER_BOX[3], 'npc');
  if (out.keepers.length || town.overlay) world.computeNav();
  const folk = art.townsfolk.filter(Boolean);
  const byId = new Map(world.buildings.map((b) => [b.id, b]));
  // 外部工務店の代理人: its own picture, else a townsperson's look (warned once)
  const cs = Array.isArray(town.contractors) ? town.contractors : [];
  if (cs.length && !art.contractor && folk.length) console.info('[codecity] 外部工務店の代理人の絵がないので、町の人の姿で歩かせる');
  for (const def of cs) {
    const homes = (def.homes || []).map((id) => byId.get(id)).filter((b) => b && b.doorOutside);
    const sheet = art.contractor || (folk.length ? folk[strHash(`contractor:${def.name}`) % folk.length] : null);
    if (!homes.length || (!sheet && !debug)) continue;
    const w = new Walker(def, sheet, world, homes, strHash(`contractor:${def.id}:${def.name}`));
    w.contractor = true;
    w.agentName = def.name;
    w.name = '外部工務店の代理人';
    out.contractors.push(w);
  }
  if (!folk.length && !debug) return out;
  const defs = Array.isArray(town.residents) ? town.residents : [];
  for (const def of defs) {
    const homes = (def.homes || []).map((id) => byId.get(id)).filter(Boolean);
    if (!homes.length) continue;
    const sheet = folk.length ? folk[((def.look | 0) % folk.length + folk.length) % folk.length] : null;
    out.walkers.push(new Walker(def, sheet, world, homes, strHash(String(def.id || def.name))));
  }
  // 常連（town.crowd）: 自分の建物の近くを歩き、ときどき広場やほかの建物へ。立ち止まり、見回し、二人で立ち話
  const plaza = [];
  for (let k = 0; k < world.grid.length; k++) if (world.grid[k] === MAT.PLAZA && world.nav[k] === 0) plaza.push(k);
  const shared = { plaza, locals: out.locals, buildings: world.buildings.filter((b) => b.doorOutside) };
  for (const def of Array.isArray(town.crowd) ? town.crowd : []) {
    const home = byId.get(def.home);
    if (!home || !home.doorOutside) continue;
    const sheet = folk.length ? folk[((def.look | 0) % folk.length + folk.length) % folk.length] : null;
    out.locals.push(new Local(def, sheet, world, home, strHash(`local:${def.id}:${def.home}`), shared));
  }
  return out;
}
