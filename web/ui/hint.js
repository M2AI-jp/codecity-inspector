// The controls hint fades after movement and stays clear of dialogue and notices.

export function updateHint(ui, s) {
  // controls hint fades after the player has moved around for a bit; never covers a dialogue
  if (ui.el.hint) {
    if (ui.hintTime < 6 && s.playerMoved) ui.hintTime += s.dt;
    const want = ui.hintTime < 6 && !ui.dlg && !ui.noticeShown && !ui.introOn;   // the intro already shows the controls
    if (want !== ui.hintShown) { ui.hintShown = want; ui.el.hint.classList.toggle('show', want); }
  }
}
