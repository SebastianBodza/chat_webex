import { after } from "next/server";
import { createClient } from "redis";
import { bot } from "@/lib/bot";
import { recorder } from "@/lib/recorder";

export const maxDuration = 800;

const GATEWAY_CHANNEL = "discord:gateway:control";
const LISTENER_ID = `listener-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Start the Discord Gateway WebSocket listener.
 * This keeps a WebSocket connection open for up to 180 seconds to receive messages.
 *
 * Uses Redis pub/sub to coordinate multiple listeners:
 * - When a new listener starts, it publishes a message to shut down existing listeners
 * - Existing listeners subscribe and gracefully shut down when they receive the message
 *
 * Usage: POST /api/discord/gateway
 * Optional query param: ?duration=180000 (milliseconds)
 */
export async function POST(request: Request): Promise<Response> {
  const discord = bot.getAdapter("discord");

  if (!discord) {
    return new Response("Discord adapter not configured", { status: 404 });
  }

  // Get duration from query params (default: 180 seconds)
  const url = new URL(request.url);
  const durationParam = url.searchParams.get("duration");
  const durationMs = durationParam ? parseInt(durationParam, 10) : 180000;

  // Cap at 10 minutes to avoid runaway costs
  const maxDurationMs = 600 * 1000;
  const actualDuration = Math.min(durationMs, maxDurationMs);

  // Create Gateway event recorder callback
  const onGatewayEvent = recorder.isEnabled
    ? (eventType: string, data: unknown) => {
        // Fire and forget - don't block message handling
        recorder.recordGatewayEvent("discord", eventType, data).catch(() => {});
      }
    : undefined;

  // Set up Redis pub/sub for listener coordination
  let abortController: AbortController | undefined;

  if (process.env.REDIS_URL) {
    abortController = new AbortController();

    // Run the pub/sub coordination in the background
    after(async () => {
      const pubClient = createClient({ url: process.env.REDIS_URL });
      const subClient = pubClient.duplicate();

      try {
        await Promise.all([pubClient.connect(), subClient.connect()]);

        // Subscribe to shutdown signals
        await subClient.subscribe(GATEWAY_CHANNEL, (message) => {
          // Ignore our own startup message
          if (message === LISTENER_ID) return;

          console.log(
            `[discord-gateway] Received shutdown signal from ${message}, stopping this listener`,
          );
          abortController?.abort();
        });

        // Publish that we're starting (this will shut down other listeners)
        await pubClient.publish(GATEWAY_CHANNEL, LISTENER_ID);
        console.log(
          `[discord-gateway] Published startup signal: ${LISTENER_ID}`,
        );

        // Keep subscription alive until abort or timeout
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, actualDuration + 5000);

          abortController?.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
      } catch (error) {
        console.error("[discord-gateway] Redis pub/sub error:", error);
      } finally {
        await subClient.unsubscribe(GATEWAY_CHANNEL).catch(() => {});
        await Promise.all([
          pubClient.quit().catch(() => {}),
          subClient.quit().catch(() => {}),
        ]);
      }
    });
  }

  return discord.startGatewayListener(
    {
      waitUntil: (task: Promise<unknown>) => after(() => task),
    },
    actualDuration,
    onGatewayEvent,
    abortController?.signal,
  );
}

/**
 * Health check for Gateway endpoint
 */
export async function GET(): Promise<Response> {
  const discord = bot.getAdapter("discord");

  if (!discord) {
    return new Response("Discord adapter not configured", { status: 404 });
  }

  return new Response(
    JSON.stringify({
      status: "ready",
      message:
        "POST to this endpoint to start Gateway listener. Use ?duration=<ms> to set duration (max 600000ms).",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
