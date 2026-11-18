// Interpolate, follow the player, draw the scene, then place proximity UI.
export function createScene({ world, player, npcList, characters, smoke, view, renderer, checkSize, updateCamera, simulation, updateNearby, overlay }) {
  const scene = { world, camX: 0, camY: 0, vw: 0, vh: 0, t: 0, player, npcs: npcList, characters, smoke };

  return function render(alpha, frameDt) {
    checkSize();
    for (let i = 0; i < characters.length; i++) characters[i].interpolate(alpha);
    updateCamera(frameDt);
    scene.camX = view.camX; scene.camY = view.camY; scene.vw = view.vw; scene.vh = view.vh; scene.t = simulation.time;
    renderer.render(scene);

    updateNearby(simulation.current, view, frameDt, simulation.playerMoved, overlay);
  };
}
