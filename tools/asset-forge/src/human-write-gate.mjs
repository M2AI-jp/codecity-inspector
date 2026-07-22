import { isatty } from 'node:tty';

// Capture the native function while this module is evaluated. Public write
// operators must not trust mutable `process.*.isTTY` properties on their own.
const nativeIsatty = isatty;

export function assertCanonicalInteractiveTerminal(label = 'Human write') {
  const input = process.stdin;
  const output = process.stdout;
  if (input?.fd !== 0 || output?.fd !== 1
    || nativeIsatty(0) !== true || nativeIsatty(1) !== true
    || input.isTTY !== true || output.isTTY !== true) {
    throw new Error(`${label} requires canonical stdin fd 0 and stdout fd 1 to both be real interactive TTYs`);
  }
}
