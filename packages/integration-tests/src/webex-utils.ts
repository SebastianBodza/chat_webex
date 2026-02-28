import { createHmac } from "node:crypto";
import type {
  WebexAttachmentAction,
  WebexMessage,
  WebexPerson,
  WebexRoom,
} from "@chat-adapter/webex";
import { vi } from "vitest";

export const WEBEX_BOT_TOKEN = "webex-test-token";
export const WEBEX_BOT_USER_ID =
  "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9ib3QtdXNlci0xMjM";
export const WEBEX_BOT_USERNAME = "Chat SDK Webex Bot";
export const WEBEX_WEBHOOK_SECRET = "webex-test-secret";

export interface MockWebexApi {
  actionsById: Map<string, WebexAttachmentAction>;
  createdMessageBodies: Array<Record<string, unknown>>;
  deletedMessageIds: string[];
  messagesById: Map<string, WebexMessage>;
  peopleById: Map<string, WebexPerson>;
  roomMessageOrder: Map<string, string[]>;
  roomsById: Map<string, WebexRoom>;
  updatedMessageBodies: Array<Record<string, unknown>>;
  clearMocks: () => void;
}

export interface WebexReplayFixtureApi {
  attachmentActions?: WebexAttachmentAction[];
  messages?: WebexMessage[];
  people?: WebexPerson[];
  rooms?: WebexRoom[];
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseRequestBody(
  body: RequestInit["body"] | undefined
): Record<string, unknown> | undefined {
  if (!body) {
    return undefined;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return { raw: body };
    }
  }

  if (body instanceof URLSearchParams) {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of body.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  if (body instanceof FormData) {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") {
        obj[key] = value;
      } else {
        obj[key] = {
          name: value.name,
          size: value.size,
          type: value.type,
        };
      }
    }
    return obj;
  }

  return undefined;
}

function mapPathname(pathname: string): string {
  if (pathname.startsWith("/v1/")) {
    return pathname.slice(3);
  }
  return pathname;
}

export function createSparkSignature(
  body: string,
  secret = WEBEX_WEBHOOK_SECRET
): string {
  return createHmac("sha1", secret).update(body).digest("hex");
}

export function createWebexWebhookRequest(
  payload: unknown,
  options?: {
    secret?: string;
    signature?: string;
  }
): Request {
  const body =
    typeof payload === "string" ? payload : JSON.stringify(payload, null, 0);
  const secret = options?.secret ?? WEBEX_WEBHOOK_SECRET;
  const signature = options?.signature ?? createSparkSignature(body, secret);

  return new Request("https://example.com/webhooks/webex", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spark-signature": signature,
    },
    body,
  });
}

export function createMockWebexApi(): MockWebexApi {
  const messagesById = new Map<string, WebexMessage>();
  const actionsById = new Map<string, WebexAttachmentAction>();
  const peopleById = new Map<string, WebexPerson>();
  const roomsById = new Map<string, WebexRoom>();
  const roomMessageOrder = new Map<string, string[]>();
  const createdMessageBodies: Array<Record<string, unknown>> = [];
  const updatedMessageBodies: Array<Record<string, unknown>> = [];
  const deletedMessageIds: string[] = [];

  return {
    messagesById,
    actionsById,
    peopleById,
    roomsById,
    roomMessageOrder,
    createdMessageBodies,
    updatedMessageBodies,
    deletedMessageIds,
    clearMocks: () => {
      createdMessageBodies.length = 0;
      updatedMessageBodies.length = 0;
      deletedMessageIds.length = 0;
    },
  };
}

export function seedRoomMessages(
  mockApi: MockWebexApi,
  roomId: string,
  messages: WebexMessage[]
): void {
  const ids: string[] = [];
  for (const message of messages) {
    mockApi.messagesById.set(message.id, message);
    ids.push(message.id);
  }
  mockApi.roomMessageOrder.set(roomId, ids);
}

export function seedWebexReplayFixtureApi(
  mockApi: MockWebexApi,
  fixtureApi: WebexReplayFixtureApi
): void {
  for (const room of fixtureApi.rooms ?? []) {
    mockApi.roomsById.set(room.id, room);
  }

  for (const person of fixtureApi.people ?? []) {
    mockApi.peopleById.set(person.id, person);
  }

  for (const action of fixtureApi.attachmentActions ?? []) {
    mockApi.actionsById.set(action.id, action);
  }

  const roomToMessages = new Map<string, WebexMessage[]>();
  for (const message of fixtureApi.messages ?? []) {
    if (!roomToMessages.has(message.roomId)) {
      roomToMessages.set(message.roomId, []);
    }
    roomToMessages.get(message.roomId)?.push(message);
  }

  for (const [roomId, messages] of roomToMessages.entries()) {
    seedRoomMessages(mockApi, roomId, messages);
  }
}

export function setupWebexFetchMock(mockApi: MockWebexApi): void {
  let sentMessageIndex = 1;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);
      const path = mapPathname(url.pathname);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = parseRequestBody(init?.body);

      if (path === "/people/me" && method === "GET") {
        return jsonResponse({
          id: WEBEX_BOT_USER_ID,
          displayName: WEBEX_BOT_USERNAME,
          nickName: WEBEX_BOT_USERNAME,
          type: "bot",
          emails: ["chat-sdk-webex-bot@example.com"],
        });
      }

      if (path.startsWith("/people/") && method === "GET") {
        const personId = decodeURIComponent(path.slice("/people/".length));
        const person = mockApi.peopleById.get(personId);
        if (!person) {
          return jsonResponse({ message: "Not Found" }, 404);
        }
        return jsonResponse(person);
      }

      if (path.startsWith("/rooms/") && method === "GET") {
        const roomId = decodeURIComponent(path.slice("/rooms/".length));
        const room = mockApi.roomsById.get(roomId) ?? { id: roomId, type: "group" };
        return jsonResponse(room);
      }

      if (path.startsWith("/attachment/actions/") && method === "GET") {
        const actionId = decodeURIComponent(
          path.slice("/attachment/actions/".length)
        );
        const action = mockApi.actionsById.get(actionId);
        if (!action) {
          return jsonResponse({ message: "Not Found" }, 404);
        }
        return jsonResponse(action);
      }

      if (path === "/messages" && method === "POST") {
        const payload = body ?? {};
        mockApi.createdMessageBodies.push(payload);

        const toPersonId =
          typeof payload.toPersonId === "string" ? payload.toPersonId : undefined;
        const roomId =
          (typeof payload.roomId === "string" && payload.roomId) ||
          (toPersonId ? `dm:${toPersonId}` : "room-created-from-test");
        const messageId = `webex-sent-${sentMessageIndex++}`;
        const created: WebexMessage = {
          id: messageId,
          roomId,
          parentId:
            typeof payload.parentId === "string" ? payload.parentId : undefined,
          text:
            typeof payload.markdown === "string"
              ? payload.markdown
              : typeof payload.text === "string"
                ? payload.text
                : "",
          markdown:
            typeof payload.markdown === "string" ? payload.markdown : undefined,
          personId: WEBEX_BOT_USER_ID,
          personDisplayName: WEBEX_BOT_USERNAME,
          personType: "bot",
          roomType: roomId.startsWith("dm:") ? "direct" : "group",
          created: "2026-02-28T10:05:00.000Z",
        };

        mockApi.messagesById.set(created.id, created);
        const existing = mockApi.roomMessageOrder.get(roomId) ?? [];
        mockApi.roomMessageOrder.set(roomId, [created.id, ...existing]);

        return jsonResponse(created);
      }

      if (path === "/messages" && method === "GET") {
        const roomId = url.searchParams.get("roomId");
        const max = Number(url.searchParams.get("max") || "50");
        const beforeMessage = url.searchParams.get("beforeMessage");
        const mentionedPeople = url.searchParams.get("mentionedPeople");

        if (!roomId) {
          return jsonResponse({ items: [] });
        }

        const orderedIds = [...(mockApi.roomMessageOrder.get(roomId) ?? [])];
        let startAt = 0;
        if (beforeMessage) {
          const beforeIdx = orderedIds.findIndex((id) => id === beforeMessage);
          startAt = beforeIdx >= 0 ? beforeIdx + 1 : orderedIds.length;
        }

        const messages = orderedIds
          .slice(startAt, startAt + Math.max(1, max))
          .map((id) => mockApi.messagesById.get(id))
          .filter((message): message is WebexMessage => !!message)
          .filter((message) => {
            if (mentionedPeople !== "me") {
              return true;
            }
            return (
              message.mentionedPeople?.includes("all") ||
              message.mentionedPeople?.includes(WEBEX_BOT_USER_ID) ||
              false
            );
          });

        return jsonResponse({ items: messages });
      }

      if (path.startsWith("/messages/") && method === "GET") {
        const messageId = decodeURIComponent(path.slice("/messages/".length));
        const message = mockApi.messagesById.get(messageId);
        if (!message) {
          return jsonResponse({ message: "Not Found" }, 404);
        }
        return jsonResponse(message);
      }

      if (path.startsWith("/messages/") && method === "PUT") {
        const messageId = decodeURIComponent(path.slice("/messages/".length));
        const payload = body ?? {};
        mockApi.updatedMessageBodies.push({
          messageId,
          ...payload,
        });
        const existing = mockApi.messagesById.get(messageId);
        const updated: WebexMessage = {
          ...(existing ?? { id: messageId, roomId: "room-updated-from-test" }),
          markdown:
            typeof payload.markdown === "string" ? payload.markdown : undefined,
          text:
            typeof payload.markdown === "string"
              ? payload.markdown
              : typeof payload.text === "string"
                ? payload.text
                : existing?.text,
          attachments: Array.isArray(payload.attachments)
            ? (payload.attachments as WebexMessage["attachments"])
            : existing?.attachments,
        };
        mockApi.messagesById.set(messageId, updated);
        return jsonResponse(updated);
      }

      if (path.startsWith("/messages/") && method === "DELETE") {
        const messageId = decodeURIComponent(path.slice("/messages/".length));
        mockApi.deletedMessageIds.push(messageId);
        mockApi.messagesById.delete(messageId);
        return new Response(null, { status: 204 });
      }

      return jsonResponse(
        {
          message: `Unhandled mocked Webex API call: ${method} ${url.toString()}`,
        },
        500
      );
    })
  );
}
