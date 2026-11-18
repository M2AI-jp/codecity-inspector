// Share one warning registry across loaders and existing callers to keep duplicate warnings suppressed.
const warned = new Set();
export function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[codecity] ${msg}`);
}
