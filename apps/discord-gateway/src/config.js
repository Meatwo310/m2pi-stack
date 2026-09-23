import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DEFAULT_MODEL = "openrouter/openrouter/free";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function parseList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseIdSet(value) {
  return new Set(parseList(value));
}

export function loadConfig(env = process.env) {
  const token = env.DISCORD_TOKEN || env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is required");

  const allowedUserIds = parseIdSet(env.DISCORD_ALLOWED_USER_IDS);
  if (allowedUserIds.size === 0) {
    throw new Error("DISCORD_ALLOWED_USER_IDS must contain at least one user ID");
  }

  return {
    token,
    allowedUserIds,
    model: env.PI_MODEL || DEFAULT_MODEL,
    cwd: env.PI_CWD || "/home/m2pi",
    agentDir: env.PI_CODING_AGENT_DIR || join(REPO_ROOT, "pi", "agent"),
    allowedTools: parseList(env.PI_GATEWAY_TOOLS),
    sessionRoot:
      env.PI_DISCORD_SESSION_DIR ||
      "/home/m2pi/.local/state/pi-discord-gateway/sessions",
  };
}
