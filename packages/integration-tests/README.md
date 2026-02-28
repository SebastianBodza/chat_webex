# Integration Tests

Integration tests for the Chat SDK that verify real-world webhook payloads are handled correctly.

## Test Categories

- **Unit tests** (`slack.test.ts`, `teams.test.ts`, `gchat.test.ts`, `webex.test.ts`) - Test adapter functionality with mock payloads
- **Replay tests** (`replay*.test.ts`) - Replay actual production webhook recordings

## Replay Tests

Replay tests use recorded webhook payloads from production to verify the SDK handles real interactions correctly.

Webex limitation: Webex webhook payloads are envelope-only. The replay fixture must also persist the recorded Webex API responses (message/action/person/room snapshots) captured in the same Redis-backed recording session.

**See [fixtures/replay/README.md](./fixtures/replay/README.md) for:**
- How to record new fixtures
- Fixture format documentation
- SHA-based recording workflow
- Platform-specific webhook formats (including Webex)
- Webex fixture generation tutorial

## Running Tests

```bash
# Run all integration tests
pnpm --filter @chat-adapter/integration-tests test

# Run with watch mode
pnpm --filter @chat-adapter/integration-tests test:watch
```
