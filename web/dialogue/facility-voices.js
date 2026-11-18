// 施設の番人の言い方。facility.facts にある事実だけを話す。
// 呼び出し側と施設の並び順を保つため、施設別の台詞をここで束ねる。
import { townHallVoice } from './facility-voices/town-hall.js';
import { innVoice } from './facility-voices/inn.js';
import { pubVoice } from './facility-voices/pub.js';
import { warehouseVoice } from './facility-voices/warehouse.js';
import { watchtowerVoice } from './facility-voices/watchtower.js';
import { dojoVoice } from './facility-voices/dojo.js';
import { repairVoice } from './facility-voices/repair.js';
import { wellVoice } from './facility-voices/well.js';
import { gateVoice } from './facility-voices/gate.js';
import { dockVoice } from './facility-voices/dock.js';

export const FACILITY_VOICE = {
  town_hall: townHallVoice,
  inn: innVoice,
  pub: pubVoice,
  warehouse: warehouseVoice,
  watchtower: watchtowerVoice,
  dojo: dojoVoice,
  repair: repairVoice,
  well: wellVoice,
  gate: gateVoice,
  dock: dockVoice,
};
