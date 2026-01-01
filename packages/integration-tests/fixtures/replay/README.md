# Replay Test Fixtures

These fixtures contain recorded production webhook payloads used by `replay.test.ts`.

## Updating Fixtures

### 1. Record a session in production

Set environment variables in your deployed app:
```bash
RECORDING_ENABLED=true
RECORDING_SESSION_ID=my-session  # optional, auto-generated if omitted
```

### 2. Interact with the bot

Perform the interaction you want to test:
1. @mention the bot in a channel/space
2. Send follow-up messages in the thread

### 3. Export the recording

```bash
cd examples/nextjs-chat

# List available sessions
pnpm recording:list

# Export a session to JSON
pnpm recording:export my-session > /path/to/output.json
```

### 4. Extract webhook payloads

From the exported JSON, find entries with `"type": "webhook"` and copy the `body` field (parsed as JSON) to the appropriate fixture file.

**For @mention:** Find the first webhook from a human user
**For follow-up:** Find subsequent webhooks in the same thread

### 5. Update fixture metadata

Each fixture file has metadata at the top:
- `botName` - Display name of your bot
- `botUserId` - Platform-specific bot user ID
- `appId` (Teams only) - Microsoft App ID

## Fixture Structure

```json
{
  "botName": "My Bot",
  "botUserId": "U123...",
  "mention": { /* webhook body for @mention */ },
  "followUp": { /* webhook body for follow-up message */ }
}
```

## Platform-Specific Notes

### Google Chat
- `mention`: Direct webhook in Add-ons format (has `chat.messagePayload`)
- `followUp`: Pub/Sub webhook (has `message.data` as base64)

### Slack
- Both webhooks are `event_callback` type
- `mention`: Message with bot user mention in text (`<@UBOTID>`)
- `followUp`: Message with `thread_ts` matching the mention's `ts`

### Teams
- Both are Bot Framework Activity payloads
- `mention`: Has `entities` array with bot mention
- `followUp`: Same `conversation.id` as mention, no bot in entities
