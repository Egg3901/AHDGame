/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { DemocraticCompetition } from "@/lib/governanceStyle/competition";
import type { GovernanceStyleScore } from "@/lib/governanceStyle/score";
import { GovernanceStyleCard } from "./GovernanceStyleCard";

afterEach(cleanup);

function score(
  health: number,
  healthLabel: string,
  competition: DemocraticCompetition | null = null
): GovernanceStyleScore {
  return {
    name: "Governance Style",
    variant: "liberal-democracy",
    leftRight: { value: 50, label: "Centre" },
    democraticHealth: { value: health, label: healthLabel },
    competition,
  };
}

const COMPETITION: DemocraticCompetition = {
  dominantPartyId: "dem",
  dominantSeatShare: 62,
  chambersMeasured: 2,
  executivePartyId: "rep",
  executiveAlignedWithLegislature: false,
  uninterruptedControlTurns: 40,
  consecutiveExecutiveTerms: 0,
  seatMarginPenalty: 1,
  legislativeContinuityPenalty: 0.5,
  executiveContinuityPenalty: 0,
  courtDominantPartyId: null,
  courtDominantShare: 0,
  courtSeated: 3,
  courtPenalty: 0,
  penalty: 1.5,
};

/** The value element of a measure: the definition beside its name. */
function measureValue(name: string): HTMLElement {
  const term = screen.getByText(name);
  return term.nextElementSibling as HTMLElement;
}

describe("GovernanceStyleCard", () => {
  it("heads the section plainly and states the verdict in sentence case", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(screen.getByRole("heading", { level: 2, name: "Governance style" })).toBeTruthy();
    // The catalog headline is title case; the section prints it as a sentence.
    expect(screen.getByText("Democracy under strain")).toBeTruthy();
    // The band's first consequence, as one line of meaning under the verdict.
    expect(
      screen.getByText("Potential GDP growth is up to 1.1 percentage points lower.")
    ).toBeTruthy();
  });

  it("shows each measure's label and score on a plain track with one marker", () => {
    const { container } = render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(measureValue("Political direction").textContent).toBe("Centre 50");
    expect(measureValue("Democratic health").textContent).toBe("Fragile democracy 52");
    expect(
      screen.getByRole("img", { name: "50 on a scale from Left at 0 to Right at 100" })
    ).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "52 on a scale from Failed state at 0 to Healthy democracy at 100",
      })
    ).toBeTruthy();
    // No gradient anywhere: the track is one neutral colour.
    expect(container.innerHTML).not.toContain("gradient");
  });

  it("keeps political direction neutral, because direction is not quality", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(measureValue("Political direction").className).toContain("text-foreground");
    expect(screen.getByText("Political character: Civic balance")).toBeTruthy();
  });

  it("turns democratic health amber in the penalty range", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(measureValue("Democratic health").className).toContain("text-warning");
  });

  it("leaves democratic health neutral once no penalty applies", () => {
    render(<GovernanceStyleCard score={score(64, "Functioning democracy")} />);
    expect(measureValue("Democratic health").className).toContain("text-foreground");
  });

  it("marks a failed state red", () => {
    render(<GovernanceStyleCard score={score(12, "Failed state")} />);
    expect(measureValue("Democratic health").className).toContain("text-error");
  });

  it("keeps the institutional assessment and what the measures mean", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(screen.getByRole("heading", { name: "Institutional assessment" })).toBeTruthy();
    expect(screen.getByText(/Democratic Health is between 40 and 60/)).toBeTruthy();
    expect(screen.getByText(/describe political direction, not quality/)).toBeTruthy();
  });

  it("lists the balance of power as figures, not boxes", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy", COMPETITION)} />);
    const section = screen
      .getByRole("heading", { name: "Balance of power" })
      .closest("section") as HTMLElement;
    const value = (label: string) =>
      within(section).getByText(label).nextElementSibling as HTMLElement;
    expect(value("Chambers").textContent).toBe("62.0%");
    expect(within(section).getByText("Largest party across 2 elected chambers")).toBeTruthy();
    expect(value("Government").textContent).toBe("Divided government");
    expect(value("Continuity").textContent).toBe("New executive");
    // Three seated justices is too few to score packing.
    expect(value("Court").textContent).toBe("n/a");
    expect(value("Institutional cost").textContent).toBe("−1.5");
    expect(within(section).getByText("Points off democratic health")).toBeTruthy();
    expect(section.textContent).toContain("Chamber margins: −1.0.");
    expect(section.textContent).toContain("Legislative continuity: −0.5.");
  });

  it("says when concentrated control costs nothing", () => {
    render(
      <GovernanceStyleCard
        score={score(64, "Functioning democracy", { ...COMPETITION, penalty: 0 })}
      />
    );
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("No pressure on democratic health")).toBeTruthy();
  });

  it("shows a region's scope note under the balance of power, and only with it", () => {
    const note = "The balance of power describes the national legislature.";
    render(
      <GovernanceStyleCard score={score(52, "Fragile democracy", COMPETITION)} scopeNote={note} />
    );
    expect(screen.getByText(note)).toBeTruthy();
    cleanup();
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} scopeNote={note} />);
    expect(screen.queryByText(note)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Balance of power" })).toBeNull();
  });
});
