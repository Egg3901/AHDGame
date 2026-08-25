import { describe, it, expect } from "vitest";
import { UK_PLEDGE_CATALOG, getPledgeCatalogEntry, pledgeCatalogFor } from "./pledgeCatalog";
import { UK_LAWS } from "@/lib/politicalLegislation/laws/ukLaws";
import { isPledgeKept, evaluateDelivery } from "./manifestoPopularity";

const lawById = new Map(UK_LAWS.map((l) => [l.id, l]));

describe("UK pledge catalog integrity", () => {
  it("has unique ids", () => {
    const ids = UK_PLEDGE_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every target references a real UK law", () => {
    for (const entry of UK_PLEDGE_CATALOG) {
      for (const t of entry.targets) {
        expect(lawById.has(t.legislationTypeId), `${entry.id} → ${t.legislationTypeId}`).toBe(true);
      }
    }
  });

  it("every level target is within the law's level ladder", () => {
    for (const entry of UK_PLEDGE_CATALOG) {
      for (const t of entry.targets) {
        if (t.policyOptionLevel === undefined) continue;
        const law = lawById.get(t.legislationTypeId)!;
        const n = law.levels?.length ?? 0;
        expect(n, `${t.legislationTypeId} has no levels`).toBeGreaterThan(0);
        expect(t.policyOptionLevel).toBeGreaterThanOrEqual(0);
        expect(t.policyOptionLevel).toBeLessThan(n);
      }
    }
  });

  it("positions and salience are in range", () => {
    for (const entry of UK_PLEDGE_CATALOG) {
      expect(Math.abs(entry.position.economic)).toBeLessThanOrEqual(5);
      expect(Math.abs(entry.position.social)).toBeLessThanOrEqual(5);
      expect(entry.baseSalience).toBeGreaterThanOrEqual(0);
      expect(entry.baseSalience).toBeLessThanOrEqual(1);
    }
  });

  it("lookups work", () => {
    expect(getPledgeCatalogEntry("uk.nhs.universal")?.label).toContain("NHS");
    expect(getPledgeCatalogEntry("nope")).toBeUndefined();
    expect(pledgeCatalogFor("UK").length).toBe(UK_PLEDGE_CATALOG.length);
    expect(pledgeCatalogFor("US").length).toBe(0);
  });
});

describe("level-based delivery against a UK catalog pledge", () => {
  const nhs = getPledgeCatalogEntry("uk.nhs.universal")!; // enact, level 4

  it("kept when the NHS reaches the pledged level", () => {
    const r = isPledgeKept(nhs.targets, nhs.targetSemantics, {
      "uk.health.universalCare.primary": { policyOptionIndex: 4 },
    });
    expect(r.kept).toBe(true);
  });

  it("broken when the NHS stays below the pledged level", () => {
    const r = isPledgeKept(nhs.targets, nhs.targetSemantics, {
      "uk.health.universalCare.primary": { policyOptionIndex: 2 },
    });
    expect(r.kept).toBe(false);
  });

  it("maintain pledge breaks only when level falls below the floor", () => {
    const protect = getPledgeCatalogEntry("uk.nhs.protect")!; // maintain, floor 3
    expect(
      isPledgeKept(protect.targets, protect.targetSemantics, {
        "uk.health.universalCare.primary": { policyOptionIndex: 4 },
      }).kept
    ).toBe(true);
    expect(
      isPledgeKept(protect.targets, protect.targetSemantics, {
        "uk.health.universalCare.primary": { policyOptionIndex: 1 },
      }).kept
    ).toBe(false);
    // untouched → kept
    expect(isPledgeKept(protect.targets, protect.targetSemantics, {}).kept).toBe(true);
  });

  it("evaluateDelivery aggregates a real 3-pledge manifesto", () => {
    const pledges = [
      "uk.nhs.universal",
      "uk.economy.soundMoney",
      "uk.education.secondaryForAll",
    ].map((id) => {
      const e = getPledgeCatalogEntry(id)!;
      return { catalogEntryId: e.id, targets: e.targets, targetSemantics: e.targetSemantics };
    });
    const r = evaluateDelivery(pledges, {
      "uk.health.universalCare.primary": { policyOptionIndex: 4 }, // kept
      "uk.economy.fiscal.primary": { policyOptionIndex: 1 }, // below floor 3 → broken
      "uk.education.universalSchooling.primary": { policyOptionIndex: 3 }, // kept
    });
    expect(r.total).toBe(3);
    expect(r.kept).toBe(2);
    expect(r.meter).toBeCloseTo(2 / 3, 5);
  });
});
