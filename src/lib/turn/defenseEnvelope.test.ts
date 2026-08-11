import { describe, expect, it } from "vitest";
import { resolveDefenseLineFrom } from "./defenseEnvelope";
import { DEFENSE_ENVELOPE_FALLBACK_GDP_FRACTION } from "@/lib/constants/military";

// The cascade is shared by the defence appropriation (which accrues it) and the Defense
// metrics (whose upkeep burden is denominated against it). Pinning it here is what stops
// the two drifting apart — a player charged off one line and measured against another.
describe("resolveDefenseLineFrom", () => {
  it("prefers the enacted line", () => {
    const line = resolveDefenseLineFrom({
      spending: { byCategory: { defense: 52_800_000_000 } },
      baselineSpendingByCategory: { defense: 1 },
      gdp: 387_000_000_000,
    } as never);
    expect(line).toBe(52_800_000_000);
  });

  it("falls back to the baseline category when nothing is enacted", () => {
    const line = resolveDefenseLineFrom({
      spending: { byCategory: {} },
      baselineSpendingByCategory: { defense: 900 },
      gdp: 387_000_000_000,
    } as never);
    expect(line).toBe(900);
  });

  it("falls back to a GDP fraction when neither exists", () => {
    const line = resolveDefenseLineFrom({ gdp: 1_000 } as never);
    expect(line).toBe(1_000 * DEFENSE_ENVELOPE_FALLBACK_GDP_FRACTION);
  });

  // A non-positive enacted line must not be treated as "enacted" — it falls through
  // rather than pinning the country at zero for the rest of the cascade.
  it("skips a zero or negative enacted line", () => {
    expect(
      resolveDefenseLineFrom({
        spending: { byCategory: { defense: 0 } },
        baselineSpendingByCategory: { defense: 900 },
      } as never)
    ).toBe(900);
    expect(
      resolveDefenseLineFrom({
        spending: { byCategory: { defense: -5 } },
        baselineSpendingByCategory: { defense: 900 },
      } as never)
    ).toBe(900);
  });

  it("returns 0 for a missing budget or an unusable GDP", () => {
    expect(resolveDefenseLineFrom(null)).toBe(0);
    expect(resolveDefenseLineFrom({ gdp: 0 } as never)).toBe(0);
    expect(resolveDefenseLineFrom({ gdp: -5 } as never)).toBe(0);
    expect(resolveDefenseLineFrom({} as never)).toBe(0);
  });
});
