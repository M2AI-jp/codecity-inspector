# tools

画像生成で作った「ドット絵風の大きな画像」を、ゲームで使う正確な解像度のドット絵に変換する道具（Node 22以上、標準ライブラリのみ）。

- 人物シート: `node tools/pixelize.mjs in.png out.png --grid 4x4 --cell 32 --char-height 30 --colors 32`（承認済みの主人公は身長30px、足元はy=31）
- 建物・小物: `node tools/pixelize.mjs in.png out.png --grid 1x1 --size 96x112`（はみ出さないよう縮めて下端中央に置く）
- 地面のtexture: `node tools/pixelize.mjs in.png out.png --grid 1x1 --size 128x128 --fit stretch --tileable`（継ぎ目なし）
- 見比べ: `node tools/preview.mjs side art/approved/player--default.png out.png cmp.png --scale 4`
- 拡大表示: `node tools/preview.mjs up out.png out-x4.png --scale 4 --grid 32`
- manifest: `node tools/build-manifest.mjs`（art/game/ の画像と sidecar の .json から art/game/manifest.json を作る。manifest は手で編集しない）
- 入れるかの検査: `node tools/check-play.mjs <リポジトリ | town.json> [...] [-v]`（web/ の衝突判定そのもので、開始位置からすべての建物の床まで歩けるか・扉の前から上キーで入れるか・クリックで入れるか・番人に話しかけられるかを確かめる。入れない建物があれば終了コード 1 と、扉まわりをふさいでいる物を出す）
- 担当地区の検査: `node tools/ascii-town.mjs town.json --districts --check`（`module.group` ごとの塊数と理由付き `unplaced` を表示。一塊でないのに説明が無ければ失敗）
- 種を変える検査: `node tools/seed-fuzz.mjs <リポジトリ | model.json> --count 200 --out compare/fuzz`（ASCII・芝生・実際の Player を検査。group 指定時は、入力 module の欠落も検査し、全担当が完全配置された seed 数と「一塊または理由付き未配置」の seed 数を分けて表示）
- 状態判定の検査: `node tools/check-state.mjs`（os.tmpdir() の下で3つのgit fixtureを作り、記録のmtimeを固定して道場の passed・failed・unverified を確かめ、終了後に消す）
