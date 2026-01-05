# @chat-adapter/teams

Microsoft Teams adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/teams
```

## Usage

```typescript
import { Chat } from "chat";
import { createTeamsAdapter } from "@chat-adapter/teams";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    teams: createTeamsAdapter({
      appId: process.env.TEAMS_APP_ID!,
      appPassword: process.env.TEAMS_APP_PASSWORD!,
      appType: "SingleTenant",
      appTenantId: process.env.TEAMS_APP_TENANT_ID!,
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Teams!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `appId` | Yes | Azure Bot App ID |
| `appPassword` | Yes | Azure Bot App Password |
| `appType` | No | `"MultiTenant"` or `"SingleTenant"` (default: `"MultiTenant"`) |
| `appTenantId` | For SingleTenant | Azure AD Tenant ID |

## Environment Variables

```bash
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...
TEAMS_APP_TENANT_ID=...  # Required for SingleTenant
```

## Azure Bot Setup

### 1. Create Azure Bot Resource

1. Go to [portal.azure.com](https://portal.azure.com)
2. Click **Create a resource**
3. Search for **Azure Bot** and select it
4. Click **Create**
5. Fill in:
   - **Bot handle**: Unique identifier for your bot
   - **Subscription**: Your Azure subscription
   - **Resource group**: Create new or use existing
   - **Pricing tier**: F0 (free) for testing
   - **Type of App**: **Single Tenant** (recommended for enterprise)
   - **Creation type**: **Create new Microsoft App ID**
6. Click **Review + create** → **Create**

### 2. Get App Credentials

1. Go to your newly created Bot resource
2. Go to **Configuration**
3. Copy **Microsoft App ID** → `TEAMS_APP_ID`
4. Click **Manage Password** (next to Microsoft App ID)
5. In the App Registration page, go to **Certificates & secrets**
6. Click **New client secret**
7. Add description, select expiry, click **Add**
8. Copy the **Value** immediately (shown only once) → `TEAMS_APP_PASSWORD`
9. Go back to **Overview** and copy **Directory (tenant) ID** → `TEAMS_APP_TENANT_ID`

### 3. Configure Messaging Endpoint

1. In your Azure Bot resource, go to **Configuration**
2. Set **Messaging endpoint** to: `https://your-domain.com/api/webhooks/teams`
3. Click **Apply**

### 4. Enable Teams Channel

1. In your Azure Bot resource, go to **Channels**
2. Click **Microsoft Teams**
3. Accept the terms of service
4. Click **Apply**

### 5. Create Teams App Package

Create a `manifest.json` file:

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "1.0.0",
  "id": "YOUR_APP_ID_HERE",
  "packageName": "com.yourcompany.chatbot",
  "developer": {
    "name": "Your Company",
    "websiteUrl": "https://your-domain.com",
    "privacyUrl": "https://your-domain.com/privacy",
    "termsOfUseUrl": "https://your-domain.com/terms"
  },
  "name": {
    "short": "Chat Bot",
    "full": "Chat SDK Demo Bot"
  },
  "description": {
    "short": "A chat bot powered by Chat SDK",
    "full": "A chat bot powered by Chat SDK that can respond to messages and commands."
  },
  "icons": {
    "outline": "outline.png",
    "color": "color.png"
  },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "YOUR_APP_ID_HERE",
      "scopes": ["personal", "team", "groupchat"],
      "supportsFiles": false,
      "isNotificationOnly": false,
      "commandLists": [
        {
          "scopes": ["personal", "team", "groupchat"],
          "commands": [
            {
              "title": "help",
              "description": "Get help using this bot"
            }
          ]
        }
      ]
    }
  ],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": ["your-domain.com"]
}
```

Create icon files (32x32 `outline.png` and 192x192 `color.png`), then zip all three files together.

### 6. Upload App to Teams

**For testing (sideloading):**
1. In Teams, click **Apps** in the sidebar
2. Click **Manage your apps** → **Upload an app**
3. Click **Upload a custom app**
4. Select your zip file

**For organization-wide deployment:**
1. Go to [Teams Admin Center](https://admin.teams.microsoft.com)
2. Go to **Teams apps** → **Manage apps**
3. Click **Upload new app**
4. Select your zip file
5. Go to **Setup policies** to control who can use the app

## Features

- Message posting and editing
- Thread subscriptions
- Reaction events (receive only)
- File attachments
- Rich cards (Adaptive Cards)
- Action callbacks (card actions)
- Typing indicators
- Direct messages
- Proactive messaging

## Limitations

- **Adding reactions**: Teams Bot Framework doesn't support bots adding reactions
- **Message history**: No API to fetch message history

## Troubleshooting

### "Unauthorized" error
- Verify `TEAMS_APP_ID` and `TEAMS_APP_PASSWORD` are correct
- For SingleTenant apps, ensure `TEAMS_APP_TENANT_ID` is set
- Check that the messaging endpoint URL is correct in Azure

### Bot not appearing in Teams
- Verify the Teams channel is enabled in Azure Bot
- Check that the app manifest is correctly configured
- Ensure the app is installed in the workspace/team

### Messages not being received
- Verify the messaging endpoint URL is correct
- Check that your server is accessible from the internet
- Review Azure Bot logs for errors

## License

MIT
