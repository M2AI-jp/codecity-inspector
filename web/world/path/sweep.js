// 足元の直進判定を共有し、道の選択と短縮で同じ当たりを確かめる。
import { FEET_W, FEET_H, FEET_UP } from '../../config.js';

// 足元の矩形がaからbへ直進できるか、途中を刻んで確かめる。
export function sweepFree(world, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len));
  let px = ax, py = ay;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, y = ay + dy * t;
    // 点の間で小物の角を横切る経路も拒む。Player の1px以下の
    // 軸別移動を包む矩形なので、丸めで通れると誤認しない。
    if (world.boxHits(Math.min(px, x) - FEET_W / 2, Math.min(py, y) - FEET_UP,
      Math.max(px, x) + FEET_W / 2, Math.max(py, y) - FEET_UP + FEET_H)) return false;
    px = x; py = y;
  }
  return true;
}
