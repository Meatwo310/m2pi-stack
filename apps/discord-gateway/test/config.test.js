import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, parseList } from "../src/config.js";

test("parses comma-separated resource lists", () => {
  assert.deepEqual(parseList("read, grep, ,find"), ["read", "grep", "find"]);
});

test("loads monorepo Pi configuration and explicit tool allowlist", () => {
  const allowedUserId = "111111111111111111";
  const config = loadConfig({
    DISCORD_TOKEN: "test-token",
    DISCORD_ALLOWED_USER_IDS: allowedUserId,
    PI_CODING_AGENT_DIR: "/repo/pi/agent",
    PI_GATEWAY_TOOLS: "read,grep",
  });
  assert.equal(config.agentDir, "/repo/pi/agent");
  assert.deepEqual(config.allowedTools, ["read", "grep"]);
  assert.deepEqual([...config.allowedUserIds], [allowedUserId]);
});
