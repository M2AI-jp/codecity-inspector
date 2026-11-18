// Enter / Space read on or take the offer; the open roster borrows left / right.
// Up / down and WASD still walk, and walking away closes the roster.

export function onKey(ui, e) {
  if (e.defaultPrevented) return;
  if (ui.rosterOpen) {
    const n = (ui.rosterPagesList || []).length || 1;
    if (e.code === 'ArrowLeft' || e.code === 'KeyQ') { ui.rosterTab = (ui.rosterTab + n - 1) % n; ui.renderRoster(); e.preventDefault(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyE') { ui.rosterTab = (ui.rosterTab + 1) % n; ui.renderRoster(); e.preventDefault(); }
    else if (e.code === 'Escape') { ui.closeRoster(); e.preventDefault(); }
    return;
  }
  if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return;
  if (ui.offerReady && ui.dlgKeeper) { ui.openRoster(ui.dlgKeeper); e.preventDefault(); }
  else if (ui.dlg) { ui.skip(); e.preventDefault(); }
}
