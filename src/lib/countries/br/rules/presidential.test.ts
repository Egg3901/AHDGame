import { describe, expect, it } from "vitest";
import { brazilPresidentialRules, decideBrazilPresidency } from "./presidential";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";

describe("Brazil presidential renewal", () => {
  it("uses era-specific selection, cadence and anchors", () => {
    expect(brazilPresidentialRules("1953-default")).toEqual({
      firstYear: 1955,
      termTurns: 240,
      mode: "plurality",
    });
    expect(brazilPresidentialRules("1979-default").mode).toBe("indirect");
    expect(brazilPresidentialRules("1991-default").firstYear).toBe(1994);
    expect(() => brazilPresidentialRules("unknown")).toThrow();
  });
  it("anchors Brazil independently of the US president and retains its five-year cadence", () => {
    const ctx = { preset: "1953-default", startingYear: 1953, preIterationTurns: 20 };
    const first = canonicalTurnsForCycle({
      countryId: "BR",
      electionType: "president",
      cycle: 1,
      ctx,
    });
    const second = canonicalTurnsForCycle({
      countryId: "BR",
      electionType: "president",
      cycle: 2,
      ctx,
    });
    expect(first?.endTurn).toBe(164);
    expect(second!.endTurn - first!.endTurn).toBe(240);
  });
  it("uses plurality or congressional marks directly but requires a fresh modern runoff", () => {
    const votes = { a: 40, b: 35, c: 25 };
    expect(decideBrazilPresidency(votes, "plurality", 1)).toEqual({
      outcome: "won",
      winnerId: "a",
    });
    expect(decideBrazilPresidency(votes, "indirect", 1)).toEqual({ outcome: "won", winnerId: "a" });
    expect(decideBrazilPresidency(votes, "majority", 1)).toEqual({
      outcome: "runoff",
      finalistIds: ["a", "b"],
    });
    expect(decideBrazilPresidency({ a: 49, b: 51 }, "majority", 2)).toEqual({
      outcome: "won",
      winnerId: "b",
    });
    expect(decideBrazilPresidency({ a: 50, b: 50 }, "majority", 1).outcome).toBe("runoff");
    expect(decideBrazilPresidency({}, "majority", 1).outcome).toBe("indeterminate");
  });
});
