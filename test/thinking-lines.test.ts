import assert from "node:assert/strict";
import test from "node:test";
import { appendThinkingLines, completedThinkingLines } from "../src/thinking-lines.js";

test("思考は完成した非空行だけを取り出し、末尾はブロック完了まで保留する", () => {
  const first = appendThinkingLines("", "一行目\n  \n二行");
  assert.deepEqual(first, { lines: ["一行目"], pending: "二行" });
  const second = appendThinkingLines(first.pending, "目\r");
  assert.deepEqual(second, { lines: ["二行目"], pending: "" });
  assert.deepEqual(appendThinkingLines(second.pending, "\n末尾").lines, []);
  assert.deepEqual(completedThinkingLines("一行目\n  \n二行目\r\n末尾"), ["一行目", "二行目", "末尾"]);
});
