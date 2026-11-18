// Dock panels opposite the player and hide corner badges beneath the player.
// Hysteresis keeps classes unchanged until a threshold is crossed.

export function layout(ui, s) {
  const v = s.view, p = s.player;
  const W = window.innerWidth, H = window.innerHeight;
  const px = (Math.round(p.rx) - v.camX) * v.cssPerPx;
  const py = (Math.round(p.ry) - 14 - v.camY) * v.cssPerPx;      // body centre
  const r = 18 * v.cssPerPx;                                       // player sprite half-size
  let dock = ui.dock || 'bottom', side = ui.side || 'right';
  // dock where the panel actually fits without reaching the player
  const ph = ui.panelH || 160;
  const below = H - 18 - (py + r), above = (py - r) - 32;
  if (dock === 'bottom' && below < ph + 8 && above > below) dock = 'top';
  else if (dock === 'top' && above < ph + 8 && below > above) dock = 'bottom';
  if (side === 'right' && px > W * 0.56) side = 'left'; else if (side === 'left' && px < W * 0.44) side = 'right';
  const underTL = px - r < 380 && py - r < 90;
  const underBL = px - r < 760 && py + r > H - 70;
  const root = ui.root || (ui.root = document.getElementById('ui'));
  if (dock !== ui.dock) { root.classList.toggle('dock-top', dock === 'top'); ui.dock = dock; }
  if (side !== ui.side) { root.classList.toggle('side-left', side === 'left'); ui.side = side; }
  const talking = !!ui.dlg || ui.noticeShown;
  if (talking !== ui.talking) { root.classList.toggle('talking', talking); ui.talking = talking; }
  if (underTL !== ui.underTL) { root.classList.toggle('under-tl', underTL); ui.underTL = underTL; }
  if (underBL !== ui.underBL) { root.classList.toggle('under-bl', underBL); ui.underBL = underBL; }
}
