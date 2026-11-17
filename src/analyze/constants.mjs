// 解析で読む件数・大きさと、モジュールを分ける基準。
export const MAX_COMMITS = 5000;          // git log を読む上限
export const MAX_TEXT_BYTES = 1 << 20;    // これより大きいファイルは行数を数えない
export const MAX_READ_FILES = 40000;      // 行数を数えるファイル数の上限（以降はバイト数から推定）
export const MAX_WALK_FILES = 100000;     // git が無いときに歩くファイル数の上限
export const SPLIT_AT = [0, 40, 120];     // 深さごとの「分割する」ファイル数
export const DAY = 86400000;
