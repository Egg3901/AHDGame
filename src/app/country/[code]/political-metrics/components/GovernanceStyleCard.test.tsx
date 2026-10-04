/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  executiveSystem: "presidential",
  executiveAlignedWithLegislature: false,
  uninterruptedControlTurns: 40,
  consecutiveExecutiveTerms: 0,
  seatMarginPenalty: 1,
  legislativeContinuityPenalty: 0.5,
  executiveContinuityPenalty: 0,
  courtDominantBloc: null,
  courtDominantShare: 0,
  courtSeated: 3,
  courtLiberalSeats: 0,
  courtSwingSeats: 0,
  courtConservativeSeats: 0,
  courtUnclassifiedSeats: 3,
  courtPenalty: 0,
  penalty: 1.5,
};

/** The figure printed under one of the balance-of-power box labels. */
function boxValue(label: string): string {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

describe("GovernanceStyleCard", () => {
  it("heads the card with the national spirit and its first consequence", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(screen.getByRole("heading", { level: 2, name: "Democracy Under Strain" })).toBeTruthy();
    expect(screen.getByText("National spirit")).toBeTruthy();
    expect(
      screen.getByText("Potential GDP growth is up to 1.1 percentage points lower.")
    ).toBeTruthy();
    expect(screen.getByText("Political character: Civic Balance")).toBeTruthy();
  });

  it("keeps both gradient rails with their coloured value words", () => {
    const { container } = render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(container.querySelectorAll("[class*='bg-gradient-to-r']")).toHaveLength(2);
    // Political direction keeps its accent; democratic health takes its score tone.
    const direction = screen
      .getAllByText("Centre")
      .find((el) => el.className.includes("text-heading"))!;
    expect(direction.className).toContain("text-primary");
    const health = screen
      .getAllByText("Fragile democracy")
      .filter((el) => el.className.includes("text-warning"));
    // The rail's value word and the pill beside the headline.
    expect(health.length).toBe(2);
  });

  it("aligns the headline to the top of the card, not the bottom of the rail panel", () => {
    const { container } = render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    const heading = screen.getByRole("heading", { level: 2 });
    const grid = heading.closest("div.grid") as HTMLElement;
    expect(grid.className).toContain("lg:items-start");
    expect(container.innerHTML).not.toContain("lg:items-end");
  });

  it("keeps the institutional assessment and what this means", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} />);
    expect(screen.getByText("The institutional assessment")).toBeTruthy();
    expect(screen.getByText(/Democratic Health is between 40 and 60/)).toBeTruthy();
    expect(screen.getByText("What this means")).toBeTruthy();
  });

  it("lays the balance of power out in its boxes with the real figures", () => {
    render(<GovernanceStyleCard score={score(52, "Fragile democracy", COMPETITION)} />);
    expect(screen.getByText("Balance of power")).toBeTruthy();
    expect(boxValue("Chambers")).toBe("62.0%");
    expect(screen.getByText("Largest party across 2 elected chambers")).toBeTruthy();
    expect(boxValue("Government")).toBe("Divided government");
    expect(boxValue("Continuity")).toBe("New executive");
    // Three seated justices is too few to score packing.
    expect(boxValue("Court")).toBe("n/a");
    expect(boxValue("Institutional cost")).toBe("−1.5");
    expect(screen.getByText("−1.5 health")).toBeTruthy();
  });

  it("prints a zero penalty as 0.0, never a negative zero", () => {
    const { container } = render(
      <GovernanceStyleCard score={score(52, "Fragile democracy", COMPETITION)} />
    );
    expect(container.textContent).toContain("Chamber margins: −1.0.");
    expect(container.textContent).toContain("Executive continuity: 0.0.");
    expect(container.textContent).toContain("Court concentration: 0.0.");
    expect(container.textContent).not.toContain("−0.0");
  });

  it("says when concentrated control costs nothing", () => {
    const { container } = render(
      <GovernanceStyleCard
        score={score(64, "Functioning democracy", { ...COMPETITION, penalty: 0 })}
      />
    );
    expect(screen.getByText("No pressure")).toBeTruthy();
    expect(boxValue("Institutional cost")).toBe("0.0");
    expect(container.textContent).not.toContain("−0.0");
  });

  it("shows a region's scope note only with the balance of power", () => {
    const note = "The balance of power describes the national legislature.";
    render(
      <GovernanceStyleCard score={score(52, "Fragile democracy", COMPETITION)} scopeNote={note} />
    );
    expect(screen.getByText(note)).toBeTruthy();
    cleanup();
    render(<GovernanceStyleCard score={score(52, "Fragile democracy")} scopeNote={note} />);
    expect(screen.queryByText(note)).toBeNull();
    expect(screen.queryByText("Balance of power")).toBeNull();
  });

  it("sets nothing under 12px", () => {
    const { container } = render(
      <GovernanceStyleCard score={score(52, "Fragile democracy", COMPETITION)} />
    );
    expect(container.innerHTML).not.toMatch(/text-body-xs|text-\[(?:[0-9]|1[01])px\]/);
  });
});
