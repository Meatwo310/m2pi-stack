import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../src/config-store.js";
import {
  defaultDatabasePath,
  defaultRuntimeConfig,
  loadConfig,
} from "../src/config.js";

function withTempDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), "m2pi-config-test-"));
  const databasePath = join(directory, "state.db");
  try {
    return run(databasePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function initialize(databasePath, overrides = {}) {
  const store = new ConfigStore(databasePath);
  try {
    store.initialize(
      { ...defaultRuntimeConfig(), ...overrides },
      new Set(["111111111111111111"]),
    );
  } finally {
    store.close();
  }
}

test("derives default paths from the runtime environment", () => {
  const options = {
    homeDir: "/srv/agent",
    stateHome: "/var/lib/agent",
    repoRoot: "/opt/m2pi-stack",
  };
  assert.equal(
    defaultDatabasePath(options),
    "/var/lib/agent/pi-discord-gateway/state.db",
  );
  assert.deepEqual(defaultRuntimeConfig(options), {
    model: "openrouter/openrouter/free",
    cwd: "/srv/agent",
    agentDir: "/opt/m2pi-stack/pi/agent",
    allowedTools: [],
    sessionRoot: "/var/lib/agent/pi-discord-gateway/sessions",
  });
});

test("falls back to the user home when XDG_STATE_HOME is absent", () => {
  assert.equal(
    defaultDatabasePath({ homeDir: "/srv/agent", stateHome: "" }),
    "/srv/agent/.local/state/pi-discord-gateway/state.db",
  );
});

test("loads runtime configuration only from SQLite", () => {
  withTempDatabase((databasePath) => {
    initialize(databasePath, {
      model: "database/model",
      agentDir: "/repo/pi/agent",
      allowedTools: ["read", "grep"],
    });

    const config = loadConfig({
      DISCORD_TOKEN: "test-token",
      M2PI_DATABASE_PATH: databasePath,
      PI_MODEL: "ignored/model",
      PI_GATEWAY_TOOLS: "ignored",
      DISCORD_ALLOWED_USER_IDS: "222222222222222222",
    });

    assert.equal(config.token, "test-token");
    assert.equal(config.model, "database/model");
    assert.equal(config.agentDir, "/repo/pi/agent");
    assert.deepEqual(config.allowedTools, ["read", "grep"]);
    assert.deepEqual([...config.allowedUserIds], ["111111111111111111"]);
    assert.equal(statSync(databasePath).mode & 0o777, 0o600);
  });
});

test("requires an explicitly initialized database", () => {
  withTempDatabase((databasePath) => {
    assert.throws(
      () => loadConfig({ DISCORD_TOKEN: "test-token", M2PI_DATABASE_PATH: databasePath }),
      /config init command/,
    );
  });
});

test("requires the Discord token independently of SQLite", () => {
  withTempDatabase((databasePath) => {
    initialize(databasePath);
    assert.throws(
      () => loadConfig({ M2PI_DATABASE_PATH: databasePath }),
      /DISCORD_TOKEN is required/,
    );
  });
});
