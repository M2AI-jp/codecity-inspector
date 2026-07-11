import { openMarket } from './market.js';
import { receiveBoat } from './harbor.js';
import { tendGarden } from './garden.js';
import { raiseWatch } from './watchtower.js';

export function openPlaza() {
  return [openMarket(), receiveBoat(), tendGarden(), raiseWatch()].join(' / ');
}
