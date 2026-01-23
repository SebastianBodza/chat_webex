import { Modal, Select, SelectOption, TextInput } from "chat";
import { describe, expect, it } from "vitest";
import { modalToSlackView } from "./modals";

describe("modalToSlackView", () => {
  it("converts a simple modal with text input", () => {
    const modal = Modal({
      callbackId: "feedback_form",
      title: "Send Feedback",
      children: [
        TextInput({
          id: "message",
          label: "Your Feedback",
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("feedback_form");
    expect(view.title).toEqual({ type: "plain_text", text: "Send Feedback" });
    expect(view.submit).toEqual({ type: "plain_text", text: "Submit" });
    expect(view.close).toEqual({ type: "plain_text", text: "Cancel" });
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({
      type: "input",
      block_id: "message",
      optional: false,
      label: { type: "plain_text", text: "Your Feedback" },
      element: {
        type: "plain_text_input",
        action_id: "message",
        multiline: false,
      },
    });
  });

  it("converts a modal with custom submit/close labels", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test Modal",
      submitLabel: "Send",
      closeLabel: "Dismiss",
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.submit).toEqual({ type: "plain_text", text: "Send" });
    expect(view.close).toEqual({ type: "plain_text", text: "Dismiss" });
  });

  it("converts multiline text input", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        TextInput({
          id: "description",
          label: "Description",
          multiline: true,
          placeholder: "Enter description...",
          maxLength: 500,
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      type: "input",
      element: {
        type: "plain_text_input",
        action_id: "description",
        multiline: true,
        placeholder: { type: "plain_text", text: "Enter description..." },
        max_length: 500,
      },
    });
  });

  it("converts optional text input", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        TextInput({
          id: "notes",
          label: "Notes",
          optional: true,
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      type: "input",
      optional: true,
    });
  });

  it("converts text input with initial value", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        TextInput({
          id: "name",
          label: "Name",
          initialValue: "John Doe",
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      element: {
        initial_value: "John Doe",
      },
    });
  });

  it("converts select element with options", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        Select({
          id: "category",
          label: "Category",
          options: [
            SelectOption({ label: "Bug Report", value: "bug" }),
            SelectOption({ label: "Feature Request", value: "feature" }),
          ],
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      type: "input",
      block_id: "category",
      label: { type: "plain_text", text: "Category" },
      element: {
        type: "static_select",
        action_id: "category",
        options: [
          { text: { type: "plain_text", text: "Bug Report" }, value: "bug" },
          {
            text: { type: "plain_text", text: "Feature Request" },
            value: "feature",
          },
        ],
      },
    });
  });

  it("converts select with initial option", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        Select({
          id: "priority",
          label: "Priority",
          options: [
            SelectOption({ label: "Low", value: "low" }),
            SelectOption({ label: "Medium", value: "medium" }),
            SelectOption({ label: "High", value: "high" }),
          ],
          initialOption: "medium",
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      element: {
        initial_option: {
          text: { type: "plain_text", text: "Medium" },
          value: "medium",
        },
      },
    });
  });

  it("converts select with placeholder", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [
        Select({
          id: "category",
          label: "Category",
          placeholder: "Select a category",
          options: [SelectOption({ label: "General", value: "general" })],
        }),
      ],
    });

    const view = modalToSlackView(modal);

    expect(view.blocks[0]).toMatchObject({
      element: {
        placeholder: { type: "plain_text", text: "Select a category" },
      },
    });
  });

  it("includes contextId as private_metadata when provided", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [],
    });

    const view = modalToSlackView(modal, "context-uuid-123");

    expect(view.private_metadata).toBe("context-uuid-123");
  });

  it("private_metadata is undefined when no contextId provided", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.private_metadata).toBeUndefined();
  });

  it("sets notify_on_close when provided", () => {
    const modal = Modal({
      callbackId: "test",
      title: "Test",
      notifyOnClose: true,
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.notify_on_close).toBe(true);
  });

  it("truncates long titles to 24 chars", () => {
    const modal = Modal({
      callbackId: "test",
      title: "This is a very long modal title that exceeds the limit",
      children: [],
    });

    const view = modalToSlackView(modal);

    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("converts a complete modal with multiple inputs", () => {
    const modal = Modal({
      callbackId: "feedback_form",
      title: "Submit Feedback",
      submitLabel: "Send",
      closeLabel: "Cancel",
      notifyOnClose: true,
      children: [
        TextInput({
          id: "message",
          label: "Your Feedback",
          placeholder: "Tell us what you think...",
          multiline: true,
        }),
        Select({
          id: "category",
          label: "Category",
          options: [
            SelectOption({ label: "Bug", value: "bug" }),
            SelectOption({ label: "Feature", value: "feature" }),
            SelectOption({ label: "Other", value: "other" }),
          ],
        }),
        TextInput({
          id: "email",
          label: "Email (optional)",
          optional: true,
        }),
      ],
    });

    const view = modalToSlackView(modal, "thread-context-123");

    expect(view.callback_id).toBe("feedback_form");
    expect(view.private_metadata).toBe("thread-context-123");
    expect(view.blocks).toHaveLength(3);
    expect(view.blocks[0].type).toBe("input");
    expect(view.blocks[1].type).toBe("input");
    expect(view.blocks[2].type).toBe("input");
  });
});
