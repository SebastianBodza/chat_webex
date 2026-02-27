import {
  type AdapterPostableMessage,
  BaseFormatConverter,
  parseMarkdown,
  type Root,
  stringifyMarkdown,
} from "chat";

export class WebexFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast).trim();
  }

  toAst(markdown: string): Root {
    return parseMarkdown(markdown);
  }

  override renderPostable(message: AdapterPostableMessage): string {
    if (typeof message === "string") {
      return message;
    }
    if ("raw" in message) {
      return message.raw;
    }
    if ("markdown" in message) {
      return this.fromMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.fromAst(message.ast);
    }
    return super.renderPostable(message);
  }
}
