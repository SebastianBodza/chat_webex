import { describe, expect, it } from "vitest";
import { cardToFallbackText, cardToWebexAdaptiveCard } from "./cards";

describe("cardToWebexAdaptiveCard", () => {
  it("converts card with text and actions to adaptive card", () => {
    const card = {
      type: "card",
      title: "Deployment",
      subtitle: "Ready to proceed",
      children: [
        {
          type: "text",
          content: "Approve the deployment?",
        },
        {
          type: "actions",
          children: [
            {
              type: "button",
              id: "approve",
              label: "Approve",
              value: "yes",
            },
            {
              type: "link-button",
              label: "Open Runbook",
              url: "https://example.com/runbook",
            },
          ],
        },
      ],
    } as const;

    const converted = cardToWebexAdaptiveCard(card);
    expect(converted.type).toBe("AdaptiveCard");
    expect(converted.body.length).toBeGreaterThan(0);
    expect(converted.actions?.length).toBe(2);
    expect(converted.actions?.[0]).toMatchObject({
      type: "Action.Submit",
      title: "Approve",
    });
  });
});

describe("cardToFallbackText", () => {
  it("returns plain fallback text for card clients that cannot render cards", () => {
    const card = {
      type: "card",
      title: "Alert",
      children: [{ type: "text", content: "Something happened." }],
    } as const;

    const fallback = cardToFallbackText(card);
    expect(fallback).toContain("Alert");
    expect(fallback).toContain("Something happened.");
  });
});
