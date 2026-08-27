import { describe, it, expect } from "vitest";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { principalOf, DICTATE_WINDOW_TURNS } from "./principal";

const base = {
  sideA: { label: "NATO", countries: ["UK", "FR"], kind: "coalition" },
  sideB: { label: "Turkey", countries: ["TR"], kind: "state" },
} as unknown as ConflictDoc;

function withJoins(joins: Array<{ countryId: string; turn: number }>): ConflictDoc {
  return {
    ...base,
    joinTurns: joins.map((j) => ({ ...j, control: 50 })),
  } as unknown as ConflictDoc;
}

describe("principalOf", () => {
  it("names the founder, which is the country with no join stamp", () => {
    expect(principalOf(withJoins([{ countryId: "FR", turn: 50 }]), "A")).toBe("UK");
  });

  it("treats a conflict with no joinTurns as all founders and takes the first", () => {
    // Conflicts predating the field carry none, and every rostered country on one
    // of those was there at the start.
    expect(principalOf(base, "A")).toBe("UK");
  });

  it("reads each side independently", () => {
    expect(principalOf(withJoins([{ countryId: "FR", turn: 50 }]), "B")).toBe("TR");
  });

  it("returns null when every country on the side joined late", () => {
    // The founder has already taken a separate peace. Nobody left holds a claim,
    // so the caller resolves the war outright rather than inventing one.
    const c = withJoins([
      { countryId: "UK", turn: 10 },
      { countryId: "FR", turn: 50 },
    ]);
    expect(principalOf(c, "A")).toBeNull();
  });

  it("returns null for an empty roster, which is a generated side", () => {
    const c = {
      ...base,
      sideB: { label: "Insurgents", countries: [], kind: "generated" },
    } as unknown as ConflictDoc;
    expect(principalOf(c, "B")).toBeNull();
  });

  it("keeps the roster's own order when a side has several founders", () => {
    // Stable because the roster is only ever appended to and spliced, never
    // reordered, so the same country is named on every read.
    const c = withJoins([]);
    expect(principalOf(c, "A")).toBe("UK");
    expect(principalOf(c, "A")).toBe("UK");
  });
});

describe("DICTATE_WINDOW_TURNS", () => {
  it("is long enough for a player to log in and short enough not to hang a war", () => {
    expect(DICTATE_WINDOW_TURNS).toBeGreaterThan(0);
    expect(DICTATE_WINDOW_TURNS).toBeLessThan(72);
  });
});
