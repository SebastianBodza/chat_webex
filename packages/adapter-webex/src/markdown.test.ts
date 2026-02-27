import { describe, expect, it } from "vitest";
import { WebexFormatConverter } from "./markdown";

describe("WebexFormatConverter", () => {
  it("converts ast to markdown", () => {
    const converter = new WebexFormatConverter();
    const markdown = converter.fromAst({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "Hello Webex" }],
        },
      ],
    });
    expect(markdown).toContain("Hello Webex");
  });

  it("renders raw and markdown postable messages", () => {
    const converter = new WebexFormatConverter();
    expect(converter.renderPostable({ raw: "raw text" })).toBe("raw text");
    expect(converter.renderPostable({ markdown: "**bold**" })).toContain(
      "**bold**"
    );
  });
});
