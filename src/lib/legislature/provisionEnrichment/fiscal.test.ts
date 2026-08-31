import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const countryFiscalBase = vi.fn();
const regionFiscalBase = vi.fn();
vi.mock("@/lib/politicalLegislation/fiscalBase", () => ({
  countryFiscalBase: (...args: unknown[]) => countryFiscalBase(...args),
  regionFiscalBase: (...args: unknown[]) => regionFiscalBase(...args),
}));

const computeLawCost = vi.fn();
vi.mock("@/lib/politicalLegislation/costEngine", () => ({
  computeLawCost: (...args: unknown[]) => computeLawCost(...args),
}));

const PROGRAM_LT = {
  _id: "ru_health",
  policyOptions: [
    { id: "o1", name: "Minimal", effectDirection: 1, costModelV2: { gdpCostFraction: 0.01 } },
    { id: "o2", name: "Universal", effectDirection: -1, costModelV2: { gdpCostFraction: 0.04 } },
  ],
};

const STATE_SLIDER_LT = {
  _id: "ru_regional_sales_tax",
  policyOptions: [],
  taxSlider: {
    scope: "state",
    taxType: "salesTax",
    minRate: 0,
    maxRate: 20,
    step: 1,
    baselineRate: 10,
  },
};

const NATIONAL_SLIDER_LT = {
  _id: "ru_income_tax",
  policyOptions: [],
  taxSlider: {
    scope: "national",
    taxType: "incomeTax",
    minRate: 0,
    maxRate: 50,
    step: 1,
    baselineRate: 20,
  },
};

describe("resolveProvisionFiscal — scope selection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    countryFiscalBase.mockResolvedValue({ gdp: 1_000_000, population: 100 });
    regionFiscalBase.mockResolvedValue({ gdp: 10_000, population: 5 });
    computeLawCost.mockReturnValue({ cost: 10, revenue: 4, net: 6 });
  });

  it("prices a program law at region scope using regionFiscalBase", async () => {
    const { resolveProvisionFiscal } = await import("./fiscal");
    await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      PROGRAM_LT as never,
      {},
      1,
      0
    );
    expect(regionFiscalBase).toHaveBeenCalledWith(db, "MOW");
    expect(countryFiscalBase).not.toHaveBeenCalled();
  });

  it("prices a program law at national scope using countryFiscalBase", async () => {
    const { resolveProvisionFiscal } = await import("./fiscal");
    await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "national", countryId: "RU" },
      PROGRAM_LT as never,
      {},
      1,
      0
    );
    expect(countryFiscalBase).toHaveBeenCalledWith(db, "RU");
    expect(regionFiscalBase).not.toHaveBeenCalled();
  });

  it("passes a null income band, matching what enactment charges", async () => {
    // billEnactment prices with bandIndex null. Only the propose modal passes the
    // real band. Detail must agree with enactment, not with the modal.
    const { resolveProvisionFiscal } = await import("./fiscal");
    await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "national", countryId: "RU" },
      PROGRAM_LT as never,
      {},
      1,
      undefined
    );
    expect(computeLawCost).toHaveBeenCalledWith(expect.anything(), expect.anything(), "RU", null);
  });

  it("reads stateBudgets for a state-scoped tax slider in a region", async () => {
    db.collection("stateBudgets").findOne.mockResolvedValue({
      _id: "MOW",
      taxRates: { salesTax: 12 },
      taxBases: { taxableSales: 400 },
    });
    const { resolveProvisionFiscal } = await import("./fiscal");
    const out = await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      STATE_SLIDER_LT as never,
      { proposedRate: 15 },
      undefined,
      undefined
    );
    expect(db.collectionMocks["stateBudgets"]!.findOne).toHaveBeenCalled();
    expect(out.fiscal?.currentRate).toBe(12);
    expect(out.fiscal?.proposedRate).toBe(15);
    expect(out.fiscal?.revenueDelta).toBe(((15 - 12) * 400) / 100);
  });

  it("reads federalBudget for a national-scope slider even on a region bill", async () => {
    db.collection("federalBudget").findOne.mockResolvedValue({
      taxRates: { incomeTax: 22 },
      taxBases: { taxableIncome: 900 },
    });
    const { resolveProvisionFiscal } = await import("./fiscal");
    const out = await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      NATIONAL_SLIDER_LT as never,
      { proposedRate: 25 },
      undefined,
      undefined
    );
    expect(db.collectionMocks["federalBudget"]!.findOne).toHaveBeenCalled();
    expect(out.fiscal?.currentRate).toBe(22);
  });

  it("falls back to the slider baseline when no budget row exists", async () => {
    db.collection("stateBudgets").findOne.mockResolvedValue(null);
    const { resolveProvisionFiscal } = await import("./fiscal");
    const out = await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      STATE_SLIDER_LT as never,
      { proposedRate: 15 },
      undefined,
      undefined
    );
    expect(out.fiscal?.currentRate).toBe(10);
    expect(out.fiscal?.revenueDelta).toBe(0);
  });

  it("returns nothing for a slider provision with no proposed rate", async () => {
    db.collection("stateBudgets").findOne.mockResolvedValue(null);
    const { resolveProvisionFiscal } = await import("./fiscal");
    const out = await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "region", countryId: "RU", regionId: "MOW" },
      STATE_SLIDER_LT as never,
      {},
      undefined,
      undefined
    );
    expect(out).toEqual({});
  });

  it("returns nothing for a non-new-generation legislation type", async () => {
    const { resolveProvisionFiscal } = await import("./fiscal");
    const out = await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "national", countryId: "RU" },
      { _id: "legacy", policyOptions: [{ id: "a", name: "A", effectDirection: 0 }] } as never,
      {},
      0,
      undefined
    );
    expect(out).toEqual({});
  });

  it("returns nothing for a country outside the political-legislation roster", async () => {
    const { resolveProvisionFiscal } = await import("./fiscal");
    const out = await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "region", countryId: "CN", regionId: "XB" },
      PROGRAM_LT as never,
      {},
      1,
      0
    );
    expect(out).toEqual({});
    expect(regionFiscalBase).not.toHaveBeenCalled();
  });

  it("omits current pricing when there is no current law", async () => {
    const { resolveProvisionFiscal } = await import("./fiscal");
    const out = await resolveProvisionFiscal(
      db as unknown as Db,
      { scope: "national", countryId: "RU" },
      PROGRAM_LT as never,
      {},
      1,
      undefined
    );
    expect(out.fiscal?.current).toBeUndefined();
    expect(out.fiscal?.netDelta).toBe(6);
  });
});
