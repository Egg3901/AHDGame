// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import profile from "@/../messages/en/profile.json";
import { ProfileTabs } from "./ProfileTabs";
import type { ComponentProps } from "react";
vi.mock("@/app/world/conflicts/generals/GeneralProfileClient", () => ({
  GeneralProfileClient: ({ editable }: { editable: boolean }) => (
    <p>{editable ? "Editable military" : "Read-only military"}</p>
  ),
}));
afterEach(cleanup);
const base: ComponentProps<typeof ProfileTabs> = {
  conflictsEnabled: true,
  subject: { id: "char-1", name: "Test Character" },
  adopted: {},
  general: null,
  editable: true,
  curEra: 2020,
  children: <div>Political content</div>,
};
function shell(props: Partial<ComponentProps<typeof ProfileTabs>> = {}) {
  return (
    <NextIntlClientProvider locale="en" messages={{ profile }}>
      <ProfileTabs {...base} {...props} />
    </NextIntlClientProvider>
  );
}
describe("profile role views", () => {
  it("always shows all three views and locks inapplicable military and business", () => {
    render(shell({ conflictsEnabled: false }));
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: /Military/ }));
    expect(screen.getByText("Political content")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Military/ }).getAttribute("aria-disabled")).toBe(
      "true"
    );
  });
  it("allows commissioned characters before specialization", () => {
    render(shell({ militaryService: { commissioned: true, commissionedTurn: 7 } }));
    fireEvent.click(screen.getByRole("tab", { name: "Military" }));
    expect(screen.getByText("Commissioned in turn 7")).toBeTruthy();
    expect(screen.getByText(/specialization has not yet/)).toBeTruthy();
  });
  it("keeps former service visible without editing privileges", () => {
    render(
      shell({
        general: { level: 2, xp: 120, pts: 0 },
        militaryService: { commissioned: false, commissionedTurn: 7, dismissedTurn: 21 },
      })
    );
    fireEvent.click(screen.getByRole("tab", { name: "Military" }));
    expect(screen.getByText("Read-only military")).toBeTruthy();
    expect(screen.getByText("Dismissed in turn 21")).toBeTruthy();
  });
  it("enables the investor-only view on another profile without exposing owner finances", () => {
    render(
      shell({ editable: false, business: { corporation: null, isInvestor: true, finances: null } })
    );
    fireEvent.click(screen.getByRole("tab", { name: "CEO / Investor" }));
    expect(screen.getByText("Investor")).toBeTruthy();
    expect(screen.queryByText("Open portfolio")).toBeNull();
    expect(screen.queryByText("Equity portfolio value")).toBeNull();
  });
  it("supports keyboard navigation and resets when the subject changes", () => {
    const { rerender } = render(
      shell({
        business: {
          corporation: { name: "Test Corp", id: "1", type: "energy" },
          isInvestor: false,
          finances: null,
        },
      })
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Political" }), { key: "ArrowRight" });
    expect(screen.getByText("Test Corp")).toBeTruthy();
    rerender(shell({ subject: { id: "char-2", name: "Other Character" } }));
    expect(screen.getByText("Political content")).toBeTruthy();
  });
});
