import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { NationalizationLedgerEntry } from "@/lib/db/types";
import { summarizeRegister, confidenceFeeds } from "./registerView";

function entry(over: Partial<NationalizationLedgerEntry>): NationalizationLedgerEntry {
  return {
    _id: new ObjectId(),
    countryId: "CN",
    nationalCorporationId: new ObjectId(),
    kind: "nationalize_whole",
    method: "legislative",
    triggers: ["strategic"],
    tier: "fair",
    valuationAnchor: 1000,
    compensationAnchor: 1000,
    sectorTypes: ["energy"],
    turn: 10,
    createdAt: new Date(0),
    ...over,
  } as NationalizationLedgerEntry;
}

const opts = { currency: "CNY" as const, fxRate: 1, ideologyMultiplier: 1 };

describe("summarizeRegister", () => {
  it("builds display rows: local amounts, seizure→null compensation, debt + shareholders", () => {
    const rows = summarizeRegister(
      [
        entry({
          kind: "nationalize_whole",
          tier: "seizure",
          triggers: ["npc"],
          compensationAnchor: 0,
          debtAnchor: 6_400,
          shareholdersSettled: 1200,
          formerCorpName: "Donghai Power Group",
          confidenceBefore: 75,
          confidenceAfter: 63,
        }),
      ],
      opts
    ).rows;
    expect(rows[0].firm).toBe("Donghai Power Group");
    expect(rows[0].compensationLocal).toBeNull(); // seizure pays nothing → "—"
    expect(rows[0].debtLocal).toBe(6_400);
    expect(rows[0].shareholdersSettled).toBe(1200);
    expect(rows[0].confidenceDelta).toBe(-12);
    expect(rows[0].approvalDelta).toBe(0); // NPC taking — no investor expropriated
    expect(rows[0].unrestDelta).toBeNull();
    expect(rows[0].sectorLabel).toBe("Energy");
  });

  it("counts only whole-corp takings as firms absorbed and sums the financial totals", () => {
    const { totals } = summarizeRegister(
      [
        entry({ kind: "nationalize_whole", compensationAnchor: 8_900, debtAnchor: 3_100 }),
        entry({ kind: "nationalize_sector", compensationAnchor: 5_200, debtAnchor: undefined }),
        entry({ kind: "privatize_ipo", compensationAnchor: 0, newCorpName: "Spinco" }),
      ],
      opts
    );
    expect(totals.firmsAbsorbed).toBe(1); // only the whole-corp row
    expect(totals.compensationLocal).toBe(14_100); // 8_900 + 5_200
    expect(totals.debtLocal).toBe(3_100);
  });

  it("a popular taking (distress/monopoly) nudges approval up; an unpopular one down", () => {
    const popular = summarizeRegister([entry({ triggers: ["distress"], tier: "fair" })], opts)
      .rows[0];
    const unpopular = summarizeRegister([entry({ triggers: ["strategic"], tier: "seizure" })], opts)
      .rows[0];
    expect(popular.approvalDelta).toBeGreaterThan(0);
    expect(unpopular.approvalDelta).toBeLessThan(0);
  });

  it("privatization approval follows ideology: market govt gains, statist govt loses", () => {
    const market = summarizeRegister([entry({ kind: "privatize_ipo", triggers: [] })], {
      ...opts,
      ideologyMultiplier: 1.5, // market bloc
    }).rows[0];
    const statist = summarizeRegister([entry({ kind: "privatize_ipo", triggers: [] })], {
      ...opts,
      ideologyMultiplier: 0.5, // statist bloc
    }).rows[0];
    expect(market.approvalDelta).toBeGreaterThan(0);
    expect(statist.approvalDelta).toBeLessThan(0);
  });
});

describe("confidenceFeeds", () => {
  it("is all-zero at/above baseline and negative below it", () => {
    const atBaseline = confidenceFeeds(70, 70);
    expect(atBaseline[0].value).toBe("0%");
    expect(atBaseline[1].value).toBe("+0 bps");

    const below = confidenceFeeds(54, 70); // gap 16 / 70
    expect(parseFloat(below[0].value)).toBeLessThan(0); // margin drag
    expect(below[1].value).toMatch(/^\+\d+ bps$/);
    expect(below[2].value).toMatch(/^-\d+%$/);
  });
});
