import { readFileSync } from "node:fs";
import {
  ActionRowBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Message,
  type StringSelectMenuInteraction,
} from "discord.js";
import { AgentClient } from "./agent-client.js";
import { allowAllUsers, canUseBot } from "./access.js";
import { allowedModels, canSelectModel, defaults, selectTrigger, settingKeys, type Scope, type ScopeKind, type SettingKey, type Settings } from "./config.js";
import { BotDb } from "./db.js";
import { progressPages, textPages, type ProgressEntry } from "./progress-format.js";
import { appendThinkingLines, completedThinkingLines } from "./thinking-lines.js";

const admins = new Set(required("DISCORD_ADMIN_USER_IDS").split(",").map((id) => id.trim()).filter(Boolean));
const allowedUsers = new Set([...admins, ...(process.env.DISCORD_ALLOWED_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean)]);
const allowAll = allowAllUsers(process.env.DISCORD_ALLOW_ALL_USERS);
const tokenPath = required("DISCORD_TOKEN_FILE");
const db = new BotDb(process.env.M2PI_DB_PATH ?? "/data/app.db");
const agent = new AgentClient(required("M2PI_AGENT_URL"));
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  allowedMentions: { parse: [] },
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
  new SlashCommandBuilder().setName("model").setDescription("このセッションのモデルを表示・変更")
    .addStringOption((option) => option.setName("name").setDescription("provider:model-id。省略するとモデルピッカーを表示")),
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

function conversationKey(guildId: string, channelId: string): string { return `${guildId}:${channelId}`; }

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

function scopes(guildId: string, info: Awaited<ReturnType<typeof context>>, sessionId: string | null): Scope[] {
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
  if (!message.inGuild() || message.author.bot || !canUseBot(message.author.id, allowAll, allowedUsers) || message.type === MessageType.ThreadStarterMessage) return;
  void handleMessage(message).catch((error) => console.error("message error", error));
});

async function handleMessage(message: Message<true>): Promise<void> {
  const info = await context(message.guild, message.channelId);
  const key = conversationKey(message.guildId, message.channelId);
  const activeId = db.getActive(key);
  const effective = db.resolve(scopes(message.guildId, info, activeId)).values;
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
    const pendingModel = db.getPendingModel(key);
    if (pendingModel) {
      db.setPendingModel(conversationKey(message.guildId, thread.id), pendingModel);
      db.clearPendingModel(key);
    }
    destination = thread;
    destinationId = thread.id;
  }
  const targetKey = conversationKey(message.guildId, destinationId);
  await serial(targetKey, async () => {
    const targetInfo = destinationId === message.channelId ? info : await context(message.guild, destinationId);
    const currentId = db.getActive(targetKey);
    const settings = db.resolve(scopes(message.guildId, targetInfo, currentId)).values;
    const model = currentId ? settings.model : db.getPendingModel(targetKey) ?? settings.model;
    await destination.sendTyping();
    const typing = setInterval(() => { void destination.sendTyping().catch(() => undefined); }, 8000);
    try {
      type Segment = { entries: ProgressEntry[]; text?: never; messages: Message[] } |
        { entries?: never; text: string; messages: Message[] };
      const modelEntry: Extract<ProgressEntry, { kind: "model" }> = { kind: "model", requested: model, actual: null };
      const modelSegment: Segment = { entries: [modelEntry], messages: [] };
      const headers = new Map<number, Segment>([[1, modelSegment]]);
      type ThoughtEntry = Extract<ProgressEntry, { kind: "thought" }>;
      type ThoughtState = { header: Segment; pending: string; entries: ThoughtEntry[] };
      const thoughts = new Map<string, ThoughtState>();
      const texts = new Map<string, Segment>();
      const tools = new Map<string, Segment>();
      const headerFor = (messageId: number): Segment => {
        let header = headers.get(messageId);
        if (!header) {
          header = { entries: [], messages: [] };
          headers.set(messageId, header);
        }
        return header;
      };
      const addThought = (header: Segment, entry: ThoughtEntry): void => {
        header.entries!.push(entry);
      };
      const thoughtFor = (id: string, messageId: number): ThoughtState => {
        let state = thoughts.get(id);
        if (!state) {
          state = { header: headerFor(messageId), pending: "", entries: [] };
          thoughts.set(id, state);
        }
        return state;
      };
      const addThoughtLines = (state: ThoughtState, lines: string[]): void => {
        for (const line of lines) {
          if (!line.trim()) continue;
          const entry: ThoughtEntry = { kind: "thought", text: line, summary: "" };
          state.entries.push(entry);
          addThought(state.header, entry);
        }
      };
      const replaceThoughtLines = (state: ThoughtState, lines: string[], summary = ""): void => {
        const entries = state.header.entries!;
        const first = state.entries.length ? entries.indexOf(state.entries[0]!) : entries.length;
        for (const entry of state.entries) {
          const index = entries.indexOf(entry);
          if (index >= 0) entries.splice(index, 1);
        }
        state.entries = [];
        const replacement: ThoughtEntry[] = summary
          ? [{ kind: "thought", text: lines.join(" "), summary }]
          : lines.filter((line) => line.trim()).map((line) => ({ kind: "thought", text: line, summary: "" }));
        const position = first < 0 ? entries.length : first;
        entries.splice(position, 0, ...replacement);
        state.entries.push(...replacement);
      };
      const safe = { allowedMentions: { parse: [] as [] }, flags: MessageFlags.SuppressEmbeds as const };
      const render = async (segment: Segment): Promise<void> => {
        const pages = segment.entries ? progressPages(settings, segment.entries) : textPages(segment.text);
        for (const [index, page] of pages.entries()) {
          const existing = segment.messages[index];
          if (!existing) segment.messages[index] = await destination.send({ content: page, ...safe });
          else if (existing.content !== page) segment.messages[index] = await existing.edit({ content: page, ...safe });
        }
        while (segment.messages.length > pages.length) {
          await segment.messages.at(-1)!.delete();
          segment.messages.pop();
        }
      };
      let renderQueue: Promise<void> = Promise.resolve();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const dirty = new Set<Segment>();
      const flush = async (): Promise<void> => {
        if (timer) clearTimeout(timer);
        timer = null;
        const batch = [...dirty];
        dirty.clear();
        renderQueue = renderQueue.then(async () => {
          for (const segment of batch) await render(segment);
        }).catch((error) => console.error("progress render error", error));
        await renderQueue;
      };
      const refresh = async (segment: Segment, immediate = false): Promise<void> => {
        dirty.add(segment);
        if (immediate) await flush();
        else if (!timer) {
          timer = setTimeout(() => {
            timer = null;
            void flush();
          }, 1200);
        }
      };
      await refresh(modelSegment, true);
      let result;
      try {
        result = await agent.prompt(currentId, prompt, model, async (event) => {
          if (event.type === "model") {
            modelEntry.actual = event.model;
            await refresh(modelSegment, true);
          } else if (event.type === "thinking") {
            const state = thoughtFor(event.id, event.messageId);
            const update = appendThinkingLines(state.pending, event.delta);
            state.pending = update.pending;
            if (update.lines.length) {
              addThoughtLines(state, update.lines);
              await refresh(state.header);
            }
          } else if (event.type === "thinking_end") {
            const state = thoughtFor(event.id, event.messageId);
            const lines = completedThinkingLines(event.content);
            replaceThoughtLines(state, lines);
            state.pending = "";
            await refresh(state.header, true);
          } else if (event.type === "summary") {
            if (settings.reasoning_display === "summary") {
              const state = thoughtFor(event.id, event.messageId);
              replaceThoughtLines(state, state.entries.map((entry) => entry.text), event.text);
              await refresh(state.header, true);
            }
          } else if (event.type === "text_start") {
            if (!texts.has(event.id)) {
              const segment: Segment = { text: "", messages: [] };
              texts.set(event.id, segment);
            }
          } else if (event.type === "text_delta") {
            let segment = texts.get(event.id);
            if (!segment) {
              segment = { text: "", messages: [] };
              texts.set(event.id, segment);
            }
            segment.text += event.delta;
          } else if (event.type === "text_end") {
            let segment = texts.get(event.id);
            if (!segment) {
              segment = { text: "", messages: [] };
              texts.set(event.id, segment);
            }
            segment.text = event.content;
            await refresh(segment, true);
          } else if (event.type === "tool") {
            let segment = tools.get(event.id);
            if (!segment) {
              segment = { entries: [{ kind: "tool", id: event.id, name: event.name, status: event.status }], messages: [] };
              tools.set(event.id, segment);
            } else (segment.entries![0] as Extract<ProgressEntry, { kind: "tool" }>).status = event.status;
            await refresh(segment, event.status !== "running" || segment.messages.length === 0);
          }
        });
      } catch (error) {
        await flush();
        throw error;
      }
      db.setActive(targetKey, result.sessionId);
      db.activateModel(targetKey, result.sessionId);
      modelEntry.actual = result.model;
      await refresh(modelSegment, true);
      if (texts.size === 0) {
        for (const piece of pieces(result.text)) await destination.send({ content: piece, ...safe });
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
  if (kind === "guild") return { kind, id: interaction.guildId };
  if (kind === "session") {
    const id = db.getActive(conversationKey(interaction.guildId, interaction.channelId));
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

function modelView(settings: Settings, current: string, pending: boolean): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const permission = { none: "変更不可", list: "許可リストのみ", all: "全モデル" }[settings.model_permission];
  const candidates = [...new Set([current, ...allowedModels(settings)])]
    .filter((model) => model.length <= 100).slice(0, 25);
  const embed = new EmbedBuilder().setTitle("モデル")
    .addFields(
      { name: pending ? "次のセッションのモデル" : "現在のモデル", value: `\`${current}\`` },
      { name: "変更権限", value: permission },
    )
    .setDescription("モデルを直接指定するには `/model name:provider:model-id` を使ってください。選択時に操作したユーザーの権限を確認します。管理者は変更権限の制限を受けません。");
  const components = candidates.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("model:select").setPlaceholder("モデルを選択")
      .addOptions(candidates.map((model) => ({ label: model.slice(0, 100), value: model, default: model === current }))),
  )] : [];
  return { embeds: [embed], components };
}

async function setSessionModel(guild: Guild, channelId: string, userId: string, model: string): Promise<string> {
  const key = conversationKey(guild.id, channelId);
  return serial(key, async () => {
    const sessionId = db.getActive(key);
    const info = await context(guild, channelId);
    const settings = db.resolve(scopes(guild.id, info, sessionId)).values;
    if (!admins.has(userId) && !canSelectModel(settings, model)) {
      throw new Error(settings.model_permission === "none" ? "モデル変更は許可されていません" : "このモデルは許可リストにありません");
    }
    if (sessionId) db.setOverride({ kind: "session", id: sessionId }, "model", model);
    else db.setPendingModel(key, model);
    return sessionId ? "このセッション" : "次のセッション";
  });
}

async function handleModelSelect(interaction: StringSelectMenuInteraction<"cached">): Promise<void> {
  if (!canUseBot(interaction.user.id, allowAll, allowedUsers)) throw new Error("この bot の利用は許可されていません");
  await interaction.deferUpdate();
  const selected = interaction.values[0]!;
  const target = await setSessionModel(interaction.guild, interaction.channelId, interaction.user.id, selected);
  const key = conversationKey(interaction.guildId, interaction.channelId);
  const sessionId = db.getActive(key);
  const info = await context(interaction.guild, interaction.channelId);
  const settings = db.resolve(scopes(interaction.guildId, info, sessionId)).values;
  await interaction.editReply({ content: `${target}のモデルを \`${selected}\` に設定しました`,
    ...modelView(settings, selected, !sessionId) });
}

client.on("interactionCreate", (interaction) => {
  if (interaction.isStringSelectMenu() && interaction.customId === "model:select") {
    if (!interaction.inCachedGuild()) return;
    void handleModelSelect(interaction).catch(async (error) => {
      console.error("model picker error", error);
      const content = error instanceof Error ? error.message : "モデルを変更できませんでした";
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content, ephemeral: true });
        else await interaction.reply({ content, ephemeral: true });
      }
      catch (replyError) { console.error("reply error", replyError); }
    });
    return;
  }
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
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
  if (!canUseBot(interaction.user.id, allowAll, allowedUsers)) {
    await interaction.reply({ content: "この bot の利用は許可されていません", ephemeral: true });
    return;
  }
  if (["restart", "config"].includes(command) && !admins.has(interaction.user.id)) {
    await interaction.reply({ content: "管理者専用コマンドです", ephemeral: true });
    return;
  }
  const key = conversationKey(interaction.guildId, interaction.channelId);
  if (command === "new") {
    await interaction.deferReply();
    await serial(key, async () => { db.clearActive(key); db.clearPendingModel(key); });
    await interaction.editReply("次のメッセージから新しいセッションを開始します");
    return;
  }
  if (command === "resume") {
    await interaction.deferReply();
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
      await interaction.editReply("セッションを再開できませんでした");
      return;
    }
    await serial(key, async () => { db.setActive(key, requested); db.clearPendingModel(key); });
    await interaction.editReply(`セッションを再開しました: \`${requested}\``);
    return;
  }
  if (command === "model") {
    await interaction.deferReply();
    const requested = interaction.options.getString("name");
    if (requested) {
      const target = await setSessionModel(interaction.guild, interaction.channelId, interaction.user.id, requested);
      await interaction.editReply({ content: `${target}のモデルを \`${requested}\` に設定しました` });
      return;
    }
    const sessionId = db.getActive(key);
    const info = await context(interaction.guild, interaction.channelId);
    const settings = db.resolve(scopes(interaction.guildId, info, sessionId)).values;
    const current = sessionId ? settings.model : db.getPendingModel(key) ?? settings.model;
    await interaction.editReply(modelView(settings, current, !sessionId));
    return;
  }
  if (command === "restart") {
    if (pending.size > 0) throw new Error("処理中の会話があります。完了後に再試行してください");
    await interaction.reply({ content: "bot を再起動します" });
    setTimeout(() => { client.destroy(); db.close(); process.exit(0); }, 500);
    return;
  }
  if (command === "config") {
    const action = interaction.options.getSubcommand();
    if (action === "show") {
      const info = await context(interaction.guild, interaction.channelId);
      const effective = db.resolve(scopes(interaction.guildId, info, db.getActive(key)));
      const lines = settingKeys.map((item) => {
        const source = effective.sources[item];
        return `${item}: \`${effective.values[item]}\` ← ${source === "default" ? "default" : `${source.kind}:${source.id}`}`;
      });
      const chunks = pieces(lines.join("\n"));
      await interaction.reply({ content: chunks[0]!, ephemeral: true, allowedMentions: { parse: [] } });
      for (const chunk of chunks.slice(1)) await interaction.followUp({ content: chunk, ephemeral: true, allowedMentions: { parse: [] } });
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

async function registerCommands(guild: Guild): Promise<void> {
  await guild.commands.set(commands.map((command) => command.toJSON()));
}

client.on("guildCreate", (guild) => {
  if (!client.isReady()) return;
  void registerCommands(guild).catch((error) => console.error(`command registration error for guild ${guild.id}`, error));
});

client.once("ready", async () => {
  const guilds = [...client.guilds.cache.values()];
  const results = await Promise.allSettled(guilds.map(registerCommands));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error(`command registration error for guild ${guilds[index]!.id}`, result.reason);
    }
  }
  console.log(`ready as ${client.user?.tag}; guilds ${client.guilds.cache.size}; default model ${defaults.model}`);
});

const token = readFileSync(tokenPath, "utf8").trim();
if (!token) throw new Error("Discord トークンが空です");
await client.login(token);
