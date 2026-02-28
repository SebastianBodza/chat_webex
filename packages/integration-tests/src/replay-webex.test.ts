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
  followUpMessage: Message | null;
  followUpThread: Thread | null;
  mentionMessage: Message | null;
  mentionThread: Thread | null;
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

function expectFollowUpCaptured(
  captured: CapturedMessages,
  options: {
    adapterName: string;
    text: string;
  }
): void {
  expect(captured.followUpMessage).not.toBeNull();
  expect(captured.followUpThread).not.toBeNull();
  expect(captured.followUpMessage?.text).toBe(options.text);
  expect(captured.followUpMessage?.author.isBot).toBe(false);
  expect(captured.followUpMessage?.author.isMe).toBe(false);
  expect(captured.followUpThread?.adapter.name).toBe(options.adapterName);
  expect(captured.followUpThread?.id).toContain(`${options.adapterName}:`);
}

describe("Webex Replay Tests", () => {
  let chat: Chat<{ webex: WebexAdapter }>;
  let mockApi: MockWebexApi;
  let tracker: ReturnType<typeof createWaitUntilTracker>;
  let captured: CapturedMessages;

  const fixtureMention = webexFixtures.mention;
  const fixtureFollowUp = webexFixtures.followUp;
  const roomId = fixtureMention.data.roomId;
  const mentionMessageId = fixtureMention.data.id;
  const followUpMessageId = fixtureFollowUp.data.id;
  const userId = fixtureMention.data.personId;
  const userEmail = fixtureMention.data.personEmail;
  const mentionText = "DummytestbotForChatSDK Mention in room ";
  const followUpText = "hi ";

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = createMockWebexApi();
    setupWebexFetchMock(mockApi);
    tracker = createWaitUntilTracker();
    captured = {
      mentionMessage: null,
      mentionThread: null,
      followUpMessage: null,
      followUpThread: null,
    };

    seedRoomMessages(mockApi, roomId, [
      {
        id: mentionMessageId,
        roomId,
        personId: userId,
        personEmail: userEmail,
        personDisplayName: "Test User",
        personType: "person",
        roomType: "group",
        text: mentionText,
        mentionedPeople: [webexFixtures.botUserId],
      },
      {
        id: followUpMessageId,
        roomId,
        parentId: mentionMessageId,
        personId: userId,
        personEmail: userEmail,
        personDisplayName: "Test User",
        personType: "person",
        roomType: "group",
        text: followUpText,
      },
    ]);

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

    chat.onSubscribedMessage(async (thread, message) => {
      captured.followUpThread = thread;
      captured.followUpMessage = message;
      const response = await thread.post("Processing...");
      await response.edit("Thanks for your message");
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
      textContains: "Mention in room",
    });
    expect(captured.mentionMessage?.author).toMatchObject({
      fullName: "Test User",
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

  it("replays follow-up in subscribed thread", async () => {
    await sendWebhook(webexFixtures.mention);
    mockApi.clearMocks();

    await sendWebhook(webexFixtures.followUp);

    expectFollowUpCaptured(captured, {
      adapterName: "webex",
      text: followUpText,
    });
    expect(mockApi.createdMessageBodies).toContainEqual(
      expect.objectContaining({
        roomId,
        parentId: mentionMessageId,
        markdown: "Processing...",
      })
    );
    expect(mockApi.updatedMessageBodies).toContainEqual(
      expect.objectContaining({
        markdown: "Thanks for your message",
      })
    );
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
    expect(captured.followUpMessage).toBeNull();
    expect(mockApi.createdMessageBodies).toHaveLength(0);
  });
});
