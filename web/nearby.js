// Select the nearby speaker / notice, then update the UI in its original priority order.
import { NEAR_RESIDENT, NEAR_KEEPER, NEAR_NOTICE } from './config.js';
import { dojoNotice, dojoSigns } from './notices.js';

export function createNearby({ town, world, player, movers, outdoorKeepers, creatures, ui }) {
  const noticeboards = world.props.filter((p) => p.type === 'noticeboard' && !p.data.overlayId);
  const readme = town.repo && town.repo.readme;
  const dojoSign = dojoNotice(town);

  function nearest(list, maxD, filter) {
    let best = null, bd = maxD * maxD;
    for (const c of list) {
      if (filter && !filter(c)) continue;
      const dx = c.x - player.x, dy = c.y - player.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  const uiState = { building: null, keeper: null, walker: null, notice: null, view: null, player, dt: 0, playerMoved: false };
  return function updateNearby(current, view, frameDt, playerMoved, overlay) {
    uiState.view = view;
    uiState.building = current && current.module ? current : null;
    uiState.keeper = current && current.keeper &&
      Math.hypot(current.keeper.x - player.x, current.keeper.y - player.y) < (current.talkR || NEAR_KEEPER) + (ui.curKeeper === current.keeper ? 24 : 0)
      ? current.keeper : null;
    // outdoors: the keeper of a landmark (the well) answers when you walk up to them
    if (!uiState.keeper && !current) {
      for (const k of outdoorKeepers) {
        if (Math.hypot(k.x - player.x, k.y - player.y) < (k.building.talkR || NEAR_KEEPER) + (ui.curKeeper === k ? 24 : 0)) { uiState.keeper = k; break; }
      }
    }
    uiState.walker = uiState.keeper ? null : nearest(movers, NEAR_RESIDENT);   // one speaker at a time: the keeper's dialogue wins
    uiState.notice = readme && noticeboards.length && nearest(noticeboards, NEAR_NOTICE) ? readme : null;
    if (!uiState.notice && dojoSign) {
      if (nearest(dojoSigns(world), NEAR_NOTICE)) uiState.notice = dojoSign;
    }
    uiState.dt = frameDt;
    uiState.playerMoved = playerMoved;
    const pet = uiState.keeper ? null : creatures.pick(player, uiState.walker);   // a creature nearer than the resident
    if (pet) uiState.walker = null;
    const overlayNear = overlay?.nearest(player);
    if (overlayNear) uiState.keeper = uiState.walker = uiState.notice = null;
    ui.update(uiState);
    overlay?.update(view, player, overlayNear);
    creatures.bubble(view, player, overlayNear ? null : pet);
  };
}
