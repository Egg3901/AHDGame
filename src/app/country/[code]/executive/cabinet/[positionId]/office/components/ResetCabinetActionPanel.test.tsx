// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithMessages as render } from "@/lib/test-utils/renderWithMessages";
import { ResetCabinetActionPanel } from "./ResetCabinetActionPanel";
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

describe("Cabinet action availability", () => {
  it("shows why a paid action is blocked while enabling Staff work", () => {
    const base = {
      target: "M47",
      targetNames: ["Transparency"],
      strength: 0.08,
      scope: "Nat" as const,
      brief: "Review delivery",
      description: "Details",
    };
    render(
      <ResetCabinetActionPanel
        canAct
        countryCode="jp"
        positionId="chief_cabinet_secretary"
        currencySymbol="¥"
        onUpdate={vi.fn()}
        model={{
          charges: 4,
          nextRechargeTurn: null,
          active: [],
          actions: [
            {
              ...base,
              id: "paid",
              title: "Paid work",
              costClass: "Ops",
              operatingCost: 100,
              allowed: false,
              blockReason: "insufficient_funds",
            },
            {
              ...base,
              id: "staff",
              title: "Staff work",
              costClass: "Staff",
              operatingCost: 0,
              allowed: true,
            },
          ],
        }}
      />
    );
    const buttons = screen.getAllByRole("button", { name: "Use action" });
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/needs available department funds/)).toBeTruthy();
  });
});
