# Webex Sample Messages

This file contains real-world webhook examples for reference during development and debugging.

## Message Created Webhook

When a user sends a message in a space:

```json
{
  "id": "webhook-event-id",
  "resource": "messages",
  "event": "created",
  "actorId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "data": {
    "id": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvbXNnLTEyMzQ1",
    "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
    "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
    "personEmail": "user@example.com"
  }
}
```

## Message Details (fetched after webhook)

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvbXNnLTEyMzQ1",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
  "roomType": "group",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "personEmail": "user@example.com",
  "text": "@TestBot hello!",
  "markdown": "<spark-mention data-object-type=\"person\" data-object-id=\"bot-id\">TestBot</spark-mention> hello!",
  "mentionedPeople": ["Y2lzY29zcGFyazovL3VzL1BFT1BMRS9ib3QtaWQ"],
  "created": "2026-02-27T10:30:00.000Z"
}
```

## Thread Reply (message with parentId)

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvcmVwbHktMTIz",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
  "roomType": "group",
  "parentId": "Y2lzY29zcGFyazovL3VzL01FU1NBR0Uvcm9vdC0xMjM",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "personEmail": "user@example.com",
  "text": "This is a reply in a thread",
  "created": "2026-02-27T10:35:00.000Z"
}
```

## Direct Message (1:1 Space)

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvZG0tbXNn",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vZG0tcm9vbQ",
  "roomType": "direct",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "personEmail": "user@example.com",
  "text": "Hello in DM",
  "created": "2026-02-27T10:40:00.000Z"
}
```

## Attachment Action Webhook (Card Button Click)

When a user clicks a button on an Adaptive Card:

```json
{
  "id": "webhook-action-id",
  "resource": "attachmentActions",
  "event": "created",
  "actorId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "data": {
    "id": "Y2lzY29zcGFyazovL3VzL0FUVEFDSE1FTlRfQUNUSU9OL2FjdGlvbi0xMjM",
    "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
    "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
    "personEmail": "user@example.com"
  }
}
```

## Attachment Action Details (fetched after webhook)

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL0FUVEFDSE1FTlRfQUNUSU9OL2FjdGlvbi0xMjM",
  "type": "submit",
  "messageId": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvY2FyZC1tc2c",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
  "inputs": {
    "actionId": "approve",
    "value": "yes"
  },
  "created": "2026-02-27T10:45:00.000Z"
}
```

## Modal Form Submit (Adaptive Card with Input Fields)

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL0FUVEFDSE1FTlRfQUNUSU9OL21vZGFsLWFjdGlvbg",
  "type": "submit",
  "messageId": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvbW9kYWwtbXNn",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
  "inputs": {
    "actionId": "__chat_modal_submit:view-123",
    "_chat_modal_flag": "1",
    "_chat_modal_view_id": "view-123",
    "_chat_modal_callback_id": "feedback_form",
    "_chat_modal_context_id": "ctx-123",
    "feedback": "Great product!",
    "rating": "5"
  },
  "created": "2026-02-27T10:50:00.000Z"
}
```

## Message with File Attachment

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvZmlsZS1tc2c",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
  "roomType": "group",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "personEmail": "user@example.com",
  "text": "Check out this file",
  "files": [
    "https://webexapis.com/v1/contents/Y2lzY29zcGFyazovL3VzL0NPTlRFTlQv..."
  ],
  "created": "2026-02-27T10:55:00.000Z"
}
```

## Person Details

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
  "emails": ["user@example.com"],
  "displayName": "John Doe",
  "nickName": "John",
  "firstName": "John",
  "lastName": "Doe",
  "avatar": "https://avatar.webex.com/...",
  "orgId": "Y2lzY29zcGFyazovL3VzL09SR0FOSVpBVElPTi9vcmctMTIz",
  "type": "person"
}
```

## Room (Space) Details

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
  "title": "Project Discussion",
  "type": "group",
  "isLocked": false,
  "lastActivity": "2026-02-27T10:30:00.000Z",
  "creatorId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9jcmVhdG9yLTEyMw",
  "created": "2026-01-15T09:00:00.000Z"
}
```

## Message Reactions

### Add Reaction (POST /messages/{messageId}/reactions)

Request body:
```json
{
  "reaction": "thumbsup"
}
```

Response:
```json
{
  "id": "Y2lzY29zcGFyazovL3VzL1JFQUNUSU9OL3JlYWN0aW9uLTEyMw",
  "messageId": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvbXNnLTEyMzQ1",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vcm9vbS0xMjM",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9ib3QtaWQ",
  "personEmail": "bot@example.webex.com",
  "reaction": "thumbsup",
  "created": "2026-02-27T11:00:00.000Z"
}
```

### List Reactions (GET /messages/{messageId}/reactions)

```json
{
  "items": [
    {
      "id": "Y2lzY29zcGFyazovL3VzL1JFQUNUSU9OL3JlYWN0aW9uLTEyMw",
      "messageId": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvbXNnLTEyMzQ1",
      "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTEyMw",
      "reaction": "thumbsup",
      "created": "2026-02-27T11:00:00.000Z"
    },
    {
      "id": "Y2lzY29zcGFyazovL3VzL1JFQUNUSU9OL3JlYWN0aW9uLTQ1Ng",
      "messageId": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvbXNnLTEyMzQ1",
      "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS91c2VyLTQ1Ng",
      "reaction": "heart",
      "created": "2026-02-27T11:01:00.000Z"
    }
  ]
}
```

### Supported Reaction Shortcodes

Webex supports the following reaction shortcodes:
- `thumbsup` - 👍
- `thumbsdown` - 👎
- `heart` - ❤️
- `celebrate` - 🎉
- `clap` - 👏
- `haha` - 😂
- `surprised` - 😮
- `thinking` - 🤔
- `sad` - 😢
- `angry` - 😠
