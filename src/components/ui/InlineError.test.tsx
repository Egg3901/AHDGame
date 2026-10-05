/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineError } from "./InlineError";

describe("InlineError", () => {
  it("renders nothing without an error", () => {
    const { container } = render(<InlineError error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows message, code and shortened ref", () => {
    render(
      <InlineError
        error={{ message: "Could not save", code: "CONFLICT", ref: "0123456789abcdef" }}
      />
    );
    expect(screen.getByText("Could not save")).toBeTruthy();
    expect(screen.getByTestId("inline-error-code").textContent).toBe("CONFLICT / 01234567");
  });

  it("normalizes thrown errors and offers retry only when retryable", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <InlineError error={new TypeError("Failed to fetch")} onRetry={onRetry} />
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<InlineError error={{ message: "no", code: "FORBIDDEN" }} onRetry={onRetry} />);
    expect(screen.queryByText("Retry")).toBeNull();
  });
});
