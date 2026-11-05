import { mountTown } from '/runtime.mjs';

const canvas = document.querySelector('canvas');
const status = document.querySelector('#status');
try {
  const response = await fetch('/scene.json');
  if (!response.ok) throw new Error('街のデータを読み込めませんでした。');
  const scene = await response.json();
  document.querySelector('#repository').textContent = scene.repository.name;
  document.title = `${scene.repository.name} — CodeCity`;
  await mountTown({ canvas, scene });
  status.textContent = '';
} catch (error) {
  status.textContent = `街を表示できませんでした: ${error.message}`;
}
