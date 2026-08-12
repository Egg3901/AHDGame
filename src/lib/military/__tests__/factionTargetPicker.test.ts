import { describe, it, expect } from "vitest";
import type { ConflictDoc } from "@/lib/db/types/conflict";

/**
 * The target picker both conflict pages build.
 *
 * Extracted here as the rule rather than the component, because BOTH producers
 * (`[conflictId]/page.tsx` and `combat/page.tsx`) compute it independently and the
 * failure is identical in each: a proxy war's rosters are empty by design, so a
 * picker built from `countries` alone offers a player who has joined the war
 * NOTHING to attack — while the declare route would have accepted the faction.
 *
 * The end-to-end verification inserts its declaration straight into the database,
 * so it walks past this entirely. Only a trace from the route back to its producer
 * finds it.
 */
function targetsFor(conflict: Pick<ConflictDoc, "sideA" | "sideB">, ownSide: "A" | "B"): string[] {
  const enemy = ownSide === "A" ? conflict.sideB : conflict.sideA;
  return [...enemy.countries, ...(enemy.factionEntity ? [enemy.factionEntity] : [])];
}

const proxyWar = {
  sideA: {
    label: "RVN",
    countries: ["US"],
    kind: "generated",
    backer: "west",
    factionEntity: "SVN",
  },
  sideB: { label: "DRV", countries: [], kind: "generated", backer: "east", factionEntity: "NVN" },
} as unknown as ConflictDoc;

const interstate = {
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition", backer: "west" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
} as unknown as ConflictDoc;

describe("declaration target picker", () => {
  it("offers the enemy FACTION in a proxy war", () => {
    // Side B's roster is empty, so without the faction this list is [] and the
    // player cannot declare at all.
    expect(targetsFor(proxyWar, "A")).toEqual(["NVN"]);
  });

  it("offers the faction alongside any real belligerents on that side", () => {
    const joined = {
      ...proxyWar,
      sideB: { ...proxyWar.sideB, countries: ["RU"] },
    } as unknown as ConflictDoc;
    expect(targetsFor(joined, "A")).toEqual(["RU", "NVN"]);
  });

  it("is unchanged for an ordinary interstate war", () => {
    expect(targetsFor(interstate, "A")).toEqual(["CN"]);
    expect(targetsFor(interstate, "B")).toEqual(["US", "UK"]);
  });
});
