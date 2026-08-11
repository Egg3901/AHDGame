import { describe, expect, it } from "vitest";
import { activeExtractionContractFilter } from "./extractionContracts";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";

/**
 * In-memory reimplementation of the Mongo `activeExtractionContractFilter`
 * semantics so we can assert doc-level behaviour (legacy active, offered
 * excluded) rather than only the query shape.
 */
function matchesActiveFilter(doc: Partial<ExtractionContract>): boolean {
  const filter = activeExtractionContractFilter();
  const revokedRule = filter.revokedTurn as { $exists: boolean };
  const statusRule = filter.status as { $nin: string[] };
  // revokedTurn: { $exists: false } → matches only when revokedTurn is absent.
  const revokedMatches = revokedRule.$exists
    ? doc.revokedTurn !== undefined
    : doc.revokedTurn === undefined;
  // status: { $nin: [...] } → absent status matches; otherwise must not be listed.
  const statusMatches = doc.status === undefined || !statusRule.$nin.includes(doc.status);
  return revokedMatches && statusMatches;
}

describe("activeExtractionContractFilter", () => {
  it("produces the canonical query shape", () => {
    expect(activeExtractionContractFilter()).toEqual({
      revokedTurn: { $exists: false },
      status: { $nin: ["offered", "declined"] },
    });
  });

  it("treats a legacy contract with no status as active", () => {
    expect(matchesActiveFilter({})).toBe(true);
  });

  it("treats an explicit active contract as active", () => {
    expect(matchesActiveFilter({ status: "active" })).toBe(true);
  });

  it("excludes offered contracts (they must not allocate capacity)", () => {
    expect(matchesActiveFilter({ status: "offered" })).toBe(false);
  });

  it("excludes declined contracts", () => {
    expect(matchesActiveFilter({ status: "declined" })).toBe(false);
  });

  it("excludes revoked / terminal contracts (revokedTurn set)", () => {
    expect(matchesActiveFilter({ status: "expired", revokedTurn: 40 })).toBe(false);
    expect(matchesActiveFilter({ revokedTurn: 12 })).toBe(false);
  });
});
