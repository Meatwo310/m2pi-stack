import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedModels, canSelectModel, defaults, parseModel, requiredPlaceholders, selectTrigger, settingChoiceLabels, settingChoices, settingGroups, settingKeys, settingLabels, settingValueLabel, validateSetting, type Scope } from "../src/config.ts";
import { BotDb } from "../src/db.ts";

test("設定パネルのカテゴリと選択肢は検証対象を網羅する", () => {
  const grouped = Object.values(settingGroups).flatMap((group) => [...group.keys]);
  assert.deepEqual([...grouped].sort(), [...settingKeys].sort());
  assert.equal(new Set(grouped).size, settingKeys.length);
  for (const key of settingKeys) {
    assert.ok(settingLabels[key]);
    assert.ok(settingLabels[key].length <= 100);
    const choices = settingChoices[key];
    if (choices) {
      assert.ok(choices.length > 0);
      for (const choice of choices) {
        assert.doesNotThrow(() => validateSetting(key, choice));
        assert.ok(settingChoiceLabels[key]?.[choice]);
        assert.notEqual(settingValueLabel(key, choice), choice);
      }
      assert.deepEqual(Object.keys(settingChoiceLabels[key] ?? {}).sort(), [...choices].sort());
      assert.throws(() => validateSetting(key, "invalid-choice"));
    } else if (requiredPlaceholders[key]) {
      assert.throws(() => validateSetting(key, "placeholder missing"));
    }
  }
});

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

test("モデル変更権限と許可リストを階層ごとに解決する", () => {
  const db = new BotDb(":memory:");
  const guild: Scope = { kind: "guild", id: "g1" };
  const channel: Scope = { kind: "channel", id: "c1" };
  try {
    assert.equal(canSelectModel(defaults, "openrouter:openrouter/free"), true);
    assert.equal(canSelectModel(defaults, "openrouter:other/model"), false);
    assert.deepEqual(allowedModels({ ...defaults, model_allowlist: "openrouter:other/model, openrouter:openrouter/free" }),
      ["openrouter:other/model", "openrouter:openrouter/free"]);
    db.setOverride(guild, "model_allowlist", "openrouter:other/model\r\nopenrouter:openrouter/free\n");
    assert.equal(db.getOverride(guild, "model_allowlist"), "openrouter:other/model\nopenrouter:openrouter/free");
    assert.deepEqual(allowedModels(db.resolve([channel, guild]).values), ["openrouter:other/model", "openrouter:openrouter/free"]);
    assert.equal(canSelectModel(db.resolve([channel, guild]).values, "openrouter:other/model"), true);
    db.setOverride(guild, "model_allowlist", "openrouter:other/model, openrouter:openrouter/free");
    assert.equal(db.getOverride(guild, "model_allowlist"), "openrouter:other/model\nopenrouter:openrouter/free");
    db.setOverride(channel, "model_permission", "none");
    assert.equal(canSelectModel(db.resolve([channel, guild]).values, "openrouter:other/model"), false);
    db.setOverride(channel, "model_permission", "all");
    assert.equal(canSelectModel(db.resolve([channel, guild]).values, "openrouter:unlisted/model"), true);
    assert.throws(() => db.setOverride(guild, "model_allowlist", "bad-model"));
    assert.throws(() => db.setOverride(guild, "model_allowlist", "openrouter:other/model\ninvalid"));
    assert.throws(() => db.setOverride(guild, "model_permission", "everyone"));
  } finally { db.close(); }
});

test("次のセッション用モデルは作成後のセッションだけに移る", () => {
  const db = new BotDb(":memory:");
  try {
    db.setPendingModel("g:c", "openrouter:other/model");
    assert.equal(db.getPendingModel("g:c"), "openrouter:other/model");
    db.activateModel("g:c", "s1");
    assert.equal(db.getPendingModel("g:c"), null);
    assert.equal(db.getOverride({ kind: "session", id: "s1" }, "model"), "openrouter:other/model");
    assert.equal(db.getOverride({ kind: "session", id: "s2" }, "model"), null);
  } finally { db.close(); }
});
