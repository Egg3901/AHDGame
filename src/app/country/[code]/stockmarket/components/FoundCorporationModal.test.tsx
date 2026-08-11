/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoundCorporationModal } from "./FoundCorporationModal";

function renderModal(foundingRate: number) {
  render(
    <FoundCorporationModal
      open
      onClose={() => {}}
      onSuccess={() => {}}
      currencySymbol="¥"
      foundingRate={foundingRate}
    />
  );
  return screen.getByRole("spinbutton") as HTMLInputElement;
}

describe("FoundCorporationModal — Starting Treasury input", () => {
  it("seeds the baseline treasury in local currency when opened (CN 7.2x)", () => {
    const input = renderModal(7.2);
    // Baseline 1,000,000 ₳ → 7,200,000 ¥.
    expect(input.value).toBe("7200000");
  });

  it("preserves a freely typed local amount at a non-USD rate", () => {
    const input = renderModal(7.2);
    // Player wants a 35,000,000 ¥ treasury. The field must keep what they typed,
    // not re-derive it through a lossy floor(local/rate)→round(anchor*rate) trip.
    fireEvent.change(input, { target: { value: "35000000" } });
    expect(input.value).toBe("35000000");
  });

  it("accepts digit-by-digit entry without the value fighting the typist", () => {
    const input = renderModal(7.2);
    // Simulate a real browser: each keystroke appends to whatever the field
    // currently shows, then React reconciles the controlled value.
    for (const next of ["1", "10", "100", "1000", "10000", "100000", "1000000", "10000000"]) {
      fireEvent.change(input, { target: { value: next } });
    }
    expect(input.value).toBe("10000000");
  });

  it("is an identity at the USD rate (regression guard for the 1.0 case)", () => {
    const input = renderModal(1);
    fireEvent.change(input, { target: { value: "5000000" } });
    expect(input.value).toBe("5000000");
  });

  it("does not flag the freshly-seeded default treasury as below the minimum", () => {
    // Guards a floor(baseLocal/rate) underflow: if 7,200,000 / 7.2 floored to
    // 999,999 the default would wrongly fail the minimum check and disable
    // founding out of the box.
    renderModal(7.2);
    expect(screen.queryByText(/Minimum starting treasury/i)).toBeNull();
  });
});

describe("FoundCorporationModal — founding cooldown (Bug #0728)", () => {
  it("shows the countdown and disables founding while on cooldown", () => {
    render(
      <FoundCorporationModal
        open
        onClose={() => {}}
        onSuccess={() => {}}
        currencySymbol="$"
        foundingRate={1}
        foundingCooldownTurnsRemaining={42}
      />
    );
    expect(screen.getByText(/found another corporation in 42 turns/i)).toBeTruthy();
    const foundButton = screen.getByRole("button", { name: /Found Corporation/i });
    expect((foundButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not show the cooldown notice when off cooldown", () => {
    render(
      <FoundCorporationModal
        open
        onClose={() => {}}
        onSuccess={() => {}}
        currencySymbol="$"
        foundingRate={1}
        foundingCooldownTurnsRemaining={0}
      />
    );
    expect(screen.queryByText(/found another corporation in/i)).toBeNull();
  });
});

describe("FoundCorporationModal — mobile reachability (ticket #1003)", () => {
  it("keeps Cancel/Found above the sticky status bar and scrolls the body", () => {
    const { container } = render(
      <FoundCorporationModal
        open
        onClose={() => {}}
        onSuccess={() => {}}
        currencySymbol="$"
        foundingRate={1}
      />
    );
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.className).toContain("pb-28");
    expect(overlay.className).toContain("z-[100]");

    const panel = overlay.firstElementChild as HTMLElement;
    expect(panel.className).toContain("max-h-[85dvh]");
    expect(panel.className).toContain("flex-col");
    expect(panel.className).toContain("overflow-hidden");

    // Footer actions must remain mounted (sticky footer), not buried in the
    // scroll body where the status bar used to cover them on Android Chrome.
    expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Found Corporation/i })).toBeTruthy();
  });

  it("uses step=1 so in-range era treasuries are not :invalid", () => {
    // Regression: step=100000 with a 1953 min of ~14,333 painted Chrome's red
    // :invalid outline on legal amounts like 70,000 ((70000-14333)%100000≠0).
    const input = renderModal(1);
    expect(input.step).toBe("1");
  });
});
