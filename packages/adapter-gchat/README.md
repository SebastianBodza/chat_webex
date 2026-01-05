# @chat-adapter/gchat

Google Chat adapter for the [chat](https://github.com/vercel-labs/chat) SDK.

## Installation

```bash
npm install chat @chat-adapter/gchat
```

## Usage

```typescript
import { Chat } from "chat";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";

const chat = new Chat({
  userName: "mybot",
  adapters: {
    gchat: createGoogleChatAdapter({
      credentials: JSON.parse(process.env.GOOGLE_CHAT_CREDENTIALS!),
    }),
  },
});

// Handle @mentions
chat.onNewMention(async (thread, message) => {
  await thread.post("Hello from Google Chat!");
});
```

## Configuration

| Option | Required | Description |
|--------|----------|-------------|
| `credentials` | Yes* | Service account credentials JSON |
| `useADC` | No | Use Application Default Credentials instead |
| `pubsubTopic` | No | Pub/Sub topic for Workspace Events |
| `impersonateUser` | No | User email for domain-wide delegation |

*Either `credentials` or `useADC: true` is required.

## Environment Variables

```bash
GOOGLE_CHAT_CREDENTIALS={"type":"service_account",...}

# Optional: for receiving ALL messages, not just @mentions
GOOGLE_CHAT_PUBSUB_TOPIC=projects/your-project/topics/chat-events
GOOGLE_CHAT_IMPERSONATE_USER=admin@yourdomain.com
```

## Google Chat Setup

### 1. Create a GCP Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project**
3. Enter project name and click **Create**

### 2. Enable Required APIs

1. Go to **APIs & Services** → **Library**
2. Search and enable:
   - **Google Chat API**
   - **Google Workspace Events API** (for receiving all messages)
   - **Cloud Pub/Sub API** (for receiving all messages)

### 3. Create a Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Enter name and description
4. Click **Create and Continue**
5. Skip the optional steps, click **Done**

### 4. Create Service Account Key

> **Note**: If your organization has the `iam.disableServiceAccountKeyCreation` constraint enabled, you'll need to:
> 1. Go to **IAM & Admin** → **Organization Policies**
> 2. Find `iam.disableServiceAccountKeyCreation`
> 3. Click **Manage Policy** → **Override parent's policy**
> 4. Set to **Not enforced** (or add an exception for your project)

1. Click on your service account
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Select **JSON** and click **Create**
5. Save the downloaded file
6. Copy the entire JSON content → `GOOGLE_CHAT_CREDENTIALS` (as a single line)

### 5. Configure Google Chat App

1. Go to [console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat)
2. Click **Configuration**
3. Fill in:
   - **App name**: Your bot's display name
   - **Avatar URL**: URL to your bot's avatar image
   - **Description**: What your bot does
   - **Interactive features**:
     - Enable **Receive 1:1 messages**
     - Enable **Join spaces and group conversations**
   - **Connection settings**: Select **App URL**
   - **App URL**: `https://your-domain.com/api/webhooks/gchat`
   - **Visibility**: Choose who can discover and install your app
4. Click **Save**

**Important for button clicks**: The same App URL receives both message events and interactive events (card button clicks). Google Chat sends CARD_CLICKED events to this URL when users click buttons in cards.

### 6. Add Bot to a Space

1. Open Google Chat
2. Create or open a Space
3. Click the space name → **Manage apps & integrations** (or **Apps & integrations**)
4. Click **Add apps**
5. Search for your app name
6. Click **Add**

## (Optional) Pub/Sub for All Messages

By default, Google Chat only sends webhooks for @mentions. To receive ALL messages in a space (for conversation context), you need to set up Workspace Events with Pub/Sub.

### 1. Create Pub/Sub Topic

1. Go to **Pub/Sub** → **Topics**
2. Click **Create Topic**
3. Enter topic ID (e.g., `chat-events`)
4. Uncheck **Add a default subscription**
5. Click **Create**
6. Copy the full topic name → `GOOGLE_CHAT_PUBSUB_TOPIC`
   - Format: `projects/your-project-id/topics/chat-events`

### 2. Grant Chat Service Account Access

> **Note**: If your organization has the `iam.allowedPolicyMemberDomains` constraint, you may need to temporarily relax it or use the console workaround below.

1. Go to your Pub/Sub topic
2. Click **Permissions** tab (or **Show Info Panel** → **Permissions**)
3. Click **Add Principal**
4. Enter: `chat-api-push@system.gserviceaccount.com`
5. Select role: **Pub/Sub Publisher**
6. Click **Save**

**If you get a policy error**, try via Cloud Console:
1. Go to **Pub/Sub** → **Topics**
2. Check the box next to your topic
3. Click **Permissions** in the info panel
4. Click **Add Principal**
5. Add `chat-api-push@system.gserviceaccount.com` with **Pub/Sub Publisher** role

### 3. Create Push Subscription

1. Go to **Pub/Sub** → **Subscriptions**
2. Click **Create Subscription**
3. Enter subscription ID (e.g., `chat-messages-push`)
4. Select your topic
5. **Delivery type**: Push
6. **Endpoint URL**: `https://your-domain.com/api/webhooks/gchat`
7. Click **Create**

### 4. Enable Domain-Wide Delegation

To create Workspace Events subscriptions and initiate DMs, you need domain-wide delegation:

**Step 1: Enable delegation on the Service Account (GCP Console)**

1. Go to [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Click on your service account
3. Go to **Details** tab
4. Check **Enable Google Workspace Domain-wide Delegation**
5. Click **Save**
6. Go to **Advanced settings** (or click on the service account again)
7. Copy the **Client ID** - this is a **numeric ID** (e.g., `123456789012345678901`), NOT the email address

**Step 2: Authorize the Client ID (Google Admin Console)**

1. Go to [Google Admin Console](https://admin.google.com)
2. Go to **Security** → **Access and data control** → **API controls**
3. Click **Manage Domain Wide Delegation**
4. Click **Add new**
5. Enter:
   - **Client ID**: The numeric ID from Step 1 (e.g., `123456789012345678901`)
   - **OAuth Scopes** (all on one line, comma-separated):
     ```
     https://www.googleapis.com/auth/chat.spaces.readonly,https://www.googleapis.com/auth/chat.messages.readonly,https://www.googleapis.com/auth/chat.spaces,https://www.googleapis.com/auth/chat.spaces.create
     ```
6. Click **Authorize**

**Step 3: Set environment variable**

Set `GOOGLE_CHAT_IMPERSONATE_USER` to an admin user email in your domain (e.g., `admin@yourdomain.com`). This user will be impersonated when creating DM spaces and Workspace Events subscriptions.

## Features

- Message posting and editing
- Thread subscriptions
- Reaction events (via Workspace Events)
- File attachments
- Rich cards (Google Chat Cards)
- Action callbacks (card buttons)
- Direct messages
- Space management

## Limitations

- **Typing indicators**: Not supported by Google Chat API
- **Adding reactions**: Requires domain-wide delegation (appears from impersonated user, not bot)

## Troubleshooting

### No webhook received
- Verify the App URL is correct in Google Chat configuration
- Check that the Chat API is enabled
- Ensure the service account has the necessary permissions

### Pub/Sub not working
- Verify `chat-api-push@system.gserviceaccount.com` has Pub/Sub Publisher role
- Check that the push subscription URL is correct
- Verify domain-wide delegation is configured with correct scopes
- Check `GOOGLE_CHAT_IMPERSONATE_USER` is a valid admin email

### "Permission denied" for Workspace Events
- Ensure domain-wide delegation is configured
- Verify the OAuth scopes are exactly as specified
- Check that the impersonated user has access to the spaces

### "Insufficient Permission" for DMs (openDM)
- DMs require domain-wide delegation with `chat.spaces` and `chat.spaces.create` scopes
- Add these scopes to your domain-wide delegation configuration in Google Admin Console
- Set `GOOGLE_CHAT_IMPERSONATE_USER` to an admin email in your domain
- Scope changes can take up to 24 hours to propagate

### "unauthorized_client" error
- The Client ID is not registered in Google Admin Console
- Or domain-wide delegation is not enabled on the service account

### Button clicks (CARD_CLICKED) not received
- Verify "Interactive features" is enabled in the Google Chat app configuration
- Check that the App URL is correctly set and accessible
- Button clicks go to the same webhook URL as messages
- Ensure your button elements have valid `id` attributes (these become the `actionId`)

## License

MIT
