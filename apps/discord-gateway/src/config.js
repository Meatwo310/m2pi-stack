import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigStore } from "./config-store.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function stateRoot(homeDir, stateHome) {
  return stateHome || join(homeDir, ".local", "state");
}

export function defaultDatabasePath({
  homeDir = homedir(),
  stateHome = process.env.XDG_STATE_HOME,
} = {}) {
  return join(stateRoot(homeDir, stateHome), "pi-discord-gateway", "state.db");
}

export function defaultRuntimeConfig({
  homeDir = homedir(),
  stateHome = process.env.XDG_STATE_HOME,
  repoRoot = REPO_ROOT,
} = {}) {
  return {
    model: "openrouter/openrouter/free",
    cwd: homeDir,
    agentDir: join(repoRoot, "pi", "agent"),
    allowedTools: [],
    sessionRoot: join(
      stateRoot(homeDir, stateHome),
      "pi-discord-gateway",
      "sessions",
    ),
  };
}

export function loadConfig(env = process.env) {
  const token = env.DISCORD_TOKEN || env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is required");

  const databasePath = env.M2PI_DATABASE_PATH || defaultDatabasePath({
    stateHome: env.XDG_STATE_HOME,
  });
  const store = new ConfigStore(databasePath);
  try {
    return { token, databasePath, ...store.read() };
  } finally {
    store.close();
  }
}
