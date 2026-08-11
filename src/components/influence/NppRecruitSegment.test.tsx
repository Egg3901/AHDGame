/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NppRecruitSegment } from "./NppRecruitSegment";

const STATES = [
  {
    stateId: "CA",
    stateName: "California",
    stateOrg: 70,
    currentNPPs: 2,
    maxSlots: 8,
    availableSlots: 6,
    actionCost: 5,
    canRecruit: true,
    hasStateLeadership: true,
  },
  {
    stateId: "WY",
    stateName: "Wyoming",
    stateOrg: 15,
    currentNPPs: 4,
    maxSlots: 4,
    availableSlots: 0,
    actionCost: 5,
    canRecruit: false,
    hasStateLeadership: false,
  },
];

describe("NppRecruitSegment", () => {
  it("shows slots/quality/cost for the selected state and recruits", () => {
    const onRecruit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <NppRecruitSegment
        states={STATES}
        actionPoints={20}
        recruitFund={100000}
        treasury={5_000_000}
        currency="USD"
        onRecruit={onRecruit}
      />
    );
    expect(screen.getByText(/High/)).toBeTruthy(); // CA org 70 → High quality
    fireEvent.click(screen.getByRole("button", { name: /Recruit/ }));
    expect(onRecruit).toHaveBeenCalledWith("CA");
  });

  it("disables recruit when no slots", () => {
    const onRecruit = vi.fn();
    render(
      <NppRecruitSegment
        states={[STATES[1]]}
        actionPoints={20}
        recruitFund={100000}
        treasury={5_000_000}
        currency="USD"
        onRecruit={onRecruit}
      />
    );
    expect(
      (screen.getByRole("button", { name: /No slots|Recruit/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("disables recruit when treasury cannot cover the fund cost", () => {
    const onRecruit = vi.fn();
    render(
      <NppRecruitSegment
        states={STATES}
        actionPoints={20}
        recruitFund={100000}
        treasury={50000}
        currency="USD"
        onRecruit={onRecruit}
      />
    );
    expect(
      (screen.getByRole("button", { name: /Insufficient|Recruit/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
