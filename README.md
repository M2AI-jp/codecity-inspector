# CodeCity

リポジトリの意味を建物や地区へ変換し、緻密なオリジナル2Dピクセルアートの街として表現するプロジェクトです。

製品の唯一の規範SSoTは [PRODUCT.md](studio/governance/PRODUCT.md) です。ユーザー要求の出典、確定した意図、未承認事項、実行順序を同ファイルに集約します。

現行の実装入口は次の一つです。

```sh
node ship/90-cli/bin/codecity.mjs /path/to/repository
```

CLIが表示したlocalhost URLをブラウザで開き、矢印キーまたはWASDで街を歩けます。2026-09-12にChromeで、連続した街の表示、移動、衝突、入口での自動cutaway、同じ座標の室内、退出時の外観復帰まで実測し、独立QAが最終PASSと判定しました。
