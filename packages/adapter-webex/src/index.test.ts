import { createHmac } from "node:crypto";
import type { ChatInstance, Lock, Logger, StateAdapter } from "chat";
import {
  Actions,
  Card,
  Modal,
  RadioSelect,
  Select,
  SelectOption,
  TextInput,
} from "chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebexAdapter, WebexAdapter } from "./index";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
};

function createMockState(): StateAdapter & { cache: Map<string, unknown> } {
  const cache = new Map<string, unknown>();
  return {
    cache,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isSubscribed: vi.fn().mockResolvedValue(false),
    acquireLock: vi
      .fn()
      .mockResolvedValue({ threadId: "", token: "", expiresAt: 0 } as Lock),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(true),
    get: vi.fn().mockImplementation((key: string) => {
      return Promise.resolve(cache.get(key) ?? null);
    }),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      cache.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn().mockImplementation((key: string) => {
      cache.delete(key);
      return Promise.resolve();
    }),
  };
}

function createMockChat(state: StateAdapter): ChatInstance {
  return {
    getState: () => state,
    getLogger: () => mockLogger,
    processMessage: vi.fn(),
    processAction: vi.fn(),
    processModalSubmit: vi.fn().mockResolvedValue(undefined),
    processModalClose: vi.fn(),
  } as unknown as ChatInstance;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createSparkSignature(body: string, secret: string): string {
  return createHmac("sha1", secret).update(body).digest("hex");
}

function createWebhookRequest(body: string, secret: string): Request {
  return new Request("https://example.com/webhooks/webex", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spark-signature": createSparkSignature(body, secret),
    },
    body,
  });
}

describe("createWebexAdapter", () => {
  const originalToken = process.env.WEBEX_BOT_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.WEBEX_BOT_TOKEN;
    } else {
      process.env.WEBEX_BOT_TOKEN = originalToken;
    }
  });

  it("creates adapter with explicit token", () => {
    const adapter = createWebexAdapter({
      botToken: "test-token",
      logger: mockLogger,
    });
    expect(adapter).toBeInstanceOf(WebexAdapter);
    expect(adapter.name).toBe("webex");
  });

  it("throws when token is missing", () => {
    delete process.env.WEBEX_BOT_TOKEN;
    expect(() => createWebexAdapter({ logger: mockLogger })).toThrow(
      "botToken is required"
    );
  });
});

describe("thread ID encoding", () => {
  const adapter = createWebexAdapter({
    botToken: "token",
    logger: mockLogger,
  });

  it("encodes and decodes thread IDs", () => {
    const encoded = adapter.encodeThreadId({
      roomId: "Y2lzY29zcGFyazovL3VzL1JPT00vabc",
      rootMessageId: "Y2lzY29zcGFyazovL3VzL01FU1NBR0Uv123",
    });
    const decoded = adapter.decodeThreadId(encoded);
    expect(decoded).toEqual({
      roomId: "Y2lzY29zcGFyazovL3VzL1JPT00vabc",
      rootMessageId: "Y2lzY29zcGFyazovL3VzL01FU1NBR0Uv123",
    });
    expect(adapter.channelIdFromThreadId(encoded)).toMatch(/^webex:/);
  });

  it("throws on invalid thread IDs", () => {
    expect(() => adapter.decodeThreadId("webex:abc")).toThrow(
      "Invalid Webex thread ID"
    );
  });
});

describe("handleWebhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects invalid signatures", async () => {
    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    await adapter.initialize(createMockChat(state));

    const request = new Request("https://example.com/webhooks/webex", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spark-signature": "invalid",
      },
      body: JSON.stringify({ resource: "messages", event: "created" }),
    });

    const response = await adapter.handleWebhook(request);
    expect(response.status).toBe(401);
  });

  it("processes messages.created webhooks", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "room-1",
        personId: "user-1",
        personEmail: "user@example.com",
        text: "Hello @bot",
        created: "2026-02-24T20:00:00.000Z",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      userName: "bot",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);

    const body = JSON.stringify({
      resource: "messages",
      event: "created",
      data: { id: "msg-1" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"));

    expect(response.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);
    const call = (chat.processMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(adapter);
    expect(call[1]).toBe(
      adapter.encodeThreadId({
        roomId: "room-1",
        rootMessageId: "msg-1",
      })
    );
  });

  it("processes attachmentActions.created webhooks", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "action-1",
        type: "submit",
        messageId: "msg-1",
        personId: "user-2",
        inputs: { actionId: "approve", value: "ok" },
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "room-1",
        personId: "user-1",
        text: "Card",
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "user-2",
        displayName: "User Two",
        emails: ["user2@example.com"],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);

    const body = JSON.stringify({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-1" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"));

    expect(response.status).toBe(200);
    expect(chat.processAction).toHaveBeenCalledTimes(1);
    const actionEvent = (chat.processAction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(actionEvent.actionId).toBe("approve");
    expect(actionEvent.value).toBe("ok");
  });

  it("extracts selected value from inputs[actionId] for choice submit actions", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "action-2",
        type: "submit",
        messageId: "msg-2",
        personId: "user-2",
        inputs: {
          actionId: "quick_action",
          quick_action: "greet",
          source: "select",
        },
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-2",
        roomId: "room-2",
        personId: "user-1",
        text: "Card",
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "user-2",
        displayName: "User Two",
        emails: ["user2@example.com"],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);

    const body = JSON.stringify({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-2" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"));

    expect(response.status).toBe(200);
    expect(chat.processAction).toHaveBeenCalledTimes(1);
    const actionEvent = (chat.processAction as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(actionEvent.actionId).toBe("quick_action");
    expect(actionEvent.value).toBe("greet");
  });

  it("routes modal submit attachment actions to processModalSubmit", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "action-modal-1",
        type: "submit",
        messageId: "msg-modal-1",
        personId: "user-2",
        inputs: {
          actionId: "__chat_modal_submit:view-1",
          _chat_modal: "1",
          _chat_modal_action: "submit",
          _chat_modal_view_id: "view-1",
          _chat_modal_callback_id: "feedback_form",
          _chat_modal_context_id: "ctx-1",
          feedback: "Looks great",
          category: "feature",
        },
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-modal-1",
        roomId: "room-modal-1",
        personId: "user-1",
        text: "Modal card",
      })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "user-2",
        displayName: "User Two",
        emails: ["user2@example.com"],
      })
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot-person-id",
      webhookSecret: "secret",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);

    const body = JSON.stringify({
      resource: "attachmentActions",
      event: "created",
      data: { id: "action-modal-1" },
    });
    const response = await adapter.handleWebhook(createWebhookRequest(body, "secret"));

    expect(response.status).toBe(200);
    expect(chat.processAction).not.toHaveBeenCalled();
    expect(chat.processModalSubmit).toHaveBeenCalledTimes(1);
    const submitEvent = (chat.processModalSubmit as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(submitEvent.callbackId).toBe("feedback_form");
    expect(submitEvent.values).toEqual({
      feedback: "Looks great",
      category: "feature",
    });
    const deleteCall = fetchMock.mock.calls[3];
    expect(String(deleteCall[0])).toContain("/messages/msg-modal-1");
    expect((deleteCall[1] as RequestInit).method).toBe("DELETE");
  });
});

describe("api operations", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts card messages with adaptive card attachment", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "reply-1",
        roomId: "room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.postMessage(threadId, {
      card: {
        type: "card",
        title: "Deploy",
        children: [],
      },
      fallbackText: "Deploy",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.roomId).toBe("room-1");
    expect(body.parentId).toBe("root-1");
    expect(body.attachments).toBeTruthy();
  });

  it("converts select and radio controls into adaptive card choices", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "reply-choices",
        roomId: "room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.postMessage(
      threadId,
      Card({
        title: "Choices",
        children: [
          Actions([
            Select({
              id: "quick_action",
              label: "Quick Action",
              placeholder: "Choose...",
              options: [
                SelectOption({ label: "Say Hello", value: "greet" }),
                SelectOption({ label: "Show Info", value: "info" }),
              ],
            }),
            RadioSelect({
              id: "plan_selected",
              label: "Choose Plan",
              options: [
                SelectOption({ label: "All text elements", value: "all_text" }),
                SelectOption({
                  label: "Headers only",
                  value: "headers_titles",
                }),
              ],
            }),
          ]),
        ],
      })
    );

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as {
      attachments: Array<{ content: { body: unknown[]; actions: unknown[] } }>;
    };

    const content = body.attachments[0].content;
    const choiceSets = content.body.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: string }).type === "Input.ChoiceSet"
    ) as Array<{ id: string; style: string }>;

    expect(choiceSets).toHaveLength(2);
    expect(choiceSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "quick_action", style: "compact" }),
        expect.objectContaining({ id: "plan_selected", style: "expanded" }),
      ])
    );

    expect(content.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Action.Submit",
          data: expect.objectContaining({ actionId: "quick_action" }),
        }),
        expect.objectContaining({
          type: "Action.Submit",
          data: expect.objectContaining({ actionId: "plan_selected" }),
        }),
      ])
    );
  });

  it("fetches thread messages in chronological order", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "reply-1",
            roomId: "room-1",
            parentId: "root-1",
            personId: "user-2",
            text: "Reply",
            created: "2026-02-24T20:02:00.000Z",
          },
          {
            id: "root-1",
            roomId: "room-1",
            personId: "user-1",
            text: "Root",
            created: "2026-02-24T20:00:00.000Z",
          },
        ],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });
    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    const result = await adapter.fetchMessages(threadId, { limit: 2 });
    expect(result.messages.map((m) => m.id)).toEqual(["root-1", "reply-1"]);
  });

  it("retries room message listing with mentionedPeople=me after permission error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          message: "The request was unauthorized.",
        },
        403
      )
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            id: "root-1",
            roomId: "room-group-1",
            personId: "user-1",
            text: "Mentioned bot message",
            created: "2026-02-24T20:00:00.000Z",
          },
        ],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-group-1",
      rootMessageId: "root-1",
    });

    const result = await adapter.fetchMessages(threadId, { limit: 1 });
    expect(result.messages).toHaveLength(1);

    const firstUrl = String(fetchMock.mock.calls[0][0]);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(firstUrl).not.toContain("mentionedPeople=me");
    expect(secondUrl).toContain("mentionedPeople=me");
  });

  it("posts DM messages using toPersonId in pseudo DM threads", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "msg-1",
        roomId: "direct-room-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const dmThreadId = await adapter.openDM("person-123");
    await adapter.postMessage(dmThreadId, "hello");

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body.toPersonId).toBe("person-123");
    expect(body.roomId).toBeUndefined();
    expect(body.parentId).toBeUndefined();
  });

  it("rejects sending more than one uploaded file in a single message", async () => {
    const fetchMock = vi.mocked(fetch);

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.postMessage(threadId, {
        markdown: "Files",
        files: [
          {
            filename: "a.txt",
            data: Buffer.from("a"),
            mimeType: "text/plain",
          },
          {
            filename: "b.txt",
            data: Buffer.from("b"),
            mimeType: "text/plain",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
      adapter: "webex",
      code: "VALIDATION_ERROR",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns Webex-scoped validation errors for unsupported file data", async () => {
    const fetchMock = vi.mocked(fetch);

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await expect(
      adapter.postMessage(threadId, {
        markdown: "Bad file payload",
        files: [
          {
            filename: "bad.txt",
            data: "not-a-buffer" as unknown as Buffer,
            mimeType: "text/plain",
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "ValidationError",
      adapter: "webex",
      code: "VALIDATION_ERROR",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens Webex modal by posting an adaptive card form", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "modal-msg-1",
        roomId: "room-modal-1",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });
    const state = createMockState();
    const chat = createMockChat(state);
    await adapter.initialize(chat);

    const threadId = adapter.encodeThreadId({
      roomId: "room-modal-1",
      rootMessageId: "root-modal-1",
    });
    state.cache.set("modal-context:webex:ctx-modal-1", {
      thread: { id: threadId },
    });

    const view = await adapter.openModal(
      "trigger-id",
      Modal({
        callbackId: "feedback_form",
        title: "Send Feedback",
        submitLabel: "Send",
        closeLabel: "Cancel",
        children: [
          TextInput({
            id: "feedback",
            label: "Feedback",
            placeholder: "Type here...",
          }),
        ],
      }),
      "ctx-modal-1"
    );

    expect(view.viewId).toBeTruthy();

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string) as {
      attachments: Array<{ content: { body: unknown[]; actions: unknown[] } }>;
      parentId?: string;
      roomId?: string;
    };

    expect(body.roomId).toBe("room-modal-1");
    expect(body.parentId).toBe("root-modal-1");
    const content = body.attachments[0].content;
    expect(content.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "Input.Text", id: "feedback" }),
      ])
    );
    expect(content.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "Action.Submit",
          data: expect.objectContaining({
            _chat_modal: "1",
            _chat_modal_callback_id: "feedback_form",
          }),
        }),
      ])
    );
    expect(
      state.cache.get(`webex:modal:view:${view.viewId}`)
    ).toMatchObject({
      callbackId: "feedback_form",
      contextId: "ctx-modal-1",
      threadId,
      viewId: view.viewId,
    });
  });

  it("adds a reaction to a message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "reaction-1",
        messageId: "msg-1",
        personId: "bot",
        reaction: "thumbsup",
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.addReaction(threadId, "msg-1", "thumbs_up");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/messages/msg-1/reactions");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string) as { reaction: string };
    expect(body.reaction).toBe("thumbsup");
  });

  it("maps emoji names to Webex reaction shortcodes", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          id: "reaction-1",
          messageId: "msg-1",
          personId: "bot",
          reaction: "heart",
        })
      )
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    // Test various emoji name formats
    await adapter.addReaction(threadId, "msg-1", "heart");
    await adapter.addReaction(threadId, "msg-1", ":thumbsup:");
    await adapter.addReaction(threadId, "msg-1", "party");

    const calls = fetchMock.mock.calls;
    expect(JSON.parse((calls[0][1] as RequestInit).body as string)).toEqual({ reaction: "heart" });
    expect(JSON.parse((calls[1][1] as RequestInit).body as string)).toEqual({ reaction: "thumbsup" });
    expect(JSON.parse((calls[2][1] as RequestInit).body as string)).toEqual({ reaction: "celebrate" });
  });

  it("removes a reaction from a message", async () => {
    const fetchMock = vi.mocked(fetch);
    // First call: list reactions
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { id: "reaction-1", personId: "bot", reaction: "thumbsup" },
          { id: "reaction-2", personId: "other-user", reaction: "thumbsup" },
        ],
      })
    );
    // Second call: delete reaction
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.removeReaction(threadId, "msg-1", "thumbs_up");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Verify list call
    const [listUrl] = fetchMock.mock.calls[0];
    expect(String(listUrl)).toContain("/messages/msg-1/reactions");
    // Verify delete call - should delete only the bot's reaction
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1];
    expect(String(deleteUrl)).toContain("/reactions/reaction-1");
    expect((deleteInit as RequestInit).method).toBe("DELETE");
  });

  it("does not delete when bot has no matching reaction", async () => {
    const fetchMock = vi.mocked(fetch);
    // Return reactions from other users only
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { id: "reaction-2", personId: "other-user", reaction: "thumbsup" },
        ],
      })
    );

    const adapter = createWebexAdapter({
      botToken: "token",
      botUserId: "bot",
      logger: mockLogger,
    });

    const threadId = adapter.encodeThreadId({
      roomId: "room-1",
      rootMessageId: "root-1",
    });

    await adapter.removeReaction(threadId, "msg-1", "thumbs_up");

    // Should only call list, not delete
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
