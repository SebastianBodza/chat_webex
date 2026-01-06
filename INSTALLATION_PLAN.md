# Native App Installation Plan

This document outlines how to make Chat SDK bots installable as native apps on each platform, with the goal of minimizing setup friction and supporting multi-tenant deployments.

## Overview

| Platform | Current State | Target State |
|----------|--------------|--------------|
| Slack | Single workspace, manual token | "Add to Slack" button, multi-workspace |
| Teams | Manual manifest + sideload | Manifest generator, org deployment |
| Google Chat | Service account + impersonation | Setup wizard, Marketplace ready |
| Discord | Manual token + interactions only | Invite link generator, full Gateway |

---

## Slack: "Add to Slack" Flow

### Current Limitations
- Requires manually copying `xoxb-` token from Slack app settings
- Single workspace only
- No OAuth callback handling

### Target Experience
```
1. Developer configures Client ID + Client Secret
2. SDK generates "Add to Slack" button/URL
3. User clicks → authorizes → redirected back
4. SDK stores workspace token automatically
5. Bot works in that workspace immediately
```

### Implementation

**New Config Options:**
```typescript
interface SlackAdapterConfig {
  // Existing (single workspace)
  botToken?: string;
  signingSecret: string;

  // New (multi-workspace distribution)
  oauth?: {
    clientId: string;
    clientSecret: string;
    scopes: string[];           // Bot scopes
    redirectUri: string;
    installationStore: InstallationStore;
  };
}
```

**Installation Store Interface:**
```typescript
interface InstallationStore {
  // Store installation when user authorizes
  storeInstallation(installation: SlackInstallation): Promise<void>;

  // Fetch installation by team ID (from incoming webhook)
  fetchInstallation(teamId: string): Promise<SlackInstallation | null>;

  // Remove installation (bot removed from workspace)
  deleteInstallation(teamId: string): Promise<void>;
}

interface SlackInstallation {
  teamId: string;
  teamName: string;
  botToken: string;        // xoxb-...
  botUserId: string;
  botId: string;
  installedAt: Date;
  installerUserId?: string;
}
```

**New Adapter Methods:**
```typescript
interface SlackAdapter {
  // Generate "Add to Slack" URL
  getInstallUrl(state?: string): string;

  // Handle OAuth callback (exchange code for token)
  handleInstallCallback(request: Request): Promise<SlackInstallation>;

  // Webhook handler now looks up token per workspace
  handleWebhook(request: Request): Promise<Response>;
}
```

**Route Setup:**
```typescript
// app/api/slack/install/route.ts
export async function GET() {
  const url = slack.getInstallUrl();
  return Response.redirect(url);
}

// app/api/slack/oauth/callback/route.ts
export async function GET(request: Request) {
  const installation = await slack.handleInstallCallback(request);
  return Response.redirect('/installed?team=' + installation.teamId);
}
```

### Required Scopes
```
app_mentions:read    - Receive @mentions
channels:history     - Read channel messages (for subscribed threads)
channels:read        - List channels
chat:write           - Send messages
groups:history       - Read private channel messages
groups:read          - List private channels
im:history           - Read DM messages
im:read              - List DMs
reactions:read       - Receive reaction events
reactions:write      - Add reactions
users:read           - Get user info
```

### Multi-Workspace Webhook Handling
```typescript
async handleWebhook(request: Request): Promise<Response> {
  // 1. Verify signature (uses signing secret, same for all workspaces)
  await this.verifySignature(request);

  // 2. Parse payload to get team_id
  const payload = await this.parsePayload(request);
  const teamId = payload.team_id;

  // 3. Fetch installation (gets workspace-specific bot token)
  const installation = await this.oauth.installationStore.fetchInstallation(teamId);
  if (!installation) {
    return new Response('App not installed in this workspace', { status: 404 });
  }

  // 4. Use installation's bot token for API calls
  this.currentBotToken = installation.botToken;

  // 5. Process message as normal
  return this.processWebhook(payload);
}
```

---

## Microsoft Teams: Manifest Generator

### Current Limitations
- Manual manifest.json creation
- Must manually zip with icons
- Complex Azure setup

### Target Experience
```
1. Developer provides Azure credentials
2. SDK generates manifest.json
3. SDK provides icons or uses defaults
4. Developer uploads zip to Teams
```

### Implementation

**Manifest Generator:**
```typescript
interface TeamsManifestConfig {
  // Required
  name: string;
  description: {
    short: string;   // Max 80 chars
    full: string;    // Max 4000 chars
  };

  // Azure credentials
  appId: string;     // Microsoft App ID

  // Optional
  accentColor?: string;
  developerName?: string;
  developerUrl?: string;
  privacyUrl?: string;
  termsOfUseUrl?: string;

  // Bot configuration
  botEndpoint: string;  // e.g., https://yourapp.com/api/webhooks/teams

  // Scopes: where can bot be used?
  scopes?: ('personal' | 'team' | 'groupchat')[];
}

function generateTeamsManifest(config: TeamsManifestConfig): TeamsManifest {
  return {
    "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    "manifestVersion": "1.17",
    "version": "1.0.0",
    "id": config.appId,
    "developer": {
      "name": config.developerName ?? "Developer",
      "websiteUrl": config.developerUrl ?? "https://example.com",
      "privacyUrl": config.privacyUrl ?? "https://example.com/privacy",
      "termsOfUseUrl": config.termsOfUseUrl ?? "https://example.com/terms"
    },
    "name": {
      "short": config.name,
      "full": config.name
    },
    "description": config.description,
    "accentColor": config.accentColor ?? "#5558AF",
    "bots": [{
      "botId": config.appId,
      "scopes": config.scopes ?? ["personal", "team", "groupchat"],
      "supportsFiles": false,
      "isNotificationOnly": false,
      "commandLists": []
    }],
    "permissions": ["identity", "messageTeamMembers"],
    "validDomains": [new URL(config.botEndpoint).hostname]
  };
}
```

**Package Generator:**
```typescript
async function createTeamsPackage(
  manifest: TeamsManifest,
  icons?: { outline: Buffer; color: Buffer }
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('outline.png', icons?.outline ?? DEFAULT_OUTLINE_ICON);
  zip.file('color.png', icons?.color ?? DEFAULT_COLOR_ICON);

  return zip.generateAsync({ type: 'nodebuffer' });
}
```

**CLI or Export:**
```typescript
// In adapter
class TeamsAdapter {
  generateManifest(config: TeamsManifestConfig): TeamsManifest;

  async createPackage(
    config: TeamsManifestConfig,
    icons?: { outline: Buffer; color: Buffer }
  ): Promise<Buffer>;

  // Writes manifest.json and package.zip to disk
  async exportPackage(
    config: TeamsManifestConfig,
    outputDir: string
  ): Promise<void>;
}
```

### Multi-Tenant Support (Already Implemented)
Teams adapter already supports multi-tenant via `appTenantId`:
- `undefined` or `"common"` = works across all organizations
- Specific tenant ID = single organization only

---

## Google Chat: Setup Wizard

### Current Limitations
- Complex GCP project setup
- Service account key management
- Domain-wide delegation requires admin
- Pub/Sub setup is manual

### Target Experience
```
1. SDK provides step-by-step GCP setup guide
2. SDK validates credentials
3. SDK auto-detects Pub/Sub configuration
4. SDK provides health check endpoint
```

### Implementation

**Validation Helpers:**
```typescript
class GoogleChatAdapter {
  // Validate credentials can authenticate
  async validateCredentials(): Promise<{
    valid: boolean;
    projectId?: string;
    serviceAccountEmail?: string;
    errors?: string[];
  }>;

  // Check API access
  async checkApiAccess(): Promise<{
    chatApi: boolean;
    pubsubApi: boolean;
    workspaceEventsApi: boolean;
    errors?: string[];
  }>;

  // Validate Pub/Sub subscription
  async validatePubSubSetup(): Promise<{
    topicExists: boolean;
    subscriptionExists: boolean;
    pushEndpointConfigured: boolean;
    errors?: string[];
  }>;

  // Health check endpoint
  async healthCheck(): Promise<HealthCheckResult>;
}
```

**Setup Guide Generator:**
```typescript
function generateSetupGuide(config: {
  projectId: string;
  webhookUrl: string;
  appName: string;
}): SetupGuide {
  return {
    steps: [
      {
        title: "Create GCP Project",
        url: `https://console.cloud.google.com/projectcreate`,
        instructions: "Create a new project or select existing"
      },
      {
        title: "Enable APIs",
        url: `https://console.cloud.google.com/apis/library?project=${config.projectId}`,
        apis: ["Google Chat API", "Cloud Pub/Sub API", "Google Workspace Events API"]
      },
      {
        title: "Create Service Account",
        url: `https://console.cloud.google.com/iam-admin/serviceaccounts/create?project=${config.projectId}`,
        instructions: "Create service account with no additional permissions"
      },
      {
        title: "Download Key",
        instructions: "Create JSON key and set as GOOGLE_CHAT_CREDENTIALS env var"
      },
      {
        title: "Configure Chat App",
        url: `https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=${config.projectId}`,
        settings: {
          name: config.appName,
          avatarUrl: "optional",
          description: "optional",
          interactiveFeatures: true,
          httpEndpoint: config.webhookUrl
        }
      },
      // Pub/Sub steps if needed...
    ]
  };
}
```

### Workspace Marketplace (Future)
For public distribution:
- Requires Google Workspace Marketplace listing
- App must pass security review
- Can enable admin-controlled deployment

---

## Discord: Invite Link Generator

### Current Limitations
- Manual bot token setup
- No invite URL generation
- Interactions only (no message receiving without Gateway)

### Target Experience
```
1. Developer provides Application ID + Bot Token
2. SDK generates invite URL with correct permissions
3. User clicks → adds to server
4. Bot receives messages via Gateway (serverless-compatible)
```

### Implementation

**Invite URL Generator:**
```typescript
interface DiscordInviteOptions {
  applicationId: string;

  // Permissions (SDK provides sensible defaults)
  permissions?: DiscordPermissions;

  // Scopes
  scopes?: ('bot' | 'applications.commands')[];

  // Pre-select guild (optional)
  guildId?: string;

  // Disable guild select (for specific guild only)
  disableGuildSelect?: boolean;
}

interface DiscordPermissions {
  sendMessages?: boolean;        // 2048
  sendMessagesInThreads?: boolean; // 274877906944
  createPublicThreads?: boolean;   // 34359738368
  readMessageHistory?: boolean;    // 65536
  addReactions?: boolean;          // 64
  useExternalEmojis?: boolean;     // 262144
  mentionEveryone?: boolean;       // 131072
  manageMessages?: boolean;        // 8192
  embedLinks?: boolean;            // 16384
  attachFiles?: boolean;           // 32768
  viewChannel?: boolean;           // 1024
  // ... more as needed
}

function generateInviteUrl(options: DiscordInviteOptions): string {
  const permissions = calculatePermissionsBitfield(options.permissions ?? {
    sendMessages: true,
    sendMessagesInThreads: true,
    readMessageHistory: true,
    addReactions: true,
    viewChannel: true,
  });

  const scopes = options.scopes ?? ['bot', 'applications.commands'];

  const params = new URLSearchParams({
    client_id: options.applicationId,
    permissions: permissions.toString(),
    scope: scopes.join(' '),
  });

  if (options.guildId) {
    params.set('guild_id', options.guildId);
  }
  if (options.disableGuildSelect) {
    params.set('disable_guild_select', 'true');
  }

  return `https://discord.com/api/oauth2/authorize?${params}`;
}
```

**Adapter Method:**
```typescript
class DiscordAdapter {
  // Generate invite URL
  getInviteUrl(options?: Partial<DiscordInviteOptions>): string {
    return generateInviteUrl({
      applicationId: this.applicationId,
      ...options
    });
  }

  // Get required permissions for full functionality
  getRequiredPermissions(): DiscordPermissions {
    return {
      sendMessages: true,
      sendMessagesInThreads: true,
      createPublicThreads: true,
      readMessageHistory: true,
      addReactions: true,
      viewChannel: true,
    };
  }
}
```

### Gateway for Serverless (Already Implemented)
The Gateway listener with cron job is already implemented:
- `startGatewayListener()` connects to Discord Gateway
- Cron job keeps it running in serverless
- Redis pub/sub coordinates across instances

---

## Shared Infrastructure

### Installation Store Interface

All platforms need similar storage for multi-tenant:

```typescript
interface InstallationStore<T> {
  store(id: string, installation: T): Promise<void>;
  fetch(id: string): Promise<T | null>;
  delete(id: string): Promise<void>;
  list(): AsyncIterable<T>;
}

// Platform-specific implementations
type SlackInstallationStore = InstallationStore<SlackInstallation>;
type TeamsInstallationStore = InstallationStore<TeamsInstallation>;
type DiscordInstallationStore = InstallationStore<DiscordInstallation>;
// Google Chat uses service account per org, different model
```

### Redis Installation Store

```typescript
function createRedisInstallationStore<T>(
  redis: RedisClient,
  prefix: string
): InstallationStore<T> {
  return {
    async store(id, installation) {
      await redis.set(`${prefix}:${id}`, JSON.stringify(installation));
    },
    async fetch(id) {
      const data = await redis.get(`${prefix}:${id}`);
      return data ? JSON.parse(data) : null;
    },
    async delete(id) {
      await redis.del(`${prefix}:${id}`);
    },
    async *list() {
      for await (const key of redis.scanIterator({ match: `${prefix}:*` })) {
        const data = await redis.get(key);
        if (data) yield JSON.parse(data);
      }
    }
  };
}
```

---

## Implementation Phases

### Phase 1: Discord Invite URL (Simplest)
- Add `getInviteUrl()` method
- Document required permissions
- Already has Gateway support

### Phase 2: Teams Manifest Generator
- Add manifest generation utility
- Add package creation (zip)
- Add default icons
- Document upload process

### Phase 3: Slack OAuth Install Flow
- Add OAuth configuration
- Implement `getInstallUrl()` and `handleInstallCallback()`
- Add InstallationStore interface
- Multi-workspace webhook routing

### Phase 4: Google Chat Setup Helpers
- Add credential validation
- Add API access checks
- Generate setup guide
- Health check endpoint

---

## File Structure

```
packages/
├── adapter-slack/
│   ├── src/
│   │   ├── index.ts          # Add OAuth methods
│   │   ├── oauth.ts          # OAuth flow implementation
│   │   └── installation.ts   # InstallationStore types
│   └── README.md             # Update with install flow
├── adapter-teams/
│   ├── src/
│   │   ├── index.ts          # Add manifest methods
│   │   └── manifest.ts       # Manifest generator
│   ├── assets/
│   │   ├── outline.png       # Default icon
│   │   └── color.png         # Default icon
│   └── README.md             # Update with manifest guide
├── adapter-gchat/
│   ├── src/
│   │   ├── index.ts          # Add validation methods
│   │   └── setup.ts          # Setup helpers
│   └── README.md             # Update with setup guide
└── adapter-discord/
    ├── src/
    │   ├── index.ts          # Add getInviteUrl
    │   └── permissions.ts    # Permission helpers
    └── README.md             # Update with invite guide
```

---

## Success Criteria

| Platform | Metric |
|----------|--------|
| Slack | User can install bot to workspace with 2 clicks |
| Teams | Developer can generate valid manifest in 1 command |
| Google Chat | Validation catches 90% of setup issues |
| Discord | Invite URL generated with correct permissions |

---

## Open Questions

1. **Slack App Directory**: Should SDK help with directory listing requirements?

2. **Teams App Store**: Should SDK support publishing to Teams App Store?

3. **Default Icons**: Should SDK include default bot icons for all platforms?

4. **Installation Events**: How to notify app when bot is added/removed from workspace?

5. **Credential Rotation**: How to handle token refresh and credential rotation?
