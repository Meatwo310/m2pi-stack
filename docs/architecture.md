# Architecture

## 配置と権限

1 つの Compose プロジェクトで、bot が参加する複数の Guild を扱います。会話と Guild 単位の設定は Guild ID で区別し、管理者・利用者 ID と Pi の作業領域は共有します。`bot` は Discord トークンと SQLite volume だけを持ちます。`agent` は Pi SDK、OpenRouter キー、Pi 状態 volume、作業 volume を持ち、Compose ネットワーク上の HTTP API を bot に提供します。agent のポートはホストに公開しません。

この分離により、Pi の `bash` や拡張が bot の Discord トークンを直接読むことを防ぎます。Pi にホストの Docker socket は渡しません。将来の `/sudo` によるローカル実行は、別の権限経路として設計します。現時点で bot のコード更新やホスト操作はできません。
Pi を呼び出せるユーザーは `DISCORD_ALLOWED_USER_IDS` と管理者 ID に限定し、追加指定がなければ管理者のみとします。Pi の作業用コンテナにはモデル認証情報があるため、利用者は信頼できるアカウントに限定します。

`/restart` は管理者 ID を確認して応答した後、bot プロセスを正常終了させます。Compose の `restart: unless-stopped` が同じイメージから bot を再起動します。agent は稼働を続けます。

## 設定

SQLite の `config_overrides` にスコープごとの部分的な上書きを保存します。各項目は次の順で最初に見つかった値を使います。

```text
session → channel → category → guild → instance → コード上の初期値
```

`NULL` は「継承」を表し、反応しない設定は明示的な `off` です。スレッドは親チャンネルと、その親カテゴリの設定を継承します。
`conversation_target` は会話の作成時に決まるため、セッション階層での上書きは受け付けません。

| 設定項目 | 値 | インスタンス初期値 |
| --- | --- | --- |
| `channel_trigger` | `mention` / `all` / `off` | `mention` |
| `managed_thread_trigger` | 同上 | `all` |
| `external_thread_trigger` | 同上 | `mention` |
| `conversation_target` | `direct` / `new_thread` | `direct` |
| `model` | `provider:model-id` | `openrouter:openrouter/free` |

bot が作ったスレッドの ID は `managed_threads` に保存します。既存スレッドで一度呼ばれても managed には変わりません。`new_thread` は通常チャンネルのメッセージから起動した会話に適用し、スレッド内ではそのスレッドで続けます。

設定変更は管理者の `/config` コマンドから行います。`/config show` は有効値と取得元を表示します。マイグレーションは bot 起動時に SQLite の `user_version` に沿って適用します。

## セッション

通常チャンネルではチャンネル単位、スレッドではスレッド単位に１つのアクティブな Pi セッションを対応付けます。Pi の会話履歴は agent volume の JSONL に、Discord の場所との対応と履歴一覧は bot の SQLite に保存します。

`/new` は現在のアクティブな対応を外します。次の発話で Pi セッションを作り、成功後にその ID を SQLite に保存します。`/resume` は同じチャンネルまたはスレッドに属する既存セッションだけを再開できます。設定の変更は次の発話で解決し直し、セッション単位の上書きがあれば優先します。

agent は最初の実装では Pi プロンプトを直列処理します。bot も同じ会話への依頼を順に処理し、Pi セッションへの競合書き込みを避けます。

## プラグイン

プラグインのコードはビルド時にイメージへ入れ、`config/pi-packages.json` にそのイメージ内の package パスを列挙します。Pi の agent directory は `/data/pi/agent` に固定します。既存 package の独自設定・認証情報・書き込み先は採用時に個別に確認します。bot 側の SQLite は既存プラグインの設定ファイルを置き換えません。

## 運用上の残件

- 稼働中バックアップの方式と保存先。対象は bot SQLite、Pi セッション、プラグイン状態、必要に応じて workspace と秘密情報です。
- Discord 管理コマンドからの bot 更新は未実装です。`/restart` は同じイメージを再起動するだけです。
- `/sudo` 用のホスト実行経路と監査・有効期間は未設計です。
- 既存プラグインはまだ選定していません。対話型 TUI のみで動くものは Discord 上で利用できるとは限りません。
