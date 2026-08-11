import { describe, it, expect } from "vitest";
import { electionTitle } from "./ElectionDetailHelpers";
import type { ElectionDetail } from "./ElectionDetailTypes";

const base = (overrides: Partial<ElectionDetail>): ElectionDetail =>
  ({ electionType: "house", countryId: "US", totalSeats: null, ...overrides }) as ElectionDetail;

describe("electionTitle — country-aware overrides", () => {
  it("uses NG chamber names, not US strings", () => {
    expect(electionTitle(base({ electionType: "house", countryId: "NG", totalSeats: 60 }))).toBe(
      "House of Representatives Race · 60 seats"
    );
    expect(electionTitle(base({ electionType: "senate", countryId: "NG" }))).toBe("Senate Race");
    expect(
      electionTitle(base({ electionType: "regionalCouncil", countryId: "NG", totalSeats: 137 }))
    ).toBe("State House of Assembly Race · 137 seats");
  });

  it("uses plain de-prefixed US titles (no 'U.S.')", () => {
    expect(electionTitle(base({ electionType: "house", countryId: "US", totalSeats: 5 }))).toBe(
      "House Race · 5 seats"
    );
    expect(electionTitle(base({ electionType: "senate", countryId: "US" }))).toBe("Senate Race");
  });
});
