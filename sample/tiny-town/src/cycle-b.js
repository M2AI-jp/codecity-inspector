import { morningBell } from './cycle-a.js';

export function eveningBell() {
  return '夕べの鐘';
}

export function nextBell() {
  return morningBell;
}
