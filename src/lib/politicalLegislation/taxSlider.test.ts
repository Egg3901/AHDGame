import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  resolveTaxSliderProvisionFields,
  stampTaxSliderProvisions,
  taxSliderNotchRate,
  taxSliderNpcEconomic,
  taxSliderPolicyOptionId,
  taxSliderRateLabel,
  validateTaxSliderProposal,
} from "./taxSlider";

const SLIDER = {
  scope: "federal" as const,
  taxType: "incomeTax",
  minRate: 0,
  maxRate: 60,
  step: 1,
  baselineRate: 35,
  waypoints: [],
};

describe("validateTaxSliderProposal", () => {
  it("accepts a valid on-grid move of at least one step", () => {
    expect(validateTaxSliderProposal(SLIDER, 38, 35, "rate:38")).toBeNull();
  });
  it("rejects a missing rate", () => {
    expect(validateTaxSliderProposal(SLIDER, undefined, 35, undefined)).toMatch(/required/);
  });
  it("rejects out-of-bounds rates", () => {
    expect(validateTaxSliderProposal(SLIDER, 61, 35, "rate:61")).toMatch(/between/);
  });
  it("rejects off-grid rates", () => {
    expect(validateTaxSliderProposal(SLIDER, 37.5, 35, "rate:37.5")).toMatch(/steps of/);
  });
  it("rejects sub-step moves from the current rate", () => {
    expect(validateTaxSliderProposal(SLIDER, 35, 35, "rate:35")).toMatch(/at least/);
    // Fractional-step slider: 7.2 → 7.3 with step 0.2 is a sub-step move.
    const ni = { ...SLIDER, maxRate: 20, step: 0.2, baselineRate: 7.2 };
    expect(validateTaxSliderProposal(ni, 7.4, 7.2, "rate:7.4")).toBeNull();
  });
  it("rejects a mismatched rate-encoded option id", () => {
    expect(validateTaxSliderProposal(SLIDER, 38, 35, "rate:40")).toMatch(/rate-encoded/);
  });
});

describe("taxSliderNpcEconomic (§5.1b delta force)", () => {
  it("hikes read leftward, scaled by a tenth of the range", () => {
    // 35 → 48 on [0,60]: scale 6 → (35−48)/6 = −2.17
    expect(taxSliderNpcEconomic(SLIDER, 35, 48)).toBeCloseTo(-13 / 6, 5);
  });
  it("cuts read rightward and clamp at ±5", () => {
    expect(taxSliderNpcEconomic(SLIDER, 60, 0)).toBe(5);
    expect(taxSliderNpcEconomic(SLIDER, 0, 60)).toBe(-5);
  });
});

describe("resolveTaxSliderProvisionFields", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function wireBudget(taxRates: Record<string, number> | undefined) {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue(taxRates ? { taxRates } : null),
    } as typeof db.collectionMocks.federalBudget;
  }

  const doc = { taxSlider: SLIDER } as never;

  it("stamps the delta force, sign-of-move direction, and encoded option id", async () => {
    wireBudget({ incomeTax: 35 });
    const resolved = await resolveTaxSliderProvisionFields(
      db as unknown as Db,
      doc,
      38,
      undefined,
      "US"
    );
    expect(resolved).toEqual({
      ok: true,
      fields: {
        proposedRate: 38,
        policyOptionId: taxSliderPolicyOptionId(38),
        economic: taxSliderNpcEconomic(SLIDER, 35, 38),
        social: 0,
        effectDirection: 1,
        policyOptionNameSnapshot: taxSliderRateLabel(38),
        currentPolicyOptionNameSnapshot: taxSliderRateLabel(35),
      },
    });
  });

  it("validates against the LIVE current rate, not the baseline", async () => {
    wireBudget({ incomeTax: 38 });
    const same = await resolveTaxSliderProvisionFields(
      db as unknown as Db,
      doc,
      38,
      undefined,
      "US"
    );
    expect(same.ok).toBe(false);
    const cut = await resolveTaxSliderProvisionFields(
      db as unknown as Db,
      doc,
      30,
      undefined,
      "US"
    );
    expect(cut.ok && cut.fields.effectDirection).toBe(-1);
    expect(cut.ok && cut.fields.economic).toBeGreaterThan(0); // cut → rightward
  });

  it("falls back to the baseline rate when no budget exists", async () => {
    wireBudget(undefined);
    const resolved = await resolveTaxSliderProvisionFields(
      db as unknown as Db,
      doc,
      40,
      undefined,
      "US"
    );
    expect(resolved.ok).toBe(true);
  });

  it("rejects a client-supplied mismatched option id", async () => {
    wireBudget({ incomeTax: 35 });
    const resolved = await resolveTaxSliderProvisionFields(
      db as unknown as Db,
      doc,
      38,
      "rate:50",
      "US"
    );
    expect(resolved.ok).toBe(false);
  });

  it("reads stateBudgets.taxRates for state-scope sliders", async () => {
    db.collection("stateBudgets");
    db.collectionMocks.stateBudgets.findOne = vi
      .fn()
      .mockResolvedValue({ taxRates: { incomeTax: 5 } });
    const stateDoc = {
      taxSlider: { ...SLIDER, scope: "state" as const, maxRate: 25, baselineRate: 5 },
    } as never;
    const missing = await resolveTaxSliderProvisionFields(
      db as unknown as Db,
      stateDoc,
      7,
      undefined,
      "US"
    );
    expect(missing.ok).toBe(false);
    const hiked = await resolveTaxSliderProvisionFields(
      db as unknown as Db,
      stateDoc,
      7,
      undefined,
      "US",
      "NC"
    );
    expect(hiked.ok && hiked.fields.proposedRate).toBe(7);
    expect(hiked.ok && hiked.fields.effectDirection).toBe(1);
    expect(hiked.ok && hiked.fields.policyOptionId).toBe("rate:7");
  });
});

describe("stampTaxSliderProvisions", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("legislationTypes");
    db.collection("stateBudgets");
    db.collectionMocks.legislationTypes.findOne = vi.fn().mockResolvedValue({
      taxSlider: { ...SLIDER, scope: "state", maxRate: 25, baselineRate: 5 },
    });
    db.collectionMocks.stateBudgets.findOne = vi.fn().mockResolvedValue({
      taxRates: { incomeTax: 5 },
    });
  });

  it("stamps slider fields on matching policy provisions", async () => {
    const stamped = await stampTaxSliderProvisions(
      db as unknown as Db,
      [{ legislationTypeId: "us.tax.stateIncomeTax", effectDirection: 0, proposedRate: 7 }],
      "US",
      "NC"
    );
    expect(stamped.ok).toBe(true);
    if (!stamped.ok) return;
    expect(stamped.provisions[0]).toMatchObject({
      legislationTypeId: "us.tax.stateIncomeTax",
      proposedRate: 7,
      policyOptionId: "rate:7",
      effectDirection: 1,
    });
  });

  it("rejects a no-move proposal against the live state rate", async () => {
    const stamped = await stampTaxSliderProvisions(
      db as unknown as Db,
      [{ legislationTypeId: "us.tax.stateIncomeTax", proposedRate: 5 }],
      "US",
      "NC"
    );
    expect(stamped.ok).toBe(false);
  });
});

describe("taxSliderNotchRate (NPC one-notch move)", () => {
  it("moves a tenth of the range, snapped to the grid", () => {
    // [0,60] step 1: notch = 6 → 35 → 41 (hike) / 29 (cut)
    expect(taxSliderNotchRate(SLIDER, 35, 1)).toBe(41);
    expect(taxSliderNotchRate(SLIDER, 35, -1)).toBe(29);
  });
  it("clamps at bounds and returns null when no ≥1-step move exists", () => {
    expect(taxSliderNotchRate(SLIDER, 58, 1)).toBe(60);
    expect(taxSliderNotchRate(SLIDER, 60, 1)).toBeNull();
    expect(taxSliderNotchRate(SLIDER, 0, -1)).toBeNull();
  });
  it("stays on fractional grids", () => {
    const ni = { ...SLIDER, maxRate: 20, step: 0.2, baselineRate: 7.2 };
    const hiked = taxSliderNotchRate(ni, 7.2, 1)!;
    expect(hiked).toBeCloseTo(9.2, 9);
    const gridSteps = (hiked - ni.minRate) / ni.step;
    expect(Math.abs(gridSteps - Math.round(gridSteps))).toBeLessThan(1e-9);
  });
});

describe("taxSliderRateLabel", () => {
  it("labels rates for snapshots and titles", () => {
    expect(taxSliderRateLabel(38)).toBe("Rate: 38%");
  });
});
