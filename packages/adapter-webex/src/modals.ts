import { createEmojiConverter } from "@chat-adapter/shared";
import type {
  FieldsElement,
  ModalElement,
  RadioSelectElement,
  SelectElement,
  SelectOptionElement,
  TextElement,
  TextInputElement,
} from "chat";
import type { WebexAdaptiveCard } from "./cards";

const convertEmoji = createEmojiConverter("webex");

const ADAPTIVE_CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.3";

export const WEBEX_MODAL_SUBMIT_PREFIX = "__chat_modal_submit";
export const WEBEX_MODAL_CLOSE_PREFIX = "__chat_modal_close";
export const WEBEX_MODAL_META_FLAG = "_chat_modal";
export const WEBEX_MODAL_META_ACTION = "_chat_modal_action";
export const WEBEX_MODAL_META_VIEW_ID = "_chat_modal_view_id";
export const WEBEX_MODAL_META_CALLBACK_ID = "_chat_modal_callback_id";
export const WEBEX_MODAL_META_CONTEXT_ID = "_chat_modal_context_id";
export const WEBEX_MODAL_META_PRIVATE_METADATA =
  "_chat_modal_private_metadata";

export interface WebexModalMetadata {
  callbackId: string;
  contextId?: string;
  privateMetadata?: string;
  viewId: string;
}

export interface WebexModalActionDescriptor {
  callbackId?: string;
  contextId?: string;
  kind: "submit" | "close";
  privateMetadata?: string;
  viewId?: string;
}

export function createWebexModalSubmitActionId(viewId: string): string {
  return `${WEBEX_MODAL_SUBMIT_PREFIX}:${viewId}`;
}

export function createWebexModalCloseActionId(viewId: string): string {
  return `${WEBEX_MODAL_CLOSE_PREFIX}:${viewId}`;
}

export function modalToWebexAdaptiveCard(
  modal: ModalElement,
  metadata: WebexModalMetadata
): WebexAdaptiveCard {
  const body: Array<Record<string, unknown>> = [
    {
      type: "TextBlock",
      text: convertEmoji(modal.title),
      weight: "Bolder",
      size: "Medium",
      wrap: true,
    },
  ];

  for (const child of modal.children) {
    if (child.type === "text_input") {
      body.push(convertTextInput(child));
      continue;
    }
    if (child.type === "select" || child.type === "radio_select") {
      body.push(convertChoiceSet(child));
      continue;
    }
    if (child.type === "text") {
      body.push(convertTextElement(child));
      continue;
    }
    if (child.type === "fields") {
      body.push(convertFieldsElement(child));
    }
  }

  const actionData = buildModalActionData(metadata);
  const actions: Array<Record<string, unknown>> = [
    {
      type: "Action.Submit",
      title: convertEmoji(modal.submitLabel || "Submit"),
      data: {
        ...actionData,
        actionId: createWebexModalSubmitActionId(metadata.viewId),
        [WEBEX_MODAL_META_ACTION]: "submit",
      },
    },
  ];

  if (modal.closeLabel || modal.notifyOnClose) {
    actions.push({
      type: "Action.Submit",
      title: convertEmoji(modal.closeLabel || "Cancel"),
      data: {
        ...actionData,
        actionId: createWebexModalCloseActionId(metadata.viewId),
        [WEBEX_MODAL_META_ACTION]: "close",
      },
    });
  }

  return {
    $schema: ADAPTIVE_CARD_SCHEMA,
    type: "AdaptiveCard",
    version: ADAPTIVE_CARD_VERSION,
    body,
    actions,
  };
}

export function modalToFallbackText(modal: ModalElement): string {
  return `${modal.title}\nPlease fill out this form card and click ${
    modal.submitLabel || "Submit"
  }.`;
}

export function parseWebexModalAction(
  inputs: Record<string, string>
): WebexModalActionDescriptor | null {
  const actionId =
    inputs.actionId || inputs._actionId || inputs.id || inputs.action || "";
  const flagged = inputs[WEBEX_MODAL_META_FLAG] === "1";

  const isSubmit = actionId.startsWith(`${WEBEX_MODAL_SUBMIT_PREFIX}:`);
  const isClose = actionId.startsWith(`${WEBEX_MODAL_CLOSE_PREFIX}:`);

  if (!(flagged || isSubmit || isClose)) {
    return null;
  }

  const inferredKind = isClose ? "close" : "submit";
  const kind =
    inputs[WEBEX_MODAL_META_ACTION] === "close"
      ? "close"
      : inputs[WEBEX_MODAL_META_ACTION] === "submit"
        ? "submit"
        : inferredKind;

  const viewIdFromAction = actionId.includes(":")
    ? actionId.split(":").slice(1).join(":")
    : undefined;

  return {
    kind,
    viewId: inputs[WEBEX_MODAL_META_VIEW_ID] || viewIdFromAction,
    callbackId: inputs[WEBEX_MODAL_META_CALLBACK_ID],
    contextId: inputs[WEBEX_MODAL_META_CONTEXT_ID] || undefined,
    privateMetadata: inputs[WEBEX_MODAL_META_PRIVATE_METADATA] || undefined,
  };
}

export function extractWebexModalValues(
  inputs: Record<string, string>
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(inputs)) {
    if (
      key === "actionId" ||
      key === "_actionId" ||
      key === "id" ||
      key === "action" ||
      key === "source" ||
      key === "value" ||
      key === WEBEX_MODAL_META_FLAG ||
      key.startsWith("_chat_modal_")
    ) {
      continue;
    }
    values[key] = value;
  }

  return values;
}

function buildModalActionData(
  metadata: WebexModalMetadata
): Record<string, string> {
  return {
    [WEBEX_MODAL_META_FLAG]: "1",
    [WEBEX_MODAL_META_VIEW_ID]: metadata.viewId,
    [WEBEX_MODAL_META_CALLBACK_ID]: metadata.callbackId,
    [WEBEX_MODAL_META_CONTEXT_ID]: metadata.contextId || "",
    [WEBEX_MODAL_META_PRIVATE_METADATA]: metadata.privateMetadata || "",
  };
}

function convertTextInput(input: TextInputElement): Record<string, unknown> {
  const element: Record<string, unknown> = {
    type: "Input.Text",
    id: input.id,
    label: convertEmoji(input.label),
    isMultiline: !!input.multiline,
  };

  if (input.placeholder) {
    element.placeholder = convertEmoji(input.placeholder);
  }

  if (input.initialValue) {
    element.value = input.initialValue;
  }

  if (typeof input.maxLength === "number") {
    element.maxLength = input.maxLength;
  }

  if (input.optional === false) {
    element.isRequired = true;
    element.errorMessage = `${input.label} is required.`;
  }

  return element;
}

function convertChoiceSet(
  choice: SelectElement | RadioSelectElement
): Record<string, unknown> {
  const element: Record<string, unknown> = {
    type: "Input.ChoiceSet",
    id: choice.id,
    label: convertEmoji(choice.label),
    style: choice.type === "radio_select" ? "expanded" : "compact",
    choices: choice.options.map(convertChoiceOption),
  };

  if (choice.initialOption) {
    element.value = choice.initialOption;
  }

  if (choice.type === "select" && choice.placeholder) {
    element.placeholder = convertEmoji(choice.placeholder);
  }

  if (choice.optional === false) {
    element.isRequired = true;
    element.errorMessage = "Please choose an option.";
  }

  return element;
}

function convertChoiceOption(option: SelectOptionElement): Record<string, string> {
  return {
    title: convertEmoji(option.label),
    value: option.value,
  };
}

function convertTextElement(text: TextElement): Record<string, unknown> {
  const element: Record<string, unknown> = {
    type: "TextBlock",
    text: convertEmoji(text.content),
    wrap: true,
  };

  if (text.style === "bold") {
    element.weight = "Bolder";
  } else if (text.style === "muted") {
    element.isSubtle = true;
  }

  return element;
}

function convertFieldsElement(fields: FieldsElement): Record<string, unknown> {
  return {
    type: "FactSet",
    facts: fields.children.map((field) => ({
      title: convertEmoji(field.label),
      value: convertEmoji(field.value),
    })),
  };
}
