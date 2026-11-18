// Fixed timestep and both scheduling paths; inspection uses this same clock and accumulator.
import { SIM_DT, MAX_FRAME_DT } from './config.js';

export function createLoop({ update, render, simulation, player, view, ui, DEBUG }) {
  let last = performance.now();
  let acc = 0;
  let lastFrameAt = 0;
  let fpsFrames = 0, fpsTime = 0;
  function frame(now) {
    if (!Number.isFinite(now)) now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 24) { update(SIM_DT); acc -= SIM_DT; steps++; }
    if (steps >= 24) acc = 0;
    render(acc / SIM_DT, dt);
    lastFrameAt = now;
    if (DEBUG) {
      fpsFrames++; fpsTime += dt;
      if (fpsTime >= 0.5) { ui.fps(`${Math.round(fpsFrames / fpsTime)} fps  ${player.x.toFixed(1)},${player.y.toFixed(1)}  ${simulation.current ? simulation.current.id : '-'}`); fpsFrames = 0; fpsTime = 0; }
    }
  }
  function rafLoop() {
    frame(performance.now());
    requestAnimationFrame(rafLoop);
  }
  // When rAF is throttled or not firing (hidden tab, automated pane), keep the world moving.
  function timerLoop() {
    if (performance.now() - lastFrameAt > 60) frame(performance.now());
    setTimeout(timerLoop, document.hidden ? 33 : 16);
  }
  return {
    start() { requestAnimationFrame(rafLoop); setTimeout(timerLoop, 100); },
    step(seconds = 1) { const n = Math.round(seconds / SIM_DT); for (let i = 0; i < n; i++) update(SIM_DT); render(1, SIM_DT); last = performance.now(); },
    renderNow() { render(1, 0); },
    // run n frames with synthetic timestamps (hz) and report on-screen player x/y and camera
    frames(n = 60, hz = 60) {
      const out = [];
      for (let i = 0; i < n; i++) {
        frame(last + 1000 / hz);
        out.push([Math.round(player.rx) - view.camX, Math.round(player.ry) - view.camY, view.camX, view.camY]);
      }
      return out;
    },
  };
}
