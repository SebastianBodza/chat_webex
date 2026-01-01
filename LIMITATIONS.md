# Platform Limitations

This document outlines the capabilities and limitations of each chat platform adapter.

## Feature Support Matrix

| Feature | Slack | Teams | Google Chat |
|---------|:-----:|:-----:|:-----------:|
| `postMessage` | ✅ | ✅ | ✅ |
| `editMessage` | ✅ | ✅ | ✅ |
| `deleteMessage` | ✅ | ✅ | ✅ |
| `addReaction` | ✅ | ❌ | ✅ |
| `removeReaction` | ✅ | ❌ | ✅ |
| `startTyping` | ❌ | ✅ | ❌ |
| `fetchMessages` | ✅ | ❌ | ✅ |
| `fetchThread` | ✅ | ✅ | ✅ |

## Platform-Specific Details

### Slack

**Limitations:**
- **Typing indicators**: Slack does not provide an API for bots to show typing indicators. The `startTyping` method is a no-op.

**Notes:**
- Bot user ID is auto-discovered via `auth.test` API call during initialization
- Supports both `bot_id` and `user` fields for message author identification
- File attachments require appropriate OAuth scopes (`files:read`)

### Microsoft Teams

**Limitations:**
- **Reactions**: Teams Bot Framework does not expose reaction APIs. `addReaction` and `removeReaction` will throw `NotImplementedError`.
- **Typing indicators**: Supported via `ActivityTypes.Typing`
- **Message history**: Teams does not provide a bot API to fetch message history. `fetchMessages` will throw `NotImplementedError`.

**Notes:**
- Bot identification uses `appId` matching against `activity.from.id`
- Service URL varies by tenant and must be preserved per conversation
- Proactive messaging requires storing conversation references

### Google Chat

**Limitations:**
- **Typing indicators**: Google Chat does not provide an API for typing indicators. The `startTyping` method is a no-op.

**Notes:**
- Bot user ID is learned dynamically from message annotations (when bot is @mentioned)
- Supports both HTTP endpoint and Pub/Sub delivery modes
- Workspace Events API subscriptions are auto-managed for Pub/Sub mode
- `removeReaction` works by listing reactions and finding by emoji (extra API call)

## isMe Detection

Each adapter detects if a message is from the bot itself using a helper method `isMessageFromSelf()`:

### Slack
- Checks `event.user === botUserId` (primary - for messages sent as bot user)
- Checks `event.bot_id === botId` (secondary - for `bot_message` subtypes)
- Both IDs are fetched during `initialize()` via `auth.test`
- Returns `false` if neither ID is known (safe default)

### Teams
- Checks exact match: `activity.from.id === appId`
- Checks suffix match: `activity.from.id` ends with `:{appId}` (handles `28:{appId}` format)
- The app ID is always known from configuration
- Returns `false` if appId is not configured (safe default)

### Google Chat
- Checks exact match: `message.sender.name === botUserId`
- Bot user ID is learned dynamically from message annotations when bot is @mentioned
- **No fallback**: Returns `false` if bot ID is not yet learned (safer than assuming all BOT messages are from self)
- Bot ID is persisted to state for serverless environments

## Error Handling

All adapters throw errors on API failures. Specific error types:

- `RateLimitError`: Thrown when platform rate limits are exceeded (429 responses)
- `NotImplementedError`: Thrown when calling unsupported features

## Markdown Support

| Feature | Slack | Teams | Google Chat |
|---------|:-----:|:-----:|:-----------:|
| Bold | ✅ `*text*` | ✅ `**text**` | ✅ `*text*` |
| Italic | ✅ `_text_` | ✅ `_text_` | ✅ `_text_` |
| Strikethrough | ✅ `~text~` | ✅ `~~text~~` | ✅ `~text~` |
| Code | ✅ `` `code` `` | ✅ `` `code` `` | ✅ `` `code` `` |
| Code blocks | ✅ | ✅ | ✅ |
| Links | ✅ `<url\|text>` | ✅ `[text](url)` | ✅ `[text](url)` |
| Lists | ✅ | ✅ | ✅ |
| Blockquotes | ✅ `>` | ✅ `>` | ⚠️ Simulated with `>` prefix |
| Mentions | ✅ `<@USER>` | ✅ `<at>name</at>` | ✅ `<users/{id}>` |
