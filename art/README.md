# Production art shelf

このディレクトリだけが新アート制作の棚です。

- `references/`: 品質基準原版。runtime使用禁止、prefab候補でもない。
- `contracts/`: 棚卸し、寸法、palette、承認状態。
- `production/vertical-slice/blockout/`: 座標を固定するフラット色設計図。
- `production/vertical-slice/master-board/`: img2img中間生成物。runtime背景として出荷禁止。
- `production/vertical-slice/prefabs/`: N1–N9を通過した切り出し候補。

asset contractに `status: "accepted"` がなく、検収証拠もない画像はruntimeへコピーしません。
missing assetを旧素材、類似画像、CSS図形へfallbackさせず、起動時に理由を表示して停止します。

