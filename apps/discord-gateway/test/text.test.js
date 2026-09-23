import test from "node:test";
import assert from "node:assert/strict";
import { splitDiscordMessage } from "../src/text.js";

test("splits output within Discord limits without losing text", () => {
  const input = `${"a".repeat(1200)}\n\n${"b".repeat(1200)}`;
  const chunks = splitDiscordMessage(input, 1900);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1900));
  assert.equal(chunks.join("\n\n"), input);
});

test("returns no chunks for blank output", () => {
  assert.deepEqual(splitDiscordMessage("   "), []);
});
