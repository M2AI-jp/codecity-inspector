import { listSupplies } from './storage.js';

export function openMarket() {
  return `市場: ${listSupplies().join('、')}`;
}
