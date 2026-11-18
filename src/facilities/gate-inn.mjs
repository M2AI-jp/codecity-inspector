// 呼び出し元を変えず、共有する正規表現と施設判定の公開名を保つ。
export { SERVERISH, ROUTE_CALL, PY_ROUTE, GO_ROUTE, RB_ROUTE, API_LITERAL, SPEC_FILE, PROMPT_FILE } from './gate-inn/patterns.mjs';
export { scanWebSources } from './gate-inn/sources.mjs';
export { detectInn } from './gate-inn/inn.mjs';
export { receptions } from './gate-inn/receptions.mjs';
export { detectGate } from './gate-inn/gate.mjs';
