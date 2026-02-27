import {
  createEmojiConverter,
  mapButtonStyle,
  cardToFallbackText as sharedCardToFallbackText,
} from "@chat-adapter/shared";
import type {
  ActionsElement,
  ButtonElement,
  CardChild,
  CardElement,
  FieldsElement,
  LinkButtonElement,
  RadioSelectElement,
  SelectElement,
  SelectOptionElement,
  SectionElement,
  TextElement,
} from "chat";

const convertEmoji = createEmojiConverter("webex");

export interface WebexAdaptiveCard {
  $schema: string;
  type: "AdaptiveCard";
  version: string;
  body: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
}

const ADAPTIVE_CARD_SCHEMA =
  "http://adaptivecards.io/schemas/adaptive-card.json";
const ADAPTIVE_CARD_VERSION = "1.3";

export function cardToWebexAdaptiveCard(card: CardElement): WebexAdaptiveCard {
  const body: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];

  if (card.title) {
    body.push({
      type: "TextBlock",
      text: convertEmoji(card.title),
      weight: "Bolder",
      size: "Medium",
      wrap: true,
    });
  }

  if (card.subtitle) {
    body.push({
      type: "TextBlock",
      text: convertEmoji(card.subtitle),
      isSubtle: true,
      wrap: true,
    });
  }

  if (card.imageUrl) {
    body.push({
      type: "Image",
      url: card.imageUrl,
      size: "Stretch",
      altText: card.title || "Image",
    });
  }

  for (const child of card.children) {
    const result = convertChildToAdaptive(child);
    body.push(...result.body);
    actions.push(...result.actions);
  }

  const adaptiveCard: WebexAdaptiveCard = {
    type: "AdaptiveCard",
    $schema: ADAPTIVE_CARD_SCHEMA,
    version: ADAPTIVE_CARD_VERSION,
    body,
  };

  if (actions.length > 0) {
    adaptiveCard.actions = actions.slice(0, 20);
  }

  return adaptiveCard;
}

interface ConvertResult {
  actions: Array<Record<string, unknown>>;
  body: Array<Record<string, unknown>>;
}

function convertChildToAdaptive(child: CardChild): ConvertResult {
  switch (child.type) {
    case "text":
      return { body: [convertTextToElement(child)], actions: [] };
    case "image":
      return {
        body: [
          {
            type: "Image",
            url: child.url,
            altText: child.alt || "Image",
            size: "Auto",
          },
        ],
        actions: [],
      };
    case "divider":
      return {
        body: [{ type: "Container", separator: true, items: [] }],
        actions: [],
      };
    case "fields":
      return { body: [convertFieldsToElement(child)], actions: [] };
    case "actions":
      return convertActions(child);
    case "section":
      return convertSection(child);
    default:
      return { body: [], actions: [] };
  }
}

function convertTextToElement(text: TextElement): Record<string, unknown> {
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

function convertFieldsToElement(fields: FieldsElement): Record<string, unknown> {
  const facts = fields.children.map((field) => ({
    title: convertEmoji(field.label),
    value: convertEmoji(field.value),
  }));

  return {
    type: "FactSet",
    facts,
  };
}

function convertActions(
  actions: ActionsElement
): ConvertResult {
  const body: Array<Record<string, unknown>> = [];
  const convertedActions: Array<Record<string, unknown>> = [];

  for (const action of actions.children) {
    if (action.type === "button") {
      convertedActions.push(convertButton(action));
      continue;
    }

    if (action.type === "link-button") {
      convertedActions.push(convertLinkButton(action));
      continue;
    }

    // Map select controls to Adaptive Card ChoiceSet inputs and add an explicit
    // submit action so selection triggers an attachment action webhook.
    if (action.type === "select" || action.type === "radio_select") {
      body.push(convertChoiceSet(action));
      convertedActions.push(convertChoiceSetSubmit(action));
    }
  }

  return { body, actions: convertedActions };
}

function convertButton(button: ButtonElement): Record<string, unknown> {
  const data: Record<string, string> = {
    actionId: button.id,
  };
  if (button.value) {
    data.value = button.value;
  }

  const action: Record<string, unknown> = {
    type: "Action.Submit",
    title: convertEmoji(button.label),
    data,
  };

  const style = mapButtonStyle(button.style, "webex");
  if (style) {
    action.style = style;
  }

  return action;
}

function convertLinkButton(button: LinkButtonElement): Record<string, unknown> {
  const action: Record<string, unknown> = {
    type: "Action.OpenUrl",
    title: convertEmoji(button.label),
    url: button.url,
  };

  const style = mapButtonStyle(button.style, "webex");
  if (style) {
    action.style = style;
  }

  return action;
}

function convertChoiceSet(
  choice: SelectElement | RadioSelectElement
): Record<string, unknown> {
  const adaptiveChoice: Record<string, unknown> = {
    type: "Input.ChoiceSet",
    id: choice.id,
    label: convertEmoji(choice.label),
    style: choice.type === "radio_select" ? "expanded" : "compact",
    choices: choice.options.map(convertChoiceOption),
  };

  if (choice.initialOption) {
    adaptiveChoice.value = choice.initialOption;
  }

  if (choice.type === "select" && choice.placeholder) {
    adaptiveChoice.placeholder = convertEmoji(choice.placeholder);
  }

  if (choice.optional === false) {
    adaptiveChoice.isRequired = true;
    adaptiveChoice.errorMessage = "Please choose an option.";
  }

  return adaptiveChoice;
}

function convertChoiceSetSubmit(
  choice: SelectElement | RadioSelectElement
): Record<string, unknown> {
  return {
    type: "Action.Submit",
    title: convertEmoji(choice.label),
    data: {
      actionId: choice.id,
      source: choice.type,
    },
  };
}

function convertChoiceOption(
  option: SelectOptionElement
): Record<string, unknown> {
  return {
    title: convertEmoji(option.label),
    value: option.value,
  };
}

function convertSection(section: SectionElement): ConvertResult {
  const body: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];

  const sectionItems: Array<Record<string, unknown>> = [];
  for (const child of section.children) {
    const converted = convertChildToAdaptive(child);
    sectionItems.push(...converted.body);
    actions.push(...converted.actions);
  }

  if (sectionItems.length > 0) {
    body.push({
      type: "Container",
      items: sectionItems,
    });
  }

  return { body, actions };
}

export function cardToFallbackText(card: CardElement): string {
  return sharedCardToFallbackText(card, {
    boldFormat: "**",
    lineBreak: "\n\n",
    platform: "webex",
  });
}
