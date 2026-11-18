import { esc } from './dom.js';

export function updateNotice(ui, s) {
  // README boards and the dojo's recorded status sign
  const showNotice = !!s.notice && !s.keeper;
  if (showNotice !== ui.noticeShown || (showNotice && s.notice !== ui.noticeFor)) {
    ui.noticeShown = showNotice;
    ui.noticeFor = showNotice ? s.notice : null;
    if (showNotice) {
      const r = s.notice;
      const lines = r.lines || (r.excerpt ? [r.excerpt] : []);
      ui.noticeReader.content.innerHTML = `<div class="label">${esc(r.label || '掲示板')}</div>${r.title ? `<div class="title">${esc(r.title)}</div>` : ''}${lines.map((line) => `<p>${esc(line)}</p>`).join('')}`;
      ui.noticeReader.reset();
      ui.el.notice.classList.add('show');
      ui.panelH = ui.el.notice.offsetHeight;
    } else ui.el.notice.classList.remove('show');
  }
  ui.noticeReader.update(s.view, s.player);
}
