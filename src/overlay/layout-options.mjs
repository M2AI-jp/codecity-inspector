export function overlayLayoutOptions(overlay) {
  return overlay
    ? { overlay: true, seed: overlay.seed, goalLook: overlay.goal?.look, goalAt: overlay.goal?.at }
    : {};
}
