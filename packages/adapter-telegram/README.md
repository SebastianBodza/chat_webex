# @chat-adapter/telegram

[![npm version](https://img.shields.io/npm/v/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)
[![npm downloads](https://img.shields.io/npm/dm/@chat-adapter/telegram)](https://www.npmjs.com/package/@chat-adapter/telegram)

Telegram adapter for [Chat SDK](https://chat-sdk.dev/docs).

## Installation

```bash
npm install chat @chat-adapter/telegram
```

## Usage

```typescript
import { Chat } from "chat";
import { createTelegramAdapter } from "@chat-adapter/telegram";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    telegram: createTelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
    }),
  },
});
```

Features include mentions, reactions, typing indicators, file uploads, and card fallback rendering with inline keyboard buttons for card actions.

## Documentation

Full setup instructions, configuration reference, and features at [chat-sdk.dev/docs/adapters/telegram](https://chat-sdk.dev/docs/adapters/telegram).

## License

MIT
