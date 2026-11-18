// Critically damped player tracking and native-pixel camera rounding.
import { CAMERA_OMEGA, CAMERA_LOOK_UP, CAMERA_LEAD } from './config.js';

export function createCamera({ player, world, view, ui }) {
  const cam = { x: 0, y: 0, vx: 0, vy: 0 };
  const clampCam = (v, size, worldSize) => (worldSize <= size ? (worldSize - size) / 2 : Math.max(0, Math.min(worldSize - size, v)));
  cam.x = clampCam(player.x - view.vw / 2, view.vw, world.W);
  cam.y = clampCam(player.y - CAMERA_LOOK_UP - view.vh / 2, view.vh, world.H);
  function updateCamera(dt) {
    // look slightly ahead along the velocity so running never hides what is in front
    const tx = player.rx - view.vw / 2 + player.vx * CAMERA_LEAD;
    let ty = player.ry - CAMERA_LOOK_UP - view.vh / 2 + player.vy * CAMERA_LEAD * 0.8;
    // while a panel is docked, frame the player away from it
    if (ui.talking) ty += (ui.dock === 'top' ? -1 : 1) * view.vh * 0.17;
    const w = CAMERA_OMEGA;
    let remaining = Math.min(dt, 0.1);
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 120);
      remaining -= h;
      cam.vx += (-2 * w * cam.vx - w * w * (cam.x - tx)) * h;
      cam.vy += (-2 * w * cam.vy - w * w * (cam.y - ty)) * h;
      cam.x += cam.vx * h; cam.y += cam.vy * h;
    }
    const cx = clampCam(cam.x, view.vw, world.W), cy = clampCam(cam.y, view.vh, world.H);
    if (cx !== cam.x) { cam.x = cx; cam.vx = 0; }
    if (cy !== cam.y) { cam.y = cy; cam.vy = 0; }
    // Round relative to the player's rounded position so the player never jitters against
    // the screen while the world scrolls in whole native pixels.
    const prx = Math.round(player.rx), pry = Math.round(player.ry);
    let rx = prx - Math.round(player.rx - cam.x), ry = pry - Math.round(player.ry - cam.y);
    if (world.W > view.vw) rx = Math.max(0, Math.min(world.W - view.vw, rx)); else rx = Math.round(cam.x);
    if (world.H > view.vh) ry = Math.max(0, Math.min(world.H - view.vh, ry)); else ry = Math.round(cam.y);
    view.camX = rx; view.camY = ry;
  }

  return { cam, updateCamera };
}
