import { TILE } from '../../web/config.js';
import { artFrom, buildWorld } from './geometry.mjs';

// ゲームの道案内（web/world/navigation.js の tile の格子）でも、出発点からたどれた tile を切り離さない。
// 1px の足元では人や物の脇を通れても、町の人とクリックで歩く主人公はこの格子で道を引く。
// 例: 桟橋と岸をつなぐ唯一の付け根に人が立つと、桟橋が道案内から切り離される。
// 配置用の world（space.mjs）とは別の world を持ち、gate の候補など既存の判定には影響させない。
export function navGuard(town, manifest) {
  const { world, start } = buildWorld(town, artFrom(manifest));
  const cols = world.cols, n = cols * world.rows;
  const startTile = Math.floor((start.y - 3) / TILE) * cols + Math.floor(start.x / TILE);
  const members = (comp) => {
    const m = new Uint8Array(n);
    if (comp >= 0) for (let k = 0; k < n; k++) m[k] = world.navComp[k] === comp ? 1 : 0;
    return m;
  };
  let reached = members(world.navComp[startTile]);
  // 足した矩形を、足した順の逆に取り除く（addRect は rects と各 tile の bucket の末尾に足すだけ）。
  const removeLast = () => {
    const idx = world.rects.length - 1, r = world.rects.pop();
    const tx0 = Math.max(0, Math.floor(r.x / TILE)), ty0 = Math.max(0, Math.floor(r.y / TILE));
    const tx1 = Math.min(cols - 1, Math.floor((r.x + r.w - 0.001) / TILE)), ty1 = Math.min(world.rows - 1, Math.floor((r.y + r.h - 0.001) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const bucket = world.buckets[ty * cols + tx];
      if (bucket && bucket[bucket.length - 1] === idx) bucket.pop();
    }
  };
  // rects を足しても、前にたどれた tile が（ふさがった tile を除いて）出発点と同じ塊に残るか。
  // commit なら残し、そうでなければ元に戻す。
  return function attempt(rects, commit = true) {
    let added = 0;
    for (const r of rects) if (world.addRect(r.x, r.y, r.w, r.h, 'overlay')) added++;
    world.computeNav();
    const comp = world.navComp[startTile];
    let ok = comp >= 0;
    for (let k = 0; ok && k < n; k++) if (reached[k] && !world.nav[k] && world.navComp[k] !== comp) ok = false;
    if (ok && commit) { reached = members(comp); return true; }
    for (let i = 0; i < added; i++) removeLast();
    world.computeNav();
    return ok;
  };
}
