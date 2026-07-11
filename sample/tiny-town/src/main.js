import { welcomeGuest } from './inn.js';
import { drawWater } from './well.js';
import { morningBell } from './cycle-a.js';
import { openPlaza } from './plaza.js';
import { missingSign } from './missing-sign.js';

export function openTown(visitor) {
  return [welcomeGuest(visitor), drawWater(), morningBell(), openPlaza(), missingSign()].join('\n');
}
