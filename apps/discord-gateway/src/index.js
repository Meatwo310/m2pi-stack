import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { loadConfig } from "./config.js";
import { PiSessionPool } from "./pi-session.js";
import { normalizePrompt, shouldAcceptMessage } from "./policy.js";
import { splitDiscordMessage } from "./text.js";

const config = loadConfig();
const sessions = new PiSessionPool({
  modelName: config.model,
  cwd: config.cwd,
  agentDir: config.agentDir,
  allowedTools: config.allowedTools,
  sessionRoot: config.sessionRoot,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, () => {
  console.log(
    `ready bot=${client.user.id} model=${config.model} allowedUsers=${[
      ...config.allowedUserIds,
    ].join(",")} tools=${config.allowedTools.join(",") || "none"}`,
  );
});

client.on("messageCreate", async (message) => {
  if (!shouldAcceptMessage(message, config.allowedUserIds, client.user?.id)) return;

  const prompt = normalizePrompt(message.content, client.user?.id);
  if (!prompt) return;

  let typingTimer;
  try {
    await message.channel.sendTyping();
    typingTimer = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8000);

    const response = await sessions.prompt(message.channelId, prompt);
    const chunks = splitDiscordMessage(response);
    for (let index = 0; index < chunks.length; index += 1) {
      const payload = {
        content: chunks[index],
        allowedMentions: { repliedUser: false },
      };
      if (index === 0) await message.reply(payload);
      else await message.channel.send(payload);
    }
  } catch (error) {
    console.error(
      `message failed channel=${message.channelId}:`,
      error instanceof Error ? error.stack || error.message : error,
    );
    await message
      .reply({
        content: "Piの応答生成中にエラーが発生しました。ログを確認してください。",
        allowedMentions: { repliedUser: false },
      })
      .catch(() => {});
  } finally {
    if (typingTimer) clearInterval(typingTimer);
  }
});

client.on("error", (error) => console.error("Discord client error:", error));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`shutdown signal=${signal}`);
  client.destroy();
  await sessions.dispose();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

await client.login(config.token);
