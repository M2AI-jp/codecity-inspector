// CSS-pixel rectangles shared by speech bubbles and overlay labels.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(Math.max(lo, hi), n));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function playerRect(view, player) {
  const s = player.sheet, scale = view.cssPerPx;
  return {
    x: (Math.round(player.rx) - (s?.px ?? 16) - view.camX) * scale,
    y: (Math.round(player.ry) - (s?.py ?? 31) - view.camY) * scale,
    w: (s?.fw ?? 32) * scale, h: (s?.fh ?? 32) * scale,
  };
}

export function screenPosition({ x, y, w, h, below = false, avoid }, W, H) {
  const margin = 8;
  const fit = (x, y) => ({ x: clamp(x, margin, W - w - margin), y: clamp(y, margin, H - h - margin), w, h });
  const at = fit(x - w / 2, below ? y : y - h);
  if (!avoid || !overlaps(at, avoid)) return at;
  // Try above the head first, then below / beside the whole sprite at screen edges.
  const candidates = [
    fit(at.x, avoid.y - h - margin), fit(at.x, avoid.y + avoid.h + margin),
    fit(avoid.x - w - margin, at.y), fit(avoid.x + avoid.w + margin, at.y),
  ];
  return candidates.find((r) => !overlaps(r, avoid)) || at;
}

export function placeBubble(el, x, y, below, avoid) {
  const p = screenPosition({ x, y, below, avoid, w: el.offsetWidth, h: el.offsetHeight }, innerWidth, innerHeight);
  const transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  if (el.style.transform !== transform) el.style.transform = transform;
}
