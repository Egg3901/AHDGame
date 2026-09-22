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

  it("disables recruitment when the party-wide NPP capacity is reached", () => {
    const onRecruit = vi.fn();
    render(
      <NppRecruitSegment
        states={[{ ...STATES[0], canRecruit: false }]}
        actionPoints={20}
        recruitFund={100000}
        treasury={5_000_000}
        currency="USD"
        onRecruit={onRecruit}
      />
    );

    const button = screen.getByRole("button", { name: "Party NPP capacity reached" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  // Growth frontier. `canRecruit` now folds in `inFrontier`, so without an
  // explicit branch an unreachable region would wrongly read "Party NPP
  // capacity reached".
  describe("growth frontier", () => {
    const UNREACHABLE = [
      {
        stateId: "CA",
        stateName: "California",
        stateOrg: 0,
        currentNPPs: 0,
        maxSlots: 2,
        availableSlots: 2,
        actionCost: 5,
        canRecruit: false,
        inFrontier: false,
        hasStateLeadership: false,
      },
    ];

    it("names the frontier as the reason rather than capacity", () => {
      render(
        <NppRecruitSegment
          states={UNREACHABLE}
          actionPoints={20}
          recruitFund={100000}
          treasury={5_000_000}
          currency="USD"
          onRecruit={vi.fn()}
        />
      );

      expect(screen.getByText(/out of your party's reach/i)).toBeTruthy();
      expect(screen.queryByText(/capacity reached/i)).toBeNull();
    });

    it("marks an unreachable region on its chip", () => {
      render(
        <NppRecruitSegment
          states={UNREACHABLE}
          actionPoints={20}
          recruitFund={100000}
          treasury={5_000_000}
          currency="USD"
          onRecruit={vi.fn()}
        />
      );

      expect(screen.getByText(/out of reach/i)).toBeTruthy();
    });

    it("preselects a reachable region over an unreachable one", () => {
      const states = [
        { ...UNREACHABLE[0] },
        {
          stateId: "NY",
          stateName: "New York",
          stateOrg: 40,
          currentNPPs: 0,
          maxSlots: 4,
          availableSlots: 4,
          actionCost: 5,
          canRecruit: true,
          inFrontier: true,
          hasStateLeadership: false,
        },
      ];
      render(
        <NppRecruitSegment
          states={states}
          actionPoints={20}
          recruitFund={100000}
          treasury={5_000_000}
          currency="USD"
          onRecruit={vi.fn()}
        />
      );

      expect(screen.getByText(/Recruit NPP in New York/i)).toBeTruthy();
    });
  });
});
