import {
  AdapterRateLimitError,
  AuthenticationError,
  cardToFallbackText,
  extractCard,
  extractFiles,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  convertEmojiPlaceholders,
  defaultEmojiResolver,
  getEmoji,
  Message,
  NotImplementedError,
} from "chat";
import {
  cardToTelegramInlineKeyboard,
  decodeTelegramCallbackData,
  emptyTelegramInlineKeyboard,
} from "./cards";
import { TelegramFormatConverter } from "./markdown";
import type {
  TelegramAdapterConfig,
  TelegramApiResponse,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramFile,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramMessageReactionUpdated,
  TelegramRawMessage,
  TelegramReactionType,
  TelegramThreadId,
  TelegramUpdate,
  TelegramUser,
} from "./types";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_SECRET_TOKEN_HEADER = "x-telegram-bot-api-secret-token";
const MESSAGE_ID_PATTERN = /^([^:]+):(\d+)$/;
const TELEGRAM_MARKDOWN_PARSE_MODE = "Markdown";
const TRAILING_SLASHES_REGEX = /\/+$/;
const MESSAGE_SEQUENCE_PATTERN = /:(\d+)$/;
const LEADING_AT_PATTERN = /^@+/;
const EMOJI_PLACEHOLDER_PATTERN = /^\{\{emoji:([a-z0-9_]+)\}\}$/i;
const EMOJI_NAME_PATTERN = /^[a-z0-9_+-]+$/i;
interface TelegramMessageAuthor {
  fullName: string;
  isBot: boolean | "unknown";
  isMe: boolean;
  userId: string;
  userName: string;
}

export class TelegramAdapter
  implements Adapter<TelegramThreadId, TelegramRawMessage>
{
  readonly name = "telegram";

  private readonly botToken: string;
  private readonly apiBaseUrl: string;
  private readonly secretToken?: string;
  private readonly logger: Logger;
  private readonly formatConverter = new TelegramFormatConverter();
  private readonly messageCache = new Map<
    string,
    Message<TelegramRawMessage>[]
  >();

  private chat: ChatInstance | null = null;
  private _botUserId?: string;
  private _userName: string;
  private readonly hasExplicitUserName: boolean;

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  constructor(
    config: TelegramAdapterConfig & { logger: Logger; userName?: string }
  ) {
    this.botToken = config.botToken;
    this.apiBaseUrl = (config.apiBaseUrl ?? TELEGRAM_API_BASE).replace(
      TRAILING_SLASHES_REGEX,
      ""
    );
    this.secretToken = config.secretToken;
    this.logger = config.logger;
    this._userName = this.normalizeUserName(config.userName ?? "bot");
    this.hasExplicitUserName = Boolean(config.userName);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (!this.hasExplicitUserName) {
      this._userName = this.normalizeUserName(chat.getUserName());
    }

    try {
      const me = await this.telegramFetch<TelegramUser>("getMe");
      this._botUserId = String(me.id);
      if (!this.hasExplicitUserName && me.username) {
        this._userName = this.normalizeUserName(me.username);
      }

      this.logger.info("Telegram adapter initialized", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Failed to fetch Telegram bot identity", {
        error: String(error),
      });
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    if (this.secretToken) {
      const headerToken = request.headers.get(TELEGRAM_SECRET_TOKEN_HEADER);
      if (headerToken !== this.secretToken) {
        this.logger.warn(
          "Telegram webhook rejected due to invalid secret token"
        );
        return new Response("Invalid secret token", { status: 401 });
      }
    }

    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn(
        "Chat instance not initialized, ignoring Telegram webhook"
      );
      return new Response("OK", { status: 200 });
    }

    const messageUpdate =
      update.message ??
      update.edited_message ??
      update.channel_post ??
      update.edited_channel_post;

    if (messageUpdate) {
      this.handleIncomingMessageUpdate(messageUpdate, options);
    }

    if (update.callback_query) {
      this.handleCallbackQuery(update.callback_query, options);
    }

    if (update.message_reaction) {
      this.handleMessageReactionUpdate(update.message_reaction, options);
    }

    return new Response("OK", { status: 200 });
  }

  private handleIncomingMessageUpdate(
    telegramMessage: TelegramMessage,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.encodeThreadId({
      chatId: String(telegramMessage.chat.id),
      messageThreadId: telegramMessage.message_thread_id,
    });

    const parsedMessage = this.parseTelegramMessage(telegramMessage, threadId);
    this.cacheMessage(parsedMessage);

    this.chat.processMessage(this, threadId, parsedMessage, options);
  }

  private handleCallbackQuery(
    callbackQuery: TelegramCallbackQuery,
    options?: WebhookOptions
  ): void {
    if (!(this.chat && callbackQuery.message)) {
      return;
    }

    const threadId = this.encodeThreadId({
      chatId: String(callbackQuery.message.chat.id),
      messageThreadId: callbackQuery.message.message_thread_id,
    });

    const messageId = this.encodeMessageId(
      String(callbackQuery.message.chat.id),
      callbackQuery.message.message_id
    );

    const { actionId, value } = decodeTelegramCallbackData(callbackQuery.data);

    this.chat.processAction(
      {
        adapter: this,
        actionId,
        value,
        messageId,
        threadId,
        user: this.toAuthor(callbackQuery.from),
        raw: callbackQuery,
      },
      options
    );

    const ackTask = this.telegramFetch<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
    }).catch((error) => {
      this.logger.warn("Failed to acknowledge Telegram callback query", {
        callbackQueryId: callbackQuery.id,
        error: String(error),
      });
    });

    if (options?.waitUntil) {
      options.waitUntil(ackTask);
    }
  }

  private handleMessageReactionUpdate(
    reactionUpdate: TelegramMessageReactionUpdated,
    options?: WebhookOptions
  ): void {
    if (!this.chat) {
      return;
    }

    const threadId = this.encodeThreadId({
      chatId: String(reactionUpdate.chat.id),
      messageThreadId: reactionUpdate.message_thread_id,
    });

    const messageId = this.encodeMessageId(
      String(reactionUpdate.chat.id),
      reactionUpdate.message_id
    );

    const oldReactions = new Set(
      reactionUpdate.old_reaction.map((reaction) => this.reactionKey(reaction))
    );
    const newReactions = new Set(
      reactionUpdate.new_reaction.map((reaction) => this.reactionKey(reaction))
    );

    const actor = reactionUpdate.user
      ? this.toAuthor(reactionUpdate.user)
      : this.toReactionActorAuthor(reactionUpdate.chat);

    for (const reaction of reactionUpdate.new_reaction) {
      const key = this.reactionKey(reaction);
      if (!oldReactions.has(key)) {
        this.chat.processReaction(
          {
            adapter: this,
            threadId,
            messageId,
            emoji: this.reactionToEmojiValue(reaction),
            rawEmoji: key,
            added: true,
            user: actor,
            raw: reactionUpdate,
          },
          options
        );
      }
    }

    for (const reaction of reactionUpdate.old_reaction) {
      const key = this.reactionKey(reaction);
      if (!newReactions.has(key)) {
        this.chat.processReaction(
          {
            adapter: this,
            threadId,
            messageId,
            emoji: this.reactionToEmojiValue(reaction),
            rawEmoji: key,
            added: false,
            user: actor,
            raw: reactionUpdate,
          },
          options
        );
      }
    }
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    const parsedThread = this.resolveThreadId(threadId);

    const card = extractCard(message);
    const replyMarkup = card ? cardToTelegramInlineKeyboard(card) : undefined;
    const parseMode = card ? TELEGRAM_MARKDOWN_PARSE_MODE : undefined;
    const text = this.truncateMessage(
      convertEmojiPlaceholders(
        card
          ? cardToFallbackText(card)
          : this.formatConverter.renderPostable(message),
        "gchat"
      )
    );

    const files = extractFiles(message);
    if (files.length > 1) {
      throw new ValidationError(
        "telegram",
        "Telegram adapter supports a single file upload per message"
      );
    }

    let rawMessage: TelegramMessage;

    if (files.length === 1) {
      const [file] = files;
      if (!file) {
        throw new ValidationError("telegram", "File upload payload is empty");
      }
      rawMessage = await this.sendDocument(
        parsedThread,
        file,
        text,
        replyMarkup,
        parseMode
      );
    } else {
      if (!text.trim()) {
        throw new ValidationError("telegram", "Message text cannot be empty");
      }

      rawMessage = await this.telegramFetch<TelegramMessage>("sendMessage", {
        chat_id: parsedThread.chatId,
        message_thread_id: parsedThread.messageThreadId,
        text,
        reply_markup: replyMarkup,
        parse_mode: parseMode,
      });
    }

    const resultingThreadId = this.encodeThreadId({
      chatId: String(rawMessage.chat.id),
      messageThreadId:
        rawMessage.message_thread_id ?? parsedThread.messageThreadId,
    });

    const parsedMessage = this.parseTelegramMessage(
      rawMessage,
      resultingThreadId
    );
    this.cacheMessage(parsedMessage);

    return {
      id: parsedMessage.id,
      threadId: parsedMessage.threadId,
      raw: rawMessage,
    };
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    const threadId = this.encodeThreadId({ chatId: channelId });
    return this.postMessage(threadId, message);
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<TelegramRawMessage>> {
    const parsedThread = this.resolveThreadId(threadId);
    const {
      chatId,
      messageId: telegramMessageId,
      compositeId,
    } = this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    const card = extractCard(message);
    const replyMarkup = card ? cardToTelegramInlineKeyboard(card) : undefined;
    const parseMode = card ? TELEGRAM_MARKDOWN_PARSE_MODE : undefined;
    const text = this.truncateMessage(
      convertEmojiPlaceholders(
        card
          ? cardToFallbackText(card)
          : this.formatConverter.renderPostable(message),
        "gchat"
      )
    );

    if (!text.trim()) {
      throw new ValidationError("telegram", "Message text cannot be empty");
    }

    const result = await this.telegramFetch<TelegramMessage | true>(
      "editMessageText",
      {
        chat_id: chatId,
        message_id: telegramMessageId,
        text,
        reply_markup: replyMarkup ?? emptyTelegramInlineKeyboard(),
        parse_mode: parseMode,
      }
    );

    if (result === true) {
      const existing = this.findCachedMessage(compositeId);
      if (!existing) {
        throw new NotImplementedError(
          "Telegram returned a non-message edit result and no cached message was found",
          "editMessage"
        );
      }

      const updated = new Message<TelegramRawMessage>({
        ...existing,
        text,
        formatted: this.formatConverter.toAst(text),
        metadata: {
          ...existing.metadata,
          edited: true,
          editedAt: new Date(),
        },
      });

      this.cacheMessage(updated);

      return {
        id: updated.id,
        threadId: updated.threadId,
        raw: updated.raw,
      };
    }

    const resultingThreadId = this.encodeThreadId({
      chatId: String(result.chat.id),
      messageThreadId: result.message_thread_id ?? parsedThread.messageThreadId,
    });

    const parsedMessage = this.parseTelegramMessage(result, resultingThreadId);
    this.cacheMessage(parsedMessage);

    return {
      id: parsedMessage.id,
      threadId: parsedMessage.threadId,
      raw: result,
    };
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const {
      chatId,
      messageId: telegramMessageId,
      compositeId,
    } = this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    await this.telegramFetch<boolean>("deleteMessage", {
      chat_id: chatId,
      message_id: telegramMessageId,
    });

    this.deleteCachedMessage(compositeId);
  }

  async addReaction(
    threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const { chatId, messageId: telegramMessageId } =
      this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    await this.telegramFetch<boolean>("setMessageReaction", {
      chat_id: chatId,
      message_id: telegramMessageId,
      reaction: [this.toTelegramReaction(emoji)],
    });
  }

  async removeReaction(
    threadId: string,
    messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    const { chatId, messageId: telegramMessageId } =
      this.decodeCompositeMessageId(messageId, parsedThread.chatId);

    await this.telegramFetch<boolean>("setMessageReaction", {
      chat_id: chatId,
      message_id: telegramMessageId,
      reaction: [],
    });
  }

  async startTyping(threadId: string): Promise<void> {
    const parsedThread = this.resolveThreadId(threadId);
    await this.telegramFetch<boolean>("sendChatAction", {
      chat_id: parsedThread.chatId,
      message_thread_id: parsedThread.messageThreadId,
      action: "typing",
    });
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<TelegramRawMessage>> {
    const messages = [...(this.messageCache.get(threadId) ?? [])].sort((a, b) =>
      this.compareMessages(a, b)
    );

    return this.paginateMessages(messages, options);
  }

  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<TelegramRawMessage>> {
    const byId = new Map<string, Message<TelegramRawMessage>>();

    for (const [threadId, messages] of this.messageCache.entries()) {
      let decoded: TelegramThreadId;
      try {
        decoded = this.decodeThreadId(threadId);
      } catch {
        continue;
      }

      if (decoded.chatId !== channelId) {
        continue;
      }

      for (const message of messages) {
        byId.set(message.id, message);
      }
    }

    const allMessages = [...byId.values()].sort((a, b) =>
      this.compareMessages(a, b)
    );
    return this.paginateMessages(allMessages, options);
  }

  async fetchMessage(
    _threadId: string,
    messageId: string
  ): Promise<Message<TelegramRawMessage> | null> {
    return this.findCachedMessage(messageId) ?? null;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const parsedThread = this.resolveThreadId(threadId);
    const chat = await this.telegramFetch<TelegramChat>("getChat", {
      chat_id: parsedThread.chatId,
    });

    return {
      id: this.encodeThreadId(parsedThread),
      channelId: String(chat.id),
      channelName: this.chatDisplayName(chat),
      isDM: chat.type === "private",
      metadata: {
        chat,
        messageThreadId: parsedThread.messageThreadId,
      },
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const chat = await this.telegramFetch<TelegramChat>("getChat", {
      chat_id: channelId,
    });

    let memberCount: number | undefined;
    try {
      memberCount = await this.telegramFetch<number>("getChatMemberCount", {
        chat_id: channelId,
      });
    } catch {
      // Some chats disallow member count queries for bot scopes.
      memberCount = undefined;
    }

    return {
      id: String(chat.id),
      name: this.chatDisplayName(chat),
      isDM: chat.type === "private",
      memberCount,
      metadata: {
        chat,
      },
    };
  }

  channelIdFromThreadId(threadId: string): string {
    return this.resolveThreadId(threadId).chatId;
  }

  async openDM(userId: string): Promise<string> {
    return this.encodeThreadId({ chatId: userId });
  }

  isDM(threadId: string): boolean {
    const { chatId } = this.resolveThreadId(threadId);
    return !chatId.startsWith("-");
  }

  encodeThreadId(platformData: TelegramThreadId): string {
    if (typeof platformData.messageThreadId === "number") {
      return `telegram:${platformData.chatId}:${platformData.messageThreadId}`;
    }

    return `telegram:${platformData.chatId}`;
  }

  decodeThreadId(threadId: string): TelegramThreadId {
    const parts = threadId.split(":");
    if (parts[0] !== "telegram" || parts.length < 2 || parts.length > 3) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram thread ID: ${threadId}`
      );
    }

    const chatId = parts[1];
    if (!chatId) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram thread ID: ${threadId}`
      );
    }

    const messageThreadPart = parts[2];
    if (!messageThreadPart) {
      return { chatId };
    }

    const messageThreadId = Number.parseInt(messageThreadPart, 10);
    if (!Number.isFinite(messageThreadId)) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram thread topic ID in thread ID: ${threadId}`
      );
    }

    return {
      chatId,
      messageThreadId,
    };
  }

  parseMessage(raw: TelegramRawMessage): Message<TelegramRawMessage> {
    const threadId = this.encodeThreadId({
      chatId: String(raw.chat.id),
      messageThreadId: raw.message_thread_id,
    });

    const message = this.parseTelegramMessage(raw, threadId);
    this.cacheMessage(message);
    return message;
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private parseTelegramMessage(
    raw: TelegramMessage,
    threadId: string
  ): Message<TelegramRawMessage> {
    const text = raw.text ?? raw.caption ?? "";
    let author: TelegramMessageAuthor;

    if (raw.from) {
      author = this.toAuthor(raw.from);
    } else if (raw.sender_chat) {
      author = this.toReactionActorAuthor(raw.sender_chat);
    } else {
      const fallbackName =
        this.chatDisplayName(raw.chat) ?? String(raw.chat.id);
      author = {
        userId: String(raw.chat.id),
        userName: fallbackName,
        fullName: fallbackName,
        isBot: "unknown" as const,
        isMe: false,
      };
    }

    const message = new Message<TelegramRawMessage>({
      id: this.encodeMessageId(String(raw.chat.id), raw.message_id),
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author,
      metadata: {
        dateSent: new Date(raw.date * 1000),
        edited: raw.edit_date !== undefined,
        editedAt:
          raw.edit_date !== undefined
            ? new Date(raw.edit_date * 1000)
            : undefined,
      },
      attachments: this.extractAttachments(raw),
      isMention: this.isBotMentioned(raw, text),
    });

    return message;
  }

  private extractAttachments(raw: TelegramMessage): Attachment[] {
    const attachments: Attachment[] = [];

    const photo = raw.photo?.at(-1);
    if (photo) {
      attachments.push(
        this.createAttachment("image", photo.file_id, {
          size: photo.file_size,
          width: photo.width,
          height: photo.height,
        })
      );
    }

    if (raw.video) {
      attachments.push(
        this.createAttachment("video", raw.video.file_id, {
          size: raw.video.file_size,
          width: raw.video.width,
          height: raw.video.height,
          name: raw.video.file_name,
          mimeType: raw.video.mime_type,
        })
      );
    }

    if (raw.audio) {
      attachments.push(
        this.createAttachment("audio", raw.audio.file_id, {
          size: raw.audio.file_size,
          name: raw.audio.file_name,
          mimeType: raw.audio.mime_type,
        })
      );
    }

    if (raw.voice) {
      attachments.push(
        this.createAttachment("audio", raw.voice.file_id, {
          size: raw.voice.file_size,
          mimeType: raw.voice.mime_type,
        })
      );
    }

    if (raw.document) {
      attachments.push(
        this.createAttachment("file", raw.document.file_id, {
          size: raw.document.file_size,
          name: raw.document.file_name,
          mimeType: raw.document.mime_type,
        })
      );
    }

    return attachments;
  }

  private createAttachment(
    type: Attachment["type"],
    fileId: string,
    metadata?: {
      size?: number;
      width?: number;
      height?: number;
      name?: string;
      mimeType?: string;
    }
  ): Attachment {
    return {
      type,
      size: metadata?.size,
      width: metadata?.width,
      height: metadata?.height,
      name: metadata?.name,
      mimeType: metadata?.mimeType,
      fetchData: async () => this.downloadFile(fileId),
    };
  }

  private async downloadFile(fileId: string): Promise<Buffer> {
    const file = await this.telegramFetch<TelegramFile>("getFile", {
      file_id: fileId,
    });

    if (!file.file_path) {
      throw new ResourceNotFoundError("telegram", "file", fileId);
    }

    const fileUrl = `${this.apiBaseUrl}/file/bot${this.botToken}/${file.file_path}`;

    let response: Response;
    try {
      response = await fetch(fileUrl);
    } catch (error) {
      throw new NetworkError(
        "telegram",
        `Failed to download Telegram file ${fileId}`,
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw new NetworkError(
        "telegram",
        `Failed to download Telegram file ${fileId}: ${response.status}`
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async sendDocument(
    thread: TelegramThreadId,
    file: {
      filename: string;
      data: Buffer | Blob | ArrayBuffer;
      mimeType?: string;
    },
    text: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    parseMode?: string
  ): Promise<TelegramMessage> {
    const buffer = await this.toTelegramBuffer(file.data);

    const formData = new FormData();
    formData.append("chat_id", thread.chatId);
    if (typeof thread.messageThreadId === "number") {
      formData.append("message_thread_id", String(thread.messageThreadId));
    }

    if (text.trim()) {
      formData.append("caption", this.truncateCaption(text));
      if (parseMode) {
        formData.append("parse_mode", parseMode);
      }
    }

    const blob = new Blob([new Uint8Array(buffer)], {
      type: file.mimeType ?? "application/octet-stream",
    });
    formData.append("document", blob, file.filename);
    if (replyMarkup) {
      formData.append("reply_markup", JSON.stringify(replyMarkup));
    }

    return this.telegramFetch<TelegramMessage>("sendDocument", formData);
  }

  private async toTelegramBuffer(
    data: Buffer | Blob | ArrayBuffer
  ): Promise<Buffer> {
    if (Buffer.isBuffer(data)) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    if (data instanceof Blob) {
      return Buffer.from(await data.arrayBuffer());
    }
    throw new ValidationError("telegram", "Unsupported file data type");
  }

  private paginateMessages(
    messages: Message<TelegramRawMessage>[],
    options: FetchOptions
  ): FetchResult<TelegramRawMessage> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? "backward";

    if (messages.length === 0) {
      return { messages: [] };
    }

    const messageIndexById = new Map(
      messages.map((message, index) => [message.id, index])
    );

    if (direction === "backward") {
      const end =
        options.cursor && messageIndexById.has(options.cursor)
          ? (messageIndexById.get(options.cursor) ?? messages.length)
          : messages.length;
      const start = Math.max(0, end - limit);
      const page = messages.slice(start, end);

      return {
        messages: page,
        nextCursor: start > 0 ? page[0]?.id : undefined,
      };
    }

    const start =
      options.cursor && messageIndexById.has(options.cursor)
        ? (messageIndexById.get(options.cursor) ?? -1) + 1
        : 0;
    const end = Math.min(messages.length, start + limit);
    const page = messages.slice(start, end);

    return {
      messages: page,
      nextCursor: end < messages.length ? page.at(-1)?.id : undefined,
    };
  }

  private cacheMessage(message: Message<TelegramRawMessage>): void {
    const existing = this.messageCache.get(message.threadId) ?? [];
    const index = existing.findIndex((item) => item.id === message.id);

    if (index >= 0) {
      existing[index] = message;
    } else {
      existing.push(message);
    }

    existing.sort((a, b) => this.compareMessages(a, b));
    this.messageCache.set(message.threadId, existing);
  }

  private findCachedMessage(
    messageId: string
  ): Message<TelegramRawMessage> | undefined {
    for (const messages of this.messageCache.values()) {
      const found = messages.find((message) => message.id === messageId);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  private deleteCachedMessage(messageId: string): void {
    for (const [threadId, messages] of this.messageCache.entries()) {
      const filtered = messages.filter((message) => message.id !== messageId);
      if (filtered.length === 0) {
        this.messageCache.delete(threadId);
      } else if (filtered.length !== messages.length) {
        this.messageCache.set(threadId, filtered);
      }
    }
  }

  private compareMessages(
    a: Message<TelegramRawMessage>,
    b: Message<TelegramRawMessage>
  ): number {
    const timeDiff =
      a.metadata.dateSent.getTime() - b.metadata.dateSent.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return this.messageSequence(a.id) - this.messageSequence(b.id);
  }

  private messageSequence(messageId: string): number {
    const match = messageId.match(MESSAGE_SEQUENCE_PATTERN);
    return match ? Number.parseInt(match[1], 10) : 0;
  }

  private resolveThreadId(value: string): TelegramThreadId {
    if (value.startsWith("telegram:")) {
      return this.decodeThreadId(value);
    }

    return { chatId: value };
  }

  private encodeMessageId(chatId: string, messageId: number): string {
    return `${chatId}:${messageId}`;
  }

  private decodeCompositeMessageId(
    messageId: string,
    expectedChatId?: string
  ): { chatId: string; messageId: number; compositeId: string } {
    const compositeMatch = messageId.match(MESSAGE_ID_PATTERN);

    if (compositeMatch) {
      const [, chatId, rawMessageId] = compositeMatch;
      const parsedMessageId = Number.parseInt(rawMessageId, 10);

      if (expectedChatId && chatId !== expectedChatId) {
        throw new ValidationError(
          "telegram",
          `Message ID chat mismatch: expected ${expectedChatId}, got ${chatId}`
        );
      }

      return {
        chatId,
        messageId: parsedMessageId,
        compositeId: `${chatId}:${parsedMessageId}`,
      };
    }

    if (!expectedChatId) {
      throw new ValidationError(
        "telegram",
        `Telegram message ID must be in <chatId>:<messageId> format, got: ${messageId}`
      );
    }

    const parsedMessageId = Number.parseInt(messageId, 10);
    if (!Number.isFinite(parsedMessageId)) {
      throw new ValidationError(
        "telegram",
        `Invalid Telegram message ID: ${messageId}`
      );
    }

    return {
      chatId: expectedChatId,
      messageId: parsedMessageId,
      compositeId: `${expectedChatId}:${parsedMessageId}`,
    };
  }

  private toAuthor(user: TelegramUser): TelegramMessageAuthor {
    const fullName = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    return {
      userId: String(user.id),
      userName: user.username ?? user.first_name ?? String(user.id),
      fullName: fullName || user.username || String(user.id),
      isBot: user.is_bot,
      isMe: String(user.id) === this._botUserId,
    };
  }

  private toReactionActorAuthor(chat: TelegramChat): TelegramMessageAuthor {
    const name = this.chatDisplayName(chat) ?? String(chat.id);
    return {
      userId: `chat:${chat.id}`,
      userName: name,
      fullName: name,
      isBot: "unknown" as const,
      isMe: false,
    };
  }

  private chatDisplayName(chat: TelegramChat): string | undefined {
    if (chat.title) {
      return chat.title;
    }

    const privateName = [chat.first_name, chat.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (privateName) {
      return privateName;
    }

    return chat.username;
  }

  private isBotMentioned(message: TelegramMessage, text: string): boolean {
    if (!text) {
      return false;
    }

    const username = this._userName;

    const entities = message.entities ?? message.caption_entities ?? [];
    for (const entity of entities) {
      if (entity.type === "mention") {
        const mentionText = this.entityText(text, entity);
        if (mentionText.toLowerCase() === `@${username.toLowerCase()}`) {
          return true;
        }
      }

      if (
        entity.type === "text_mention" &&
        entity.user &&
        this._botUserId &&
        String(entity.user.id) === this._botUserId
      ) {
        return true;
      }

      if (entity.type === "bot_command") {
        const commandText = this.entityText(text, entity);
        if (commandText.toLowerCase().endsWith(`@${username.toLowerCase()}`)) {
          return true;
        }
      }
    }

    const mentionRegex = new RegExp(`@${this.escapeRegex(username)}\\b`, "i");
    return mentionRegex.test(text);
  }

  private entityText(text: string, entity: TelegramMessageEntity): string {
    return text.slice(entity.offset, entity.offset + entity.length);
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private normalizeUserName(value: string): string {
    return value.replace(LEADING_AT_PATTERN, "").trim() || "bot";
  }

  private truncateMessage(text: string): string {
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
      return text;
    }

    return `${text.slice(0, TELEGRAM_MESSAGE_LIMIT - 3)}...`;
  }

  private truncateCaption(text: string): string {
    if (text.length <= TELEGRAM_CAPTION_LIMIT) {
      return text;
    }

    return `${text.slice(0, TELEGRAM_CAPTION_LIMIT - 3)}...`;
  }

  private toTelegramReaction(emoji: EmojiValue | string): TelegramReactionType {
    if (typeof emoji !== "string") {
      return {
        type: "emoji",
        emoji: defaultEmojiResolver.toGChat(emoji.name),
      };
    }

    if (emoji.startsWith("custom:")) {
      return {
        type: "custom_emoji",
        custom_emoji_id: emoji.slice("custom:".length),
      };
    }

    const placeholderMatch = emoji.match(EMOJI_PLACEHOLDER_PATTERN);
    if (placeholderMatch) {
      return {
        type: "emoji",
        emoji: defaultEmojiResolver.toGChat(placeholderMatch[1]),
      };
    }

    if (EMOJI_NAME_PATTERN.test(emoji)) {
      return {
        type: "emoji",
        emoji: defaultEmojiResolver.toGChat(emoji.toLowerCase()),
      };
    }

    return {
      type: "emoji",
      emoji,
    };
  }

  private reactionKey(reaction: TelegramReactionType): string {
    if (reaction.type === "emoji") {
      return reaction.emoji;
    }

    return `custom:${reaction.custom_emoji_id}`;
  }

  private reactionToEmojiValue(reaction: TelegramReactionType): EmojiValue {
    if (reaction.type === "emoji") {
      return defaultEmojiResolver.fromGChat(reaction.emoji);
    }

    return getEmoji(`custom:${reaction.custom_emoji_id}`);
  }

  private async telegramFetch<TResult>(
    method: string,
    payload?: Record<string, unknown> | FormData
  ): Promise<TResult> {
    const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers:
          payload instanceof FormData
            ? undefined
            : {
                "Content-Type": "application/json",
              },
        body:
          payload instanceof FormData ? payload : JSON.stringify(payload ?? {}),
      });
    } catch (error) {
      throw new NetworkError(
        "telegram",
        `Network error calling Telegram ${method}`,
        error instanceof Error ? error : undefined
      );
    }

    let data: TelegramApiResponse<TResult>;
    try {
      data = (await response.json()) as TelegramApiResponse<TResult>;
    } catch {
      throw new NetworkError(
        "telegram",
        `Failed to parse Telegram API response for ${method}`
      );
    }

    if (!(response.ok && data.ok)) {
      this.throwTelegramApiError(method, response.status, data);
    }

    if (typeof data.result === "undefined") {
      throw new NetworkError(
        "telegram",
        `Telegram API ${method} returned no result`
      );
    }

    return data.result;
  }

  private throwTelegramApiError(
    method: string,
    status: number,
    data: TelegramApiResponse<unknown>
  ): never {
    const errorCode = data.error_code ?? status;
    const description = data.description ?? `Telegram API ${method} failed`;

    if (errorCode === 429) {
      throw new AdapterRateLimitError("telegram", data.parameters?.retry_after);
    }

    if (errorCode === 401) {
      throw new AuthenticationError("telegram", description);
    }

    if (errorCode === 403) {
      throw new PermissionError("telegram", method);
    }

    if (errorCode === 404) {
      throw new ResourceNotFoundError("telegram", method);
    }

    if (errorCode >= 400 && errorCode < 500) {
      throw new ValidationError("telegram", description);
    }

    throw new NetworkError(
      "telegram",
      `${description} (status ${status}, error ${errorCode})`
    );
  }
}

export function createTelegramAdapter(
  config?: Partial<
    TelegramAdapterConfig & { logger: Logger; userName?: string }
  >
): TelegramAdapter {
  const botToken = config?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new ValidationError(
      "telegram",
      "botToken is required. Set TELEGRAM_BOT_TOKEN or provide it in config."
    );
  }

  const apiBaseUrl =
    config?.apiBaseUrl ??
    process.env.TELEGRAM_API_BASE_URL ??
    TELEGRAM_API_BASE;
  const secretToken =
    config?.secretToken ?? process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
  const userName = config?.userName ?? process.env.TELEGRAM_BOT_USERNAME;

  return new TelegramAdapter({
    botToken,
    apiBaseUrl,
    secretToken,
    logger: config?.logger ?? new ConsoleLogger("info").child("telegram"),
    userName,
  });
}

export { TelegramFormatConverter } from "./markdown";
export type {
  TelegramAdapterConfig,
  TelegramCallbackQuery,
  TelegramChat,
  TelegramMessage,
  TelegramMessageReactionUpdated,
  TelegramRawMessage,
  TelegramThreadId,
  TelegramUpdate,
  TelegramUser,
} from "./types";
