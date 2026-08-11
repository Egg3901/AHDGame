/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when open is false", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open={false} title="Hidden" onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders title and children when open", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Visible" onClose={onClose}>
        <p>body content</p>
      </Modal>
    );
    expect(screen.getByText("Visible")).toBeTruthy();
    expect(screen.getByText("body content")).toBeTruthy();
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Test" onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText("Close dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Test" onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("closeOnEscape (default true)", () => {
    it("calls onClose when Escape is pressed while open", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Test" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does NOT call onClose when Escape is pressed while closed", () => {
      const onClose = vi.fn();
      render(
        <Modal open={false} title="Test" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("respects closeOnEscape={false} — Escape does not close", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Test" onClose={onClose} closeOnEscape={false}>
          <p>body</p>
        </Modal>
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("does not call onClose for other keys", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Test" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      fireEvent.keyDown(window, { key: "Enter" });
      fireEvent.keyDown(window, { key: "Tab" });
      fireEvent.keyDown(window, { key: "a" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("detaches the Escape listener after the modal closes", () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <Modal open title="Test" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      rerender(
        <Modal open={false} title="Test" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("scrollable", () => {
    it("uses items-center layout by default (not scrollable)", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Test" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      const root = screen.getByRole("dialog");
      expect(root.className).toContain("items-center");
      expect(root.className).not.toContain("items-start");
      expect(root.className).not.toContain("overflow-y-auto");
    });

    it("switches to scrollable layout when scrollable={true}", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Test" onClose={onClose} scrollable>
          <p>body</p>
        </Modal>
      );
      const root = screen.getByRole("dialog");
      expect(root.className).toContain("items-start");
      expect(root.className).toContain("overflow-y-auto");
      expect(root.className).not.toContain("items-center");
    });
  });

  describe("maxWidthClass", () => {
    it("defaults to max-w-md", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Test" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      const panel = screen.getByText("Test").closest("div")?.parentElement;
      expect(panel?.className).toContain("max-w-md");
    });

    it("respects custom maxWidthClass", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Test" onClose={onClose} maxWidthClass="max-w-3xl">
          <p>body</p>
        </Modal>
      );
      const panel = screen.getByText("Test").closest("div")?.parentElement;
      expect(panel?.className).toContain("max-w-3xl");
    });
  });

  describe("title as ReactNode", () => {
    it("renders a ReactNode title verbatim (no <h2> wrapper around it)", () => {
      const onClose = vi.fn();
      render(
        <Modal
          open
          title={
            <div data-testid="custom-title">
              <h2>Main title</h2>
              <p>Subtitle line</p>
            </div>
          }
          onClose={onClose}
        >
          <p>body</p>
        </Modal>
      );
      const custom = screen.getByTestId("custom-title");
      expect(custom).toBeTruthy();
      expect(screen.getByText("Main title")).toBeTruthy();
      expect(screen.getByText("Subtitle line")).toBeTruthy();
    });

    it("wraps a string title in an <h2>", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Plain string" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      const h2 = screen.getByText("Plain string");
      expect(h2.tagName).toBe("H2");
    });
  });

  describe("headerActions", () => {
    it("renders headerActions content in the header row when provided", () => {
      const onClose = vi.fn();
      render(
        <Modal
          open
          title="With actions"
          onClose={onClose}
          headerActions={<span data-testid="badge">Admin</span>}
        >
          <p>body</p>
        </Modal>
      );
      expect(screen.getByTestId("badge")).toBeTruthy();
      expect(screen.getByText("Admin")).toBeTruthy();
    });

    it("omits headerActions slot when prop is not provided", () => {
      const onClose = vi.fn();
      const { container } = render(
        <Modal open title="No actions" onClose={onClose}>
          <p>body</p>
        </Modal>
      );
      // Sanity: no test-only slot rendered
      expect(container.querySelector('[data-testid="badge"]')).toBeNull();
    });
  });

  describe("bodyClassName", () => {
    it("uses default body padding when bodyClassName not provided", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Default" onClose={onClose}>
          <p data-testid="body">body</p>
        </Modal>
      );
      const body = screen.getByTestId("body").parentElement;
      expect(body?.className).toContain("px-5");
      expect(body?.className).toContain("pb-5");
    });

    it("replaces default padding when bodyClassName is provided", () => {
      const onClose = vi.fn();
      render(
        <Modal open title="Edge-to-edge" onClose={onClose} bodyClassName="p-0">
          <p data-testid="body">body</p>
        </Modal>
      );
      const body = screen.getByTestId("body").parentElement;
      expect(body?.className).toBe("p-0");
    });
  });
});
