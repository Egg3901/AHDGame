import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 productivityGrowth sweep guard (P2d). productivityGrowth is now
 * ENGINE-DERIVED from the TFP basket (rdIntensity + workforceSkill + the infra
 * composite + urbanization — registry/economic.ts), so a law whose primary is a
 * BASKET ROOT (rdIntensity, apprenticeshipRate→skill, broadbandAccess, …) and
 * that also targets productivityGrowth directly double-counts via the root
 * pass-through.
 *
 * KEEP-LIST: laws whose productivity mechanism is NOT in the basket —
 * robotics/AI adoption, government digitalization, SME dynamism, labor
 * standards. They model channels the basket lacks (named for the balance pass).
 */
const NON_BASKET_MECHANISM_KEEP_LIST = new Set<string>([
  "de_robotics_ai", // automation adoption — not a basket input
  "de_digital_governance", // government digitalization — not a basket input
  "de_sme_mittelstand", // SME dynamism — not a basket input
  "ie_workers_rights", // labor standards/morale — not a basket input
]);

function productivityHits(lt: LegislationType): string[] {
  const hits: string[] = [];
  if (
    lt.effectTarget?.metricCategoryId === "economic" &&
    lt.effectTarget.metricId === "productivityGrowth"
  ) {
    hits.push("effectTarget productivityGrowth");
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    if (w.metricCategoryId === "economic" && w.metricId === "productivityGrowth") {
      hits.push(`weighted productivityGrowth (${w.weight})`);
    }
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) {
      if (e.category === "economic" && e.metricId === "productivityGrowth") {
        hits.push("option tick productivityGrowth");
      }
    }
  }
  return hits;
}

describe("§4.7 productivityGrowth sweep", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("only non-basket-mechanism laws may target productivityGrowth", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      if (NON_BASKET_MECHANISM_KEEP_LIST.has(lt._id)) continue;
      for (const hit of productivityHits(lt)) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `productivityGrowth double-counts present:\n${offenders.join("\n")}`).toEqual(
      []
    );
  });

  it("keep-list laws still carry their non-basket mechanism effects", () => {
    for (const id of NON_BASKET_MECHANISM_KEEP_LIST) {
      const lt = all.find((l) => l._id === id);
      if (!lt) continue;
      expect(productivityHits(lt).length, `${id} keeps its effect`).toBeGreaterThan(0);
    }
  });
});
