const DEFAULT_FOOT = { house_s: [5, 4], house_m: [6, 4], house_l: [7, 5], shop: [6, 4], workshop: [7, 5], ruin: [6, 4], repair: [6, 4] };
const DOOR_DX = { house_s: 2, house_m: 2, house_l: 3, shop: 2, workshop: 3, ruin: 2 };
// 施設（PRODUCT.md §4）。art manifest にその archetype の絵があるものだけを置く（作ったものだけを置く）。
const FACILITY_NAME = { town_hall: '役場', inn: '宿屋', pub: '酒場', warehouse: '倉庫', watchtower: '見張り台', dojo: '道場', dock: '船着場', repair: '修理小屋' };
// 外に立つ施設（建物ではなく小物＋外に立つ番人）。その小物の絵があるときだけ置く
const LANDMARK = { well: { name: '井戸', prop: 'wellhouse' }, gate: { name: '門', prop: 'gate' } };
const CROWD_CAP = 40;               // 街を歩く常連の上限
const RECENT_DAYS = 90;
const PROP_SIZE = { well: [2, 2], 'canal-mouth': [2, 1], noticeboard: [2, 1], bench: [2, 1], cart: [3, 1] };
const MARGIN = 6;
const CAP = 120;
const WINDOW = 10;                  // 置けないときに先を探す幅
const WORKSHOP_ANGLE = 0.35;        // 東やや南（広場の南の大通りの東側）
const Y_WEIGHT = 1.1;               // 縦の距離を少し重めに見て、やや横長の街にする
const GRASS = 0, STREET = 1, DIRT = 2, PLAZA = 3, OUT = 4, WATER = 5;
const CH = ['.', '#', ':', '+', ' ', '~'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export {
  DEFAULT_FOOT,
  DOOR_DX,
  FACILITY_NAME,
  LANDMARK,
  CROWD_CAP,
  RECENT_DAYS,
  PROP_SIZE,
  MARGIN,
  CAP,
  WINDOW,
  WORKSHOP_ANGLE,
  Y_WEIGHT,
  GRASS,
  STREET,
  DIRT,
  PLAZA,
  OUT,
  WATER,
  CH,
  clamp,
};
