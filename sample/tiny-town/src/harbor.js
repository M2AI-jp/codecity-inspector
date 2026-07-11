import { listSupplies } from './storage.js';

export function receiveBoat() {
  return `${listSupplies().length}種類の荷を倉庫へ運びました。`;
}
