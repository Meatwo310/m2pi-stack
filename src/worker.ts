import { readFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { parseModel } from "./config.js";

const workspace = process.env.M2PI_WORKSPACE ?? "/workspace";
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const agentDir = process.env.PI_CODING_AGENT_DIR ?? "/data/pi/agent";
const sessionDir = process.env.PI_CODING_AGENT_SESSION_DIR ?? "/data/pi/sessions";
const keyPath = process.env.OPENROUTER_API_KEY_FILE;
if (!keyPath) throw new Error("OPENROUTER_API_KEY_FILE が必要です");
process.env.OPENROUTER_API_KEY = readFileSync(keyPath, "utf8").trim();
if (!process.env.OPENROUTER_API_KEY) throw new Error("OpenRouter API キーが空です");
for (const path of [workspace, agentDir, sessionDir, process.env.HOME ?? "/data/home"]) {
  mkdirSync(path, { recursive: true });
}

const modelRuntime = await ModelRuntime.create();
const packageManifest = JSON.parse(readFileSync(join(appRoot, "config/pi-packages.json"), "utf8")) as { packages?: unknown };
if (!Array.isArray(packageManifest.packages) || !packageManifest.packages.every((item) => typeof item === "string" && item.startsWith("./"))) {
  throw new Error("config/pi-packages.json の packages は ./ で始まるパスの配列にしてください");
}
const packagePaths = (packageManifest.packages as string[]).map((path) => {
  const absolute = resolve(appRoot, path);
  if (!absolute.startsWith(resolve(appRoot) + sep)) throw new Error(`package path がアプリ外です: ${path}`);
  return absolute;
});
let queue: Promise<unknown> = Promise.resolve();

function json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  let length = 0;
  for await (const part of request) {
    const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
    length += buffer.length;
    if (length > 1024 * 1024) throw new Error("リクエストが大きすぎます");
    parts.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("JSON object が必要です");
  return parsed as Record<string, unknown>;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method !== "POST") {
    json(response, 404, { error: "not found" });
    return;
  }
  try {
    const input = await body(request);
    if (request.url === "/sessions/exists") {
      const sessionId = input.sessionId;
      if (typeof sessionId !== "string") throw new Error("sessionId が必要です");
      json(response, 200, { exists: !!SessionManager.findById(workspace, sessionId, sessionDir) });
      return;
    }
    if (request.url === "/sessions/prompt") {
      const { sessionId, prompt, model } = input;
      if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt が必要です");
      if (typeof model !== "string") throw new Error("model が必要です");
      const { provider, id } = parseModel(model);
      const selectedModel = modelRuntime.getModel(provider, id);
      if (!selectedModel) throw new Error(`モデルが見つかりません: ${model}`);
      let manager: SessionManager;
      if (sessionId === null || sessionId === undefined) {
        manager = SessionManager.create(workspace, sessionDir);
      } else if (typeof sessionId === "string") {
        const path = SessionManager.findById(workspace, sessionId, sessionDir);
        if (!path) {
          json(response, 404, { error: "セッションが見つかりません" });
          return;
        }
        manager = SessionManager.open(path, sessionDir, workspace);
      } else {
        throw new Error("sessionId が不正です");
      }
      const settingsManager = SettingsManager.create(workspace, agentDir);
      settingsManager.applyOverrides({ packages: packagePaths });
      const resourceLoader = new DefaultResourceLoader({ cwd: workspace, agentDir, settingsManager });
      await resourceLoader.reload();
      const { session } = await createAgentSession({
        cwd: workspace,
        agentDir,
        sessionManager: manager,
        modelRuntime,
        model: selectedModel,
        settingsManager,
        resourceLoader,
      });
      try {
        await session.setModel(selectedModel);
        await session.prompt(prompt);
        json(response, 200, {
          sessionId: manager.getSessionId(),
          text: session.getLastAssistantText() ?? "（応答本文がありません）",
        });
      } finally {
        session.dispose();
      }
      return;
    }
    json(response, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    json(response, 400, { error: error instanceof Error ? error.message : "unknown error" });
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { ok: true });
    return;
  }
  const task = queue.then(() => handle(request, response));
  queue = task.catch((error) => {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: "agent error" });
  });
});
server.requestTimeout = 0;
server.listen(8787, "0.0.0.0", () => console.log("agent worker listening on 8787"));
