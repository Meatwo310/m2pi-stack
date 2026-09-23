import test from "node:test";
import assert from "node:assert/strict";
import { ConfigStore } from "../src/config-store.js";

function initialize(store) {
  store.initialize(
    {
      model: "example/model",
      cwd: "/workspace",
      agentDir: "/agent",
      sessionRoot: "/sessions",
      allowedTools: [],
    },
    new Set(["111111111111111111"]),
  );
}

test("updates typed configuration and user access", () => {
  const store = new ConfigStore(":memory:");
  try {
    initialize(store);
    store.set("allowed_tools", "read, grep,read");
    store.set("model", "new/model");
    store.allowUser("222222222222222222");
    store.denyUser("111111111111111111");

    const current = store.read();
    assert.equal(current.model, "new/model");
    assert.deepEqual(current.allowedTools, ["read", "grep"]);
    assert.deepEqual([...current.allowedUserIds], ["222222222222222222"]);
  } finally {
    store.close();
  }
});

test("initialization is explicit and can only happen once", () => {
  const store = new ConfigStore(":memory:");
  try {
    assert.throws(() => store.read(), /config init command/);
    initialize(store);
    assert.throws(() => initialize(store), /already initialized/);
  } finally {
    store.close();
  }
});

test("does not permit removing the last allowed user", () => {
  const store = new ConfigStore(":memory:");
  try {
    initialize(store);
    assert.throws(
      () => store.denyUser("111111111111111111"),
      /last allowed user/,
    );
  } finally {
    store.close();
  }
});

test("rejects unknown keys and malformed user IDs", () => {
  const store = new ConfigStore(":memory:");
  try {
    initialize(store);
    assert.throws(() => store.set("discord_token", "secret"), /Unknown configuration key/);
    assert.throws(() => store.allowUser("not-an-id"), /Invalid Discord user ID/);
  } finally {
    store.close();
  }
});
