import { readFileSync } from "node:fs";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageType,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
} from "discord.js";
import { AgentClient } from "./agent-client.js";
import { defaults, selectTrigger, settingKeys, type Scope, type ScopeKind, type SettingKey } from "./config.js";
import { BotDb } from "./db.js";

const guildId = required("DISCORD_GUILD_ID");
const admins = new Set(required("DISCORD_ADMIN_USER_IDS").split(",").map((id) => id.trim()).filter(Boolean));
const allowedUsers = new Set([...admins, ...(process.env.DISCORD_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean)]);
const tokenPath = required("DISCORD_TOKEN_FILE");
const db = new BotDb(process.env.M2PI_DB_PATH ?? "/data/app.db");
const agent = new AgentClient(required("M2PI_AGENT_URL"));
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} が必要です`);
  return value;
}

const settingChoices = settingKeys.map((key) => ({ name: key, value: key }));
const scopeChoices: Array<{ name: ScopeKind; value: ScopeKind }> = [
  { name: "session", value: "session" },
  { name: "channel", value: "channel" },
  { name: "category", value: "category" },
  { name: "guild", value: "guild" },
  { name: "instance", value: "instance" },
];
const commands = [
  new SlashCommandBuilder().setName("new").setDescription("この場所で新しい Pi セッションを開始"),
  new SlashCommandBuilder().setName("resume").setDescription("この場所の Pi セッションを一覧・再開")
    .addStringOption((option) => option.setName("session").setDescription("再開するセッション ID。省略すると一覧を表示")),
  new SlashCommandBuilder().setName("restart").setDescription("bot を再起動（管理者のみ）"),
  new SlashCommandBuilder().setName("config").setDescription("設定を表示・変更（管理者のみ）")
    .addSubcommand((sub) => sub.setName("show").setDescription("この場所の有効な設定を表示"))
    .addSubcommand((sub) => sub.setName("set").setDescription("設定を上書き")
      .addStringOption((option) => option.setName("scope").setDescription("設定階層").setRequired(true).addChoices(...scopeChoices))
      .addStringOption((option) => option.setName("setting").setDescription("設定項目").setRequired(true).addChoices(...settingChoices))
      .addStringOption((option) => option.setName("value").setDescription("設定値").setRequired(true))
      .addChannelOption((option) => option.setName("target").setDescription("channel/category の対象。省略時は現在の場所")))
    .addSubcommand((sub) => sub.setName("reset").setDescription("上書きを消して継承に戻す")
      .addStringOption((option) => option.setName("scope").setDescription("設定階層").setRequired(true).addChoices(...scopeChoices))
      .addStringOption((option) => option.setName("setting").setDescription("設定項目").setRequired(true).addChoices(...settingChoices))
      .addChannelOption((option) => option.setName("target").setDescription("channel/category の対象。省略時は現在の場所"))),
];

const pending = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(work);
  pending.set(key, task);
  try { return await task; }
  finally { if (pending.get(key) === task) pending.delete(key); }
}

function conversationKey(channelId: string): string { return `${guildId}:${channelId}`; }

async function context(guild: Guild, channelId: string): Promise<{
  isThread: boolean; parentChannelId: string; categoryId: string | null; managed: boolean;
}> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel) throw new Error("チャンネルを取得できません");
  const isThread = channel.isThread();
  const parentChannelId = isThread ? channel.parentId : channel.id;
  if (!parentChannelId) throw new Error("親チャンネルを取得できません");
  const parent = isThread ? await guild.channels.fetch(parentChannelId) : channel;
  const categoryId = parent && "parentId" in parent && typeof parent.parentId === "string" ? parent.parentId : null;
  return { isThread, parentChannelId, categoryId, managed: isThread && db.isManagedThread(channelId) };
}

function scopes(info: Awaited<ReturnType<typeof context>>, sessionId: string | null): Scope[] {
  const result: Scope[] = [];
  if (sessionId) result.push({ kind: "session", id: sessionId });
  result.push({ kind: "channel", id: info.parentChannelId });
  if (info.categoryId) result.push({ kind: "category", id: info.categoryId });
  result.push({ kind: "guild", id: guildId }, { kind: "instance", id: "default" });
  return result;
}

function promptFrom(message: Message): string {
  const mention = client.user?.id;
  const content = mention ? message.content.replace(new RegExp(`<@!?${mention}>`, "g"), "").trim() : message.content.trim();
  return content ? `Discord user ${message.author.id} (${message.author.username}):\n${content}` : "";
}

function pieces(text: string): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 1900) {
    const boundary = rest.lastIndexOf("\n", 1900);
    const length = boundary > 900 ? boundary : 1900;
    chunks.push(rest.slice(0, length));
    rest = rest.slice(length).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : ["（応答本文がありません）"];
}

client.on("messageCreate", (message) => {
  if (!message.inGuild() || message.guildId !== guildId || message.author.bot || !allowedUsers.has(message.author.id) || message.type === MessageType.ThreadStarterMessage) return;
  void handleMessage(message).catch((error) => console.error("message error", error));
});

async function handleMessage(message: Message<true>): Promise<void> {
  const info = await context(message.guild, message.channelId);
  const key = conversationKey(message.channelId);
  const activeId = db.getActive(key);
  const effective = db.resolve(scopes(info, activeId)).values;
  const mode = selectTrigger(effective, info.isThread, info.managed);
  if (mode === "off" || (mode === "mention" && !message.mentions.has(client.user!.id))) return;
  const prompt = promptFrom(message);
  if (!prompt) return;

  let destination = message.channel;
  let destinationId = message.channelId;
  if (!info.isThread && effective.conversation_target === "new_thread") {
    let thread;
    try {
      thread = await message.startThread({ name: `m2pi: ${message.content.replace(/<@!?\d+>/g, "").trim().slice(0, 70) || "新しい会話"}` });
    } catch (error) {
      console.error("thread creation error", error);
      await message.reply({ content: "スレッドを作れませんでした。bot のスレッド作成権限を確認してください。", allowedMentions: { parse: [] } });
      return;
    }
    db.markManagedThread(thread.id, message.channelId);
    destination = thread;
    destinationId = thread.id;
  }
  const targetKey = conversationKey(destinationId);
  await serial(targetKey, async () => {
    const targetInfo = destinationId === message.channelId ? info : await context(message.guild, destinationId);
    const currentId = db.getActive(targetKey);
    const model = db.resolve(scopes(targetInfo, currentId)).values.model;
    await destination.sendTyping();
    const typing = setInterval(() => { void destination.sendTyping().catch(() => undefined); }, 8000);
    try {
      const result = await agent.prompt(currentId, prompt, model);
      db.setActive(targetKey, result.sessionId);
      for (const piece of pieces(result.text)) {
        await destination.send({ content: piece, allowedMentions: { parse: [] } });
      }
    } catch (error) {
      console.error("agent prompt error", error);
      await destination.send({ content: "Pi の処理に失敗しました。管理者にログの確認を依頼してください。", allowedMentions: { parse: [] } });
    } finally {
      clearInterval(typing);
    }
  });
}

async function targetScope(interaction: ChatInputCommandInteraction<"cached">, kind: ScopeKind): Promise<Scope> {
  if (kind === "instance") return { kind, id: "default" };
  if (kind === "guild") return { kind, id: guildId };
  if (kind === "session") {
    const id = db.getActive(conversationKey(interaction.channelId));
    if (!id) throw new Error("この場所にはアクティブなセッションがありません");
    return { kind, id };
  }
  const chosen = interaction.options.getChannel("target");
  const info = await context(interaction.guild, chosen?.id ?? interaction.channelId);
  if (kind === "channel") return { kind, id: info.parentChannelId };
  if (chosen?.type === ChannelType.GuildCategory) return { kind, id: chosen.id };
  if (!info.categoryId) throw new Error("このチャンネルにはカテゴリがありません。target でカテゴリを指定してください");
  return { kind, id: info.categoryId };
}

client.on("interactionCreate", (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild() || interaction.guildId !== guildId) return;
  void handleCommand(interaction).catch(async (error) => {
    console.error("command error", error);
    const content = error instanceof Error ? error.message : "コマンドに失敗しました";
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, ephemeral: true });
      else await interaction.reply({ content, ephemeral: true });
    } catch (replyError) { console.error("reply error", replyError); }
  });
});

async function handleCommand(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const command = interaction.commandName;
  if (!allowedUsers.has(interaction.user.id)) {
    await interaction.reply({ content: "この bot の利用は許可されていません", ephemeral: true });
    return;
  }
  if (["restart", "config"].includes(command) && !admins.has(interaction.user.id)) {
    await interaction.reply({ content: "管理者専用コマンドです", ephemeral: true });
    return;
  }
  const key = conversationKey(interaction.channelId);
  if (command === "new") {
    await interaction.deferReply({ ephemeral: true });
    await serial(key, async () => db.clearActive(key));
    await interaction.editReply("次のメッセージから新しいセッションを開始します");
    return;
  }
  if (command === "resume") {
    await interaction.deferReply({ ephemeral: true });
    const requested = interaction.options.getString("session");
    if (!requested) {
      const current = db.getActive(key);
      const rows = db.listSessions(key);
      await interaction.editReply(
        rows.length
          ? `現在: ${current ?? "なし"}\n最近のセッション:\n${rows.map((row) => `\`${row.id}\` — ${row.createdAt}`).join("\n")}\n再開: \`/resume session:<ID>\``
          : "この場所に保存されたセッションはありません",
      );
      return;
    }
    if (!db.hasSession(key, requested) || !(await agent.exists(requested))) {
      throw new Error("この場所のセッションが見つかりません");
    }
    await serial(key, async () => db.setActive(key, requested));
    await interaction.editReply(`セッションを再開しました: \`${requested}\``);
    return;
  }
  if (command === "restart") {
    if (pending.size > 0) throw new Error("処理中の会話があります。完了後に再試行してください");
    await interaction.reply({ content: "bot を再起動します", ephemeral: true });
    setTimeout(() => { client.destroy(); db.close(); process.exit(0); }, 500);
    return;
  }
  if (command === "config") {
    const action = interaction.options.getSubcommand();
    if (action === "show") {
      const info = await context(interaction.guild, interaction.channelId);
      const effective = db.resolve(scopes(info, db.getActive(key)));
      const lines = settingKeys.map((item) => {
        const source = effective.sources[item];
        return `${item}: \`${effective.values[item]}\` ← ${source === "default" ? "default" : `${source.kind}:${source.id}`}`;
      });
      await interaction.reply({ content: lines.join("\n"), ephemeral: true });
      return;
    }
    const kind = interaction.options.getString("scope", true) as ScopeKind;
    const setting = interaction.options.getString("setting", true) as SettingKey;
    const scope = await targetScope(interaction, kind);
    if (action === "set") {
      const value = interaction.options.getString("value", true);
      db.setOverride(scope, setting, value);
      await interaction.reply({ content: `${scope.kind}:${scope.id} の ${setting} を \`${value}\` に設定しました`, ephemeral: true });
    } else {
      db.resetOverride(scope, setting);
      await interaction.reply({ content: `${scope.kind}:${scope.id} の ${setting} を継承に戻しました`, ephemeral: true });
    }
  }
}

client.once("ready", async () => {
  const guild = await client.guilds.fetch(guildId);
  await guild.commands.set(commands.map((command) => command.toJSON()));
  console.log(`ready as ${client.user?.tag}; guild ${guildId}; default model ${defaults.model}`);
});

const token = readFileSync(tokenPath, "utf8").trim();
if (!token) throw new Error("Discord トークンが空です");
await client.login(token);
