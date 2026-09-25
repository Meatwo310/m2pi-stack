export const settingKeys = [
  "channel_trigger",
  "managed_thread_trigger",
  "external_thread_trigger",
  "conversation_target",
  "model",
  "model_permission",
  "model_allowlist",
  "model_display",
  "model_template",
  "reasoning_display",
  "reasoning_summary_fallback",
  "reasoning_template",
  "tool_display",
  "tool_template",
] as const;

export type SettingKey = (typeof settingKeys)[number];
export const settingLabels: Record<SettingKey, string> = {
  channel_trigger: "チャンネルでの応答条件",
  managed_thread_trigger: "作成したスレッドでの応答条件",
  external_thread_trigger: "その他のスレッドでの応答条件",
  conversation_target: "会話を開始する場所",
  model: "使用モデル",
  model_permission: "モデル変更権限",
  model_allowlist: "変更可能なモデル",
  model_display: "モデル名の表示",
  model_template: "モデル名の表示形式",
  reasoning_display: "思考内容の表示",
  reasoning_summary_fallback: "要約がない場合",
  reasoning_template: "思考内容の表示形式",
  tool_display: "ツール実行の表示",
  tool_template: "ツール実行の表示形式",
};
export const settingGroups = {
  conversation: { label: "🎯 会話トリガー", keys: ["channel_trigger", "managed_thread_trigger", "external_thread_trigger", "conversation_target"] },
  model: { label: "🤖 モデル", keys: ["model", "model_permission", "model_allowlist"] },
  display: { label: "💬 表示テンプレート", keys: ["model_display", "model_template", "reasoning_display", "reasoning_summary_fallback", "reasoning_template", "tool_display", "tool_template"] },
} as const satisfies Record<string, { label: string; keys: readonly SettingKey[] }>;
export type SettingGroup = keyof typeof settingGroups;
export const settingChoices: Partial<Record<SettingKey, readonly string[]>> = {
  channel_trigger: ["mention", "all", "off"],
  managed_thread_trigger: ["mention", "all", "off"],
  external_thread_trigger: ["mention", "all", "off"],
  conversation_target: ["direct", "new_thread"],
  model_permission: ["none", "list", "all"],
  model_display: ["off", "requested", "route"],
  reasoning_display: ["off", "summary", "text"],
  reasoning_summary_fallback: ["hide", "text"],
  tool_display: ["off", "on"],
};
export const settingChoiceLabels: Partial<Record<SettingKey, Readonly<Record<string, string>>>> = {
  channel_trigger: { mention: "メンション時のみ", all: "すべてのメッセージ", off: "応答しない" },
  managed_thread_trigger: { mention: "メンション時のみ", all: "すべてのメッセージ", off: "応答しない" },
  external_thread_trigger: { mention: "メンション時のみ", all: "すべてのメッセージ", off: "応答しない" },
  conversation_target: { direct: "現在のチャンネル", new_thread: "新しいスレッド" },
  model_permission: { none: "変更不可", list: "許可リストのみ", all: "すべてのモデル" },
  model_display: { off: "表示しない", requested: "指定モデル", route: "実際の利用先も表示" },
  reasoning_display: { off: "表示しない", summary: "要約", text: "全文" },
  reasoning_summary_fallback: { hide: "表示しない", text: "全文を表示" },
  tool_display: { off: "表示しない", on: "表示する" },
};
export function settingValueLabel(key: SettingKey, value: string): string {
  return settingChoiceLabels[key]?.[value] ?? value;
}
export const requiredPlaceholders: Partial<Record<SettingKey, readonly string[]>> = {
  model_template: ["${model}"],
  reasoning_template: ["${thought}"],
  tool_template: ["${tool}", "${status}"],
};
export type Trigger = "mention" | "all" | "off";
export type ConversationTarget = "direct" | "new_thread";
export type ModelDisplay = "off" | "requested" | "route";
export type ModelPermission = "none" | "list" | "all";
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
  model_permission: ModelPermission;
  model_allowlist: string;
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
  model: process.env.M2PI_DEFAULT_MODEL?.trim() || "openrouter:openrouter/free",
  model_permission: "list",
  model_allowlist: process.env.M2PI_DEFAULT_MODEL?.trim() || "openrouter:openrouter/free",
  model_display: "route",
  model_template: "-# 🤖 ${model}",
  reasoning_display: "text",
  reasoning_summary_fallback: "text",
  reasoning_template: "-# 🧐 ${thought}",
  tool_display: "on",
  tool_template: "-# 🔧 ${tool} — ${status}",
};

validateSetting("model", defaults.model);

export function validateSetting(key: SettingKey, value: string): void {
  const choices = settingChoices[key];
  if (choices) {
    if (!choices.includes(value)) throw new Error(`${key} は ${choices.join(" / ")} のいずれかです`);
    return;
  }
  if (key in requiredPlaceholders) {
    if (!value || value.length > 500 || /[\r\n]/.test(value)) throw new Error(`${key} は改行なしの 1～500 文字にしてください`);
    if (requiredPlaceholders[key]?.some((placeholder) => !value.includes(placeholder))) {
      throw new Error(`${key} に ${requiredPlaceholders[key]!.join(" と ")} を含めてください`);
    }
    return;
  }
  if (key === "model_allowlist") {
    if (value.length > 2000 || parseModelAllowlist(value).some((model) => !isModelId(model))) {
      throw new Error("model_allowlist は provider:model-id を1行ずつ入力してください");
    }
    return;
  }
  if (!isModelId(value)) {
    throw new Error("model は provider:model-id の形式です（例: openrouter:openrouter/free）");
  }
}

function isModelId(value: string): boolean { return /^[a-z0-9_-]+:[^\s,]+$/i.test(value); }

export function allowedModels(settings: Settings): string[] {
  return parseModelAllowlist(settings.model_allowlist);
}

export function parseModelAllowlist(value: string): string[] {
  return value.split(/,|\r\n|\r|\n/).map((model) => model.trim()).filter(Boolean);
}

export function canSelectModel(settings: Settings, model: string): boolean {
  validateSetting("model", model);
  return settings.model_permission === "all" ||
    (settings.model_permission === "list" && allowedModels(settings).includes(model));
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
