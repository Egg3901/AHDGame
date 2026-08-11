/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WikiEditorClient } from "../WikiEditorClient";

// Mock next/navigation
const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => pushMock(...args),
    refresh: (...args: unknown[]) => refreshMock(...args),
    back: vi.fn(),
  }),
}));

// Mock fetch
global.fetch = vi.fn();

describe("WikiEditorClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
    localStorage.clear();
  });

  it("renders create mode with all form fields", () => {
    render(<WikiEditorClient mode="create" isAdmin={false} />);

    expect(screen.getByLabelText(/title/i)).toBeTruthy();
    expect(screen.getByLabelText(/slug/i)).toBeTruthy();
    expect(screen.getByLabelText(/description/i)).toBeTruthy();
    expect(screen.getByLabelText(/content/i)).toBeTruthy();
    expect(screen.getByLabelText(/tags/i)).toBeTruthy();
    expect(screen.getByLabelText(/difficulty/i)).toBeTruthy();
  });

  it("auto-generates slug from title", () => {
    render(<WikiEditorClient mode="create" isAdmin={false} />);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.change(titleInput, { target: { value: "Test Page Title" } });

    const slugInput = screen.getByLabelText(/slug/i) as HTMLInputElement;
    expect(slugInput.value).toBe("test-page-title");
  });

  it("shows featured checkbox for admins only", () => {
    const { rerender } = render(<WikiEditorClient mode="create" isAdmin={false} />);
    expect(screen.queryByLabelText(/featured/i)).toBeNull();

    rerender(<WikiEditorClient mode="create" isAdmin={true} />);
    expect(screen.getByLabelText(/featured/i)).toBeTruthy();
  });

  it("shows template selector in create mode", () => {
    render(<WikiEditorClient mode="create" isAdmin={false} />);
    expect(screen.getByText(/game mechanic/i)).toBeTruthy();
    expect(screen.getByText(/strategy guide/i)).toBeTruthy();
  });

  it("does not show template selector in edit mode", () => {
    render(
      <WikiEditorClient
        mode="edit"
        isAdmin={false}
        initialSlug="test"
        initialData={{
          title: "Test",
          description: "Test description",
          content: "Test content",
          tags: [],
        }}
      />
    );
    expect(screen.queryByText(/game mechanic/i)).toBeNull();
  });

  it("loads initial data in edit mode", () => {
    render(
      <WikiEditorClient
        mode="edit"
        isAdmin={false}
        initialSlug="test"
        initialData={{
          title: "Initial Title",
          description: "Initial description",
          content: "Initial content",
          tags: ["tag1", "tag2"],
          difficulty: "beginner",
        }}
      />
    );

    expect(screen.getByDisplayValue("Initial Title")).toBeTruthy();
    expect(screen.getByDisplayValue("Initial description")).toBeTruthy();
    expect(screen.getByDisplayValue("Initial content")).toBeTruthy();
    expect(screen.getByText("tag1")).toBeTruthy();
    expect(screen.getByText("tag2")).toBeTruthy();
  });

  it("toggles between edit and preview modes", () => {
    render(<WikiEditorClient mode="create" isAdmin={false} />);

    const previewButton = screen.getByText(/preview/i);
    fireEvent.click(previewButton);

    expect(screen.getByText(/edit/i)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /content/i })).toBeNull();
  });

  it("saves an edit when no template or difficulty is set", async () => {
    // Regression: editor state defaults `selectedTemplate` and `difficulty` to
    // `null`. zod's `.optional()` only accepts `undefined`, so passing `null`
    // used to silently fail validation on fields with no inline error UI,
    // making Save look dead. The form must coerce `null` -> `undefined`.
    const longContent = "x".repeat(80);
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, slug: "existing-page" }),
    });

    render(
      <WikiEditorClient
        mode="edit"
        isAdmin={true}
        initialSlug="existing-page"
        initialData={{
          title: "Existing Page",
          description: "A description with at least ten characters.",
          content: longContent,
          tags: [],
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/wiki/existing-page");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse(((init as RequestInit).body as string) ?? "{}");
    // Coercion guarantees the schema-rejecting `null`s never reach the wire.
    expect(body.templateType).toBeUndefined();
    expect(body.difficulty).toBeUndefined();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/wiki/existing-page"));
  });

  it("adds and removes tags", () => {
    render(<WikiEditorClient mode="create" isAdmin={false} />);

    const tagInput = screen.getByPlaceholderText(/add a tag/i);
    fireEvent.change(tagInput, { target: { value: "test-tag" } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    expect(screen.getByText("test-tag")).toBeTruthy();

    const removeButton = screen.getByText("×");
    fireEvent.click(removeButton);

    expect(screen.queryByText("test-tag")).toBeNull();
  });
});
