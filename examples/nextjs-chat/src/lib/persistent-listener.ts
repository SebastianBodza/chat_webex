import { createClient } from "redis";

/**
 * Configuration for a persistent listener.
 */
export interface PersistentListenerConfig {
  /** Unique name for this listener type (used for Redis channel) */
  name: string;
  /** Redis URL for cross-instance coordination (optional) */
  redisUrl?: string;
  /** Default duration in milliseconds */
  defaultDurationMs: number;
  /** Maximum duration in milliseconds */
  maxDurationMs: number;
}

/**
 * Options passed to the listener function.
 */
export interface ListenerOptions {
  /** Signal that fires when the listener should stop */
  abortSignal: AbortSignal;
  /** Unique ID for this listener instance */
  listenerId: string;
  /** Duration this listener should run */
  durationMs: number;
}

/**
 * Result from starting a persistent listener.
 */
export type ListenerResult =
  | { type: "completed"; response: Response }
  | { type: "handoff"; previousListener: string }
  | { type: "adopted"; previousListener: string };

/**
 * Global state for warm start optimization.
 * Keyed by listener name to support multiple listener types.
 */
const activeListeners = new Map<
  string,
  {
    listenerId: string;
    abortController: AbortController;
    handoff: () => void;
    startTime: number;
  }
>();

/**
 * Creates a persistent listener manager for serverless environments.
 *
 * Features:
 * - Warm start optimization: reuses existing connections when hitting the same instance
 * - Cross-instance coordination via Redis pub/sub
 * - Graceful handoff between invocations
 *
 * @example
 * ```ts
 * const listener = createPersistentListener({
 *   name: "discord-gateway",
 *   redisUrl: process.env.REDIS_URL,
 *   defaultDurationMs: 600_000,
 *   maxDurationMs: 600_000,
 * });
 *
 * export async function GET(request: Request) {
 *   return listener.start(request, {
 *     afterTask: (task) => after(() => task),
 *     run: async ({ abortSignal, durationMs }) => {
 *       // Your long-running logic here
 *       return new Response("OK");
 *     },
 *   });
 * }
 * ```
 */
export function createPersistentListener(config: PersistentListenerConfig) {
  const { name, redisUrl, defaultDurationMs, maxDurationMs } = config;
  const redisChannel = `persistent-listener:${name}:control`;

  return {
    /**
     * Start the persistent listener.
     */
    async start(
      request: Request,
      options: {
        /** Function to schedule background tasks (e.g., Next.js `after`) */
        afterTask: (task: Promise<unknown>) => void;
        /** The actual listener logic to run */
        run: (opts: ListenerOptions) => Promise<Response>;
        /** Optional: get duration from request (default: query param `duration`) */
        getDuration?: (request: Request) => number | undefined;
      },
    ): Promise<Response> {
      const { afterTask, run, getDuration } = options;

      // Generate unique listener ID
      const listenerId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Check for warm start - can we adopt an existing connection?
      const existing = activeListeners.get(name);
      if (existing) {
        const elapsed = Date.now() - existing.startTime;
        console.log(
          `[${name}] Warm start detected! Adopting from ${existing.listenerId} (running ${Math.round(elapsed / 1000)}s)`,
        );

        // Signal the old invocation to return
        existing.handoff();

        // Update state but keep the same abort controller and connection
        const oldListenerId = existing.listenerId;
        existing.listenerId = listenerId;
        existing.startTime = Date.now();

        // Create new handoff promise for this invocation
        let handoffResolve: () => void = () => {};
        const handoffPromise = new Promise<void>((resolve) => {
          handoffResolve = resolve;
        });
        existing.handoff = handoffResolve;

        // Wait for next handoff or abort
        afterTask(
          Promise.race([
            handoffPromise,
            new Promise<void>((resolve) => {
              existing.abortController.signal.addEventListener(
                "abort",
                () => resolve(),
                { once: true },
              );
            }),
          ]).then(() => {
            console.log(`[${name}] ${listenerId} handoff/abort received`);
          }),
        );

        return new Response(
          JSON.stringify({
            ok: true,
            listenerId,
            adopted: true,
            previousListener: oldListenerId,
            message: `Adopted existing ${name} connection (warm start)`,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      console.log(
        `[${name}] Cold start, creating new connection: ${listenerId}`,
      );

      // Parse duration from request
      const requestedDuration = getDuration
        ? getDuration(request)
        : (() => {
            const url = new URL(request.url);
            const param = url.searchParams.get("duration");
            return param ? parseInt(param, 10) : undefined;
          })();
      const durationMs = Math.min(
        requestedDuration ?? defaultDurationMs,
        maxDurationMs,
      );

      // Set up abort controller and handoff promise
      const abortController = new AbortController();
      let handoffResolve: () => void = () => {};
      const handoffPromise = new Promise<void>((resolve) => {
        handoffResolve = resolve;
      });

      // Initialize global state for warm start optimization
      activeListeners.set(name, {
        listenerId,
        abortController,
        handoff: handoffResolve,
        startTime: Date.now(),
      });

      // Set up Redis pub/sub for cross-instance coordination
      if (redisUrl) {
        afterTask(
          this.setupRedisPubSub(
            redisUrl,
            redisChannel,
            listenerId,
            durationMs,
            abortController,
          ),
        );
      }

      try {
        // Start the listener
        const listenerPromise = run({
          abortSignal: abortController.signal,
          listenerId,
          durationMs,
        });

        // Race between: listener completing, or handoff to warm start
        const result = await Promise.race([
          listenerPromise.then((response) => ({
            type: "completed" as const,
            response,
          })),
          handoffPromise.then(() => ({ type: "handoff" as const })),
        ]);

        if (result.type === "handoff") {
          console.log(`[${name}] ${listenerId} handed off to warm start`);
          return new Response(
            JSON.stringify({
              ok: true,
              listenerId,
              handedOff: true,
              message: "Connection handed off to warm start invocation",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        // Clean up if we're still the active listener
        const current = activeListeners.get(name);
        if (current?.listenerId === listenerId) {
          activeListeners.delete(name);
        }

        return result.response;
      } catch (error) {
        // Clean up on error
        const current = activeListeners.get(name);
        if (current?.listenerId === listenerId) {
          activeListeners.delete(name);
        }

        console.error(`[${name}] Error in listener:`, error);
        return new Response(
          JSON.stringify({
            error: `Failed to start ${name} listener`,
            message: error instanceof Error ? error.message : String(error),
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    },

    /**
     * Set up Redis pub/sub for cross-instance coordination.
     */
    async setupRedisPubSub(
      redisUrl: string,
      channel: string,
      listenerId: string,
      durationMs: number,
      abortController: AbortController,
    ): Promise<void> {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();

      try {
        await Promise.all([pubClient.connect(), subClient.connect()]);

        // Subscribe to shutdown signals from other instances
        await subClient.subscribe(channel, (message) => {
          if (message === listenerId) return;
          // Ignore if we've been adopted by a warm start
          const current = activeListeners.get(name);
          if (current && current.listenerId !== listenerId) return;

          console.log(
            `[${name}] ${listenerId} received shutdown signal from ${message}`,
          );
          abortController.abort();
        });

        // Publish that we're starting (shuts down listeners on other instances)
        await pubClient.publish(channel, listenerId);
        console.log(`[${name}] Published startup signal: ${listenerId}`);

        // Keep subscription alive until abort or timeout
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, durationMs + 5000);
          abortController.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });
      } catch (error) {
        console.error(`[${name}] Redis pub/sub error:`, error);
      } finally {
        await subClient.unsubscribe(channel).catch(() => {});
        await Promise.all([
          pubClient.quit().catch(() => {}),
          subClient.quit().catch(() => {}),
        ]);
        console.log(`[${name}] ${listenerId} pub/sub cleanup complete`);
      }
    },
  };
}
