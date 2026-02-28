import { createWebexAdapter, type WebexAdapter } from "@chat-adapter/webex";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWaitUntilTracker } from "./test-scenarios";
import {
  createMockWebexApi,
  createWebexWebhookRequest,
  seedRoomMessages,
  setupWebexFetchMock,
  WEBEX_BOT_TOKEN,
  WEBEX_BOT_USER_ID,
  WEBEX_BOT_USERNAME,
  WEBEX_WEBHOOK_SECRET,
  type MockWebexApi,
} from "./webex-utils";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => mockLogger,
};

describe("Webex Integration", () => {
  const TEST_ROOM_ID = "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM";
  const TEST_USER_ID = "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw";
  const TEST_MENTION_MESSAGE_ID = "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvbWVudGlvbi0x";
  const TEST_FOLLOW_UP_MESSAGE_ID = "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvZm9sbG93dXAtMQ";
  const TEST_ACTION_MESSAGE_ID = "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvYWN0aW9uLTE";

  let chat: Chat<{ webex: WebexAdapter }>;
  let mockApi: MockWebexApi;
  let tracker: ReturnType<typeof createWaitUntilTracker>;
  let webexAdapter: WebexAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    mockApi = createMockWebexApi();
    setupWebexFetchMock(mockApi);
    tracker = createWaitUntilTracker();

    webexAdapter = createWebexAdapter({
      botToken: WEBEX_BOT_TOKEN,
      botUserId: WEBEX_BOT_USER_ID,
      userName: WEBEX_BOT_USERNAME,
      webhookSecret: WEBEX_WEBHOOK_SECRET,
      logger: mockLogger,
    });

    chat = new Chat({
      userName: WEBEX_BOT_USERNAME,
      adapters: { webex: webexAdapter },
      state: createMemoryState(),
      logger: "error",
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createMessagesCreatedWebhook(messageId: string): Request {
    return createWebexWebhookRequest({
      id: `webhook-${messageId}`,
      resource: "messages",
      event: "created",
      actorId: TEST_USER_ID,
      data: {
        id: messageId,
        roomId: TEST_ROOM_ID,
        personId: TEST_USER_ID,
        personEmail: "user@example.com",
      },
    });
  }

  it("rejects invalid webhook signatures", async () => {
    const request = createWebexWebhookRequest(
      {
        resource: "messages",
        event: "created",
        data: { id: TEST_MENTION_MESSAGE_ID },
      },
      { signature: "invalid-signature" }
    );

    const response = await chat.webhooks.webex(request);
    expect(response.status).toBe(401);
  });

  it("handles mention webhooks and responds in thread", async () => {
    seedRoomMessages(mockApi, TEST_ROOM_ID, [
      {
        id: TEST_MENTION_MESSAGE_ID,
        roomId: TEST_ROOM_ID,
        personId: TEST_USER_ID,
        personEmail: "user@example.com",
        personDisplayName: "Test User",
        personType: "person",
        roomType: "group",
        text: `@${WEBEX_BOT_USERNAME} hello`,
        mentionedPeople: [WEBEX_BOT_USER_ID],
      },
    ]);

    const mentionHandler = vi.fn();
    chat.onNewMention(async (thread, message) => {
      mentionHandler(thread.id, message.text);
      await thread.post("Thanks for mentioning me!");
    });

    const response = await chat.webhooks.webex(
      createMessagesCreatedWebhook(TEST_MENTION_MESSAGE_ID),
      { waitUntil: tracker.waitUntil }
    );

    expect(response.status).toBe(200);
    await tracker.waitForAll();

    const expectedThreadId = webexAdapter.encodeThreadId({
      roomId: TEST_ROOM_ID,
      rootMessageId: TEST_MENTION_MESSAGE_ID,
    });

    expect(mentionHandler).toHaveBeenCalledWith(
      expectedThreadId,
      `@${WEBEX_BOT_USERNAME} hello`
    );
    expect(mockApi.createdMessageBodies).toContainEqual(
      expect.objectContaining({
        roomId: TEST_ROOM_ID,
        parentId: TEST_MENTION_MESSAGE_ID,
        markdown: "Thanks for mentioning me!",
      })
    );
  });

  it("routes follow-up messages to subscribed handler", async () => {
    seedRoomMessages(mockApi, TEST_ROOM_ID, [
      {
        id: TEST_MENTION_MESSAGE_ID,
        roomId: TEST_ROOM_ID,
        personId: TEST_USER_ID,
        personEmail: "user@example.com",
        personDisplayName: "Test User",
        personType: "person",
        roomType: "group",
        text: `@${WEBEX_BOT_USERNAME} subscribe`,
        mentionedPeople: [WEBEX_BOT_USER_ID],
      },
      {
        id: TEST_FOLLOW_UP_MESSAGE_ID,
        roomId: TEST_ROOM_ID,
        parentId: TEST_MENTION_MESSAGE_ID,
        personId: TEST_USER_ID,
        personEmail: "user@example.com",
        personDisplayName: "Test User",
        personType: "person",
        roomType: "group",
        text: "Follow-up message",
      },
    ]);

    chat.onNewMention(async (thread) => {
      await thread.subscribe();
    });

    const subscribedHandler = vi.fn();
    chat.onSubscribedMessage(async (thread, message) => {
      subscribedHandler(thread.id, message.text);
      await thread.post("Ack follow-up");
    });

    await chat.webhooks.webex(createMessagesCreatedWebhook(TEST_MENTION_MESSAGE_ID), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    mockApi.clearMocks();

    await chat.webhooks.webex(createMessagesCreatedWebhook(TEST_FOLLOW_UP_MESSAGE_ID), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    const expectedThreadId = webexAdapter.encodeThreadId({
      roomId: TEST_ROOM_ID,
      rootMessageId: TEST_MENTION_MESSAGE_ID,
    });

    expect(subscribedHandler).toHaveBeenCalledWith(
      expectedThreadId,
      "Follow-up message"
    );
    expect(mockApi.createdMessageBodies).toContainEqual(
      expect.objectContaining({
        roomId: TEST_ROOM_ID,
        parentId: TEST_MENTION_MESSAGE_ID,
        markdown: "Ack follow-up",
      })
    );
  });

  it("handles attachment action webhooks", async () => {
    mockApi.actionsById.set("action-approve-1", {
      id: "action-approve-1",
      type: "submit",
      messageId: TEST_ACTION_MESSAGE_ID,
      personId: TEST_USER_ID,
      inputs: {
        actionId: "approve",
        value: "order-123",
      },
    });
    mockApi.messagesById.set(TEST_ACTION_MESSAGE_ID, {
      id: TEST_ACTION_MESSAGE_ID,
      roomId: TEST_ROOM_ID,
      personId: TEST_USER_ID,
      personType: "person",
      roomType: "group",
      text: "Action card",
    });
    mockApi.peopleById.set(TEST_USER_ID, {
      id: TEST_USER_ID,
      displayName: "Test User",
      emails: ["user@example.com"],
      type: "person",
    });

    const actionHandler = vi.fn();
    chat.onAction("approve", async (event) => {
      actionHandler(event.actionId, event.value, event.user.userId);
      await event.thread.post("Action handled");
    });

    const response = await chat.webhooks.webex(
      createWebexWebhookRequest({
        id: "webhook-action-1",
        resource: "attachmentActions",
        event: "created",
        actorId: TEST_USER_ID,
        data: {
          id: "action-approve-1",
          roomId: TEST_ROOM_ID,
          personId: TEST_USER_ID,
          personEmail: "user@example.com",
        },
      }),
      { waitUntil: tracker.waitUntil }
    );

    expect(response.status).toBe(200);
    await tracker.waitForAll();

    const expectedThreadId = webexAdapter.encodeThreadId({
      roomId: TEST_ROOM_ID,
      rootMessageId: TEST_ACTION_MESSAGE_ID,
    });

    expect(actionHandler).toHaveBeenCalledWith(
      "approve",
      "order-123",
      TEST_USER_ID
    );
    expect(mockApi.createdMessageBodies).toContainEqual(
      expect.objectContaining({
        roomId: TEST_ROOM_ID,
        parentId: TEST_ACTION_MESSAGE_ID,
        markdown: "Action handled",
      })
    );
    expect(expectedThreadId).toContain("webex:");
  });

  it("supports posting then editing a message", async () => {
    seedRoomMessages(mockApi, TEST_ROOM_ID, [
      {
        id: TEST_MENTION_MESSAGE_ID,
        roomId: TEST_ROOM_ID,
        personId: TEST_USER_ID,
        personType: "person",
        roomType: "group",
        text: `@${WEBEX_BOT_USERNAME} edit`,
        mentionedPeople: [WEBEX_BOT_USER_ID],
      },
    ]);

    chat.onNewMention(async (thread) => {
      const message = await thread.post("Processing...");
      await message.edit("Done");
    });

    await chat.webhooks.webex(createMessagesCreatedWebhook(TEST_MENTION_MESSAGE_ID), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(mockApi.createdMessageBodies).toContainEqual(
      expect.objectContaining({
        roomId: TEST_ROOM_ID,
        parentId: TEST_MENTION_MESSAGE_ID,
        markdown: "Processing...",
      })
    );
    expect(mockApi.updatedMessageBodies).toContainEqual(
      expect.objectContaining({
        markdown: "Done",
      })
    );
  });

  it("skips messages authored by the bot itself", async () => {
    seedRoomMessages(mockApi, TEST_ROOM_ID, [
      {
        id: TEST_MENTION_MESSAGE_ID,
        roomId: TEST_ROOM_ID,
        personId: WEBEX_BOT_USER_ID,
        personType: "bot",
        roomType: "group",
        text: `@${WEBEX_BOT_USERNAME} loop`,
        mentionedPeople: [WEBEX_BOT_USER_ID],
      },
    ]);

    const mentionHandler = vi.fn();
    chat.onNewMention(() => {
      mentionHandler();
    });

    await chat.webhooks.webex(createMessagesCreatedWebhook(TEST_MENTION_MESSAGE_ID), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();

    expect(mentionHandler).not.toHaveBeenCalled();
    expect(mockApi.createdMessageBodies).toHaveLength(0);
  });
});
