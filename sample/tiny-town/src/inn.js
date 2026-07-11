import { drawWater } from './well.js';

export function welcomeGuest(name = '旅人') {
  return `${name}さん、ようこそ。${drawWater()}`;
}
