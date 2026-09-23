export function shouldAcceptMessage(message, allowedUserIds, botUserId) {
  if (!message || message.author?.bot) return false;
  if (!allowedUserIds.has(String(message.author?.id ?? ""))) return false;

  // Direct messages have no meaningful mention gate. Guild messages must
  // explicitly mention this bot; replying to it without a mention is ignored.
  if (!message.guildId) return true;
  if (!botUserId) return false;
  return Boolean(message.mentions?.users?.has(String(botUserId)));
}

export function normalizePrompt(content, botUserId) {
  let text = String(content ?? "");
  if (botUserId) {
    const escaped = String(botUserId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`<@!?${escaped}>`, "g"), " ");
  }
  return text.replace(/\s+/g, " ").trim();
}
