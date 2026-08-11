import { describe, it, expect } from "vitest";
import { getElectionMethod } from "@/lib/elections/electionMethod";
import { getCountryConfig } from "@/lib/constants/countries";

// Locks the method values the generalResolution intercepts branch on. If a
// future edit changes a country's method, these guards force a conscious review
// of the corresponding intercept in generalResolution.ts.
describe("resolver intercept dispatch keys", () => {
  it("DE Landtag dispatches on pr_sainteLague (unique to DE Landtag)", () => {
    expect(getElectionMethod("DE", "landtag")).toBe("pr_sainteLague");
  });

  it("DE Bundestag (+ snap) dispatches on ams, scoped by electionType", () => {
    expect(getElectionMethod("DE", "bundestag")).toBe("ams");
    expect(getElectionMethod("DE", "snap_bundestag")).toBe("ams");
  });

  it("AMS is shared by SCO/WAL lower chambers — so the Bundestag intercept guards on electionType, not method alone", () => {
    // SCO Holyrood and WAL Senedd also use AMS. If the Bundestag intercept
    // dispatched on `method === "ams"` alone, their lower-chamber elections
    // would wrongly trigger the DE-specific Landesliste reconciler. The
    // electionType guard (bundestag/snap_bundestag) — types only DE spawns —
    // keeps them out.
    expect(getCountryConfig("SCO").electionSystems.lowerChamber).toBe("ams");
    expect(getCountryConfig("WAL").electionSystems.lowerChamber).toBe("ams");
  });

  it("non-intercepted lower chambers resolve as generic Hare LR", () => {
    for (const [c, t] of [
      ["UK", "commons"],
      ["JP", "shugiin"],
      ["IE", "dail"],
      ["CN", "npcDelegate"],
    ] as const) {
      expect(getElectionMethod(c, t)).toBe("pr_hareQuota");
    }
  });

  it("US President is electoralCollege; IE Uachtarán is fptp (president intercept stays electionType-based)", () => {
    // The president intercept keys on electionType, not method — these values
    // document the head-of-state methods but do NOT drive that dispatch.
    expect(getElectionMethod("US", "president")).toBe("electoralCollege");
    expect(getElectionMethod("IE", "uachtaran")).toBe("fptp");
  });
});
