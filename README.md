# m2pi-stack

Pi Agent を Discord から使うための Compose スタックです。1 つの bot が参加する複数の Discord サーバーで利用できます。Discord bot と Pi の作業用 agent は別コンテナで起動します。

## セットアップ

Node.js 24.15 以上、pnpm 11、Docker Compose が必要です。Discord アプリでは **Message Content Intent** を有効にし、bot にメッセージの閲覧・送信、スレッド作成・送信、スラッシュコマンドの権限を付けます。

1. `instances/example/.env.example` を `instances/<名前>/.env` にコピーし、`COMPOSE_PROJECT_NAME`、`INSTANCE_DIR`、管理者ユーザー ID を設定します。ユーザー ID はカンマ区切りで複数指定できます。`DISCORD_ALLOW_ALL_USERS=false`（初期値）では `DISCORD_ALLOWED_USER_IDS` と管理者だけが利用でき、許可ユーザー欄が空なら管理者だけです。`DISCORD_ALLOW_ALL_USERS=true` にすると bot が参加する全サーバーの全ユーザーが会話と `/new`・`/resume` を利用できます。`/config`・`/restart` は引き続き管理者専用です。これらのユーザー設定は全サーバーで共通です。
2. `instances/<名前>/secrets/discord_token` と `instances/<名前>/secrets/openrouter_api_key` を作り、各ファイルに対応するトークンだけを書きます。これらのファイルと `.env` は Git の対象外です。
3. リポジトリのルートから起動します。

```sh
docker compose --env-file instances/<名前>/.env up -d --build
```

更新後は同じコマンドで再ビルドできます。イメージを変更していなければ `--build` は省略できます。bot が参加するサーバーでは同じインスタンスを利用し、会話とギルド単位の設定はサーバーごとに区別します。Pi の作業領域と agent の状態は共有されます。分離したい場合は、別の Discord bot と Compose インスタンスを用意します。

全ユーザーに開放する場合は、使用中の `instances/<名前>/.env` に `DISCORD_ALLOW_ALL_USERS=true` を指定して再ビルド・再起動してください。`DISCORD_ALLOWED_USER_IDS` はこの設定が `true` の場合は利用判定に影響しません。メッセージへの反応は各チャンネルの `channel_trigger` 設定と bot の Discord 権限にも従います。

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
- 応答開始時に指定モデルを最初の進行メッセージへ送信し、実際のモデルが判明したらその行を編集します。思考は完成した非空行だけをまとめて表示し、ブロック終了時に改行のない末尾も表示します。本文はブロックの完成後に別メッセージで一括送信します。ツール呼び出しは Pi のイベント順に残します。長い本文は分割し、長い思考行は省略します。思考と要約の提供はモデルとプロバイダーに依存します。

`/config set` では `session`、`channel`、`category`、`guild`、`instance` の階層を選びます。例えば `setting=model`、`value=openrouter:openrouter/free` と指定します。`/config reset` は下位階層からの継承に戻します。

進行表示は次の設定で調整できます。テンプレートは改行なしの 1～500 文字です。設定値は `/config show` で確認できます。

| 設定 | 初期値 | 値・プレースホルダー |
| --- | --- | --- |
| `model_display` | `route` | `off` / `requested` / `route`。`route` は実モデル判明後に矢印で追記 |
| `model_template` | `-# 🤖 ${model}` | `${model}` が必要 |
| `reasoning_display` | `text` | `off` / `summary` / `text`。`text` は Pi が渡す可視テキスト |
| `reasoning_summary_fallback` | `text` | `hide` / `text`。`summary` が無い場合の表示 |
| `reasoning_template` | `-# 🧐 ${thought}` | `${thought}` が必要 |
| `tool_display` | `on` | `off` / `on` |
| `tool_template` | `-# 🔧 ${tool} — ${status}` | `${tool}` と `${status}` が必要。ツールの引数と結果本文は表示しません |

`reasoning.summary` が返る場合は、`reasoning_display=summary` で表示済みの思考行を要約に差し替えます。返らない場合の表示は `reasoning_summary_fallback` に従います。送信メッセージではメンションとリンクの埋め込みを無効化します。

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
