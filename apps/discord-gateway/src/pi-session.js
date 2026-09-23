import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

function systemPrompt(allowedTools) {
  const capability = allowedTools.length
    ? `Only these tools are enabled: ${allowedTools.join(", ")}. Never claim capabilities outside that list.`
    : "You currently have no tools, so never claim to have read files, run commands, or changed external state.";
  return `You are Pi, an AI assistant speaking through Discord.\nAnswer the user's request directly. Keep responses suitable for Discord.\n${capability}`;
}

function safeChannelKey(channelId) {
  const key = String(channelId);
  if (!/^\d{1,30}$/.test(key) && !/^smoke-[a-z0-9-]+$/i.test(key)) {
    throw new Error("Invalid channel ID");
  }
  return key;
}

export class PiSessionPool {
  constructor({ modelName, cwd, agentDir, allowedTools = [], sessionRoot }) {
    this.modelName = modelName;
    this.cwd = cwd;
    this.agentDir = agentDir;
    this.allowedTools = allowedTools;
    this.sessionRoot = sessionRoot;
    this.handles = new Map();
    this.queues = new Map();
    this.modelRuntimePromise = null;
  }

  async modelRuntime() {
    if (!this.modelRuntimePromise) {
      this.modelRuntimePromise = ModelRuntime.create({ allowModelNetwork: false });
    }
    return this.modelRuntimePromise;
  }

  async createHandle(channelId) {
    const key = safeChannelKey(channelId);
    const modelRuntime = await this.modelRuntime();
    const resolved = resolveCliModel({
      cliModel: this.modelName,
      modelRuntime,
    });
    if (resolved.error || !resolved.model) {
      throw new Error(resolved.error || `Model not found: ${this.modelName}`);
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      noExtensions: false,
      noSkills: false,
      noPromptTemplates: false,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: systemPrompt(this.allowedTools),
    });
    await resourceLoader.reload();

    const sessionDir = join(this.sessionRoot, key);
    const sessionManager = SessionManager.continueRecent(this.cwd, sessionDir);
    const toolOptions = this.allowedTools.length
      ? { tools: this.allowedTools }
      : { noTools: "all" };
    const { session } = await createAgentSession({
      cwd: this.cwd,
      agentDir: this.agentDir,
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel || "off",
      modelRuntime,
      resourceLoader,
      sessionManager,
      ...toolOptions,
    });
    return { session };
  }

  async handle(channelId) {
    const key = safeChannelKey(channelId);
    if (!this.handles.has(key)) {
      const pending = this.createHandle(key).catch((error) => {
        this.handles.delete(key);
        throw error;
      });
      this.handles.set(key, pending);
    }
    return this.handles.get(key);
  }

  async prompt(channelId, prompt) {
    const key = safeChannelKey(channelId);
    const previous = this.queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      const { session } = await this.handle(key);
      let output = "";
      let providerError = "";
      const unsubscribe = session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        ) {
          output += event.assistantMessageEvent.delta;
        }
        if (
          event.type === "message_end" &&
          event.message?.role === "assistant" &&
          event.message?.stopReason === "error"
        ) {
          providerError = event.message.errorMessage || "Provider request failed";
        }
      });
      try {
        await session.prompt(prompt);
      } finally {
        unsubscribe();
      }
      const text = output.trim();
      if (!text) throw new Error(providerError || "Pi returned no text response");
      return text;
    });
    this.queues.set(key, current);
    current
      .finally(() => {
        if (this.queues.get(key) === current) this.queues.delete(key);
      })
      .catch(() => {});
    return current;
  }

  async dispose() {
    const handles = await Promise.allSettled(this.handles.values());
    for (const result of handles) {
      if (result.status === "fulfilled") result.value.session.dispose();
    }
    this.handles.clear();
    this.queues.clear();
  }
}
