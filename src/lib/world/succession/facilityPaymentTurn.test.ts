import { ObjectId, type ClientSession, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { materializeFacilityPaymentTurn } from "./facilityPaymentTurn";

vi.mock("@/lib/mongodb", () => ({ getMongoClient: vi.fn() }));
const applicationId = "1991-default:split:1";
function scenario(count = 1) {
  const mem = createInMemoryDb();
  mem.seed("federationSettlementApplications", [
    {
      _id: applicationId,
      presetId: "1991-default",
      settlementId: "split",
      revision: 1,
      sourceEntityId: "RU",
      entityIds: ["RU", "UKR"],
      status: "applied",
      appliedOnTurn: 96,
    },
  ]);
  mem.seed(
    "worldEntityStates",
    ["RU", "UKR"].map((entityId) => ({
      _id: `1991-default:${entityId}`,
      applicationId,
      entityId,
      appliedOnTurn: 96,
    }))
  );
  const firms = Array.from({ length: count }, () => ({
    _id: new ObjectId(),
    countryId: "RU",
    liquidCurrencyCode: "RUB",
    liquidCapital: 100,
  }));
  const claims = firms.map((firm, index) => ({
    _id: `${applicationId}:plant-${index}`,
    applicationId,
    claimId: `plant-${index}`,
    corporationId: firm._id.toHexString(),
    sectorId: `sector-${index}`,
    debtorEntityId: "UKR",
    creditorCountryId: "RU",
    amountAnchor: 10,
    status: "payable",
  }));
  mem.seed("corporations", firms);
  mem.seed("federationFacilityClaims", claims);
  mem.seed("federationFiscalAccounts", [
    {
      _id: `${applicationId}:UKR`,
      applicationId,
      entityId: "UKR",
      kind: "background-successor",
      claimIds: claims.map((claim) => claim.claimId),
      facilityClaimLiabilityMinor: 1000 * count,
    },
  ]);
  mem.seed("macroCountries", [
    {
      _id: "UKR",
      presetId: "1991-default",
      simulationTier: "background-macro",
      federationTreasuryMinor: 500 * count,
    },
  ]);
  mem.seed("exchangeRates", [{ _id: "RUB", currencyCode: "RUB", rate: 2 }]);
  const input = {
    db: mem as unknown as Db,
    session: { inTransaction: () => true } as ClientSession,
    applicationId,
    turn: 97,
    now: new Date(0),
  };
  return { mem, input };
}
describe("treasury-funded private facility payments", () => {
  it("conserves cash across partial payments, exchange conversion and same-turn replay", async () => {
    const { mem, input } = scenario();
    const first = await materializeFacilityPaymentTurn(input);
    expect(first).toMatchObject({
      paidMinor: 500,
      successorPaymentsMinor: { UKR: 500 },
      payments: [{ paidMinor: 500, currencyCode: "RUB", rate: 2, localAmount: 10 }],
    });
    expect(mem.collection("corporations").docs[0].liquidCapital).toBe(110);
    expect(mem.collection("macroCountries").docs[0].federationTreasuryMinor).toBe(0);
    expect(mem.collection("federationFacilityClaims").docs[0]).toMatchObject({
      status: "payable",
      paidMinor: 500,
    });
    expect(await materializeFacilityPaymentTurn(input)).toEqual(first);
    expect(mem.collection("corporations").docs[0].liquidCapital).toBe(110);
    mem.collection("macroCountries").docs[0].federationTreasuryMinor = 700;
    expect((await materializeFacilityPaymentTurn({ ...input, turn: 98 })).paidMinor).toBe(500);
    expect(mem.collection("corporations").docs[0].liquidCapital).toBe(120);
    expect(mem.collection("macroCountries").docs[0].federationTreasuryMinor).toBe(200);
    expect(mem.collection("federationFacilityClaims").docs[0]).toMatchObject({
      status: "paid",
      paidMinor: 1000,
    });
    expect((await materializeFacilityPaymentTurn({ ...input, turn: 99 })).paidMinor).toBe(0);
  });
  it("pays 100 firms with one projected firm read and one batch per collection", async () => {
    const { mem, input } = scenario(100);
    const firms = mem.collection("corporations");
    const read = vi.spyOn(firms, "find");
    const firmWrite = vi.spyOn(firms, "bulkWrite");
    const claimWrite = vi.spyOn(mem.collection("federationFacilityClaims"), "bulkWrite");
    const macroWrite = vi.spyOn(mem.collection("macroCountries"), "bulkWrite");
    expect((await materializeFacilityPaymentTurn(input)).paidMinor).toBe(50000);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projection: expect.objectContaining({ liquidCapital: 1, liquidCurrencyCode: 1 }),
      })
    );
    for (const write of [firmWrite, claimWrite, macroWrite]) expect(write).toHaveBeenCalledOnce();
    expect(firms.docs.every((firm) => firm.liquidCapital === 110)).toBe(true);
  });
  it("carries claims forward while preserving a successor overdraft", async () => {
    const { mem, input } = scenario();
    mem.collection("macroCountries").docs[0].federationTreasuryMinor = -100;
    expect((await materializeFacilityPaymentTurn(input)).paidMinor).toBe(0);
    expect(mem.collection("macroCountries").docs[0].federationTreasuryMinor).toBe(-100);
    expect(mem.collection("corporations").docs[0].liquidCapital).toBe(100);
  });
  it.each(["protected", "relocated", "missing"])(
    "defers a %s recipient without redirecting cash",
    async (kind) => {
      const { mem, input } = scenario();
      const firms = mem.collection("corporations").docs;
      if (kind === "protected") firms[0].federationPendingHeadquartersId = applicationId;
      if (kind === "relocated") firms[0].countryId = "PL";
      if (kind === "missing") firms.splice(0);
      expect(await materializeFacilityPaymentTurn(input)).toMatchObject({
        paidMinor: 0,
        deferredClaimIds: ["plant-0"],
      });
      expect(mem.collection("macroCountries").docs[0].federationTreasuryMinor).toBe(500);
    }
  );
  it.each(["rate", "liability", "receipt", "treasury"])(
    "rejects a changed %s before writes",
    async (kind) => {
      const { mem, input } = scenario();
      if (kind === "rate") mem.collection("exchangeRates").docs[0].rate = 0;
      if (kind === "liability") mem.collection("federationFacilityClaims").docs[0].paidMinor = 1001;
      if (kind === "receipt") mem.collection("worldEntityStates").docs.splice(0, 1);
      if (kind === "treasury")
        delete mem.collection("macroCountries").docs[0].federationTreasuryMinor;
      const write = vi.spyOn(mem.collection("corporations"), "bulkWrite");
      await expect(materializeFacilityPaymentTurn(input)).rejects.toThrow();
      expect(write).not.toHaveBeenCalled();
      expect(mem.collection("federationFacilityPaymentTurns").docs).toHaveLength(0);
    }
  );
  it("rejects missing transaction and same-turn activation", async () => {
    const { input } = scenario();
    await expect(
      materializeFacilityPaymentTurn({
        ...input,
        session: { inTransaction: () => false } as ClientSession,
      })
    ).rejects.toThrow("transaction");
    await expect(materializeFacilityPaymentTurn({ ...input, turn: 96 })).rejects.toThrow("earlier");
  });
});
