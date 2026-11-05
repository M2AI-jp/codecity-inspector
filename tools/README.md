# tools

画像生成で作った「ドット絵風の大きな画像」を、ゲームで使う正確な解像度のドット絵に変換する道具（Node 22以上、標準ライブラリのみ）。

- 人物シート: `node tools/pixelize.mjs in.png out.png --grid 4x4 --cell 32 --char-height 30 --colors 32`（承認済みの主人公は身長30px、足元はy=31）
- 建物・小物: `node tools/pixelize.mjs in.png out.png --grid 1x1 --size 96x112`（はみ出さないよう縮めて下端中央に置く）
- 地面のtexture: `node tools/pixelize.mjs in.png out.png --grid 1x1 --size 128x128 --fit stretch --tileable`（継ぎ目なし）
- 見比べ: `node tools/preview.mjs side art/approved/player--default.png out.png cmp.png --scale 4`
- 拡大表示: `node tools/preview.mjs up out.png out-x4.png --scale 4 --grid 32`
