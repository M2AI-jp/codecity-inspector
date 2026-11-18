// 段と建物の予約: 通常建物を無視する探索でも、施設と歩行面を守るための印を残す。
export function prepareTerrainReservations(T) {
  const { N, id, plaza, placed, terraces, inG } = T;
  const terraceMask = new Uint8Array(N);
  for (const t of terraces || []) {
    for (let y = t.y; y <= t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) if (inG(x, y)) terraceMask[id(x, y)] = 1;
  }
  const doorFront = new Uint8Array(N);
  const buildingWalkRow = new Uint8Array(N);
  const facilityWalkRow = new Uint8Array(N);
  const fixedFoot = new Uint8Array(N), fixedRoof = new Uint8Array(N), fixedFront = new Uint8Array(N), fixedDoorFront = new Uint8Array(N);
  for (const p of placed) {
    const dc = p.doorCol ?? p.x + p.spec.doorDx;
    for (let x = p.x; x < p.x + p.w; x++) if (inG(x, p.yb + 1)) {
      buildingWalkRow[id(x, p.yb + 1)] = 1;
      if (p.spec.facility) facilityWalkRow[id(x, p.yb + 1)] = 1;
    }
    for (let x = p.x; x < p.x + p.w; x++) {
      for (let y = p.y; y <= p.yb; y++) if (inG(x, y) && p.spec.facility) fixedFoot[id(x, y)] = 1;
      for (let y = p.y - (p.spec.roofRows ?? 2); y < p.y; y++) if (inG(x, y) && p.spec.facility) fixedRoof[id(x, y)] = 1;
      for (let y = p.yb + 1; y < (p.track?.sd?.[x - p.track.x0] ?? p.yb + 1); y++) if (inG(x, y) && p.spec.facility) fixedFront[id(x, y)] = 1;
    }
    for (let y = p.yb + 1; y <= p.yb + 2; y++) if (inG(dc, y)) {
      doorFront[id(dc, y)] = 1;
      if (p.spec.facility) fixedDoorFront[id(dc, y)] = 1;
    }
  }
  const inPlaza = (x, y) => x >= plaza.x0 && x <= plaza.x1 && y >= plaza.y0 && y <= plaza.y1;
  Object.assign(T, { terraceMask, doorFront, buildingWalkRow, facilityWalkRow, fixedFoot, fixedRoof, fixedFront, fixedDoorFront, inPlaza });
}
