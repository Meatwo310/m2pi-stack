export const settingKeys = [
  "channel_trigger",
  "managed_thread_trigger",
  "external_thread_trigger",
  "conversation_target",
  "model",
] as const;

export type SettingKey = (typeof settingKeys)[number];
export type Trigger = "mention" | "all" | "off";
export type ConversationTarget = "direct" | "new_thread";
export type ScopeKind = "instance" | "guild" | "category" | "channel" | "session";
export type Scope = { kind: ScopeKind; id: string };

export type Settings = {
  channel_trigger: Trigger;
  managed_thread_trigger: Trigger;
  external_thread_trigger: Trigger;
  conversation_target: ConversationTarget;
  model: string;
};

export const defaults: Settings = {
  channel_trigger: "mention",
  managed_thread_trigger: "all",
  external_thread_trigger: "mention",
  conversation_target: "direct",
  model: "openrouter:openrouter/free",
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
