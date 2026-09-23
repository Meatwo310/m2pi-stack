# m2pi-stack

Pi Agent を Discord から使うための Compose スタックです。Discord サーバーごとに独立した Compose プロジェクトを起動します。現在の実装は Discord bot と Pi の作業用 agent を別コンテナに分けています。

## セットアップ

Node.js 24.15 以上、pnpm 11、Docker Compose が必要です。Discord アプリでは **Message Content Intent** を有効にし、bot にメッセージの閲覧・送信、スレッド作成・送信、スラッシュコマンドの権限を付けます。

1. `instances/example/.env.example` を `instances/<名前>/.env` にコピーし、`COMPOSE_PROJECT_NAME`、`INSTANCE_DIR`、Guild ID、管理者ユーザー ID を設定します。ID はカンマ区切りで複数指定できます。`DISCORD_ALLOWED_USER_IDS` が空なら管理者だけが会話できます。
2. `instances/<名前>/secrets/discord_token` と `instances/<名前>/secrets/openrouter_api_key` を作り、各ファイルに対応するトークンだけを書きます。これらのファイルと `.env` は Git の対象外です。
3. リポジトリのルートから起動します。

```sh
docker compose --env-file instances/<名前>/.env up -d --build
```

更新後は同じコマンドで再ビルドできます。イメージを変更していなければ `--build` は省略できます。別の Discord サーバーは別の `instances/<名前>/.env` と Compose プロジェクト名で起動します。

```sh
docker compose --env-file instances/<名前>/.env ps
docker compose --env-file instances/<名前>/.env logs -f bot agent
```

## Discord での操作

- 通常チャンネルでは、初期設定で bot をメンションすると反応します。
- bot が作ったスレッドではメンションなしで会話できます。既存の別スレッドでは各メッセージでメンションが必要です。
- `/new` は現在のチャンネルまたはスレッドのアクティブなセッションを外し、次の発話から新しい会話を始めます。
- `/resume` はその場所の最近のセッションを表示し、`/resume session:<ID>` で再開します。
- `/config show`、`/config set`、`/config reset` と `/restart` は `DISCORD_ADMIN_USER_IDS` に指定した管理者専用です。

`/config set` では `session`、`channel`、`category`、`guild`、`instance` の階層を選びます。例えば `setting=model`、`value=openrouter:openrouter/free` と指定します。`/config reset` は下位階層からの継承に戻します。

## 保存先

| Compose volume | 内容 |
| --- | --- |
| `bot_state` | `/data/app.db`: Discord 設定、セッション対応、bot が作ったスレッド ID |
| `agent_state` | `/data/pi/agent`: Pi とプラグインの設定・状態、`/data/pi/sessions`: Pi の会話履歴、`/data/home`: その他のプラグイン状態 |
| `workspace` | Pi が読み書きする `/workspace` |

プラグインのコードはイメージに含めます。自作プラグインは `plugins/local`、採用する既存 package はルートの `package.json` と `config/pi-packages.json` で固定します。プラグイン固有の設定ファイルの場所は各 package の仕様に従います。

## 開発

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

設計上の判断と残っている運用課題は [docs/architecture.md](docs/architecture.md) にまとめています。
