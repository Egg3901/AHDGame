/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Character } from "@/lib/db/types";
import { PoliticalStanding } from "./PoliticalStanding";

const baseProps = {
  character: { actions: 5, party: "2" } as unknown as Character,
  homeState: null,
  influence: 0,
  nationalInfluence: 0,
  influenceDecay: "0",
  nationalGainPerTurn: "0",
  favorability: 50,
  favColor: "#fff",
  favDecayDisplay: null,
  infamy: 0,
  infamyPenalty: null,
  maxNPI: 100,
  baseActionsPerTurn: 4,
  officeActionBonus: 2,
  chairActionBonus: 0,
  totalActionsPerTurn: 6,
  actionHoarding: false,
};

describe("PoliticalStanding action breakdown", () => {
  it("renders each labeled source line in the Actions tooltip when opened", () => {
    render(
      <PoliticalStanding
        {...baseProps}
        bonusActionsFromParty={3}
        actionBreakdown={[
          { label: "Base", amount: 4 },
          { label: "Office (Member of Bundestag)", amount: 1 },
          { label: "Cabinet (Federal Minister of Defence)", amount: 1 },
          { label: "Party influence", amount: 3 },
        ]}
      />
    );

    // Tooltip content only renders once the trigger is focused/opened.
    fireEvent.focus(screen.getByText("Actions"));

    expect(screen.getByText("Office (Member of Bundestag)")).toBeTruthy();
    expect(screen.getByText("Cabinet (Federal Minister of Defence)")).toBeTruthy();
    expect(screen.getByText("Party influence")).toBeTruthy();
    // Amounts render with a leading "+".
    expect(screen.getAllByText("+1").length).toBeGreaterThanOrEqual(2);
  });

  it("renders no breakdown block when actionBreakdown is absent", () => {
    render(<PoliticalStanding {...baseProps} />);
    fireEvent.focus(screen.getByText("Actions"));
    expect(screen.queryByText(/Cabinet \(/)).toBeNull();
  });
});
