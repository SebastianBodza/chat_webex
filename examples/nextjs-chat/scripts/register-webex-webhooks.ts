import { config as loadEnv } from "dotenv";

const DEFAULT_WEBEX_API_BASE = "https://webexapis.com/v1";
const DEFAULT_WEBHOOK_PATH = "/api/webhooks/webex";
const DEFAULT_NAME_PREFIX = "chat-sdk-webex";

type WebhookResource = "messages" | "attachmentActions";
type WebhookEvent = "created";

interface WebhookConfig {
  event: WebhookEvent;
  filter?: string;
  name: string;
  resource: WebhookResource;
}

interface WebexWebhook {
  event: string;
  id: string;
  name: string;
  resource: string;
  targetUrl: string;
}

interface WebexWebhookCollectionResponse {
  items?: WebexWebhook[];
}

interface RegisterOptions {
  dryRun: boolean;
  help: boolean;
}

function readEnv() {
  // Prefer .env.local when present, then fall back to .env.
  loadEnv({ path: ".env.local" });
  loadEnv({ path: ".env" });
}

function usageAndExit(message?: string, exitCode = 1): never {
  if (message) {
    console.error(`Error: ${message}`);
  }

  console.log(`
Usage:
  pnpm --filter example-nextjs-chat webex:webhooks [publicBaseUrl] [--dry-run]

Environment:
  WEBEX_BOT_TOKEN                  Required. Bot token used for Webex API calls.
  WEBEX_WEBHOOK_SECRET             Required. Shared secret for webhook signatures.
  WEBEX_WEBHOOK_BASE_URL           Optional. Public base URL (ngrok URL). Can pass as first CLI arg.
  WEBEX_WEBHOOK_PATH               Optional. Defaults to ${DEFAULT_WEBHOOK_PATH}
  WEBEX_WEBHOOK_URL                Optional. Full target URL (overrides BASE_URL + PATH).
  WEBEX_WEBHOOK_NAME_PREFIX        Optional. Defaults to ${DEFAULT_NAME_PREFIX}
  WEBEX_WEBHOOK_MESSAGES_FILTER    Optional. e.g. roomId=<ROOM_ID>
  WEBEX_WEBHOOK_ACTIONS_FILTER     Optional. e.g. roomId=<ROOM_ID>
  WEBEX_API_BASE_URL               Optional. Defaults to ${DEFAULT_WEBEX_API_BASE}
`);

  process.exit(exitCode);
}

function trimTrailingSlash(input: string): string {
  return input.replace(/\/+$/, "");
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  const links = linkHeader.split(",").map((part) => part.trim());
  for (const link of links) {
    const match = link.match(/^<([^>]+)>\s*;\s*rel="?next"?$/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function parseCliArgs(args: string[]): {
  options: RegisterOptions;
  publicBaseUrlArg?: string;
} {
  let publicBaseUrlArg: string | undefined;
  const options: RegisterOptions = { dryRun: false, help: false };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      usageAndExit(`Unknown flag: ${arg}`);
    }
    if (!publicBaseUrlArg) {
      publicBaseUrlArg = arg;
      continue;
    }
    usageAndExit(`Unexpected argument: ${arg}`);
  }

  return { options, publicBaseUrlArg };
}

async function webexRequest<T>(input: {
  apiBaseUrl: string;
  body?: Record<string, unknown>;
  method: "DELETE" | "GET" | "POST" | "PUT";
  pathOrUrl: string;
  token: string;
}): Promise<{ data: T; headers: Headers }> {
  const url = input.pathOrUrl.startsWith("http")
    ? input.pathOrUrl
    : `${input.apiBaseUrl}${input.pathOrUrl}`;

  const response = await fetch(url, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `Webex API ${input.method} ${url} failed (${response.status}): ${responseText}`
    );
  }

  const data = responseText ? (JSON.parse(responseText) as T) : ({} as T);
  return { data, headers: response.headers };
}

async function listAllWebhooks(input: {
  apiBaseUrl: string;
  token: string;
}): Promise<WebexWebhook[]> {
  const hooks: WebexWebhook[] = [];
  let nextUrl: string | null = `${input.apiBaseUrl}/webhooks?max=100`;
  const seenUrls = new Set<string>();

  while (nextUrl) {
    if (seenUrls.has(nextUrl)) {
      break;
    }
    seenUrls.add(nextUrl);

    const { data, headers } = await webexRequest<WebexWebhookCollectionResponse>(
      {
        apiBaseUrl: input.apiBaseUrl,
        method: "GET",
        pathOrUrl: nextUrl,
        token: input.token,
      }
    );

    hooks.push(...(data.items || []));
    nextUrl = parseNextLink(headers.get("link"));
  }

  return hooks;
}

function buildWebhookBody(input: {
  config: WebhookConfig;
  secret: string;
  targetUrl: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.config.name,
    targetUrl: input.targetUrl,
    resource: input.config.resource,
    event: input.config.event,
    secret: input.secret,
  };

  if (input.config.filter) {
    body.filter = input.config.filter;
  }

  return body;
}

async function upsertWebhook(input: {
  apiBaseUrl: string;
  config: WebhookConfig;
  dryRun: boolean;
  existing: WebexWebhook[];
  secret: string;
  targetUrl: string;
  token: string;
}): Promise<void> {
  const existingMatch = input.existing.find((hook) => hook.name === input.config.name);
  const body = buildWebhookBody({
    config: input.config,
    secret: input.secret,
    targetUrl: input.targetUrl,
  });

  if (existingMatch) {
    if (input.dryRun) {
      console.log(`[dry-run] Would update webhook ${existingMatch.id} (${input.config.name})`);
      return;
    }

    await webexRequest({
      apiBaseUrl: input.apiBaseUrl,
      method: "PUT",
      pathOrUrl: `/webhooks/${existingMatch.id}`,
      token: input.token,
      body,
    });
    console.log(`Updated webhook: ${input.config.name}`);
    return;
  }

  if (input.dryRun) {
    console.log(`[dry-run] Would create webhook (${input.config.name})`);
    return;
  }

  await webexRequest({
    apiBaseUrl: input.apiBaseUrl,
    method: "POST",
    pathOrUrl: "/webhooks",
    token: input.token,
    body,
  });
  console.log(`Created webhook: ${input.config.name}`);
}

async function main(): Promise<void> {
  readEnv();

  const { options, publicBaseUrlArg } = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    usageAndExit(undefined, 0);
  }

  const token = process.env.WEBEX_BOT_TOKEN;
  const secret = process.env.WEBEX_WEBHOOK_SECRET;
  if (!token) {
    usageAndExit("WEBEX_BOT_TOKEN is required");
  }
  if (!secret) {
    usageAndExit("WEBEX_WEBHOOK_SECRET is required");
  }

  const apiBaseUrl = trimTrailingSlash(
    process.env.WEBEX_API_BASE_URL || DEFAULT_WEBEX_API_BASE
  );
  const webhookPath = process.env.WEBEX_WEBHOOK_PATH || DEFAULT_WEBHOOK_PATH;
  const configuredTargetUrl = process.env.WEBEX_WEBHOOK_URL;
  const publicBaseUrl =
    process.env.WEBEX_WEBHOOK_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    publicBaseUrlArg;

  const targetUrl = configuredTargetUrl
    ? configuredTargetUrl
    : publicBaseUrl
      ? `${trimTrailingSlash(publicBaseUrl)}${webhookPath.startsWith("/") ? "" : "/"}${webhookPath}`
      : undefined;

  if (!targetUrl) {
    usageAndExit(
      "Provide WEBEX_WEBHOOK_URL, WEBEX_WEBHOOK_BASE_URL, PUBLIC_BASE_URL, or a public base URL arg"
    );
  }

  const namePrefix = process.env.WEBEX_WEBHOOK_NAME_PREFIX || DEFAULT_NAME_PREFIX;
  const desiredWebhooks: WebhookConfig[] = [
    {
      name: `${namePrefix}-messages-created`,
      resource: "messages",
      event: "created",
      filter: process.env.WEBEX_WEBHOOK_MESSAGES_FILTER,
    },
    {
      name: `${namePrefix}-attachment-actions-created`,
      resource: "attachmentActions",
      event: "created",
      filter: process.env.WEBEX_WEBHOOK_ACTIONS_FILTER,
    },
  ];

  console.log("Registering Webex webhooks with config:");
  console.log(
    JSON.stringify(
      {
        apiBaseUrl,
        dryRun: options.dryRun,
        names: desiredWebhooks.map((hook) => hook.name),
        targetUrl,
      },
      null,
      2
    )
  );

  const existing = await listAllWebhooks({ apiBaseUrl, token });
  for (const config of desiredWebhooks) {
    await upsertWebhook({
      apiBaseUrl,
      config,
      dryRun: options.dryRun,
      existing,
      secret,
      targetUrl,
      token,
    });
  }

  if (options.dryRun) {
    console.log("Dry run complete. No changes were sent to Webex.");
  } else {
    console.log("Webhook registration complete.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
