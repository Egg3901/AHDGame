/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useDialogA11y } from "./useDialogA11y";

afterEach(cleanup);

function Dialog({ onClose, closeOnEscape }: { onClose: () => void; closeOnEscape?: boolean }) {
  const { dialogProps, titleId } = useDialogA11y(onClose, { closeOnEscape });
  return (
    <div className="fixed inset-0" {...dialogProps}>
      <h2 id={titleId}>Spin off a subsidiary</h2>
      <button onClick={onClose} aria-label="Close">
        x
      </button>
    </div>
  );
}

describe("useDialogA11y (#15)", () => {
  it("marks the container as a modal dialog", () => {
    render(<Dialog onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  // The part that is easy to miss: role + aria-modal without a name leaves a
  // screen reader announcing only "dialog".
  it("gives the dialog an accessible name from its heading", () => {
    render(<Dialog onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Spin off a subsidiary" })).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("honours closeOnEscape: false for deliberate-dismiss dialogs", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} closeOnEscape={false} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Dialog onClose={onClose} />);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives two open dialogs distinct heading ids", () => {
    render(
      <>
        <Dialog onClose={vi.fn()} />
        <Dialog onClose={vi.fn()} />
      </>
    );
    const [a, b] = screen.getAllByRole("dialog");
    expect(a.getAttribute("aria-labelledby")).not.toBe(b.getAttribute("aria-labelledby"));
  });
});
