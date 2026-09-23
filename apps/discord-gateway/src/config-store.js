import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CONFIG_KEYS = new Set([
  "model",
  "cwd",
  "agent_dir",
  "session_root",
  "allowed_tools",
]);

function now() {
  return new Date().toISOString();
}

function normalizeUserId(value) {
  const id = String(value ?? "").trim();
  if (!/^\d{1,30}$/.test(id)) throw new Error(`Invalid Discord user ID: ${id}`);
  return id;
}

function normalizeTools(value) {
  const tools = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(tools.map((item) => String(item).trim()).filter(Boolean))];
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS agent_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      model TEXT NOT NULL,
      cwd TEXT NOT NULL,
      agent_dir TEXT NOT NULL,
      session_root TEXT NOT NULL,
      allowed_tools_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS allowed_users (
      user_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version = 1;
  `);
  db.exec("PRAGMA journal_mode = WAL;");
}

export class ConfigStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(dbPath);
    ensureSchema(this.db);
    if (dbPath !== ":memory:") chmodSync(dbPath, 0o600);
  }

  initialize(config, allowedUserIds) {
    const existing = this.db.prepare("SELECT 1 FROM agent_config WHERE id = 1").get();
    if (existing) throw new Error("Configuration database is already initialized");

    const users = [...new Set([...allowedUserIds].map(normalizeUserId))];
    if (users.length === 0) {
      throw new Error("At least one allowed Discord user ID is required");
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO agent_config (
          id, model, cwd, agent_dir, session_root, allowed_tools_json, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?)
      `).run(
        config.model,
        config.cwd,
        config.agentDir,
        config.sessionRoot,
        JSON.stringify(normalizeTools(config.allowedTools)),
        now(),
      );
      const insertUser = this.db.prepare(
        "INSERT INTO allowed_users (user_id, created_at) VALUES (?, ?)",
      );
      for (const userId of users) insertUser.run(userId, now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  read() {
    const row = this.db.prepare("SELECT * FROM agent_config WHERE id = 1").get();
    if (!row) {
      throw new Error(
        "Configuration database is not initialized; run the config init command",
      );
    }

    let allowedTools;
    try {
      allowedTools = normalizeTools(JSON.parse(row.allowed_tools_json));
    } catch {
      throw new Error("Invalid allowed_tools_json in configuration database");
    }

    const users = this.db
      .prepare("SELECT user_id FROM allowed_users ORDER BY user_id")
      .all()
      .map((item) => item.user_id);
    if (users.length === 0) throw new Error("Configuration must contain at least one allowed user");

    return {
      model: row.model,
      cwd: row.cwd,
      agentDir: row.agent_dir,
      sessionRoot: row.session_root,
      allowedTools,
      allowedUserIds: new Set(users),
      updatedAt: row.updated_at,
    };
  }

  set(key, value) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`Unknown configuration key: ${key}`);
    const column = key === "allowed_tools" ? "allowed_tools_json" : key;
    const storedValue = key === "allowed_tools"
      ? JSON.stringify(normalizeTools(value))
      : String(value).trim();
    if (!storedValue) throw new Error(`${key} must not be empty`);
    this.db
      .prepare(`UPDATE agent_config SET ${column} = ?, updated_at = ? WHERE id = 1`)
      .run(storedValue, now());
  }

  allowUser(userId) {
    this.db
      .prepare("INSERT OR IGNORE INTO allowed_users (user_id, created_at) VALUES (?, ?)")
      .run(normalizeUserId(userId), now());
  }

  denyUser(userId) {
    const id = normalizeUserId(userId);
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM allowed_users").get().count;
    if (count <= 1) throw new Error("Cannot remove the last allowed user");
    this.db.prepare("DELETE FROM allowed_users WHERE user_id = ?").run(id);
  }

  close() {
    this.db.close();
  }
}
