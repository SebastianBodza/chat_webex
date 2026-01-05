# @chat-adapter/slack

Slack adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/slack
```

## Usage

```typescript
import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    slack: createSlackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Slack!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `botToken` | Yes | Slack bot token (starts with `xoxb-`) |
| `signingSecret` | Yes | Slack signing secret for webhook verification |

## Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

## Slack App Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Enter app name and select workspace
4. Click **Create App**

### 2. Configure Bot Token Scopes

1. Go to **OAuth & Permissions** in the sidebar
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `app_mentions:read` - Receive @mention events
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info
   - `chat:write` - Send messages
   - `groups:history` - Read messages in private channels
   - `groups:read` - View basic private channel info
   - `im:history` - Read direct messages
   - `im:read` - View basic DM info
   - `reactions:read` - View emoji reactions
   - `reactions:write` - Add/remove emoji reactions
   - `users:read` - View user info (for display names)

### 3. Install App to Workspace

1. Go to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Authorize the app
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → `SLACK_BOT_TOKEN`

### 4. Get Signing Secret

1. Go to **Basic Information**
2. Under **App Credentials**, copy **Signing Secret** → `SLACK_SIGNING_SECRET`

### 5. Configure Event Subscriptions

1. Go to **Event Subscriptions**
2. Toggle **Enable Events** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack`
   - Slack will verify the URL immediately
4. Under **Subscribe to bot events**, add:
   - `app_mention` - When someone @mentions your bot
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
5. Click **Save Changes**

### 6. (Optional) Enable Interactivity

If you want to use buttons, modals, or other interactive components:

1. Go to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to On
3. Set **Request URL** to: `https://your-domain.com/api/webhooks/slack`

## Features

- Message posting and editing
- Thread subscriptions
- Reaction handling (add/remove/events)
- File attachments
- Rich cards (Block Kit)
- Action callbacks (interactive components)
- Direct messages

## Troubleshooting

### "Invalid signature" error
- Verify `SLACK_SIGNING_SECRET` is correct
- Check that the request timestamp is within 5 minutes (clock sync issue)

### Bot not responding to messages
- Verify Event Subscriptions are configured
- Check that the bot has been added to the channel
- Ensure the webhook URL is correct and accessible

## License

MIT
