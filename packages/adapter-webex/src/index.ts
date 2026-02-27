import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  AdapterRateLimitError,
  AuthenticationError,
  extractCard,
  extractFiles,
  NetworkError,
  PermissionError,
  ResourceNotFoundError,
  toBuffer,
  ValidationError,
} from "@chat-adapter/shared";
import type {
  ActionEvent,
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChannelInfo,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  Logger,
  Message as ChatMessage,
  ModalElement,
  ModalResponse,
  RawMessage,
  ThreadInfo,
  ThreadSummary,
  WebhookOptions,
} from "chat";
import {
  ConsoleLogger,
  defaultEmojiResolver,
  Message,
  NotImplementedError,
} from "chat";
import { cardToFallbackText, cardToWebexAdaptiveCard } from "./cards";
import { WebexFormatConverter } from "./markdown";
import {
  extractWebexModalValues,
  modalToFallbackText,
  modalToWebexAdaptiveCard,
  parseWebexModalAction,
} from "./modals";
import type {
  WebexAttachmentAction,
  WebexListMessagesResponse,
  WebexListReactionsResponse,
  WebexMessage,
  WebexPerson,
  WebexReaction,
  WebexRoom,
  WebexThreadId,
  WebexWebhookPayload,
} from "./types";

const DEFAULT_WEBEX_BASE_URL = "https://webexapis.com/v1";
const DM_ROOT_SENTINEL = "root";
const DM_ROOM_PREFIX = "dm:";
const EMOJI_PLACEHOLDER_REGEX = /\{\{emoji:([a-z0-9_]+)\}\}/gi;
const HMAC_SHA1_HEX_LENGTH = 40;
const MAX_WEBEX_PAGE_SIZE = 100;
const WEBEX_PREFIX = "webex";
const WEBEX_MODAL_STATE_KEY_PREFIX = "webex:modal:view:";
const WEBEX_MODAL_STATE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Mapping from normalized emoji names to Webex reaction shortcodes.
 * Webex supports a limited set of reactions.
 * @see https://developer.webex.com/docs/api/v1/message-reactions
 */
const EMOJI_TO_WEBEX_REACTION: Record<string, string> = {
  // Direct mappings
  thumbs_up: "thumbsup",
  thumbsup: "thumbsup",
  "+1": "thumbsup",
  thumbs_down: "thumbsdown",
  thumbsdown: "thumbsdown",
  "-1": "thumbsdown",
  heart: "heart",
  clap: "clap",
  celebrate: "celebrate",
  party: "celebrate",
  tada: "celebrate",
  laugh: "haha",
  haha: "haha",
  joy: "haha",
  surprised: "surprised",
  open_mouth: "surprised",
  thinking: "thinking",
  thinking_face: "thinking",
  sad: "sad",
  cry: "sad",
  sob: "sad",
  angry: "angry",
  // Common aliases
  like: "thumbsup",
  love: "heart",
  applause: "clap",
  congratulations: "celebrate",
};

interface WebexRequestInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

interface WebexModalState {
  callbackId: string;
  contextId?: string;
  privateMetadata?: string;
  threadId: string;
  viewId: string;
}

export interface WebexAdapterConfig {
  baseUrl?: string;
  botToken: string;
  botUserId?: string;
  logger: Logger;
  userName?: string;
  webhookSecret?: string;
}

export class WebexAdapter implements Adapter<WebexThreadId, WebexMessage> {
  readonly name = WEBEX_PREFIX;

  private readonly botToken: string;
  private readonly webhookSecret?: string;
  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly formatConverter = new WebexFormatConverter();
  private chat: ChatInstance | null = null;
  private _botUserId?: string;
  private _userName: string;
  private readonly personCache = new Map<string, WebexPerson>();
  private readonly roomTypeCache = new Map<string, "direct" | "group">();
  private readonly dmRoomCache = new Map<string, string>();

  constructor(config: WebexAdapterConfig) {
    this.botToken = config.botToken;
    this.webhookSecret = config.webhookSecret;
    this.logger = config.logger;
    this.baseUrl = config.baseUrl ?? DEFAULT_WEBEX_BASE_URL;
    this._botUserId = config.botUserId;
    this._userName = config.userName ?? "webex-bot";
  }

  get botUserId(): string | undefined {
    return this._botUserId;
  }

  get userName(): string {
    return this._userName;
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;

    if (this._botUserId) {
      return;
    }

    try {
      const me = await this.webexRequest<WebexPerson>("/people/me", {
        method: "GET",
      });
      this._botUserId = me.id;
      this.personCache.set(me.id, me);
      this._userName = me.nickName || me.displayName || this._userName;
      this.logger.info("Webex auth completed", {
        botUserId: this._botUserId,
        userName: this._userName,
      });
    } catch (error) {
      this.logger.warn("Could not fetch Webex bot identity", { error });
    }
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const body = await request.text();
    if (
      !this.verifyWebhookSignature(
        body,
        request.headers.get("x-spark-signature")
      )
    ) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: WebexWebhookPayload;
    try {
      payload = JSON.parse(body) as WebexWebhookPayload;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!this.chat) {
      this.logger.warn("Chat instance not initialized, ignoring webhook");
      return new Response("ok", { status: 200 });
    }

    try {
      if (payload.resource === "messages" && payload.event === "created") {
        await this.handleMessageCreatedWebhook(payload, options);
      } else if (
        payload.resource === "attachmentActions" &&
        payload.event === "created"
      ) {
        await this.handleAttachmentActionWebhook(payload, options);
      }
    } catch (error) {
      this.logger.error("Error handling Webex webhook", {
        resource: payload.resource,
        event: payload.event,
        error,
      });
    }

    return new Response("ok", { status: 200 });
  }

  private async handleMessageCreatedWebhook(
    payload: WebexWebhookPayload,
    options?: WebhookOptions
  ): Promise<void> {
    const messageId = payload.data?.id;
    if (!messageId) {
      return;
    }

    const message = await this.getMessage(messageId);
    if (!message) {
      return;
    }

    if (this.isMessageFromSelf(message)) {
      return;
    }

    if (message.roomType) {
      this.roomTypeCache.set(message.roomId, message.roomType);
    }

    const rootMessageId = message.parentId || message.id;
    const threadId = this.encodeThreadId({
      roomId: message.roomId,
      rootMessageId,
    });
    const parsedMessage = this.parseWebexMessage(message, threadId);

    this.chat?.processMessage(this, threadId, parsedMessage, options);
  }

  private async handleAttachmentActionWebhook(
    payload: WebexWebhookPayload,
    options?: WebhookOptions
  ): Promise<void> {
    const attachmentActionId = payload.data?.id;
    if (!attachmentActionId) {
      return;
    }

    const action = await this.webexRequest<WebexAttachmentAction>(
      `/attachment/actions/${encodeURIComponent(attachmentActionId)}`,
      { method: "GET" }
    );

    const message = await this.getMessage(action.messageId);
    if (!message) {
      return;
    }

    const rootMessageId = message.parentId || message.id;
    const threadId = this.encodeThreadId({
      roomId: message.roomId,
      rootMessageId,
    });

    const author = await this.buildActionAuthor(
      action.personId,
      payload.data?.personEmail
    );

    const actionId = this.resolveActionId(action);
    const value = this.resolveActionValue(action, actionId);

    const handledAsModal = await this.handleModalAttachmentAction(
      payload,
      action,
      message,
      threadId,
      author,
      options
    );
    if (handledAsModal) {
      return;
    }

    const event: Omit<ActionEvent, "thread" | "openModal"> & {
      adapter: WebexAdapter;
    } = {
      actionId,
      value,
      user: author,
      messageId: action.messageId,
      threadId,
      triggerId: action.id,
      adapter: this,
      raw: {
        webhook: payload,
        action,
      },
    };

    this.chat?.processAction(event, options);
  }

  private async buildActionAuthor(
    personId?: string,
    personEmail?: string
  ): Promise<{
    userId: string;
    userName: string;
    fullName: string;
    isBot: boolean;
    isMe: boolean;
  }> {
    if (!personId) {
      const fallback = personEmail ?? "unknown";
      return {
        userId: fallback,
        userName: fallback,
        fullName: fallback,
        isBot: false,
        isMe: false,
      };
    }

    const person = await this.getPerson(personId);
    const displayName =
      person?.displayName || person?.nickName || personEmail || personId;
    const email = person?.emails?.[0];
    const userName = email ? this.emailToUserName(email) : displayName;

    return {
      userId: personId,
      userName,
      fullName: displayName,
      isBot: person?.type === "bot",
      isMe: personId === this._botUserId,
    };
  }

  private resolveActionId(action: WebexAttachmentAction): string {
    const inputs = action.inputs ?? {};
    const actionId =
      inputs.actionId ||
      inputs._actionId ||
      inputs.id ||
      inputs.action ||
      action.type;
    return actionId || "submit";
  }

  private resolveActionValue(
    action: WebexAttachmentAction,
    actionId?: string
  ): string | undefined {
    const inputs = action.inputs ?? {};
    if (typeof inputs.value === "string") {
      return inputs.value;
    }

    if (actionId && typeof inputs[actionId] === "string") {
      return inputs[actionId];
    }

    const inputEntries = Object.entries(inputs).filter(
      ([key]) =>
        key !== "actionId" &&
        key !== "_actionId" &&
        key !== "id" &&
        key !== "action" &&
        key !== "source"
    );

    if (inputEntries.length === 1 && typeof inputEntries[0]?.[1] === "string") {
      return inputEntries[0][1] as string;
    }

    if (Object.keys(inputs).length === 0) {
      return undefined;
    }
    return JSON.stringify(inputs);
  }

  private async handleModalAttachmentAction(
    payload: WebexWebhookPayload,
    action: WebexAttachmentAction,
    _message: WebexMessage,
    threadId: string,
    author: {
      userId: string;
      userName: string;
      fullName: string;
      isBot: boolean;
      isMe: boolean;
    },
    options?: WebhookOptions
  ): Promise<boolean> {
    const inputs = action.inputs ?? {};
    const descriptor = parseWebexModalAction(inputs);
    if (!descriptor) {
      return false;
    }

    const persisted = descriptor.viewId
      ? await this.getModalState(descriptor.viewId)
      : null;

    const viewId = descriptor.viewId || persisted?.viewId || "";
    const callbackId = descriptor.callbackId || persisted?.callbackId;
    const contextId = descriptor.contextId ?? persisted?.contextId;
    const privateMetadata =
      descriptor.privateMetadata ?? persisted?.privateMetadata;

    if (!callbackId) {
      this.logger.warn("Webex modal action missing callbackId", {
        actionId: inputs.actionId,
        viewId,
      });
      return true;
    }

    if (descriptor.kind === "close") {
      this.chat?.processModalClose(
        {
          adapter: this,
          callbackId,
          privateMetadata,
          raw: { webhook: payload, action },
          user: author,
          viewId,
        },
        contextId,
        options
      );

      await this.safeDeleteMessage(threadId, action.messageId);
      if (viewId) {
        await this.deleteModalState(viewId);
      }
      return true;
    }

    const values = extractWebexModalValues(inputs);

    const response = await this.chat?.processModalSubmit(
      {
        adapter: this,
        callbackId,
        privateMetadata,
        raw: { webhook: payload, action },
        user: author,
        values,
        viewId,
      },
      contextId,
      options
    );

    await this.applyModalResponse(response, threadId, action.messageId, {
      callbackId,
      contextId,
      privateMetadata,
      viewId,
    });

    return true;
  }

  private async applyModalResponse(
    response: ModalResponse | undefined,
    threadId: string,
    messageId: string,
    metadata: {
      callbackId: string;
      contextId?: string;
      privateMetadata?: string;
      viewId?: string;
    }
  ): Promise<void> {
    if (!response || response.action === "close") {
      await this.safeDeleteMessage(threadId, messageId);
      if (metadata.viewId) {
        await this.deleteModalState(metadata.viewId);
      }
      return;
    }

    if (response.action === "errors") {
      const lines = Object.entries(response.errors).map(
        ([field, error]) => `- ${field}: ${error}`
      );
      await this.postMessage(
        threadId,
        `Please fix the following fields:\n${lines.join("\n")}`
      );
      return;
    }

    if (response.action === "update") {
      const viewId = metadata.viewId || randomUUID();
      await this.updateModalCardMessage(threadId, messageId, response.modal, {
        callbackId: response.modal.callbackId,
        contextId: metadata.contextId,
        privateMetadata: response.modal.privateMetadata ?? metadata.privateMetadata,
        viewId,
      });
      if (metadata.viewId && metadata.viewId !== viewId) {
        await this.deleteModalState(metadata.viewId);
      }
      return;
    }

    if (response.action === "push") {
      await this.postModalCardMessage(threadId, response.modal, {
        callbackId: response.modal.callbackId,
        contextId: metadata.contextId,
        privateMetadata: response.modal.privateMetadata ?? metadata.privateMetadata,
        viewId: randomUUID(),
      });
    }
  }

  private async safeDeleteMessage(
    threadId: string,
    messageId?: string
  ): Promise<void> {
    if (!messageId) {
      return;
    }

    try {
      await this.deleteMessage(threadId, messageId);
    } catch (error) {
      this.logger.debug("Failed to delete Webex modal card message", {
        messageId,
        error,
      });
    }
  }

  private async postModalCardMessage(
    threadId: string,
    modal: ModalElement,
    metadata: {
      callbackId: string;
      contextId?: string;
      privateMetadata?: string;
      viewId: string;
    }
  ): Promise<WebexMessage> {
    const { roomId, rootMessageId } = this.decodeThreadId(threadId);
    const target = await this.resolvePostingTarget(roomId);
    const parentId =
      target.type === "room" && rootMessageId !== DM_ROOT_SENTINEL
        ? rootMessageId
        : undefined;

    const body: Record<string, unknown> = {
      markdown: modalToFallbackText(modal),
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: modalToWebexAdaptiveCard(modal, metadata),
        },
      ],
    };

    if (target.type === "room") {
      body.roomId = target.roomId;
      if (parentId) {
        body.parentId = parentId;
      }
    } else {
      body.toPersonId = target.personId;
    }

    const raw = await this.webexRequest<WebexMessage>("/messages", {
      method: "POST",
      body,
    });

    if (target.type === "dm" && raw.roomId) {
      await this.setDmRoom(target.personId, raw.roomId);
    }

    await this.storeModalState({
      callbackId: metadata.callbackId,
      contextId: metadata.contextId,
      privateMetadata: metadata.privateMetadata,
      threadId,
      viewId: metadata.viewId,
    });

    return raw;
  }

  private async updateModalCardMessage(
    threadId: string,
    messageId: string,
    modal: ModalElement,
    metadata: {
      callbackId: string;
      contextId?: string;
      privateMetadata?: string;
      viewId: string;
    }
  ): Promise<WebexMessage> {
    const raw = await this.webexRequest<WebexMessage>(
      `/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PUT",
        body: {
          markdown: modalToFallbackText(modal),
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: modalToWebexAdaptiveCard(modal, metadata),
            },
          ],
        },
      }
    );

    await this.storeModalState({
      callbackId: metadata.callbackId,
      contextId: metadata.contextId,
      privateMetadata: metadata.privateMetadata,
      threadId,
      viewId: metadata.viewId,
    });

    return raw;
  }

  private async resolveModalThreadId(contextId?: string): Promise<string | null> {
    if (!contextId || !this.chat) {
      return null;
    }

    const context = await this.chat.getState().get<{
      channel?: { id?: string };
      thread?: { id?: string };
    }>(`modal-context:${this.name}:${contextId}`);

    if (context?.thread?.id) {
      return context.thread.id;
    }

    const channelId = context?.channel?.id;
    if (!channelId) {
      return null;
    }

    try {
      const roomId = this.decodeChannelId(channelId);
      return this.encodeThreadId({
        roomId,
        rootMessageId: DM_ROOT_SENTINEL,
      });
    } catch {
      return null;
    }
  }

  private modalStateKey(viewId: string): string {
    return `${WEBEX_MODAL_STATE_KEY_PREFIX}${viewId}`;
  }

  private async storeModalState(state: WebexModalState): Promise<void> {
    if (!this.chat) {
      return;
    }

    await this.chat
      .getState()
      .set(this.modalStateKey(state.viewId), state, WEBEX_MODAL_STATE_TTL_MS);
  }

  private async getModalState(viewId: string): Promise<WebexModalState | null> {
    if (!this.chat) {
      return null;
    }

    return this.chat
      .getState()
      .get<WebexModalState>(this.modalStateKey(viewId));
  }

  private async deleteModalState(viewId: string): Promise<void> {
    if (!this.chat) {
      return;
    }

    await this.chat.getState().delete(this.modalStateKey(viewId));
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WebexMessage>> {
    const { roomId, rootMessageId } = this.decodeThreadId(threadId);
    const target = await this.resolvePostingTarget(roomId);
    const parentId =
      target.type === "room" && rootMessageId !== DM_ROOT_SENTINEL
        ? rootMessageId
        : undefined;

    const payload = await this.buildCreateMessageRequestBody(message, {
      roomId: target.type === "room" ? target.roomId : undefined,
      toPersonId: target.type === "dm" ? target.personId : undefined,
      parentId,
    });

    const raw = await this.webexRequest<WebexMessage>("/messages", {
      method: "POST",
      body: payload,
    });

    if (target.type === "dm" && raw.roomId) {
      await this.setDmRoom(target.personId, raw.roomId);
    }

    return {
      id: raw.id,
      threadId,
      raw,
    };
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WebexMessage>> {
    const roomId = this.decodeChannelId(channelId);
    const target = await this.resolvePostingTarget(roomId);

    const payload = await this.buildCreateMessageRequestBody(message, {
      roomId: target.type === "room" ? target.roomId : undefined,
      toPersonId: target.type === "dm" ? target.personId : undefined,
    });

    const raw = await this.webexRequest<WebexMessage>("/messages", {
      method: "POST",
      body: payload,
    });

    if (target.type === "dm" && raw.roomId) {
      await this.setDmRoom(target.personId, raw.roomId);
    }

    return {
      id: raw.id,
      threadId: channelId,
      raw,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<WebexMessage>> {
    const files = extractFiles(message);
    if (files.length > 0) {
      throw new ValidationError(
        "webex",
        "Editing messages with file uploads is not supported by this adapter."
      );
    }

    const card = extractCard(message);
    let markdown: string;
    let attachments: WebexMessage["attachments"];

    if (card) {
      markdown = cardToFallbackText(card);
      attachments = [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: cardToWebexAdaptiveCard(card),
        },
      ];
    } else {
      markdown = this.convertEmojiPlaceholders(
        this.formatConverter.renderPostable(message)
      );
      attachments = undefined;
    }

    const raw = await this.webexRequest<WebexMessage>(
      `/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PUT",
        body: {
          markdown,
          attachments,
        },
      }
    );

    return {
      id: raw.id,
      threadId,
      raw,
    };
  }

  async deleteMessage(_threadId: string, messageId: string): Promise<void> {
    await this.webexRequest<void>(`/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
    });
  }

  async addReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const reaction = this.resolveWebexReaction(emoji);
    await this.webexRequest<WebexReaction>(
      `/messages/${encodeURIComponent(messageId)}/reactions`,
      {
        method: "POST",
        body: { reaction },
      }
    );
  }

  async removeReaction(
    _threadId: string,
    messageId: string,
    emoji: EmojiValue | string
  ): Promise<void> {
    const reaction = this.resolveWebexReaction(emoji);

    // Webex requires the reactionId to delete, so we need to list reactions first
    const response = await this.webexRequest<WebexListReactionsResponse>(
      `/messages/${encodeURIComponent(messageId)}/reactions`,
      { method: "GET" }
    );

    // Find our bot's reaction with the matching emoji
    const myReaction = response.items?.find(
      (r) => r.personId === this._botUserId && r.reaction === reaction
    );

    if (myReaction) {
      await this.webexRequest<void>(
        `/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(myReaction.id)}`,
        { method: "DELETE" }
      );
    }
  }

  private resolveWebexReaction(emoji: EmojiValue | string): string {
    const emojiName =
      typeof emoji === "string"
        ? emoji.replace(/^:|:$/g, "").toLowerCase()
        : emoji.name.toLowerCase();

    // Check our mapping first
    const mapped = EMOJI_TO_WEBEX_REACTION[emojiName];
    if (mapped) {
      return mapped;
    }

    // If it's already a valid Webex reaction shortcode, use it directly
    const validWebexReactions = [
      "thumbsup",
      "thumbsdown",
      "heart",
      "celebrate",
      "clap",
      "haha",
      "surprised",
      "thinking",
      "sad",
      "angry",
    ];
    if (validWebexReactions.includes(emojiName)) {
      return emojiName;
    }

    // Default to thumbsup for unknown emoji
    this.logger.debug("Unknown emoji for Webex reaction, defaulting to thumbsup", {
      emoji: emojiName,
    });
    return "thumbsup";
  }

  async startTyping(_threadId: string, _status?: string): Promise<void> {
    // Webex Messaging API does not provide a typing indicator endpoint.
  }

  async fetchMessage(
    threadId: string,
    messageId: string
  ): Promise<ChatMessage<WebexMessage> | null> {
    try {
      const message = await this.webexRequest<WebexMessage>(
        `/messages/${encodeURIComponent(messageId)}`,
        { method: "GET" }
      );
      const { roomId } = this.decodeThreadId(threadId);
      const root = message.parentId || message.id;
      const derivedThreadId = this.encodeThreadId({
        roomId,
        rootMessageId: root,
      });
      return this.parseWebexMessage(message, derivedThreadId);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async fetchMessages(
    threadId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<WebexMessage>> {
    const { roomId, rootMessageId } = this.decodeThreadId(threadId);
    const resolvedRoomId = await this.resolveRoomId(roomId);
    if (!resolvedRoomId) {
      return { messages: [] };
    }

    const matchMessage = (message: WebexMessage): boolean => {
      if (rootMessageId === DM_ROOT_SENTINEL) {
        return true;
      }
      const root = message.parentId || message.id;
      return root === rootMessageId;
    };

    if (options.direction === "forward") {
      return this.fetchMessagesForward(
        resolvedRoomId,
        threadId,
        matchMessage,
        options
      );
    }

    return this.fetchMessagesBackward(
      resolvedRoomId,
      threadId,
      matchMessage,
      options
    );
  }

  async fetchChannelMessages(
    channelId: string,
    options: FetchOptions = {}
  ): Promise<FetchResult<WebexMessage>> {
    const roomId = this.decodeChannelId(channelId);
    const resolvedRoomId = await this.resolveRoomId(roomId);
    if (!resolvedRoomId) {
      return { messages: [] };
    }

    const matcher = (message: WebexMessage): boolean => !message.parentId;

    if (options.direction === "forward") {
      return this.fetchMessagesForward(
        resolvedRoomId,
        channelId,
        matcher,
        options
      );
    }

    return this.fetchMessagesBackward(
      resolvedRoomId,
      channelId,
      matcher,
      options
    );
  }

  private async fetchMessagesBackward(
    roomId: string,
    threadId: string,
    matcher: (message: WebexMessage) => boolean,
    options: FetchOptions
  ): Promise<FetchResult<WebexMessage>> {
    const limit = options.limit || 50;
    const pageSize = Math.min(MAX_WEBEX_PAGE_SIZE, Math.max(limit * 3, 50));
    const matched: WebexMessage[] = [];
    let cursor = options.cursor;

    for (let i = 0; i < 20 && matched.length < limit; i++) {
      const items = await this.listRoomMessagesPage(roomId, pageSize, cursor);
      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        if (matcher(item)) {
          matched.push(item);
          if (matched.length >= limit) {
            break;
          }
        }
      }

      if (items.length < pageSize) {
        break;
      }

      const oldest = items.at(-1);
      if (!oldest?.id) {
        break;
      }
      cursor = oldest.id;
    }

    const selected = matched.slice(0, limit);
    const chronological = [...selected].reverse();
    const messages = chronological.map((message) =>
      this.parseWebexMessage(message, threadId)
    );

    return {
      messages,
      nextCursor: matched.length >= limit ? selected.at(-1)?.id : undefined,
    };
  }

  private async fetchMessagesForward(
    roomId: string,
    threadId: string,
    matcher: (message: WebexMessage) => boolean,
    options: FetchOptions
  ): Promise<FetchResult<WebexMessage>> {
    const limit = options.limit || 50;
    const all = await this.collectMatchedMessages(roomId, matcher, 2000);
    const chronological = [...all].reverse();

    let startIndex = 0;
    if (options.cursor) {
      const cursorIndex = chronological.findIndex(
        (message) => message.id === options.cursor
      );
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const selected = chronological.slice(startIndex, startIndex + limit);
    const messages = selected.map((message) =>
      this.parseWebexMessage(message, threadId)
    );

    return {
      messages,
      nextCursor:
        startIndex + limit < chronological.length ? selected.at(-1)?.id : undefined,
    };
  }

  private async collectMatchedMessages(
    roomId: string,
    matcher: (message: WebexMessage) => boolean,
    maxMessages: number
  ): Promise<WebexMessage[]> {
    const collected: WebexMessage[] = [];
    let cursor: string | undefined;

    for (let i = 0; i < 50 && collected.length < maxMessages; i++) {
      const items = await this.listRoomMessagesPage(roomId, MAX_WEBEX_PAGE_SIZE, cursor);
      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        if (matcher(item)) {
          collected.push(item);
          if (collected.length >= maxMessages) {
            break;
          }
        }
      }

      if (items.length < MAX_WEBEX_PAGE_SIZE) {
        break;
      }

      const oldest = items.at(-1);
      if (!oldest?.id) {
        break;
      }
      cursor = oldest.id;
    }

    return collected;
  }

  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<WebexMessage>> {
    const roomId = this.decodeChannelId(channelId);
    const resolvedRoomId = await this.resolveRoomId(roomId);
    if (!resolvedRoomId) {
      return { threads: [] };
    }

    const limit = options.limit || 50;
    const maxMessages = Math.min(limit * 8, 1000);
    const recent = await this.collectMatchedMessages(
      resolvedRoomId,
      () => true,
      maxMessages
    );

    const roots = new Map<string, WebexMessage>();
    const replyCount = new Map<string, number>();
    const lastActivity = new Map<string, Date>();

    for (const message of recent) {
      const rootId = message.parentId || message.id;
      const created = this.parseCreatedAt(message.created);
      const existingDate = lastActivity.get(rootId);
      if (!existingDate || created > existingDate) {
        lastActivity.set(rootId, created);
      }

      if (message.parentId) {
        replyCount.set(rootId, (replyCount.get(rootId) || 0) + 1);
      } else {
        roots.set(message.id, message);
      }
    }

    const sortedRoots = [...roots.values()].sort((a, b) => {
      const aDate = lastActivity.get(a.id) || this.parseCreatedAt(a.created);
      const bDate = lastActivity.get(b.id) || this.parseCreatedAt(b.created);
      return bDate.getTime() - aDate.getTime();
    });

    let startIndex = 0;
    if (options.cursor) {
      const cursorIndex = sortedRoots.findIndex(
        (message) => message.id === options.cursor
      );
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const selected = sortedRoots.slice(startIndex, startIndex + limit);

    const threads: ThreadSummary<WebexMessage>[] = selected.map((root) => {
      const threadId = this.encodeThreadId({
        roomId: resolvedRoomId,
        rootMessageId: root.id,
      });
      return {
        id: threadId,
        rootMessage: this.parseWebexMessage(root, threadId),
        replyCount: replyCount.get(root.id),
        lastReplyAt: replyCount.get(root.id)
          ? lastActivity.get(root.id)
          : undefined,
      };
    });

    return {
      threads,
      nextCursor:
        startIndex + limit < sortedRoots.length ? selected.at(-1)?.id : undefined,
    };
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const { roomId, rootMessageId } = this.decodeThreadId(threadId);
    const resolvedRoomId = await this.resolveRoomId(roomId);

    let room: WebexRoom | undefined;
    if (resolvedRoomId) {
      room = await this.webexRequest<WebexRoom>(
        `/rooms/${encodeURIComponent(resolvedRoomId)}`,
        {
          method: "GET",
        }
      );
      if (room.type) {
        this.roomTypeCache.set(resolvedRoomId, room.type);
      }
    }

    let rootMessage: WebexMessage | undefined;
    if (
      resolvedRoomId &&
      rootMessageId &&
      rootMessageId !== DM_ROOT_SENTINEL
    ) {
      const fetchedRoot = await this.getMessage(rootMessageId);
      if (fetchedRoot) {
        rootMessage = fetchedRoot;
      }
    }

    return {
      id: threadId,
      channelId: this.encodeChannelId(roomId),
      channelName: room?.title,
      isDM: room?.type === "direct" || roomId.startsWith(DM_ROOM_PREFIX),
      metadata: {
        roomId: resolvedRoomId || roomId,
        rootMessageId,
        roomType: room?.type,
        roomTitle: room?.title,
        rootMessage,
      },
    };
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const roomId = this.decodeChannelId(channelId);
    const resolvedRoomId = await this.resolveRoomId(roomId);

    if (!resolvedRoomId) {
      return {
        id: channelId,
        isDM: roomId.startsWith(DM_ROOM_PREFIX),
        metadata: {
          roomId,
        },
      };
    }

    const room = await this.webexRequest<WebexRoom>(
      `/rooms/${encodeURIComponent(resolvedRoomId)}`,
      {
        method: "GET",
      }
    );

    if (room.type) {
      this.roomTypeCache.set(resolvedRoomId, room.type);
    }

    return {
      id: channelId,
      name: room.title,
      isDM: room.type === "direct",
      metadata: {
        roomId: room.id,
        type: room.type,
        isLocked: room.isLocked,
        lastActivity: room.lastActivity,
      },
    };
  }

  async openDM(userId: string): Promise<string> {
    const roomId = `${DM_ROOM_PREFIX}${userId}`;
    return this.encodeThreadId({
      roomId,
      rootMessageId: DM_ROOT_SENTINEL,
    });
  }

  async openModal(
    _triggerId: string,
    modal: ModalElement,
    contextId?: string
  ): Promise<{ viewId: string }> {
    const threadId = await this.resolveModalThreadId(contextId);
    if (!threadId) {
      throw new ValidationError(
        "webex",
        "Could not resolve modal context for Webex action."
      );
    }

    const viewId = randomUUID();
    await this.postModalCardMessage(threadId, modal, {
      callbackId: modal.callbackId,
      contextId,
      privateMetadata: modal.privateMetadata,
      viewId,
    });

    return { viewId };
  }

  encodeThreadId(platformData: WebexThreadId): string {
    const encodedRoomId = Buffer.from(platformData.roomId, "utf8").toString(
      "base64url"
    );
    const encodedRoot = Buffer.from(
      platformData.rootMessageId,
      "utf8"
    ).toString("base64url");
    return `${WEBEX_PREFIX}:${encodedRoomId}:${encodedRoot}`;
  }

  decodeThreadId(threadId: string): WebexThreadId {
    const parts = threadId.split(":");
    if (parts.length !== 3 || parts[0] !== WEBEX_PREFIX) {
      throw new ValidationError("webex", `Invalid Webex thread ID: ${threadId}`);
    }

    try {
      return {
        roomId: Buffer.from(parts[1], "base64url").toString("utf8"),
        rootMessageId: Buffer.from(parts[2], "base64url").toString("utf8"),
      };
    } catch {
      throw new ValidationError(
        "webex",
        `Invalid base64 payload in Webex thread ID: ${threadId}`
      );
    }
  }

  channelIdFromThreadId(threadId: string): string {
    const { roomId } = this.decodeThreadId(threadId);
    return this.encodeChannelId(roomId);
  }

  isDM(threadId: string): boolean {
    const { roomId } = this.decodeThreadId(threadId);
    if (roomId.startsWith(DM_ROOM_PREFIX)) {
      return true;
    }
    return this.roomTypeCache.get(roomId) === "direct";
  }

  parseMessage(raw: WebexMessage): Message<WebexMessage> {
    const rootMessageId = raw.parentId || raw.id;
    const threadId = this.encodeThreadId({
      roomId: raw.roomId,
      rootMessageId,
    });
    return this.parseWebexMessage(raw, threadId);
  }

  renderFormatted(content: FormattedContent): string {
    return this.formatConverter.fromAst(content);
  }

  private parseWebexMessage(
    raw: WebexMessage,
    threadId: string
  ): Message<WebexMessage> {
    const text = raw.markdown || raw.text || "";
    const fullName =
      raw.personDisplayName ||
      raw.personEmail ||
      raw.personId ||
      "unknown";
    const userName = raw.personEmail
      ? this.emailToUserName(raw.personEmail)
      : raw.personDisplayName || raw.personId || "unknown";

    const attachments: Attachment[] = (raw.files || []).map((url) =>
      this.createFileAttachment(url)
    );

    return new Message<WebexMessage>({
      id: raw.id,
      threadId,
      text,
      formatted: this.formatConverter.toAst(text),
      raw,
      author: {
        userId: raw.personId || "unknown",
        userName,
        fullName,
        isBot: raw.personType === "bot",
        isMe: raw.personId === this._botUserId,
      },
      metadata: {
        dateSent: this.parseCreatedAt(raw.created),
        edited: false,
      },
      attachments,
      isMention: this.isMessageMention(raw, text),
    });
  }

  private isMessageMention(raw: WebexMessage, text: string): boolean {
    if (raw.roomType === "direct") {
      return true;
    }

    if (raw.mentionedPeople?.includes("all")) {
      return true;
    }

    if (this._botUserId && raw.mentionedPeople?.includes(this._botUserId)) {
      return true;
    }

    if (!this._userName) {
      return false;
    }

    const mentionPattern = new RegExp(`@${this.escapeRegex(this._userName)}\\b`, "i");
    return mentionPattern.test(text);
  }

  private isMessageFromSelf(message: WebexMessage): boolean {
    return !!(this._botUserId && message.personId === this._botUserId);
  }

  private encodeChannelId(roomId: string): string {
    return `${WEBEX_PREFIX}:${Buffer.from(roomId, "utf8").toString("base64url")}`;
  }

  private decodeChannelId(channelId: string): string {
    const parts = channelId.split(":");
    if (parts.length !== 2 || parts[0] !== WEBEX_PREFIX) {
      throw new ValidationError(
        "webex",
        `Invalid Webex channel ID: ${channelId}`
      );
    }
    try {
      return Buffer.from(parts[1], "base64url").toString("utf8");
    } catch {
      throw new ValidationError(
        "webex",
        `Invalid base64 payload in Webex channel ID: ${channelId}`
      );
    }
  }

  private async resolvePostingTarget(roomId: string): Promise<
    | { type: "room"; roomId: string }
    | { type: "dm"; personId: string; roomId?: string }
  > {
    if (!roomId.startsWith(DM_ROOM_PREFIX)) {
      return { type: "room", roomId };
    }

    const personId = roomId.slice(DM_ROOM_PREFIX.length);
    const mappedRoomId = await this.getDmRoom(personId);
    return { type: "dm", personId, roomId: mappedRoomId ?? undefined };
  }

  private async resolveRoomId(roomId: string): Promise<string | null> {
    if (!roomId.startsWith(DM_ROOM_PREFIX)) {
      return roomId;
    }
    const personId = roomId.slice(DM_ROOM_PREFIX.length);
    return this.getDmRoom(personId);
  }

  private async setDmRoom(personId: string, roomId: string): Promise<void> {
    this.dmRoomCache.set(personId, roomId);
    this.roomTypeCache.set(roomId, "direct");
    if (this.chat) {
      await this.chat
        .getState()
        .set(`webex:dm-room:${personId}`, roomId, 30 * 24 * 60 * 60 * 1000);
    }
  }

  private async getDmRoom(personId: string): Promise<string | null> {
    const cached = this.dmRoomCache.get(personId);
    if (cached) {
      return cached;
    }

    if (!this.chat) {
      return null;
    }

    const fromState = await this.chat
      .getState()
      .get<string>(`webex:dm-room:${personId}`);
    if (fromState) {
      this.dmRoomCache.set(personId, fromState);
      this.roomTypeCache.set(fromState, "direct");
      return fromState;
    }

    return null;
  }

  private async listRoomMessagesPage(
    roomId: string,
    max: number,
    beforeMessage?: string
  ): Promise<WebexMessage[]> {
    const useMentionFilter = this.roomTypeCache.get(roomId) === "group";

    try {
      const response = await this.listRoomMessagesRequest({
        roomId,
        max,
        beforeMessage,
        mentionedOnly: useMentionFilter,
      });
      return response.items || [];
    } catch (error) {
      // Bots need mentionedPeople=me in group spaces; retry with that filter
      // when a generic fetch is rejected.
      if (error instanceof PermissionError && !useMentionFilter) {
        const response = await this.listRoomMessagesRequest({
          roomId,
          max,
          beforeMessage,
          mentionedOnly: true,
        });
        this.roomTypeCache.set(roomId, "group");
        return response.items || [];
      }
      throw error;
    }
  }

  private async listRoomMessagesRequest(input: {
    roomId: string;
    max: number;
    beforeMessage?: string;
    mentionedOnly?: boolean;
  }): Promise<WebexListMessagesResponse> {
    const query = new URLSearchParams();
    query.set("roomId", input.roomId);
    query.set(
      "max",
      String(Math.min(Math.max(input.max, 1), MAX_WEBEX_PAGE_SIZE))
    );

    if (input.beforeMessage) {
      query.set("beforeMessage", input.beforeMessage);
    }

    if (input.mentionedOnly) {
      query.set("mentionedPeople", "me");
    }

    return this.webexRequest<WebexListMessagesResponse>(
      `/messages?${query.toString()}`,
      { method: "GET" }
    );
  }

  private async getMessage(messageId: string): Promise<WebexMessage | null> {
    try {
      return await this.webexRequest<WebexMessage>(
        `/messages/${encodeURIComponent(messageId)}`,
        { method: "GET" }
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private async getPerson(personId: string): Promise<WebexPerson | undefined> {
    const cached = this.personCache.get(personId);
    if (cached) {
      return cached;
    }

    try {
      const person = await this.webexRequest<WebexPerson>(
        `/people/${encodeURIComponent(personId)}`,
        {
          method: "GET",
        }
      );
      this.personCache.set(personId, person);
      return person;
    } catch (error) {
      this.logger.debug("Could not fetch Webex person", {
        personId,
        error,
      });
      return undefined;
    }
  }

  private async buildCreateMessageRequestBody(
    message: AdapterPostableMessage,
    context: {
      parentId?: string;
      roomId?: string;
      toPersonId?: string;
    }
  ): Promise<FormData | Record<string, unknown>> {
    const files = extractFiles(message);
    const card = extractCard(message);

    if (card && files.length > 0) {
      throw new ValidationError(
        "webex",
        "Sending a card with uploaded files in the same message is not supported."
      );
    }

    // Webex currently accepts only one uploaded file per message.
    if (files.length > 1) {
      throw new ValidationError(
        "webex",
        "Webex only supports a single file upload per message."
      );
    }

    const markdown = card
      ? cardToFallbackText(card)
      : this.convertEmojiPlaceholders(this.formatConverter.renderPostable(message));

    if (files.length > 0) {
      const form = new FormData();
      if (context.roomId) {
        form.set("roomId", context.roomId);
      }
      if (context.toPersonId) {
        form.set("toPersonId", context.toPersonId);
      }
      if (context.parentId) {
        form.set("parentId", context.parentId);
      }
      form.set("markdown", markdown);

      for (const file of files) {
        const buffer = await toBuffer(file.data, { platform: "webex" });
        if (!buffer) {
          throw new ValidationError("webex", "Unsupported file data type");
        }
        const mimeType = file.mimeType || "application/octet-stream";
        const blob = new Blob([buffer], { type: mimeType });
        form.append("files", blob, file.filename);
      }

      return form;
    }

    const payload: Record<string, unknown> = {
      markdown,
    };

    if (context.roomId) {
      payload.roomId = context.roomId;
    }
    if (context.toPersonId) {
      payload.toPersonId = context.toPersonId;
    }
    if (context.parentId) {
      payload.parentId = context.parentId;
    }

    if (card) {
      payload.attachments = [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: cardToWebexAdaptiveCard(card),
        },
      ];
    }

    return payload;
  }

  private createFileAttachment(url: string): Attachment {
    const fileName = this.fileNameFromUrl(url);
    const mimeType = this.guessMimeType(fileName);
    const type = this.attachmentTypeFromMime(mimeType);

    return {
      type,
      url,
      name: fileName,
      mimeType,
      fetchData: async () => {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.botToken}`,
          },
        });
        if (!response.ok) {
          throw new NetworkError(
            "webex",
            `Failed to fetch attachment: ${response.status}`
          );
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        return buffer;
      },
    };
  }

  private fileNameFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname;
      const name = pathname.split("/").at(-1);
      return name || "attachment";
    } catch {
      return "attachment";
    }
  }

  private guessMimeType(fileName: string): string | undefined {
    const extension = fileName.split(".").at(-1)?.toLowerCase();
    if (!extension) {
      return undefined;
    }

    const mimeByExtension: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      mp4: "video/mp4",
      mov: "video/quicktime",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      pdf: "application/pdf",
      txt: "text/plain",
      csv: "text/csv",
      json: "application/json",
    };
    return mimeByExtension[extension];
  }

  private attachmentTypeFromMime(
    mimeType: string | undefined
  ): Attachment["type"] {
    if (!mimeType) {
      return "file";
    }
    if (mimeType.startsWith("image/")) {
      return "image";
    }
    if (mimeType.startsWith("video/")) {
      return "video";
    }
    if (mimeType.startsWith("audio/")) {
      return "audio";
    }
    return "file";
  }

  private emailToUserName(email: string): string {
    return email.split("@")[0] || email;
  }

  private parseCreatedAt(created?: string): Date {
    if (!created) {
      return new Date();
    }
    const parsed = new Date(created);
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  private convertEmojiPlaceholders(text: string): string {
    return text.replace(EMOJI_PLACEHOLDER_REGEX, (_, emojiName: string) =>
      defaultEmojiResolver.toGChat(emojiName)
    );
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private verifyWebhookSignature(
    body: string,
    signatureHeader: string | null
  ): boolean {
    if (!this.webhookSecret) {
      return true;
    }
    if (!signatureHeader) {
      return false;
    }

    let signature = signatureHeader.trim();
    if (signature.toLowerCase().startsWith("sha1=")) {
      signature = signature.slice(5);
    }

    const expectedHex = createHmac("sha1", this.webhookSecret)
      .update(body)
      .digest("hex");
    const expectedBase64 = createHmac("sha1", this.webhookSecret)
      .update(body)
      .digest("base64");

    if (signature.length === HMAC_SHA1_HEX_LENGTH) {
      return this.constantTimeEqual(signature.toLowerCase(), expectedHex);
    }
    return this.constantTimeEqual(signature, expectedBase64);
  }

  private constantTimeEqual(value: string, expected: string): boolean {
    const valueBuffer = Buffer.from(value, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (valueBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(valueBuffer, expectedBuffer);
  }

  private async webexRequest<T>(
    path: string,
    init: WebexRequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.botToken}`);

    const rawBody = init.body;
    let body: RequestInit["body"];
    if (rawBody === undefined || rawBody === null) {
      body = undefined;
    } else if (
      typeof rawBody === "string" ||
      rawBody instanceof FormData ||
      rawBody instanceof URLSearchParams ||
      rawBody instanceof Blob ||
      rawBody instanceof ArrayBuffer ||
      ArrayBuffer.isView(rawBody) ||
      rawBody instanceof ReadableStream
    ) {
      body = rawBody as RequestInit["body"];
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(rawBody);
    }

    const { body: _body, ...requestInit } = init;
    const response = await fetch(url, {
      ...requestInit,
      headers,
      body,
    });

    if (!response.ok) {
      throw await this.toWebexError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  }

  private async toWebexError(response: Response): Promise<Error> {
    const bodyText = await response.text();
    let message = `Webex API error ${response.status}`;

    if (bodyText) {
      try {
        const parsed = JSON.parse(bodyText) as {
          message?: string;
          errors?: Array<{ description?: string }>;
        };
        message =
          parsed.message ||
          parsed.errors?.[0]?.description ||
          `${message}: ${bodyText}`;
      } catch {
        message = `${message}: ${bodyText}`;
      }
    }

    if (response.status === 401) {
      return new AuthenticationError("webex", message);
    }
    if (response.status === 403) {
      return new PermissionError("webex", "perform this operation");
    }
    if (response.status === 404) {
      return new ResourceNotFoundError("webex", "resource");
    }
    if (response.status === 429) {
      const retryAfter = Number.parseInt(
        response.headers.get("retry-after") || "",
        10
      );
      return new AdapterRateLimitError(
        "webex",
        Number.isNaN(retryAfter) ? undefined : retryAfter
      );
    }

    return new NetworkError("webex", message);
  }
}

export function createWebexAdapter(
  config?: Partial<
    Omit<WebexAdapterConfig, "botToken" | "logger"> & {
      botToken: string;
      logger: Logger;
    }
  >
): WebexAdapter {
  const botToken = config?.botToken ?? process.env.WEBEX_BOT_TOKEN;
  if (!botToken) {
    throw new ValidationError(
      "webex",
      "botToken is required. Set WEBEX_BOT_TOKEN or provide it in config."
    );
  }

  const resolved: WebexAdapterConfig = {
    botToken,
    webhookSecret: config?.webhookSecret ?? process.env.WEBEX_WEBHOOK_SECRET,
    baseUrl: config?.baseUrl ?? process.env.WEBEX_BASE_URL,
    userName: config?.userName ?? process.env.WEBEX_BOT_USERNAME,
    botUserId: config?.botUserId,
    logger: config?.logger ?? new ConsoleLogger("info").child("webex"),
  };

  return new WebexAdapter(resolved);
}

export { cardToFallbackText, cardToWebexAdaptiveCard } from "./cards";
export { WebexFormatConverter } from "./markdown";
export type {
  WebexAttachmentAction,
  WebexMessage,
  WebexPerson,
  WebexRoom,
  WebexThreadId,
  WebexWebhookPayload,
} from "./types";
