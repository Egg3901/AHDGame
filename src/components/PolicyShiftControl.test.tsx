/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyShiftControl } from "./PolicyShiftControl";

afterEach(cleanup);

describe("PolicyShiftControl", () => {
  it("allows a voucher-backed shift even when the player has fewer than 15 actions", () => {
    render(
      <PolicyShiftControl
        axis="economic"
        value={0}
        currentActions={0}
        useVoucher
        onShift={vi.fn()}
      />
    );

    const shiftRight = screen.getByRole("button", { name: "Shift Conservative" });
    expect(shiftRight).toHaveProperty("disabled", false);
    fireEvent.click(shiftRight);

    expect(screen.getByRole("dialog", { name: "Confirm policy shift" })).toBeTruthy();
    expect(screen.getByText("-1 Voucher")).toBeTruthy();
    expect(screen.getByText(/no actions, infamy, influence, or cooldown/i)).toBeTruthy();
    expect(screen.queryByText("-15 Actions")).toBeNull();
  });

  it("still requires 15 actions without a voucher", () => {
    render(<PolicyShiftControl axis="social" value={0} currentActions={0} onShift={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Shift Traditional" })).toHaveProperty(
      "disabled",
      true
    );
  });
});
