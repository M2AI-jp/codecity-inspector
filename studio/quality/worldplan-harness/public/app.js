import { createHarnessViewModel } from './index.mjs';

const fileInput = document.querySelector('#plan-file');
const jsonInput = document.querySelector('#plan-json');
const renderButton = document.querySelector('#render-plan');
const inputStatus = document.querySelector('#input-status');
const canvasStatus = document.querySelector('#canvas-status');
const canvas = document.querySelector('#world-canvas');
const context = canvas.getContext('2d');
const summary = document.querySelector('#summary');
const evidenceColumns = document.querySelector('#evidence-columns');
const errorsPanel = document.querySelector('#errors-panel');
const errorsList = document.querySelector('#errors-list');

let loadedText = '';

fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files ?? [];
  if (!file) return;
  loadedText = await file.text();
  jsonInput.value = loadedText;
  inputStatus.textContent = `${file.name} loaded locally; render to validate.`;
});

renderButton.addEventListener('click', () => render(jsonInput.value || loadedText));

function render(input) {
  const result = createHarnessViewModel(input);
  errorsPanel.hidden = result.ok;
  errorsList.replaceChildren();
  if (!result.ok) {
    result.errors.forEach((item) => {
      const row = document.createElement('li');
      row.textContent = `${item.path} [${item.code}] ${item.message}`;
      errorsList.append(row);
    });
    inputStatus.textContent = 'Plan rejected. No town view was drawn.';
    canvasStatus.textContent = 'Schema errors are shown below; data was not invented.';
    clearCanvas();
    return;
  }
  inputStatus.textContent = 'WorldPlan v1 accepted as logical data.';
  canvasStatus.textContent = 'Logical coordinates only; no art or runtime scene is loaded.';
  draw(result.view);
  updateSummary(result.view);
  updateEvidence(result.view);
}

function clearCanvas() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#0c1114';
  context.fillRect(0, 0, canvas.width, canvas.height);
  summary.querySelectorAll('dd').forEach((node) => { node.textContent = '—'; });
  evidenceColumns.replaceChildren();
}

function updateSummary(view) {
  const values = [view.identity.name, `${view.counts.terrain} cells`, `${view.counts.plots} (${view.counts.occupiedPlots} occupied)`, `${view.counts.npcs} / ${view.counts.quests}`];
  summary.querySelectorAll('dd').forEach((node, index) => { node.textContent = values[index]; });
}

function updateEvidence(view) {
  evidenceColumns.replaceChildren();
  for (const state of ['observed', 'inferred', 'unknown']) {
    const column = document.createElement('article');
    column.className = `evidence-column ${state}`;
    const heading = document.createElement('h3');
    heading.textContent = state[0].toUpperCase() + state.slice(1);
    column.append(heading);
    const list = document.createElement('ul');
    const entries = view.evidence[state];
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'No claims supplied.';
      list.append(empty);
    } else {
      entries.forEach((entry) => {
        const row = document.createElement('li');
        row.textContent = entry.source ? `${entry.claim} (${entry.source})` : entry.claim;
        list.append(row);
      });
    }
    column.append(list);
    evidenceColumns.append(column);
  }
}

function draw(view) {
  const padding = 24;
  const cellSize = Math.max(18, Math.min((canvas.width - padding * 2) / view.grid.columns, (canvas.height - padding * 2) / view.grid.rows));
  canvas.width = Math.ceil(view.grid.columns * cellSize + padding * 2);
  canvas.height = Math.ceil(view.grid.rows * cellSize + padding * 2);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#0c1114';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const colors = { meadow: '#78976d', coast: '#6b8d91', terrace: '#82785e', basin: '#6c806b', plain: '#78976d' };
  context.fillStyle = colors[view.terrain] ?? '#44515a';
  context.fillRect(padding, padding, view.grid.columns * cellSize, view.grid.rows * cellSize);
  context.fillStyle = '#4e7d9d';
  view.water.forEach((point) => context.fillRect(padding + point.x * cellSize, padding + point.y * cellSize, cellSize, cellSize));
  context.strokeStyle = 'rgba(14, 23, 25, .35)';
  context.lineWidth = 1;
  for (let x = 0; x <= view.grid.columns; x += 1) { context.beginPath(); context.moveTo(padding + x * cellSize, padding); context.lineTo(padding + x * cellSize, padding + view.grid.rows * cellSize); context.stroke(); }
  for (let y = 0; y <= view.grid.rows; y += 1) { context.beginPath(); context.moveTo(padding, padding + y * cellSize); context.lineTo(padding + view.grid.columns * cellSize, padding + y * cellSize); context.stroke(); }

  view.roads.forEach((road) => {
    context.strokeStyle = '#e8d39c';
    context.lineWidth = Math.max(3, cellSize * .22);
    context.beginPath();
    road.points.forEach((point, index) => {
      const x = padding + (point.x + .5) * cellSize;
      const y = padding + (point.y + .5) * cellSize;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  });
  view.plots.forEach((plot) => {
    const x = padding + plot.cell.x * cellSize;
    const y = padding + plot.cell.y * cellSize;
    context.strokeStyle = plot.occupancy === 'vacant' ? '#e6d56a' : '#f4e78e';
    context.lineWidth = 2;
    context.strokeRect(x + 2, y + 2, plot.cell.width * cellSize - 4, plot.cell.height * cellSize - 4);
    if (plot.occupancy !== 'vacant') {
      context.fillStyle = 'rgba(236, 223, 117, .23)';
      context.fillRect(x + 3, y + 3, plot.cell.width * cellSize - 6, plot.cell.height * cellSize - 6);
    }
    context.fillStyle = '#eef4df';
    context.font = `${Math.max(8, Math.min(13, cellSize * .35))}px ui-monospace`;
    context.fillText(plot.id, x + 5, y + 14);
  });
  view.quests.forEach((quest) => {
    const plot = view.plots.find((candidate) => candidate.id === quest.plotId);
    if (!plot) return;
    const x = padding + (plot.cell.x + plot.cell.width - .35) * cellSize;
    const y = padding + (plot.cell.y + .35) * cellSize;
    context.fillStyle = '#b89bed';
    context.beginPath(); context.arc(x, y, Math.max(4, cellSize * .16), 0, Math.PI * 2); context.fill();
  });
  view.npcs.forEach((npc) => {
    if (!npc.position) return;
    const x = padding + (npc.position.x + .5) * cellSize;
    const y = padding + (npc.position.y + .5) * cellSize;
    context.fillStyle = '#e68686';
    context.beginPath(); context.arc(x, y, Math.max(5, cellSize * .2), 0, Math.PI * 2); context.fill();
    context.fillStyle = '#fff4e8';
    context.font = `${Math.max(8, Math.min(12, cellSize * .3))}px ui-monospace`;
    context.fillText(npc.name, x + 5, y - 5);
  });
}

clearCanvas();
