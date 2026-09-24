import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { AgentClient, type PromptProgress } from "../src/agent-client.js";

test("agent の進行イベントを行の分割に関係なく順に受け取る", async () => {
  const server = createServer(async (_request, response) => {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.write('{"type":"model","model":"openrouter:nex-agi/nex-n2.5-mini:free"}\n{"type":"thinking","id":"1:0","messageId":1,"delta":"考');
    await new Promise((resolve) => setTimeout(resolve, 10));
    response.write('え中"}\n{"type":"thinking_end","id":"1:0","messageId":1,"content":"考え中"}\n{"type":"text_start","id":"1:1","messageId":1}\n{"type":"text_delta","id":"1:1","messageId":1,"delta":"途中"}\n{"type":"text_end","id":"1:1","messageId":1,"content":"途中"}\n{"type":"tool","id":"call-1","name":"read","status":"running"}\n{"type":"tool","id":"call-1","name":"read","status":"done"}\n{"type":"text_start","id":"2:0","messageId":2}\n{"type":"text_delta","id":"2:0","messageId":2,"delta":"回答"}\n{"type":"text_end","id":"2:0","messageId":2,"content":"回答"}\n{"type":"done","sessionId":"session-1","text":"回答","model":"openrouter:nex-agi/nex-n2.5-mini:free"}\n');
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("ポートを取得できません");
    const events: PromptProgress[] = [];
    const client = new AgentClient(`http://127.0.0.1:${address.port}`);
    const result = await client.prompt(null, "質問", "openrouter:openrouter/free", async (event) => { events.push(event); });
    assert.deepEqual(events, [
      { type: "model", model: "openrouter:nex-agi/nex-n2.5-mini:free" },
      { type: "thinking", id: "1:0", messageId: 1, delta: "考え中" },
      { type: "thinking_end", id: "1:0", messageId: 1, content: "考え中" },
      { type: "text_start", id: "1:1", messageId: 1 },
      { type: "text_delta", id: "1:1", messageId: 1, delta: "途中" },
      { type: "text_end", id: "1:1", messageId: 1, content: "途中" },
      { type: "tool", id: "call-1", name: "read", status: "running" },
      { type: "tool", id: "call-1", name: "read", status: "done" },
      { type: "text_start", id: "2:0", messageId: 2 },
      { type: "text_delta", id: "2:0", messageId: 2, delta: "回答" },
      { type: "text_end", id: "2:0", messageId: 2, content: "回答" },
    ]);
    assert.deepEqual(result, { sessionId: "session-1", text: "回答", model: "openrouter:nex-agi/nex-n2.5-mini:free" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
