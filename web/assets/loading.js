// Keep fetch and image failure handling shared without changing request timing or URL resolution.
import { warnOnce } from './warnings.js';

export async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { warnOnce(`img:${url}`, `画像を読み込めません: ${url}`); resolve(null); };
    img.src = url;
  });
}

export const resolve = (src, base) => new URL(src, base).href;
