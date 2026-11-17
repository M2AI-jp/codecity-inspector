// A goal reserves a plot, never an enterable Town.building.
export const GOAL_ART = { castle: 'castle-1' };

export function goalPlot(look, props) {
  const key = GOAL_ART[look], art = props?.[key];
  if (!art?.solid || !art.size || !art.origin || art.deck || art.solids) return null;
  const [sx, sy, sw, sh] = art.solid;
  if (sw <= 0 || sh <= 0 || [sx, sy, sw, sh].some((v) => !Number.isInteger(v / 16))) return null;
  const w = sw / 16, h = sh / 16;
  const top = (art.bounds?.[1] ?? 0) - art.origin[1];
  return { key, w, h, roofRows: Math.ceil(Math.max(0, sy - top) / 16) };
}

export function goalGeometry(prop, art) {
  const [sx, sy, w, h] = art.solid;
  const foot = { x: prop.x * 16 + sx, y: prop.y * 16 + sy, w, h };
  const front = { x: foot.x - 16, y: foot.y + h, w: w + 32, h: 32 };
  const sides = [
    { x: foot.x - 16, y: foot.y, w: 16, h },
    { x: foot.x + w, y: foot.y, w: 16, h },
  ];
  const [bx, by, bw, bh] = art.bounds || [0, 0, ...art.size];
  const image = { x: prop.x * 16 - art.origin[0] + bx, y: prop.y * 16 - art.origin[1] + by, w: bw, h: bh };
  const cells = (r) => {
    const out = [];
    for (let y = Math.floor(r.y / 16); y < Math.ceil((r.y + r.h) / 16); y++) {
      for (let x = Math.floor(r.x / 16); x < Math.ceil((r.x + r.w) / 16); x++) out.push([x, y]);
    }
    return out;
  };
  return { foot, front, sides, image, cells, clearance: [...cells(front), ...sides.flatMap(cells)] };
}
