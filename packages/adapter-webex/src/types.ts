export interface WebexThreadId {
  roomId: string;
  rootMessageId: string;
}

export interface WebexMessage {
  id: string;
  roomId: string;
  parentId?: string;
  personId?: string;
  personEmail?: string;
  personDisplayName?: string;
  personType?: "person" | "bot";
  text?: string;
  markdown?: string;
  created?: string;
  mentionedPeople?: string[];
  roomType?: "direct" | "group";
  files?: string[];
  attachments?: Array<{
    contentType?: string;
    content?: unknown;
  }>;
}

export interface WebexRoom {
  id: string;
  title?: string;
  type?: "direct" | "group";
  isLocked?: boolean;
  lastActivity?: string;
}

export interface WebexPerson {
  id: string;
  displayName?: string;
  nickName?: string;
  type?: "person" | "bot";
  emails?: string[];
}

export interface WebexAttachmentAction {
  id: string;
  type?: string;
  messageId: string;
  roomId?: string;
  personId?: string;
  inputs?: Record<string, string>;
  created?: string;
}

export interface WebexWebhookPayload {
  id?: string;
  resource: string;
  event: string;
  actorId?: string;
  orgId?: string;
  createdBy?: string;
  appId?: string;
  data?: {
    id?: string;
    roomId?: string;
    personId?: string;
    personEmail?: string;
    messageId?: string;
    created?: string;
  };
}

export interface WebexListMessagesResponse {
  items: WebexMessage[];
}

export interface WebexReaction {
  id: string;
  messageId: string;
  roomId?: string;
  personId: string;
  personEmail?: string;
  reaction: string;
  created?: string;
}

export interface WebexListReactionsResponse {
  items: WebexReaction[];
}
