import { eveningBell } from './cycle-b.js';

export function morningBell() {
  return '朝の鐘';
}

export function nextBell() {
  return eveningBell;
}
