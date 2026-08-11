// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LedgerCrisis } from "@/lib/alignment/queries/worldAlignment";
import { CrisisDesk } from "./CrisisDesk";

const crisis = (over: Partial<LedgerCrisis> = {}): LedgerCrisis => ({
  id: "c1",
  targetEntityId: "YU",
  targetName: "Yugoslavia",
  title: "A country pulled two ways",
  headline: "Two blocs are both deeply invested here.",
  turnsRemaining: 7,
  movementCap: 7.5,
  ...over,
});

describe("CrisisDesk", () => {
  it("renders nothing at all when the world is quiet", () => {
    const { container } = render(<CrisisDesk crises={[]} />);
    expect(container.textContent).toBe("");
  });

  it("names the nation, what is at stake and how long is left", () => {
    render(<CrisisDesk crises={[crisis()]} />);
    expect(screen.getByText(/Yugoslavia/)).toBeTruthy();
    expect(screen.getByText(/7 turns left/)).toBeTruthy();
  });

  it("shows the raised ceiling against the normal one", async () => {
    const { PER_NATION_TURN_CAP } = await import("@/lib/constants/alignmentEras");
    render(<CrisisDesk crises={[crisis()]} />);
    expect(screen.getByText(/moves up to 7\.5 a turn/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`normally ${PER_NATION_TURN_CAP}`))).toBeTruthy();
  });

  it("marks a crisis about to settle", () => {
    render(<CrisisDesk crises={[crisis({ turnsRemaining: 0 })]} />);
    expect(screen.getByText(/settling/i)).toBeTruthy();
  });
});
