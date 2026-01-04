import { after } from "next/server";
import { createClient } from "redis";
import { bot } from "@/lib/bot";
import { recorder } from "@/lib/recorder";

export const maxDuration = 800;

const GATEWAY_CHANNEL = "discord:gateway:control";

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
  // Generate unique listener ID per request
  const listenerId = `listener-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[discord-gateway] Starting gateway listener: ${listenerId}`);

  // Ensure bot is initialized (this normally happens on first webhook)
  await bot.initialize();

  const discord = bot.getAdapter("discord");

  if (!discord) {
    console.log("[discord-gateway] Discord adapter not configured");
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
          if (message === listenerId) return;

          console.log(
            `[discord-gateway] ${listenerId} received shutdown signal from ${message}`,
          );
          abortController?.abort();
        });

        // Publish that we're starting (this will shut down other listeners)
        await pubClient.publish(GATEWAY_CHANNEL, listenerId);
        console.log(
          `[discord-gateway] Published startup signal: ${listenerId}`,
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
        console.log(`[discord-gateway] ${listenerId} pub/sub cleanup complete`);
      }
    });
  }

  try {
    console.log(`[discord-gateway] Calling startGatewayListener`);
    const response = await discord.startGatewayListener(
      {
        waitUntil: (task: Promise<unknown>) => after(() => task),
      },
      actualDuration,
      onGatewayEvent,
      abortController?.signal,
    );
    console.log(
      `[discord-gateway] startGatewayListener returned status: ${response.status}`,
    );
    return response;
  } catch (error) {
    console.error("[discord-gateway] Error in startGatewayListener:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to start gateway listener",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
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
