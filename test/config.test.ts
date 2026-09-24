import assert from "node:assert/strict";
import { test } from "node:test";
import { defaults, parseModel, selectTrigger, type Scope } from "../src/config.ts";
import { BotDb } from "../src/db.ts";

test("設定は項目ごとに session → channel → category → guild → instance と継承する", () => {
  const db = new BotDb(":memory:");
  const scopes: Scope[] = [
    { kind: "session", id: "s1" },
    { kind: "channel", id: "c1" },
    { kind: "category", id: "cat1" },
    { kind: "guild", id: "g1" },
    { kind: "instance", id: "default" },
  ];
  try {
    assert.deepEqual(db.resolve(scopes).values, defaults);
    db.setOverride(scopes[3]!, "model", "openrouter:anthropic/claude-sonnet-4");
    db.setOverride(scopes[2]!, "channel_trigger", "all");
    db.setOverride(scopes[1]!, "model", "openrouter:openrouter/free");
    db.setOverride(scopes[0]!, "managed_thread_trigger", "mention");
    const effective = db.resolve(scopes);
    assert.equal(effective.values.channel_trigger, "all");
    assert.equal(effective.sources.channel_trigger, scopes[2]);
    assert.equal(effective.values.model, "openrouter:openrouter/free");
    assert.equal(effective.sources.model, scopes[1]);
    assert.equal(effective.values.managed_thread_trigger, "mention");
    db.resetOverride(scopes[1]!, "model");
    assert.equal(db.resolve(scopes).values.model, "openrouter:anthropic/claude-sonnet-4");
    assert.throws(() => db.setOverride(scopes[0]!, "conversation_target", "new_thread"));
  } finally { db.close(); }
});

test("m2pi が作成したスレッドだけ初期値でメンション不要", () => {
  assert.equal(selectTrigger(defaults, false, false), "mention");
  assert.equal(selectTrigger(defaults, true, true), "all");
  assert.equal(selectTrigger(defaults, true, false), "mention");
});

test("セッションは会話ごとに保存・再開し、managed thread を記録する", () => {
  const db = new BotDb(":memory:");
  try {
    db.setActive("guild:channel-a", "session-a");
    assert.equal(db.getActive("guild:channel-a"), "session-a");
    assert.equal(db.hasSession("guild:channel-a", "session-a"), true);
    assert.equal(db.hasSession("guild:channel-b", "session-a"), false);
    assert.throws(() => db.setActive("guild:channel-b", "session-a"));
    db.clearActive("guild:channel-a");
    assert.equal(db.getActive("guild:channel-a"), null);
    assert.equal(db.listSessions("guild:channel-a")[0]?.id, "session-a");
    db.markManagedThread("thread-a", "channel-a");
    assert.equal(db.isManagedThread("thread-a"), true);
    assert.equal(db.isManagedThread("thread-b"), false);
  } finally { db.close(); }
});

test("モデル指定は provider と ID を区別する", () => {
  assert.deepEqual(parseModel("openrouter:openrouter/free"), { provider: "openrouter", id: "openrouter/free" });
  assert.throws(() => parseModel("openrouter/free"));
});

test("進行表示の設定を検証し、階層ごとに保存する", () => {
  const db = new BotDb(":memory:");
  const guild: Scope = { kind: "guild", id: "g1" };
  try {
    db.setOverride(guild, "model_display", "requested");
    db.setOverride(guild, "reasoning_display", "summary");
    db.setOverride(guild, "reasoning_summary_fallback", "hide");
    db.setOverride(guild, "tool_template", "${tool}: ${status}");
    const values = db.resolve([guild]).values;
    assert.equal(values.model_display, "requested");
    assert.equal(values.reasoning_display, "summary");
    assert.equal(values.reasoning_summary_fallback, "hide");
    assert.equal(values.tool_template, "${tool}: ${status}");
    assert.throws(() => db.setOverride(guild, "model_display", "verbose"));
    assert.throws(() => db.setOverride(guild, "reasoning_template", "thought"));
    db.resetOverride(guild, "model_display");
    assert.equal(db.resolve([guild]).values.model_display, defaults.model_display);
  } finally { db.close(); }
});
