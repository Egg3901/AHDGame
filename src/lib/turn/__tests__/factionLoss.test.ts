import { describe, it, expect } from "vitest";
import { factionLoss } from "../battleResolution";
import type { SideOutcome } from "@/lib/military/battle";

const side = (over: Partial<SideOutcome>): SideOutcome =>
  ({ country: "NVN", power: 500, loss: 0, unitResults: [], ...over }) as SideOutcome;

/**
 * A faction has no `militaryUnits` rows, so its casualties are billed against the
 * conflict's `tokenStrength`. The bill has to be its OWN.
 */
describe("factionLoss", () => {
  it("charges the faction only its own dead when a real ally defends beside it", () => {
    const defender = side({
      loss: 13_000,
      contingents: [
        { country: "NVN", power: 300, loss: 3_000 },
        { country: "RU", power: 700, loss: 10_000 },
      ],
    });
    // The bug: the whole side's 13,000 came off the token force, so the faction
    // absorbed every casualty its ally took as well as its own.
    expect(factionLoss(defender, "NVN")).toBe(3_000);
  });

  it("takes the whole side on a pre-coalition outcome the faction alone names", () => {
    // Those outcomes name one country per side, and for those the faction WAS the
    // whole side — the total is its own.
    expect(factionLoss(side({ loss: 4_200 }), "NVN")).toBe(4_200);
  });

  it("charges nothing on a pre-coalition outcome named for someone else", () => {
    expect(factionLoss(side({ country: "RU", loss: 4_200 }), "NVN")).toBe(0);
  });

  it("rounds to whole men, because tokenStrength is an integer", () => {
    const defender = side({
      loss: 10,
      contingents: [{ country: "NVN", power: 300, loss: 3.6 }],
    });
    expect(factionLoss(defender, "NVN")).toBe(4);
  });

  it("never returns a negative charge", () => {
    const defender = side({
      loss: 10,
      contingents: [{ country: "NVN", power: 300, loss: -5 }],
    });
    expect(factionLoss(defender, "NVN")).toBe(0);
  });

  it("charges nothing when the faction took no part in the engagement", () => {
    const defender = side({
      country: "RU",
      loss: 10_000,
      contingents: [{ country: "RU", power: 700, loss: 10_000 }],
    });
    expect(factionLoss(defender, "NVN")).toBe(0);
  });
});
