# @chat-adapter/webex

[![npm version](https://img.shields.io/npm/v/@chat-adapter/webex)](https://www.npmjs.com/package/@chat-adapter/webex)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/webex)](https://www.npmjs.com/package/@chat-adapter/webex)

Webex adapter for [Chat SDK](https://chat-sdk.dev/docs).

## Installation

```bash
npm install chat @chat-adapter/webex
```

## Usage

```typescript
import { Chat } from "chat";
import { createWebexAdapter } from "@chat-adapter/webex";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    webex: createWebexAdapter({
      botToken: process.env.WEBEX_BOT_TOKEN!,
      webhookSecret: process.env.WEBEX_WEBHOOK_SECRET,
    }),
  },
});

bot.onNewMention(async (thread) => {
  await thread.post("Hello from Webex!");
});
```

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/webex](https://chat-sdk.dev/docs/adapters/webex).

## License

MIT
