import { createWebexAdapter, type WebexAdapter } from "@chat-adapter/webex";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Logger, type Message, type Thread } from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webexFixtures from "../fixtures/replay/webex.json";
import { createWaitUntilTracker } from "./test-scenarios";
import {
  createMockWebexApi,
  createWebexWebhookRequest,
  seedRoomMessages,
  seedWebexReplayFixtureApi,
  setupWebexFetchMock,
  WEBEX_BOT_TOKEN,
  WEBEX_WEBHOOK_SECRET,
  type MockWebexApi,
} from "./webex-utils";

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => mockLogger,
};

type CapturedMessages = {
  mentionMessage: Message | null;
  mentionThread: Thread | null;
};

type CapturedAction = {
  actionId: string | null;
  messageId: string | null;
  thread: Thread | null;
  userId: string | null;
  value: unknown;
};

function expectMentionCaptured(
  captured: CapturedMessages,
  options: {
    adapterName: string;
    authorUserId: string;
    textContains: string;
  }
): void {
  expect(captured.mentionMessage).not.toBeNull();
  expect(captured.mentionThread).not.toBeNull();
  expect(captured.mentionMessage?.text).toContain(options.textContains);
  expect(captured.mentionMessage?.author.userId).toBe(options.authorUserId);
  expect(captured.mentionMessage?.author.isBot).toBe(false);
  expect(captured.mentionMessage?.author.isMe).toBe(false);
  expect(captured.mentionThread?.adapter.name).toBe(options.adapterName);
  expect(captured.mentionThread?.id).toContain(`${options.adapterName}:`);
}

function expectActionCaptured(
  captured: CapturedAction,
  options: {
    adapterName: string;
    actionId: string;
    userId: string;
  }
): void {
  expect(captured.thread).not.toBeNull();
  expect(captured.actionId).toBe(options.actionId);
  expect(captured.userId).toBe(options.userId);
  expect(captured.thread?.adapter.name).toBe(options.adapterName);
  expect(captured.thread?.id).toContain(`${options.adapterName}:`);
}

describe("Webex Replay Tests", () => {
  let chat: Chat<{ webex: WebexAdapter }>;
  let mockApi: MockWebexApi;
  let tracker: ReturnType<typeof createWaitUntilTracker>;
  let captured: CapturedMessages;
  let capturedAction: CapturedAction;

  const fixtureMention = webexFixtures.mention;
  const fixtureAction = webexFixtures.action;
  const mentionMessageFromApi = webexFixtures.api.messages.find(
    (message) => message.id === fixtureMention.data.id
  );
  const actionFromApi = webexFixtures.api.attachmentActions.find(
    (action) => action.id === fixtureAction.data.id
  );
  const sourceActionMessageFromApi = webexFixtures.api.messages.find(
    (message) => message.id === fixtureAction.data.messageId
  );
  if (!mentionMessageFromApi || !actionFromApi || !sourceActionMessageFromApi) {
    throw new Error("Invalid Webex replay fixture: missing required recorded API data");
  }

  const roomId = fixtureMention.data.roomId;
  const mentionMessageId = fixtureMention.data.id;
  const userId = fixtureMention.data.personId;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockWebexApi();
    setupWebexFetchMock(mockApi);
    tracker = createWaitUntilTracker();
    captured = {
      mentionMessage: null,
      mentionThread: null,
    };
    capturedAction = {
      actionId: null,
      messageId: null,
      thread: null,
      userId: null,
      value: undefined,
    };

    seedWebexReplayFixtureApi(mockApi, webexFixtures.api);

    const webexAdapter = createWebexAdapter({
      botToken: WEBEX_BOT_TOKEN,
      webhookSecret: WEBEX_WEBHOOK_SECRET,
      botUserId: webexFixtures.botUserId,
      userName: webexFixtures.botName,
      logger: mockLogger,
    });

    chat = new Chat({
      userName: webexFixtures.botName,
      adapters: { webex: webexAdapter },
      state: createMemoryState(),
      logger: "error",
    });

    chat.onNewMention(async (thread, message) => {
      captured.mentionThread = thread;
      captured.mentionMessage = message;
      await thread.subscribe();
      await thread.post("Thanks for mentioning me!");
    });

    chat.onAction("hello", async (event) => {
      capturedAction.actionId = event.actionId;
      capturedAction.messageId = event.messageId;
      capturedAction.thread = event.thread;
      capturedAction.userId = event.user.userId;
      capturedAction.value = event.value;
      await event.thread.post("Action handled from replay");
    });
  });

  afterEach(async () => {
    await chat.shutdown();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function sendWebhook(payload: unknown): Promise<void> {
    await chat.webhooks.webex(createWebexWebhookRequest(payload), {
      waitUntil: tracker.waitUntil,
    });
    await tracker.waitForAll();
  }

  it("replays @mention with correct message and thread properties", async () => {
    await sendWebhook(webexFixtures.mention);

    expectMentionCaptured(captured, {
      adapterName: "webex",
      authorUserId: userId,
      textContains: mentionMessageFromApi.text,
    });
    expect(captured.mentionMessage?.author).toMatchObject({
      fullName: mentionMessageFromApi.personEmail,
      isBot: false,
      isMe: false,
    });
    expect(mockApi.createdMessageBodies).toContainEqual(
      expect.objectContaining({
        roomId,
        parentId: mentionMessageId,
        markdown: "Thanks for mentioning me!",
      })
    );
  });

  it("replays attachment action with recorded webhook payload", async () => {
    await sendWebhook(webexFixtures.action);

    expectActionCaptured(capturedAction, {
      adapterName: "webex",
      actionId: actionFromApi.inputs.actionId,
      userId: actionFromApi.personId,
    });
    expect(mockApi.createdMessageBodies).toContainEqual(
      expect.objectContaining({
        roomId,
        parentId: sourceActionMessageFromApi.parentId ?? sourceActionMessageFromApi.id,
        markdown: "Action handled from replay",
      })
    );
    expect(capturedAction.messageId).toBe(actionFromApi.messageId);
  });

  it("skips webhook messages sent by the bot itself", async () => {
    const botMessageId = "fixture-bot-self-message";
    seedRoomMessages(mockApi, roomId, [
      {
        id: botMessageId,
        roomId,
        personId: webexFixtures.botUserId,
        personType: "bot",
        roomType: "group",
        text: `@${webexFixtures.botName} loop`,
        mentionedPeople: [webexFixtures.botUserId],
      },
    ]);

    await sendWebhook({
      ...fixtureMention,
      data: {
        ...fixtureMention.data,
        id: botMessageId,
      },
    });

    expect(captured.mentionMessage).toBeNull();
    expect(mockApi.createdMessageBodies).toHaveLength(0);
  });
});
