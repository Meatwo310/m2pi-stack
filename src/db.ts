import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaults, parseModelAllowlist, settingKeys, validateSetting, type Scope, type SettingKey, type Settings } from "./config.js";

const migrations = [
  `CREATE TABLE config_overrides (
     scope_kind TEXT NOT NULL CHECK(scope_kind IN ('instance','guild','category','channel','session')),
     scope_id TEXT NOT NULL,
     channel_trigger TEXT CHECK(channel_trigger IN ('mention','all','off')),
     managed_thread_trigger TEXT CHECK(managed_thread_trigger IN ('mention','all','off')),
     external_thread_trigger TEXT CHECK(external_thread_trigger IN ('mention','all','off')),
     conversation_target TEXT CHECK(conversation_target IN ('direct','new_thread')),
     model TEXT,
     PRIMARY KEY(scope_kind, scope_id)
   ) STRICT;
   CREATE TABLE conversation_sessions (
     session_id TEXT PRIMARY KEY,
     conversation_key TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) STRICT;
   CREATE INDEX conversation_sessions_by_conversation
     ON conversation_sessions(conversation_key, created_at DESC);
   CREATE TABLE active_sessions (
     conversation_key TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES conversation_sessions(session_id)
   ) STRICT;
   CREATE TABLE managed_threads (
     thread_id TEXT PRIMARY KEY,
     parent_channel_id TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) STRICT;`,
  `ALTER TABLE config_overrides ADD COLUMN model_display TEXT CHECK(model_display IN ('off','requested','route'));
   ALTER TABLE config_overrides ADD COLUMN model_template TEXT;
   ALTER TABLE config_overrides ADD COLUMN reasoning_display TEXT CHECK(reasoning_display IN ('off','summary','text'));
   ALTER TABLE config_overrides ADD COLUMN reasoning_summary_fallback TEXT CHECK(reasoning_summary_fallback IN ('hide','text'));
   ALTER TABLE config_overrides ADD COLUMN reasoning_template TEXT;
   ALTER TABLE config_overrides ADD COLUMN stream_status TEXT CHECK(stream_status IN ('off','on'));
   ALTER TABLE config_overrides ADD COLUMN stream_status_text TEXT;
   ALTER TABLE config_overrides ADD COLUMN tool_display TEXT CHECK(tool_display IN ('off','on'));
   ALTER TABLE config_overrides ADD COLUMN tool_template TEXT;`,
  `ALTER TABLE config_overrides ADD COLUMN model_permission TEXT CHECK(model_permission IN ('none','list','all'));
   ALTER TABLE config_overrides ADD COLUMN model_allowlist TEXT;
   CREATE TABLE pending_models (
     conversation_key TEXT PRIMARY KEY,
     model TEXT NOT NULL
   ) STRICT;`,
] as const;

type ConfigRow = Partial<Record<SettingKey, string | null>>;

export class BotDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    const version = Number((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (version > migrations.length) throw new Error(`未対応の DB バージョン: ${version}`);
    for (let index = version; index < migrations.length; index++) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(migrations[index]!);
        this.db.exec(`PRAGMA user_version = ${index + 1}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    this.db.prepare(`INSERT OR IGNORE INTO config_overrides
      (scope_kind, scope_id, channel_trigger, managed_thread_trigger, external_thread_trigger, conversation_target, model)
      VALUES ('instance', 'default', ?, ?, ?, ?, ?)`).run(
      defaults.channel_trigger, defaults.managed_thread_trigger, defaults.external_thread_trigger,
      defaults.conversation_target, defaults.model,
    );
  }

  close(): void { this.db.close(); }

  getOverride(scope: Scope, key: SettingKey): string | null {
    const row = this.db.prepare("SELECT * FROM config_overrides WHERE scope_kind = ? AND scope_id = ?")
      .get(scope.kind, scope.id) as ConfigRow | undefined;
    return row?.[key] ?? null;
  }

  setOverride(scope: Scope, key: SettingKey, value: string): void {
    if (scope.kind === "session" && key === "conversation_target") {
      throw new Error("conversation_target はセッション作成前に決まるため、session には設定できません");
    }
    validateSetting(key, value);
    if (key === "model_allowlist") value = parseModelAllowlist(value).join("\n");
    this.db.prepare("INSERT OR IGNORE INTO config_overrides (scope_kind, scope_id) VALUES (?, ?)").run(scope.kind, scope.id);
    this.db.prepare(`UPDATE config_overrides SET ${key} = ? WHERE scope_kind = ? AND scope_id = ?`)
      .run(value, scope.kind, scope.id);
  }

  resetOverride(scope: Scope, key: SettingKey): void {
    if (scope.kind === "instance") {
      this.setOverride(scope, key, defaults[key]);
      return;
    }
    this.db.prepare(`UPDATE config_overrides SET ${key} = NULL WHERE scope_kind = ? AND scope_id = ?`)
      .run(scope.kind, scope.id);
  }

  resolve(scopes: readonly Scope[]): { values: Settings; sources: Record<SettingKey, Scope | "default"> } {
    const values = { ...defaults };
    const sources = {} as Record<SettingKey, Scope | "default">;
    for (const key of settingKeys) {
      sources[key] = "default";
      for (const scope of scopes) {
        if (key === "conversation_target" && scope.kind === "session") continue;
        const value = this.getOverride(scope, key);
        if (value !== null) {
          values[key] = value as never;
          sources[key] = scope;
          break;
        }
      }
    }
    return { values, sources };
  }

  getActive(conversationKey: string): string | null {
    const row = this.db.prepare("SELECT session_id FROM active_sessions WHERE conversation_key = ?")
      .get(conversationKey) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  clearActive(conversationKey: string): void {
    this.db.prepare("DELETE FROM active_sessions WHERE conversation_key = ?").run(conversationKey);
  }

  setActive(conversationKey: string, sessionId: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT OR IGNORE INTO conversation_sessions (session_id, conversation_key) VALUES (?, ?)")
        .run(sessionId, conversationKey);
      const row = this.db.prepare("SELECT conversation_key FROM conversation_sessions WHERE session_id = ?")
        .get(sessionId) as { conversation_key: string };
      if (row.conversation_key !== conversationKey) throw new Error("別の会話のセッションは再開できません");
      this.db.prepare(`INSERT INTO active_sessions (conversation_key, session_id) VALUES (?, ?)
        ON CONFLICT(conversation_key) DO UPDATE SET session_id = excluded.session_id`).run(conversationKey, sessionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listSessions(conversationKey: string): Array<{ id: string; createdAt: string }> {
    return this.db.prepare(`SELECT session_id AS id, created_at AS createdAt FROM conversation_sessions
      WHERE conversation_key = ? ORDER BY created_at DESC LIMIT 10`).all(conversationKey) as Array<{ id: string; createdAt: string }>;
  }

  hasSession(conversationKey: string, sessionId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM conversation_sessions WHERE conversation_key = ? AND session_id = ?")
      .get(conversationKey, sessionId);
  }

  markManagedThread(threadId: string, parentChannelId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO managed_threads (thread_id, parent_channel_id) VALUES (?, ?)")
      .run(threadId, parentChannelId);
  }

  isManagedThread(threadId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM managed_threads WHERE thread_id = ?").get(threadId);
  }

  getPendingModel(conversationKey: string): string | null {
    const row = this.db.prepare("SELECT model FROM pending_models WHERE conversation_key = ?")
      .get(conversationKey) as { model: string } | undefined;
    return row?.model ?? null;
  }

  setPendingModel(conversationKey: string, model: string): void {
    validateSetting("model", model);
    this.db.prepare(`INSERT INTO pending_models (conversation_key, model) VALUES (?, ?)
      ON CONFLICT(conversation_key) DO UPDATE SET model = excluded.model`).run(conversationKey, model);
  }

  clearPendingModel(conversationKey: string): void {
    this.db.prepare("DELETE FROM pending_models WHERE conversation_key = ?").run(conversationKey);
  }

  activateModel(conversationKey: string, sessionId: string): void {
    const model = this.getPendingModel(conversationKey);
    if (model === null) return;
    this.setOverride({ kind: "session", id: sessionId }, "model", model);
    this.clearPendingModel(conversationKey);
  }
}
