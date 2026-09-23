import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrompt, shouldAcceptMessage } from "../src/policy.js";

const allowedUserId = "111111111111111111";
const otherUserId = "222222222222222222";
const botId = "333333333333333333";
const guildId = "444444444444444444";
const allowed = new Set([allowedUserId]);

test("accepts only the configured human user and requires guild mentions", () => {
  const guildMessage = (authorId, mentioned) => ({
    guildId,
    author: { id: authorId, bot: false },
    mentions: { users: { has: (id) => mentioned && id === botId } },
  });

  assert.equal(
    shouldAcceptMessage(guildMessage(allowedUserId, true), allowed, botId),
    true,
  );
  assert.equal(
    shouldAcceptMessage(guildMessage(allowedUserId, false), allowed, botId),
    false,
  );
  assert.equal(
    shouldAcceptMessage(guildMessage(otherUserId, true), allowed, botId),
    false,
  );
  assert.equal(
    shouldAcceptMessage(
      { author: { id: allowedUserId, bot: true } },
      allowed,
      botId,
    ),
    false,
  );
});

test("keeps direct messages available to the allowed user", () => {
  assert.equal(
    shouldAcceptMessage(
      { guildId: null, author: { id: allowedUserId, bot: false } },
      allowed,
      botId,
    ),
    true,
  );
});

test("removes bot mentions from prompts", () => {
  assert.equal(
    normalizePrompt(`<@${botId}> こんにちは`, botId),
    "こんにちは",
  );
  assert.equal(
    normalizePrompt(`<@!${botId}>  テスト`, botId),
    "テスト",
  );
});
