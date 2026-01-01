import type { Emoji, EmojiFormats, EmojiMapConfig } from "./types";

/**
 * Default emoji map for well-known emoji.
 * Maps normalized emoji names to platform-specific formats.
 */
export const DEFAULT_EMOJI_MAP: Record<string, EmojiFormats> = {
  thumbs_up: { slack: ["+1", "thumbsup"], gchat: "👍" },
  thumbs_down: { slack: ["-1", "thumbsdown"], gchat: "👎" },
  heart: { slack: "heart", gchat: ["❤️", "❤"] },
  smile: { slack: ["smile", "slightly_smiling_face"], gchat: "😊" },
  laugh: { slack: ["laughing", "satisfied", "joy"], gchat: ["😂", "😆"] },
  thinking: { slack: "thinking_face", gchat: "🤔" },
  eyes: { slack: "eyes", gchat: "👀" },
  fire: { slack: "fire", gchat: "🔥" },
  check: {
    slack: ["white_check_mark", "heavy_check_mark"],
    gchat: ["✅", "✔️"],
  },
  x: { slack: ["x", "heavy_multiplication_x"], gchat: ["❌", "✖️"] },
  question: { slack: "question", gchat: ["❓", "?"] },
  party: { slack: ["tada", "partying_face"], gchat: ["🎉", "🥳"] },
  rocket: { slack: "rocket", gchat: "🚀" },
  star: { slack: "star", gchat: "⭐" },
  wave: { slack: "wave", gchat: "👋" },
  clap: { slack: "clap", gchat: "👏" },
  "100": { slack: "100", gchat: "💯" },
  warning: { slack: "warning", gchat: "⚠️" },
};

/**
 * Emoji resolver that handles conversion between platform formats and normalized names.
 */
export class EmojiResolver {
  private emojiMap: Record<string, EmojiFormats>;
  private slackToNormalized: Map<string, string>;
  private gchatToNormalized: Map<string, string>;

  constructor(customMap?: EmojiMapConfig) {
    this.emojiMap = { ...DEFAULT_EMOJI_MAP, ...customMap };
    this.slackToNormalized = new Map();
    this.gchatToNormalized = new Map();
    this.buildReverseMaps();
  }

  private buildReverseMaps(): void {
    for (const [normalized, formats] of Object.entries(this.emojiMap)) {
      // Build Slack reverse map
      const slackFormats = Array.isArray(formats.slack)
        ? formats.slack
        : [formats.slack];
      for (const slack of slackFormats) {
        this.slackToNormalized.set(slack.toLowerCase(), normalized);
      }

      // Build GChat reverse map
      const gchatFormats = Array.isArray(formats.gchat)
        ? formats.gchat
        : [formats.gchat];
      for (const gchat of gchatFormats) {
        this.gchatToNormalized.set(gchat, normalized);
      }
    }
  }

  /**
   * Convert a Slack emoji name to normalized format.
   * Returns the raw emoji if no mapping exists.
   */
  fromSlack(slackEmoji: string): Emoji | string {
    // Remove colons if present (e.g., ":+1:" -> "+1")
    const cleaned = slackEmoji.replace(/^:|:$/g, "").toLowerCase();
    return this.slackToNormalized.get(cleaned) ?? slackEmoji;
  }

  /**
   * Convert a Google Chat unicode emoji to normalized format.
   * Returns the raw emoji if no mapping exists.
   */
  fromGChat(gchatEmoji: string): Emoji | string {
    return this.gchatToNormalized.get(gchatEmoji) ?? gchatEmoji;
  }

  /**
   * Convert a normalized emoji to Slack format.
   * Returns the first Slack format if multiple exist.
   */
  toSlack(emoji: Emoji | string): string {
    const formats = this.emojiMap[emoji];
    if (!formats) return emoji;
    return Array.isArray(formats.slack) ? formats.slack[0] : formats.slack;
  }

  /**
   * Convert a normalized emoji to Google Chat format.
   * Returns the first GChat format if multiple exist.
   */
  toGChat(emoji: Emoji | string): string {
    const formats = this.emojiMap[emoji];
    if (!formats) return emoji;
    return Array.isArray(formats.gchat) ? formats.gchat[0] : formats.gchat;
  }

  /**
   * Check if an emoji (in any format) matches a normalized emoji name.
   */
  matches(rawEmoji: string, normalized: Emoji | string): boolean {
    const formats = this.emojiMap[normalized];
    if (!formats) return rawEmoji === normalized;

    const slackFormats = Array.isArray(formats.slack)
      ? formats.slack
      : [formats.slack];
    const gchatFormats = Array.isArray(formats.gchat)
      ? formats.gchat
      : [formats.gchat];

    const cleanedRaw = rawEmoji.replace(/^:|:$/g, "").toLowerCase();

    return (
      slackFormats.some((s) => s.toLowerCase() === cleanedRaw) ||
      gchatFormats.includes(rawEmoji)
    );
  }

  /**
   * Add or override emoji mappings.
   */
  extend(customMap: EmojiMapConfig): void {
    Object.assign(this.emojiMap, customMap);
    this.buildReverseMaps();
  }
}

/**
 * Default emoji resolver instance.
 */
export const defaultEmojiResolver = new EmojiResolver();
