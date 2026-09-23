# Local Pi package

自作の Pi extension、skill、prompt をこの package に追加します。追加したリソースは `package.json` の `pi` manifest に明示してください。

既存の npm package はルートの `package.json` に依存関係として固定し、`config/pi-packages.json` に `./node_modules/<package-name>` を追加します。プラグインのコードは Docker イメージに入り、設定と状態はインスタンス別の agent volume に保存します。
