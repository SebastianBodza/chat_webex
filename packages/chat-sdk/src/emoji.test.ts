import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMOJI_MAP,
  defaultEmojiResolver,
  EmojiResolver,
} from "./emoji";

describe("EmojiResolver", () => {
  describe("fromSlack", () => {
    it("should convert Slack emoji to normalized format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("+1")).toBe("thumbs_up");
      expect(resolver.fromSlack("thumbsup")).toBe("thumbs_up");
      expect(resolver.fromSlack("-1")).toBe("thumbs_down");
      expect(resolver.fromSlack("heart")).toBe("heart");
      expect(resolver.fromSlack("fire")).toBe("fire");
    });

    it("should handle colons around emoji names", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack(":+1:")).toBe("thumbs_up");
      expect(resolver.fromSlack(":fire:")).toBe("fire");
    });

    it("should be case-insensitive", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("FIRE")).toBe("fire");
      expect(resolver.fromSlack("Heart")).toBe("heart");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("custom_emoji")).toBe("custom_emoji");
    });
  });

  describe("fromGChat", () => {
    it("should convert GChat unicode emoji to normalized format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("👍")).toBe("thumbs_up");
      expect(resolver.fromGChat("👎")).toBe("thumbs_down");
      expect(resolver.fromGChat("❤️")).toBe("heart");
      expect(resolver.fromGChat("🔥")).toBe("fire");
      expect(resolver.fromGChat("🚀")).toBe("rocket");
    });

    it("should handle multiple unicode variants", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("❤")).toBe("heart");
      expect(resolver.fromGChat("❤️")).toBe("heart");
      expect(resolver.fromGChat("✅")).toBe("check");
      expect(resolver.fromGChat("✔️")).toBe("check");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("🦄")).toBe("🦄");
    });
  });

  describe("toSlack", () => {
    it("should convert normalized emoji to Slack format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toSlack("thumbs_up")).toBe("+1");
      expect(resolver.toSlack("fire")).toBe("fire");
      expect(resolver.toSlack("heart")).toBe("heart");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toSlack("custom")).toBe("custom");
    });
  });

  describe("toGChat", () => {
    it("should convert normalized emoji to GChat format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toGChat("thumbs_up")).toBe("👍");
      expect(resolver.toGChat("fire")).toBe("🔥");
      expect(resolver.toGChat("rocket")).toBe("🚀");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toGChat("custom")).toBe("custom");
    });
  });

  describe("matches", () => {
    it("should match Slack format to normalized emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("+1", "thumbs_up")).toBe(true);
      expect(resolver.matches("thumbsup", "thumbs_up")).toBe(true);
      expect(resolver.matches(":+1:", "thumbs_up")).toBe(true);
      expect(resolver.matches("fire", "fire")).toBe(true);
    });

    it("should match GChat format to normalized emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("👍", "thumbs_up")).toBe(true);
      expect(resolver.matches("🔥", "fire")).toBe(true);
      expect(resolver.matches("❤️", "heart")).toBe(true);
    });

    it("should not match different emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("+1", "thumbs_down")).toBe(false);
      expect(resolver.matches("👍", "fire")).toBe(false);
    });

    it("should match unmapped emoji by equality", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("custom", "custom")).toBe(true);
      expect(resolver.matches("custom", "other")).toBe(false);
    });
  });

  describe("extend", () => {
    it("should add new emoji mappings", () => {
      const resolver = new EmojiResolver();
      resolver.extend({
        unicorn: { slack: "unicorn_face", gchat: "🦄" },
      });

      expect(resolver.fromSlack("unicorn_face")).toBe("unicorn");
      expect(resolver.fromGChat("🦄")).toBe("unicorn");
      expect(resolver.toSlack("unicorn")).toBe("unicorn_face");
      expect(resolver.toGChat("unicorn")).toBe("🦄");
    });

    it("should override existing mappings", () => {
      const resolver = new EmojiResolver();
      resolver.extend({
        fire: { slack: "flames", gchat: "🔥" },
      });

      expect(resolver.fromSlack("flames")).toBe("fire");
      expect(resolver.toSlack("fire")).toBe("flames");
    });
  });

  describe("defaultEmojiResolver", () => {
    it("should be a pre-configured resolver instance", () => {
      expect(defaultEmojiResolver).toBeInstanceOf(EmojiResolver);
      expect(defaultEmojiResolver.fromSlack("+1")).toBe("thumbs_up");
    });
  });

  describe("DEFAULT_EMOJI_MAP", () => {
    it("should contain all well-known emoji", () => {
      const expectedEmoji = [
        "thumbs_up",
        "thumbs_down",
        "heart",
        "smile",
        "laugh",
        "thinking",
        "eyes",
        "fire",
        "check",
        "x",
        "question",
        "party",
        "rocket",
        "star",
        "wave",
        "clap",
        "100",
        "warning",
      ];

      for (const emoji of expectedEmoji) {
        expect(DEFAULT_EMOJI_MAP[emoji]).toBeDefined();
        expect(DEFAULT_EMOJI_MAP[emoji].slack).toBeDefined();
        expect(DEFAULT_EMOJI_MAP[emoji].gchat).toBeDefined();
      }
    });
  });
});
