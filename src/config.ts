export const settingKeys = [
  "channel_trigger",
  "managed_thread_trigger",
  "external_thread_trigger",
  "conversation_target",
  "model",
  "model_display",
  "model_template",
  "reasoning_display",
  "reasoning_summary_fallback",
  "reasoning_template",
  "tool_display",
  "tool_template",
] as const;

export type SettingKey = (typeof settingKeys)[number];
export type Trigger = "mention" | "all" | "off";
export type ConversationTarget = "direct" | "new_thread";
export type ModelDisplay = "off" | "requested" | "route";
export type ReasoningDisplay = "off" | "summary" | "text";
export type ReasoningSummaryFallback = "hide" | "text";
export type Toggle = "off" | "on";
export type ScopeKind = "instance" | "guild" | "category" | "channel" | "session";
export type Scope = { kind: ScopeKind; id: string };

export type Settings = {
  channel_trigger: Trigger;
  managed_thread_trigger: Trigger;
  external_thread_trigger: Trigger;
  conversation_target: ConversationTarget;
  model: string;
  model_display: ModelDisplay;
  model_template: string;
  reasoning_display: ReasoningDisplay;
  reasoning_summary_fallback: ReasoningSummaryFallback;
  reasoning_template: string;
  tool_display: Toggle;
  tool_template: string;
};

export const defaults: Settings = {
  channel_trigger: "mention",
  managed_thread_trigger: "all",
  external_thread_trigger: "mention",
  conversation_target: "direct",
  model: "openrouter:openrouter/free",
  model_display: "route",
  model_template: "-# 🤖 ${model}",
  reasoning_display: "text",
  reasoning_summary_fallback: "text",
  reasoning_template: "-# 🧐 ${thought}",
  tool_display: "on",
  tool_template: "-# 🔧 ${tool} — ${status}",
};

export function validateSetting(key: SettingKey, value: string): void {
  if (key.endsWith("_trigger")) {
    if (!["mention", "all", "off"].includes(value)) {
      throw new Error("trigger は mention / all / off のいずれかです");
    }
    return;
  }
  if (key === "conversation_target") {
    if (!["direct", "new_thread"].includes(value)) {
      throw new Error("conversation_target は direct / new_thread のいずれかです");
    }
    return;
  }
  const choices: Partial<Record<SettingKey, readonly string[]>> = {
    model_display: ["off", "requested", "route"],
    reasoning_display: ["off", "summary", "text"],
    reasoning_summary_fallback: ["hide", "text"],
    tool_display: ["off", "on"],
  };
  if (choices[key]) {
    if (!choices[key].includes(value)) throw new Error(`${key} は ${choices[key].join(" / ")} のいずれかです`);
    return;
  }
  const placeholders: Partial<Record<SettingKey, string[]>> = {
    model_template: ["${model}"],
    reasoning_template: ["${thought}"],
    tool_template: ["${tool}", "${status}"],
  };
  if (key in placeholders) {
    if (!value || value.length > 500 || /[\r\n]/.test(value)) throw new Error(`${key} は改行なしの 1～500 文字にしてください`);
    if (placeholders[key]?.some((placeholder) => !value.includes(placeholder))) {
      throw new Error(`${key} に ${placeholders[key]!.join(" と ")} を含めてください`);
    }
    return;
  }
  if (!/^[a-z0-9_-]+:.+$/i.test(value)) {
    throw new Error("model は provider:model-id の形式です（例: openrouter:openrouter/free）");
  }
}

export function parseModel(value: string): { provider: string; id: string } {
  validateSetting("model", value);
  const colon = value.indexOf(":");
  return { provider: value.slice(0, colon), id: value.slice(colon + 1) };
}

export function selectTrigger(settings: Settings, isThread: boolean, isManagedThread: boolean): Trigger {
  if (!isThread) return settings.channel_trigger;
  return isManagedThread ? settings.managed_thread_trigger : settings.external_thread_trigger;
}
