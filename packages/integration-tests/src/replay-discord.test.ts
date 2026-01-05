/**
 * Discord replay tests using recorded production fixtures.
 *
 * These tests replay real Discord interactions captured from production
 * to verify the adapter handles actual Discord payloads correctly.
 *
 * Based on recordings from SHA 94eb6504 which captured:
 * - Button clicks: hello, info, messages, goodbye
 * - DM interactions
 * - Multi-user scenarios
 * - Thread-based conversations
 */

import type { ActionEvent } from "chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import discordFixtures from "../fixtures/replay/discord.json";
import {
  createDiscordTestContext,
  type DiscordTestContext,
  expectValidAction,
} from "./replay-test-utils";

const REAL_BOT_ID = discordFixtures.metadata.botId;
const REAL_GUILD_ID = discordFixtures.metadata.guildId;
const REAL_THREAD_ID = discordFixtures.metadata.threadId;
const REAL_USER_ID = discordFixtures.metadata.userId;
const REAL_USER_NAME = discordFixtures.metadata.userName;

describe("Discord Replay Tests", () => {
  let ctx: DiscordTestContext;
  let capturedAction: ActionEvent | null = null;

  afterEach(async () => {
    capturedAction = null;
    if (ctx) {
      await ctx.chat.shutdown();
      ctx.cleanup();
    }
    vi.clearAllMocks();
  });

  describe("Production Button Actions (from SHA 94eb6504)", () => {
    it("should handle 'hello' button click from production recording", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(`Hello, ${event.user.fullName}!`);
          },
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe(6); // DEFERRED_UPDATE_MESSAGE

      expectValidAction(capturedAction, {
        actionId: "hello",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Hello, Malte"),
        }),
      );
    });

    it("should handle 'messages' button click that triggers fetch operation", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            // Simulate the fetchMessages action from bot.tsx
            const result = await event.thread.adapter.fetchMessages(
              event.thread.id,
              { limit: 5, direction: "backward" },
            );
            await event.thread.post(
              `Fetched ${result.messages.length} messages`,
            );
          },
        },
      );

      const response = await ctx.sendWebhook(
        discordFixtures.buttonClickMessages,
      );

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "messages",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.list).toHaveBeenCalled();
      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
    });

    it("should handle 'info' button click showing bot information", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(
              `User: ${event.user.fullName}, Platform: ${event.adapter.name}`,
            );
          },
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.buttonClickInfo);

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "info",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Malte"),
        }),
      );
    });

    it("should handle 'goodbye' button click (danger style)", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post(
              `Goodbye, ${event.user.fullName}! See you later.`,
            );
          },
        },
      );

      const response = await ctx.sendWebhook(
        discordFixtures.buttonClickGoodbye,
      );

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "goodbye",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: false,
      });

      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Goodbye"),
        }),
      );
    });
  });

  describe("DM Interactions", () => {
    it("should handle button click in DM channel", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
            await event.thread.post("DM received!");
          },
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.dmButtonClick);

      expect(response.status).toBe(200);

      expectValidAction(capturedAction, {
        actionId: "dm-action",
        userId: REAL_USER_ID,
        userName: REAL_USER_NAME,
        adapterName: "discord",
        isDM: true,
      });

      // DM thread ID format: discord:@me:{dmChannelId}
      expect(capturedAction?.thread.id).toBe("discord:@me:DM_CHANNEL_123");
    });

    it("should extract user info from DM interaction (user field, not member.user)", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.dmButtonClick);

      // DM uses `user` field directly instead of `member.user`
      expect(capturedAction?.user.userId).toBe(REAL_USER_ID);
      expect(capturedAction?.user.userName).toBe(REAL_USER_NAME);
      expect(capturedAction?.user.fullName).toBe("Malte");
    });
  });

  describe("Multi-User Scenarios", () => {
    it("should handle same action from different users", async () => {
      const actionLog: Array<{ userId: string; actionId: string }> = [];

      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            actionLog.push({
              userId: event.user.userId,
              actionId: event.actionId,
            });
            await event.thread.post(`Hello, ${event.user.fullName}!`);
          },
        },
      );

      // First user clicks hello
      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(actionLog).toHaveLength(1);
      expect(actionLog[0].userId).toBe(REAL_USER_ID);

      ctx.mockApi.clearMocks();

      // Different user clicks hello
      await ctx.sendWebhook(discordFixtures.differentUser);
      expect(actionLog).toHaveLength(2);
      expect(actionLog[1].userId).toBe("9876543210987654321");
      expect(actionLog[1].actionId).toBe("hello");
    });

    it("should correctly populate different user properties", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.differentUser);

      expect(capturedAction?.user.userId).toBe("9876543210987654321");
      expect(capturedAction?.user.userName).toBe("alice123");
      expect(capturedAction?.user.fullName).toBe("Alice");
    });
  });

  describe("Thread ID Verification", () => {
    it("should create correct thread ID for guild thread interactions", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            capturedAction = event;
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      // Thread ID format: discord:{guildId}:{threadId}
      expect(capturedAction?.thread.id).toBe(
        `discord:${REAL_GUILD_ID}:${REAL_THREAD_ID}`,
      );
      expect(capturedAction?.threadId).toBe(capturedAction?.thread.id);
    });

    it("should maintain consistent thread ID across multiple actions", async () => {
      const threadIds: string[] = [];

      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            threadIds.push(event.thread.id);
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      await ctx.sendWebhook(discordFixtures.buttonClickMessages);
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);

      // All actions should have same thread ID
      expect(threadIds).toHaveLength(3);
      expect(new Set(threadIds).size).toBe(1);
    });
  });

  describe("Message Operations", () => {
    it("should post, then edit message", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Processing...");
            await msg.edit("Done!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Done!",
        }),
      );
    });

    it("should support typing indicator before posting", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            await event.thread.startTyping();
            await event.thread.post("Done typing!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.channels.typing).toHaveBeenCalled();
      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
    });

    it("should add reactions to posted messages", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("React to this!");
            await msg.addReaction("thumbsup");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
      expect(ctx.mockApi.reactions.add).toHaveBeenCalled();
    });

    it("should delete posted messages", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Temporary message");
            await msg.delete();
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(ctx.mockApi.messages.create).toHaveBeenCalled();
      expect(ctx.mockApi.messages.delete).toHaveBeenCalled();
    });
  });

  describe("Action ID Filtering", () => {
    it("should route actions to specific handlers", async () => {
      const helloHandler = vi.fn();
      const infoHandler = vi.fn();
      const messagesHandler = vi.fn();
      const goodbyeHandler = vi.fn();

      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {},
      );

      ctx.chat.onAction("hello", helloHandler);
      ctx.chat.onAction("info", infoHandler);
      ctx.chat.onAction("messages", messagesHandler);
      ctx.chat.onAction("goodbye", goodbyeHandler);

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(helloHandler).toHaveBeenCalled();
      expect(infoHandler).not.toHaveBeenCalled();

      helloHandler.mockClear();

      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(infoHandler).toHaveBeenCalled();
      expect(helloHandler).not.toHaveBeenCalled();
    });

    it("should support catch-all handler for any action", async () => {
      const catchAllHandler = vi.fn();

      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {},
      );

      ctx.chat.onAction(catchAllHandler);

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(catchAllHandler).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: "hello" }),
      );

      catchAllHandler.mockClear();

      await ctx.sendWebhook(discordFixtures.buttonClickGoodbye);
      expect(catchAllHandler).toHaveBeenCalledWith(
        expect.objectContaining({ actionId: "goodbye" }),
      );
    });

    it("should support array of action IDs in handler", async () => {
      const multiHandler = vi.fn();

      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {},
      );

      ctx.chat.onAction(["hello", "goodbye"], multiHandler);

      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(multiHandler).toHaveBeenCalled();

      multiHandler.mockClear();

      await ctx.sendWebhook(discordFixtures.buttonClickGoodbye);
      expect(multiHandler).toHaveBeenCalled();

      multiHandler.mockClear();

      // info should not trigger the handler
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(multiHandler).not.toHaveBeenCalled();
    });
  });

  describe("Response Types", () => {
    it("should return DEFERRED_UPDATE_MESSAGE (type 6) for button interactions", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async () => {},
        },
      );

      const response = await ctx.sendWebhook(discordFixtures.buttonClickHello);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe(6); // DEFERRED_UPDATE_MESSAGE
    });
  });

  describe("Complete Conversation Flow", () => {
    it("should handle full conversation: hello → info → messages → goodbye", async () => {
      const actionLog: string[] = [];

      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            actionLog.push(event.actionId);
            if (event.actionId === "hello") {
              await event.thread.post(`Hello, ${event.user.fullName}!`);
            } else if (event.actionId === "info") {
              await event.thread.post(
                `Platform: ${event.adapter.name}, Thread: ${event.thread.id}`,
              );
            } else if (event.actionId === "messages") {
              await event.thread.adapter.fetchMessages(event.thread.id, {
                limit: 5,
              });
              await event.thread.post("Fetched messages");
            } else if (event.actionId === "goodbye") {
              await event.thread.post("Goodbye!");
            }
          },
        },
      );

      // Step 1: Say Hello
      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(actionLog).toEqual(["hello"]);

      ctx.mockApi.clearMocks();

      // Step 2: Show Info
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(actionLog).toEqual(["hello", "info"]);

      ctx.mockApi.clearMocks();

      // Step 3: Fetch Messages
      await ctx.sendWebhook(discordFixtures.buttonClickMessages);
      expect(actionLog).toEqual(["hello", "info", "messages"]);
      expect(ctx.mockApi.messages.list).toHaveBeenCalled();

      ctx.mockApi.clearMocks();

      // Step 4: Goodbye
      await ctx.sendWebhook(discordFixtures.buttonClickGoodbye);
      expect(actionLog).toEqual(["hello", "info", "messages", "goodbye"]);

      // Total: 4 message posts (one per action)
      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Goodbye"),
        }),
      );
    });
  });

  describe("Edit Message Pattern (Streaming Fallback)", () => {
    it("should handle post then edit pattern", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            // Post initial message
            const msg = await event.thread.post("Thinking...");
            // Then edit with final content (simulates streaming completion)
            await msg.edit("Done thinking!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickInfo);

      // Should post initial message
      expect(ctx.mockApi.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Thinking...",
        }),
      );

      // Should update with final content
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Done thinking!",
        }),
      );
    });

    it("should handle multiple post-edit cycles", async () => {
      const editCount = { value: 0 };

      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Processing...");
            editCount.value++;
            await msg.edit(`Completed step ${editCount.value}`);
          },
        },
      );

      // First button click
      await ctx.sendWebhook(discordFixtures.buttonClickHello);
      expect(editCount.value).toBe(1);
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Completed step 1",
        }),
      );

      ctx.mockApi.clearMocks();

      // Second button click
      await ctx.sendWebhook(discordFixtures.buttonClickInfo);
      expect(editCount.value).toBe(2);
      expect(ctx.mockApi.messages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "Completed step 2",
        }),
      );
    });

    it("should support progressive edits to same message", async () => {
      ctx = createDiscordTestContext(
        { botName: "Chat SDK Demo", applicationId: REAL_BOT_ID },
        {
          onAction: async (event) => {
            const msg = await event.thread.post("Step 1...");
            await msg.edit("Step 1... Step 2...");
            await msg.edit("Step 1... Step 2... Done!");
          },
        },
      );

      await ctx.sendWebhook(discordFixtures.buttonClickHello);

      // Should create once
      expect(ctx.mockApi.messages.create).toHaveBeenCalledTimes(1);

      // Should update twice (once for each edit)
      expect(ctx.mockApi.messages.update).toHaveBeenCalledTimes(2);

      // Final edit should have complete content
      const updateCalls = ctx.mockApi.messages.update.mock.calls;
      expect(updateCalls[1][0].content).toBe("Step 1... Step 2... Done!");
    });
  });
});
