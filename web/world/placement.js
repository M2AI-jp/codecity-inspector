// 建物・小物・水上の板を、元の順に当たり矩形と灯へ追加する。
// 呼び出し側を変えず、役割ごとの処理を公開する窓口。
export { applyDecks } from './placement/decks.js';
export { addRect } from './placement/rectangles.js';
export { pickVariant, propDef } from './placement/variants.js';
export { addBuilding } from './placement/buildings.js';
export { addProp } from './placement/props.js';
