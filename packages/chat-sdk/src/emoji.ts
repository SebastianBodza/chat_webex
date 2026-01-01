import type {
  CustomEmojiMap,
  Emoji,
  EmojiFormats,
  EmojiMapConfig,
  WellKnownEmoji,
} from "./types";

/**
 * Default emoji map for well-known emoji.
 * Maps normalized emoji names to platform-specific formats.
 */
export const DEFAULT_EMOJI_MAP: Record<string, EmojiFormats> = {
  // Reactions & Gestures
  thumbs_up: { slack: ["+1", "thumbsup"], gchat: "👍" },
  thumbs_down: { slack: ["-1", "thumbsdown"], gchat: "👎" },
  clap: { slack: "clap", gchat: "👏" },
  wave: { slack: "wave", gchat: "👋" },
  pray: { slack: "pray", gchat: "🙏" },
  muscle: { slack: "muscle", gchat: "💪" },
  ok_hand: { slack: "ok_hand", gchat: "👌" },
  point_up: { slack: "point_up", gchat: "👆" },
  point_down: { slack: "point_down", gchat: "👇" },
  point_left: { slack: "point_left", gchat: "👈" },
  point_right: { slack: "point_right", gchat: "👉" },
  raised_hands: { slack: "raised_hands", gchat: "🙌" },
  shrug: { slack: "shrug", gchat: "🤷" },
  facepalm: { slack: "facepalm", gchat: "🤦" },

  // Emotions & Faces
  heart: { slack: "heart", gchat: ["❤️", "❤"] },
  smile: { slack: ["smile", "slightly_smiling_face"], gchat: "😊" },
  laugh: { slack: ["laughing", "satisfied", "joy"], gchat: ["😂", "😆"] },
  thinking: { slack: "thinking_face", gchat: "🤔" },
  sad: { slack: ["cry", "sad", "white_frowning_face"], gchat: "😢" },
  cry: { slack: "sob", gchat: "😭" },
  angry: { slack: "angry", gchat: "😠" },
  love_eyes: { slack: "heart_eyes", gchat: "😍" },
  cool: { slack: "sunglasses", gchat: "😎" },
  wink: { slack: "wink", gchat: "😉" },
  surprised: { slack: "open_mouth", gchat: "😮" },
  worried: { slack: "worried", gchat: "😟" },
  confused: { slack: "confused", gchat: "😕" },
  neutral: { slack: "neutral_face", gchat: "😐" },
  sleeping: { slack: "sleeping", gchat: "😴" },
  sick: { slack: "nauseated_face", gchat: "🤢" },
  mind_blown: { slack: "exploding_head", gchat: "🤯" },
  relieved: { slack: "relieved", gchat: "😌" },
  grimace: { slack: "grimacing", gchat: "😬" },
  rolling_eyes: { slack: "rolling_eyes", gchat: "🙄" },
  hug: { slack: "hugging_face", gchat: "🤗" },
  zany: { slack: "zany_face", gchat: "🤪" },

  // Status & Symbols
  check: {
    slack: ["white_check_mark", "heavy_check_mark"],
    gchat: ["✅", "✔️"],
  },
  x: { slack: ["x", "heavy_multiplication_x"], gchat: ["❌", "✖️"] },
  question: { slack: "question", gchat: ["❓", "?"] },
  exclamation: { slack: "exclamation", gchat: "❗" },
  warning: { slack: "warning", gchat: "⚠️" },
  stop: { slack: "octagonal_sign", gchat: "🛑" },
  info: { slack: "information_source", gchat: "ℹ️" },
  "100": { slack: "100", gchat: "💯" },
  fire: { slack: "fire", gchat: "🔥" },
  star: { slack: "star", gchat: "⭐" },
  sparkles: { slack: "sparkles", gchat: "✨" },
  lightning: { slack: "zap", gchat: "⚡" },
  boom: { slack: "boom", gchat: "💥" },
  eyes: { slack: "eyes", gchat: "👀" },

  // Status Indicators (colored circles)
  green_circle: { slack: "large_green_circle", gchat: "🟢" },
  yellow_circle: { slack: "large_yellow_circle", gchat: "🟡" },
  red_circle: { slack: "red_circle", gchat: "🔴" },
  blue_circle: { slack: "large_blue_circle", gchat: "🔵" },
  white_circle: { slack: "white_circle", gchat: "⚪" },
  black_circle: { slack: "black_circle", gchat: "⚫" },

  // Objects & Tools
  rocket: { slack: "rocket", gchat: "🚀" },
  party: { slack: ["tada", "partying_face"], gchat: ["🎉", "🥳"] },
  confetti: { slack: "confetti_ball", gchat: "🎊" },
  balloon: { slack: "balloon", gchat: "🎈" },
  gift: { slack: "gift", gchat: "🎁" },
  trophy: { slack: "trophy", gchat: "🏆" },
  medal: { slack: "first_place_medal", gchat: "🥇" },
  lightbulb: { slack: "bulb", gchat: "💡" },
  gear: { slack: "gear", gchat: "⚙️" },
  wrench: { slack: "wrench", gchat: "🔧" },
  hammer: { slack: "hammer", gchat: "🔨" },
  bug: { slack: "bug", gchat: "🐛" },
  link: { slack: "link", gchat: "🔗" },
  lock: { slack: "lock", gchat: "🔒" },
  unlock: { slack: "unlock", gchat: "🔓" },
  key: { slack: "key", gchat: "🔑" },
  pin: { slack: "pushpin", gchat: "📌" },
  memo: { slack: "memo", gchat: "📝" },
  clipboard: { slack: "clipboard", gchat: "📋" },
  calendar: { slack: "calendar", gchat: "📅" },
  clock: { slack: "clock1", gchat: "🕐" },
  hourglass: { slack: "hourglass", gchat: "⏳" },
  bell: { slack: "bell", gchat: "🔔" },
  megaphone: { slack: "mega", gchat: "📢" },
  speech_bubble: { slack: "speech_balloon", gchat: "💬" },
  email: { slack: "email", gchat: "📧" },
  inbox: { slack: "inbox_tray", gchat: "📥" },
  outbox: { slack: "outbox_tray", gchat: "📤" },
  package: { slack: "package", gchat: "📦" },
  folder: { slack: "file_folder", gchat: "📁" },
  file: { slack: "page_facing_up", gchat: "📄" },
  chart_up: { slack: "chart_with_upwards_trend", gchat: "📈" },
  chart_down: { slack: "chart_with_downwards_trend", gchat: "📉" },
  coffee: { slack: "coffee", gchat: "☕" },
  pizza: { slack: "pizza", gchat: "🍕" },
  beer: { slack: "beer", gchat: "🍺" },

  // Arrows & Directions
  arrow_up: { slack: "arrow_up", gchat: "⬆️" },
  arrow_down: { slack: "arrow_down", gchat: "⬇️" },
  arrow_left: { slack: "arrow_left", gchat: "⬅️" },
  arrow_right: { slack: "arrow_right", gchat: "➡️" },
  refresh: { slack: "arrows_counterclockwise", gchat: "🔄" },

  // Nature & Weather
  sun: { slack: "sunny", gchat: "☀️" },
  cloud: { slack: "cloud", gchat: "☁️" },
  rain: { slack: "rain_cloud", gchat: "🌧️" },
  snow: { slack: "snowflake", gchat: "❄️" },
  rainbow: { slack: "rainbow", gchat: "🌈" },
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

/** Placeholder pattern for emoji in text: {{emoji:name}} */
const EMOJI_PLACEHOLDER_REGEX = /\{\{emoji:([a-z0-9_]+)\}\}/gi;

/**
 * Convert emoji placeholders in text to platform-specific format.
 *
 * @example
 * ```typescript
 * convertEmojiPlaceholders("Thanks! {{emoji:thumbs_up}}", "slack");
 * // Returns: "Thanks! :+1:"
 *
 * convertEmojiPlaceholders("Thanks! {{emoji:thumbs_up}}", "gchat");
 * // Returns: "Thanks! 👍"
 * ```
 */
export function convertEmojiPlaceholders(
  text: string,
  platform: "slack" | "gchat" | "teams",
  resolver: EmojiResolver = defaultEmojiResolver,
): string {
  return text.replace(EMOJI_PLACEHOLDER_REGEX, (_, emojiName: string) => {
    switch (platform) {
      case "slack":
        return `:${resolver.toSlack(emojiName)}:`;
      case "gchat":
        return resolver.toGChat(emojiName);
      case "teams":
        // Teams uses unicode emoji
        return resolver.toGChat(emojiName);
      default:
        return resolver.toGChat(emojiName);
    }
  });
}

/** Type for emoji placeholder strings */
type EmojiPlaceholder<T extends string> = `{{emoji:${T}}}`;

/** Base emoji object with well-known emoji */
type BaseEmojiHelper = {
  [K in WellKnownEmoji]: EmojiPlaceholder<K>;
} & {
  custom: (name: string) => string;
};

/** Extended emoji object including custom emoji from module augmentation */
type ExtendedEmojiHelper = BaseEmojiHelper & {
  [K in keyof CustomEmojiMap]: EmojiPlaceholder<K & string>;
};

/**
 * Create a type-safe emoji helper with custom emoji.
 *
 * Custom emoji are automatically registered with the default resolver,
 * so placeholders will convert correctly in messages.
 *
 * @example
 * ```typescript
 * // First, extend the CustomEmojiMap type (usually in a .d.ts file)
 * declare module "chat-sdk" {
 *   interface CustomEmojiMap {
 *     unicorn: EmojiFormats;
 *     company_logo: EmojiFormats;
 *   }
 * }
 *
 * // Then create the emoji helper with your custom emoji
 * const emoji = createEmoji({
 *   unicorn: { slack: "unicorn_face", gchat: "🦄" },
 *   company_logo: { slack: "company", gchat: "🏢" },
 * });
 *
 * // Now you get type-safe access to custom emoji that auto-convert
 * await thread.post(`${emoji.unicorn} Magic!`);
 * // Slack: ":unicorn_face: Magic!"
 * // GChat: "🦄 Magic!"
 * ```
 */
export function createEmoji<
  T extends Record<
    string,
    { slack: string | string[]; gchat: string | string[] }
  >,
>(
  customEmoji?: T,
): BaseEmojiHelper & { [K in keyof T]: EmojiPlaceholder<K & string> } {
  const base: BaseEmojiHelper = {
    // Reactions & Gestures
    thumbs_up: "{{emoji:thumbs_up}}",
    thumbs_down: "{{emoji:thumbs_down}}",
    clap: "{{emoji:clap}}",
    wave: "{{emoji:wave}}",
    pray: "{{emoji:pray}}",
    muscle: "{{emoji:muscle}}",
    ok_hand: "{{emoji:ok_hand}}",
    point_up: "{{emoji:point_up}}",
    point_down: "{{emoji:point_down}}",
    point_left: "{{emoji:point_left}}",
    point_right: "{{emoji:point_right}}",
    raised_hands: "{{emoji:raised_hands}}",
    shrug: "{{emoji:shrug}}",
    facepalm: "{{emoji:facepalm}}",
    // Emotions & Faces
    heart: "{{emoji:heart}}",
    smile: "{{emoji:smile}}",
    laugh: "{{emoji:laugh}}",
    thinking: "{{emoji:thinking}}",
    sad: "{{emoji:sad}}",
    cry: "{{emoji:cry}}",
    angry: "{{emoji:angry}}",
    love_eyes: "{{emoji:love_eyes}}",
    cool: "{{emoji:cool}}",
    wink: "{{emoji:wink}}",
    surprised: "{{emoji:surprised}}",
    worried: "{{emoji:worried}}",
    confused: "{{emoji:confused}}",
    neutral: "{{emoji:neutral}}",
    sleeping: "{{emoji:sleeping}}",
    sick: "{{emoji:sick}}",
    mind_blown: "{{emoji:mind_blown}}",
    relieved: "{{emoji:relieved}}",
    grimace: "{{emoji:grimace}}",
    rolling_eyes: "{{emoji:rolling_eyes}}",
    hug: "{{emoji:hug}}",
    zany: "{{emoji:zany}}",
    // Status & Symbols
    check: "{{emoji:check}}",
    x: "{{emoji:x}}",
    question: "{{emoji:question}}",
    exclamation: "{{emoji:exclamation}}",
    warning: "{{emoji:warning}}",
    stop: "{{emoji:stop}}",
    info: "{{emoji:info}}",
    "100": "{{emoji:100}}",
    fire: "{{emoji:fire}}",
    star: "{{emoji:star}}",
    sparkles: "{{emoji:sparkles}}",
    lightning: "{{emoji:lightning}}",
    boom: "{{emoji:boom}}",
    eyes: "{{emoji:eyes}}",
    // Status Indicators
    green_circle: "{{emoji:green_circle}}",
    yellow_circle: "{{emoji:yellow_circle}}",
    red_circle: "{{emoji:red_circle}}",
    blue_circle: "{{emoji:blue_circle}}",
    white_circle: "{{emoji:white_circle}}",
    black_circle: "{{emoji:black_circle}}",
    // Objects & Tools
    rocket: "{{emoji:rocket}}",
    party: "{{emoji:party}}",
    confetti: "{{emoji:confetti}}",
    balloon: "{{emoji:balloon}}",
    gift: "{{emoji:gift}}",
    trophy: "{{emoji:trophy}}",
    medal: "{{emoji:medal}}",
    lightbulb: "{{emoji:lightbulb}}",
    gear: "{{emoji:gear}}",
    wrench: "{{emoji:wrench}}",
    hammer: "{{emoji:hammer}}",
    bug: "{{emoji:bug}}",
    link: "{{emoji:link}}",
    lock: "{{emoji:lock}}",
    unlock: "{{emoji:unlock}}",
    key: "{{emoji:key}}",
    pin: "{{emoji:pin}}",
    memo: "{{emoji:memo}}",
    clipboard: "{{emoji:clipboard}}",
    calendar: "{{emoji:calendar}}",
    clock: "{{emoji:clock}}",
    hourglass: "{{emoji:hourglass}}",
    bell: "{{emoji:bell}}",
    megaphone: "{{emoji:megaphone}}",
    speech_bubble: "{{emoji:speech_bubble}}",
    email: "{{emoji:email}}",
    inbox: "{{emoji:inbox}}",
    outbox: "{{emoji:outbox}}",
    package: "{{emoji:package}}",
    folder: "{{emoji:folder}}",
    file: "{{emoji:file}}",
    chart_up: "{{emoji:chart_up}}",
    chart_down: "{{emoji:chart_down}}",
    coffee: "{{emoji:coffee}}",
    pizza: "{{emoji:pizza}}",
    beer: "{{emoji:beer}}",
    // Arrows & Directions
    arrow_up: "{{emoji:arrow_up}}",
    arrow_down: "{{emoji:arrow_down}}",
    arrow_left: "{{emoji:arrow_left}}",
    arrow_right: "{{emoji:arrow_right}}",
    refresh: "{{emoji:refresh}}",
    // Nature & Weather
    sun: "{{emoji:sun}}",
    cloud: "{{emoji:cloud}}",
    rain: "{{emoji:rain}}",
    snow: "{{emoji:snow}}",
    rainbow: "{{emoji:rainbow}}",
    // Custom
    custom: (name: string): string => `{{emoji:${name}}}`,
  };

  if (customEmoji) {
    // Add custom emoji to the helper object
    for (const key of Object.keys(customEmoji)) {
      (base as unknown as Record<string, string>)[key] = `{{emoji:${key}}}`;
    }
    // Extend the default resolver so placeholders convert correctly
    defaultEmojiResolver.extend(customEmoji as EmojiMapConfig);
  }

  return base as BaseEmojiHelper & {
    [K in keyof T]: EmojiPlaceholder<K & string>;
  };
}

/**
 * Type-safe emoji helper for embedding emoji in messages.
 *
 * @example
 * ```typescript
 * import { emoji } from "chat-sdk";
 *
 * await thread.post(`Great job! ${emoji.thumbs_up} ${emoji.fire}`);
 * // Slack: "Great job! :+1: :fire:"
 * // GChat: "Great job! 👍 🔥"
 * ```
 *
 * For custom emoji, use `createEmoji()` with module augmentation:
 * @example
 * ```typescript
 * // types.d.ts
 * declare module "chat-sdk" {
 *   interface CustomEmojiMap {
 *     unicorn: EmojiFormats;
 *   }
 * }
 *
 * // bot.ts
 * const emoji = createEmoji({ unicorn: { slack: "unicorn", gchat: "🦄" } });
 * await thread.post(`${emoji.unicorn} Magic!`);
 * ```
 */
export const emoji: ExtendedEmojiHelper = createEmoji() as ExtendedEmojiHelper;
