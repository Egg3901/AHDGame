import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { unownedHeadroomUnitsPerAnchor } from "@/lib/market/unownedHeadroom";

vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  anchorToCorpLiquidCapital: vi.fn((v: number) => v),
  corpLiquidCapitalToAnchor: vi.fn((v: number) => v),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  resolveCorpLiquidCurrencyCode: vi.fn(() => "CNY"),
  resolveSectorHostCurrencyCode: vi.fn(() => "CNY"),
  fxRateForSectorHostFromMap: vi.fn(() => 1),
}));
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  readCorpEconomicAnchor: vi.fn((v: number) => v), // rate 1 ⇒ passthrough
}));
// NPV math has its own canonical tests in corporateBondDefault; here we mock it
// to a fixed valuation and test orchestration (route, re-parent, tier-applied
// payout, donor credit, bond re-stamp, shell teardown) rather than re-test NPV.
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  computeSectorNpvSum: vi.fn(() => 4000),
  allocateShareholderPool: vi.fn(() => ({
    characterRows: [],
    corporationRows: [],
    fundRows: [],
    publicFloatRow: null,
  })),
}));
vi.mock("@/lib/bonds/bondPrincipalSum", () => ({
  sumBondPrincipalAnchor: vi.fn(() => 0),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
// Politics are tested in consequences/apply.test.ts; mock here so the Phase-1
// transition assertions (re-parent, payout, teardown) stay isolated.
vi.mock("./consequences/apply", () => ({
  applyNationalizationConsequences: vi.fn().mockResolvedValue({
    confidenceBefore: 70,
    confidenceAfter: 70,
    legitimacyDelta: 0,
    approvalMetricNudges: [],
    foreignOwnerRecorded: null,
  }),
}));

/** Minimal politics context for the Phase-1 transition assertions. */
const CONSEQ = { method: "executive" as const, triggers: [] as [], turn: 1 };
vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn((amt: number) => ({ cashOnHand: amt })),
  getHomeCurrency: vi.fn(() => "USD"),
}));
vi.mock("@/lib/currency/govBudgetFields", () => ({
  writeGovBudgetLocal: vi.fn((v: number) => v),
}));
vi.mock("@/lib/centralBank/helpers", () => ({ getBankId: vi.fn(() => "CN-cb") }));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/financialTxLog/stampDeleted", () => ({
  stampSubjectDeleted: vi.fn().mockResolvedValue(undefined),
}));
// Treasury debit has its own unit tests; mock so orchestration tests stay focused.
vi.mock("./treasury", () => ({
  debitTreasuryCompensation: vi.fn().mockResolvedValue(0),
  creditTreasuryProceeds: vi.fn().mockResolvedValue(undefined),
}));
// NatCorp resolution/ensure have their own tests in nationalCorporation.test.ts.
// Mock them here so the engine tests are decoupled from corporations.findOne
// call ordering and assert routing/orchestration directly.
vi.mock("./nationalCorporation", () => ({
  ensurePrimaryNationalCorporation: vi.fn(),
  resolveNationalCorporationForSector: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("centralBanks");
  db.collection("bonds");
  db.collection("characters");
  db.collection("imperialCharacters");
});

function findCursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("nationalizeSector", () => {
  async function setup(opts: { natCorpId: ObjectId; donorId: ObjectId; sectorId: ObjectId }) {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: opts.sectorId,
      corporationId: opts.donorId,
      countryId: "CN",
      stateId: "CN-HD",
      sectorType: "energy",
      revenue: 6_000_000,
      profitMargin: 35,
      workers: 500,
      currentGrowthCost: 0,
    });
    // corporations.findOne is only called once now (donor by sector.corporationId).
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: opts.donorId,
      name: "Donor Co",
      countryId: "CN",
      liquidCapital: 1000,
      liquidCurrencyCode: "CNY",
    });
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({
      _id: opts.natCorpId,
      countryId: "CN",
      countryOwnerId: "CN",
    } as never);
  }

  it("routes the sector to the owning NatCorp and credits the donor", async () => {
    const natCorpId = new ObjectId();
    const donorId = new ObjectId();
    const sectorId = new ObjectId();
    await setup({ natCorpId, donorId, sectorId });

    const { nationalizeSector } = await import("./ownershipTransition");
    const result = await nationalizeSector(db as unknown as Db, {
      countryId: "CN",
      sectorId,
      tier: "fair",
      consequence: CONSEQ,
    });

    // Routed via the per-type resolver, not a fixed corp.
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    expect(resolveNationalCorporationForSector).toHaveBeenCalledWith(db, "CN", "energy");

    const sectorUpdate = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
    expect(sectorUpdate[0]).toEqual({ _id: sectorId });
    expect(sectorUpdate[1].$set.corporationId).toEqual(natCorpId);
    // Transition revenue haircut (6M × 0.85) + nationalization anchor stamped.
    expect(sectorUpdate[1].$set.revenue).toBe(5_100_000);
    expect(sectorUpdate[1].$set.nationalizedAtTurn).toBe(1);

    // Valuation 4000 × fair (1.0) × buyout premium (5) = 20000.
    expect(result.compensationPaid).toBe(20000);
    const donorUpdate = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => JSON.stringify(c[0]) === JSON.stringify({ _id: donorId })
    );
    expect(donorUpdate![1].$inc.liquidCapital).toBe(20000);
    expect(result.nationalCorporationId).toEqual(natCorpId);
  });

  it("stamps absorbedAtTurn on the re-parented sector (re-privatization cooldown anchor)", async () => {
    const natCorpId = new ObjectId();
    const donorId = new ObjectId();
    const sectorId = new ObjectId();
    await setup({ natCorpId, donorId, sectorId });

    const { nationalizeSector } = await import("./ownershipTransition");
    await nationalizeSector(db as unknown as Db, {
      countryId: "CN",
      sectorId,
      tier: "fair",
      consequence: { method: "executive", triggers: [], turn: 77 },
    });

    const setArg = db.collectionMocks.corporateSectors.updateOne.mock.calls[0][1].$set;
    expect(setArg.corporationId).toEqual(natCorpId);
    expect(setArg.absorbedAtTurn).toBe(77);
    expect(setArg.nationalizedAtTurn).toBe(77);
  });

  it("seizure tier pays the donor nothing and makes no donor update", async () => {
    const natCorpId = new ObjectId();
    const donorId = new ObjectId();
    const sectorId = new ObjectId();
    await setup({ natCorpId, donorId, sectorId });

    const { nationalizeSector } = await import("./ownershipTransition");
    const result = await nationalizeSector(db as unknown as Db, {
      countryId: "CN",
      sectorId,
      tier: "seizure",
      consequence: CONSEQ,
    });

    expect(result.compensationPaid).toBe(0);
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledTimes(1);
    const donorUpdate = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => JSON.stringify(c[0]) === JSON.stringify({ _id: donorId })
    );
    expect(donorUpdate).toBeUndefined();
  });

  // Regression for the multi-NatCorp "take the rest" invariant: once a sector type
  // has been split off into a secondary, a LATER taking of more of that type must
  // route to that secondary AND merge into its existing (state, type) holding —
  // not re-parent a duplicate, not land in the primary.
  it("take-the-rest after a split routes to the claiming secondary and merges into its holding", async () => {
    const secondaryId = new ObjectId(); // split-off that claimed "energy"
    const donorId = new ObjectId(); // the corp losing the remaining slice
    const sectorId = new ObjectId(); // the remaining energy@CN-HD being taken
    const existingHoldingId = new ObjectId(); // the secondary's energy@CN-HD from the earlier partial taking

    // The per-type resolver returns the SECONDARY (it claimed "energy" via a prior split-off).
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({
      _id: secondaryId,
      countryId: "CN",
      countryOwnerId: "CN",
      isPrimaryNationalCorporation: false,
      assignedSectorTypes: ["energy"],
    } as never);

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: donorId,
      name: "CorpX",
      countryId: "CN",
      liquidCapital: 1000,
      liquidCurrencyCode: "CNY",
    });

    // findOne distinguishes the donor's sector (by _id) from the secondary's
    // existing (state, type) holding (the absorb's merge lookup).
    db.collectionMocks.corporateSectors.findOne.mockImplementation((q) => {
      if (q?._id?.equals?.(sectorId)) {
        return Promise.resolve({
          _id: sectorId,
          corporationId: donorId,
          countryId: "CN",
          stateId: "CN-HD",
          sectorType: "energy",
          revenue: 6_000_000,
          workers: 500,
          currentGrowthCost: 0,
          profitMargin: 35,
        });
      }
      if (q?.corporationId?.equals?.(secondaryId)) {
        return Promise.resolve({
          _id: existingHoldingId,
          corporationId: secondaryId,
          stateId: "CN-HD",
          sectorType: "energy",
          revenue: 4_000_000,
          workers: 300,
          currentGrowthCost: 0,
        });
      }
      return Promise.resolve(null);
    });

    const { nationalizeSector } = await import("./ownershipTransition");
    const result = await nationalizeSector(db as unknown as Db, {
      countryId: "CN",
      sectorId,
      tier: "fair",
      consequence: CONSEQ,
    });

    // Routed to the claiming secondary, not the primary.
    expect(resolveNationalCorporationForSector).toHaveBeenCalledWith(db, "CN", "energy");
    expect(result.nationalCorporationId).toEqual(secondaryId);

    // Merged into the secondary's EXISTING energy@CN-HD holding (haircut 6M×0.85),
    // not re-parented as a fresh row.
    const mergeUpdate = db.collectionMocks.corporateSectors.updateOne.mock.calls.find((c) =>
      c[0]?._id?.equals?.(existingHoldingId)
    );
    expect(mergeUpdate).toBeDefined();
    expect(mergeUpdate![1].$inc.revenue).toBe(5_100_000);
    expect(mergeUpdate![1].$set.nationalizedAtTurn).toBe(1);

    // The donor's taken row is folded in (deleted), not left re-parented.
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({ _id: sectorId });
    const reparent = db.collectionMocks.corporateSectors.updateOne.mock.calls.find((c) =>
      c[0]?._id?.equals?.(sectorId)
    );
    expect(reparent).toBeUndefined();
  });

  it("debits the treasury (gated) for a fair-tier taking", async () => {
    const natCorpId = new ObjectId();
    const donorId = new ObjectId();
    const sectorId = new ObjectId();
    await setup({ natCorpId, donorId, sectorId });

    const { debitTreasuryCompensation } = await import("./treasury");
    const { nationalizeSector } = await import("./ownershipTransition");
    await nationalizeSector(db as unknown as Db, {
      countryId: "CN",
      sectorId,
      tier: "fair",
      consequence: CONSEQ,
    });

    expect(debitTreasuryCompensation).toHaveBeenCalledWith(
      db,
      "CN",
      20000, // valuation 4000 × fair × buyout premium (5)
      expect.anything(),
      expect.any(Date)
    );
  });
});

describe("nationalizeWholeCorp", () => {
  async function setupTarget(opts: { primaryId: ObjectId; targetId: ObjectId }) {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: opts.targetId,
      name: "Target Co",
      countryId: "CN",
      liquidCapital: 500,
      liquidCurrencyCode: "CNY",
      totalShares: 1000,
      sharePrice: 2,
      shareholders: [],
    });
    const { ensurePrimaryNationalCorporation } = await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({
      _id: opts.primaryId,
      countryId: "CN",
      countryOwnerId: "CN",
      isPrimaryNationalCorporation: true,
    } as never);
  }

  it("absorbs sectors (routed per type), re-stamps bonds to the primary, dissolves the shell", async () => {
    const primaryId = new ObjectId();
    const targetId = new ObjectId();
    const sectorId = new ObjectId();
    const bondId = new ObjectId();
    await setupTarget({ primaryId, targetId });

    db.collectionMocks.corporateSectors.find.mockReturnValue(
      findCursor([
        {
          _id: sectorId,
          corporationId: targetId,
          countryId: "CN",
          stateId: "CN-HD",
          sectorType: "energy",
          revenue: 6_000_000,
          profitMargin: 35,
          currentGrowthCost: 0,
        },
      ])
    );
    db.collectionMocks.bonds.find.mockReturnValue(
      findCursor([
        {
          _id: bondId,
          corporationId: targetId,
          countryId: "CN",
          currencyCode: "CNY",
          defaulted: false,
          matured: false,
          totalIssued: 100000,
          couponRate: 5,
          holders: [],
        },
      ])
    );
    // Single energy sector routes to the primary (no split-off claims it).
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    const result = await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "fair",
      consequence: CONSEQ,
    });

    // Sector re-parented to its routed destination (primary here) — no existing
    // (NatCorp, state, type) holding, so a plain re-parent (not a merge).
    const sectorUpdate = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.corporationId != null
    );
    expect(sectorUpdate![0]).toEqual({ _id: sectorId });
    expect(sectorUpdate![1].$set.corporationId).toEqual(primaryId);

    // Bonds re-stamped to the primary (issuer continuity).
    const bondUpdate = db.collectionMocks.bonds.updateMany.mock.calls[0];
    expect(bondUpdate[0]).toEqual({ corporationId: targetId, matured: false });
    expect(bondUpdate[1].$set.corporationId).toEqual(primaryId);

    expect(db.collectionMocks.corporations.deleteOne).toHaveBeenCalledWith({ _id: targetId });
    expect(result.nationalCorporationId).toEqual(primaryId);
    expect(result.sectorsAbsorbed).toBe(1);
    expect(result.bondsAssumed).toBe(1);
  });

  // Bug #0775 follow-up: the dissolved shell's liquidCapital used to vanish. It must
  // be conserved — the state recoups cash up to the compensation it paid, and any
  // cash beyond the buyout goes to the CEO. seizure / vacant ⇒ all to the treasury.
  it("recoups the dissolved corp's cash to the treasury when it is within the buyout (no CEO surplus)", async () => {
    const primaryId = new ObjectId();
    const targetId = new ObjectId();
    await setupTarget({ primaryId, targetId }); // liquidCapital 500, fair tier
    db.collectionMocks.corporateSectors.find.mockReturnValue(findCursor([]));
    db.collectionMocks.bonds.find.mockReturnValue(findCursor([]));
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    const { creditTreasuryProceeds } = await import("./treasury");
    await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "fair",
      consequence: CONSEQ,
    });

    // valuation = max(marketCap 2000, equity 500+4000) − 0 = 4500; payout = 4500 × 5 = 22500.
    // cash (500) ≤ payout ⇒ the state recoups all 500; CEO gets nothing.
    expect(vi.mocked(creditTreasuryProceeds)).toHaveBeenCalledWith(db, "CN", 500, expect.any(Date));
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("pays cash beyond the buyout to the CEO and recoups the rest to the treasury", async () => {
    const primaryId = new ObjectId();
    const targetId = new ObjectId();
    const ceoId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: targetId,
      name: "Cash Co",
      countryId: "CN",
      liquidCapital: 10000,
      liquidCurrencyCode: "CNY",
      totalShares: 1000,
      sharePrice: 0,
      shareholders: [],
      ceoId,
    });
    const { ensurePrimaryNationalCorporation, resolveNationalCorporationForSector } =
      await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({
      _id: primaryId,
      countryId: "CN",
      countryOwnerId: "CN",
    } as never);
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);
    db.collectionMocks.corporateSectors.find.mockReturnValue(findCursor([]));
    db.collectionMocks.bonds.find.mockReturnValue(findCursor([]));
    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: ceoId });
    // Underwater valuation so the buyout is small relative to the cash on hand.
    const { computeSectorNpvSum } = await import("@/lib/bonds/corporateBondDefault");
    vi.mocked(computeSectorNpvSum).mockReturnValueOnce(0);
    const { sumBondPrincipalAnchor } = await import("@/lib/bonds/bondPrincipalSum");
    vi.mocked(sumBondPrincipalAnchor).mockReturnValueOnce(9000);

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    const { creditTreasuryProceeds } = await import("./treasury");
    await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "fair",
      consequence: CONSEQ,
    });

    // valuation = max(0, 10000+0) − 9000 = 1000; payout = 1000 × 5 = 5000.
    // CEO surplus = 10000 − 5000 = 5000; treasury recoups the remaining 5000.
    const ceoPay = db.collectionMocks.characters.updateOne.mock.calls.find(
      (c) => c[0]._id?.toString() === ceoId.toString()
    );
    expect(ceoPay?.[1].$inc.cashOnHand).toBe(5000);
    expect(vi.mocked(creditTreasuryProceeds)).toHaveBeenCalledWith(
      db,
      "CN",
      5000,
      expect.any(Date)
    );
  });

  it("under a seizure, routes all cash to the treasury and pays the CEO nothing", async () => {
    const primaryId = new ObjectId();
    const targetId = new ObjectId();
    const ceoId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: targetId,
      name: "Seized Co",
      countryId: "CN",
      liquidCapital: 8000,
      liquidCurrencyCode: "CNY",
      totalShares: 1000,
      sharePrice: 1,
      shareholders: [],
      ceoId,
    });
    const { ensurePrimaryNationalCorporation, resolveNationalCorporationForSector } =
      await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({
      _id: primaryId,
      countryId: "CN",
      countryOwnerId: "CN",
    } as never);
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);
    db.collectionMocks.corporateSectors.find.mockReturnValue(findCursor([]));
    db.collectionMocks.bonds.find.mockReturnValue(findCursor([]));
    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: ceoId });

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    const { creditTreasuryProceeds } = await import("./treasury");
    await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "seizure",
      consequence: CONSEQ,
    });

    // Seizure pays shareholders nothing; the state takes the full cash, CEO gets none.
    expect(vi.mocked(creditTreasuryProceeds)).toHaveBeenCalledWith(
      db,
      "CN",
      8000,
      expect.any(Date)
    );
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("records assumed debt + shareholder count on the whole-corp ledger row", async () => {
    const primaryId = new ObjectId();
    const targetId = new ObjectId();
    const sectorId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: targetId,
      name: "Target Co",
      countryId: "CN",
      liquidCapital: 500,
      liquidCurrencyCode: "CNY",
      totalShares: 1000,
      sharePrice: 2,
      shareholders: [
        { characterId: new ObjectId(), shares: 600 },
        { characterId: new ObjectId(), shares: 400 },
      ],
    });
    const { ensurePrimaryNationalCorporation } = await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({
      _id: primaryId,
      countryId: "CN",
      countryOwnerId: "CN",
      isPrimaryNationalCorporation: true,
    } as never);
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      findCursor([
        {
          _id: sectorId,
          corporationId: targetId,
          countryId: "CN",
          stateId: "CN-HD",
          sectorType: "energy",
          revenue: 1000,
          currentGrowthCost: 0,
        },
      ])
    );
    db.collectionMocks.bonds.find.mockReturnValue(findCursor([]));
    const { sumBondPrincipalAnchor } = await import("@/lib/bonds/bondPrincipalSum");
    vi.mocked(sumBondPrincipalAnchor).mockReturnValueOnce(5000); // ₳ debt assumed
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "fair",
      consequence: CONSEQ,
    });

    const led = db.collectionMocks.nationalizationLedger.insertOne.mock.calls[0][0];
    expect(led.kind).toBe("nationalize_whole");
    expect(led.debtAnchor).toBe(5000);
    expect(led.shareholdersSettled).toBe(2);
  });

  it("releases the corp's FOREIGN sectors to the unowned market instead of absorbing them", async () => {
    const primaryId = new ObjectId();
    const targetId = new ObjectId();
    const domesticSectorId = new ObjectId();
    const foreignSectorId = new ObjectId();
    await setupTarget({ primaryId, targetId });

    db.collectionMocks.corporateSectors.find.mockReturnValue(
      findCursor([
        {
          _id: domesticSectorId,
          corporationId: targetId,
          countryId: "CN", // home country — absorbed
          stateId: "CN-HD",
          sectorType: "energy",
          revenue: 6_000_000,
          profitMargin: 35,
          currentGrowthCost: 0,
        },
        {
          _id: foreignSectorId,
          corporationId: targetId,
          countryId: "JP", // foreign — released to unowned, not absorbed
          stateId: "JP-13",
          sectorType: "technology",
          revenue: 2_000_000,
          profitMargin: 30,
          currentGrowthCost: 0,
        },
      ])
    );
    db.collectionMocks.bonds.find.mockReturnValue(findCursor([]));
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);

    // The released sector's region has changed hands: its stored country still
    // says JP, the state says PL.
    db.collection("states");
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "JP-13", countryId: "PL" });
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    const result = await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "fair",
      consequence: CONSEQ,
    });

    // Domestic sector re-parented into the NatCorp.
    const sectorUpdate = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.corporationId != null
    );
    expect(sectorUpdate![0]).toEqual({ _id: domesticSectorId });

    // Foreign sector merged into the unowned market (₳-converted, by state+type)
    // and removed. This is an AGGREGATION PIPELINE update, not $inc +
    // $setOnInsert: the derived `headroomUnits` must be recomputed from the
    // POST-increment revenue in the same write, and $inc on a doc predating the
    // headroom backfill would start the field from 0 and understate the pool
    // permanently. $setOnInsert is unavailable inside a pipeline, hence the
    // $ifNull identity seeding.
    const unownedUpsert = db.collectionMocks.unownedSectors.updateOne.mock.calls[0];
    expect(unownedUpsert[0]).toEqual({ stateId: "JP-13", sectorType: "technology" });
    expect(unownedUpsert[2]).toEqual({ upsert: true });

    const pipeline = unownedUpsert[1] as Array<{ $set: Record<string, unknown> }>;
    expect(Array.isArray(pipeline)).toBe(true);
    // Stage 1 adds the ₳ revenue onto whatever the pool already held.
    expect(pipeline[0].$set.revenue).toEqual({
      $add: [{ $ifNull: ["$revenue", 0] }, 2_000_000], // passthrough at rate 1
    });
    expect(pipeline[0].$set.stateId).toEqual({ $ifNull: ["$stateId", "JP-13"] });
    // Ticket #1271: the pool row's country comes from the STATE, not from
    // whatever the released sector last stored. The state below says the region
    // is Polish while the sector still says JP, so this fails on the old code,
    // which read `sector.countryId` directly.
    expect(pipeline[0].$set.countryId).toEqual({ $ifNull: ["$countryId", "PL"] });
    // Stage 2 derives headroomUnits from the revenue stage 1 settled on, so a
    // pool with a missing/stale value heals rather than drifting further.
    const headroom = pipeline[1].$set.headroomUnits as { $multiply: [string, number] };
    expect(headroom.$multiply[0]).toBe("$revenue");
    expect(headroom.$multiply[1]).toBeCloseTo(unownedHeadroomUnitsPerAnchor("technology", 1), 10);
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({
      _id: foreignSectorId,
    });

    // Only the domestic sector counts as absorbed; the foreign one was divested.
    expect(result.sectorsAbsorbed).toBe(1);
    // Shell still dissolved.
    expect(db.collectionMocks.corporations.deleteOne).toHaveBeenCalledWith({ _id: targetId });
  });

  it("fans sectors of different types into different NatCorps", async () => {
    const primaryId = new ObjectId();
    const energySplitId = new ObjectId();
    const targetId = new ObjectId();
    const energySectorId = new ObjectId();
    const techSectorId = new ObjectId();
    await setupTarget({ primaryId, targetId });

    db.collectionMocks.corporateSectors.find.mockReturnValue(
      findCursor([
        {
          _id: energySectorId,
          corporationId: targetId,
          countryId: "CN",
          stateId: "CN-HD",
          sectorType: "energy",
          revenue: 1,
          profitMargin: 35,
          currentGrowthCost: 0,
        },
        {
          _id: techSectorId,
          corporationId: targetId,
          countryId: "CN",
          stateId: "CN-HD",
          sectorType: "technology",
          revenue: 1,
          profitMargin: 35,
          currentGrowthCost: 0,
        },
      ])
    );
    db.collectionMocks.bonds.find.mockReturnValue(findCursor([]));

    // energy → dedicated split-off; technology → primary (remainder).
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockImplementation(
      async (_db, _country, sectorType) =>
        (sectorType === "energy" ? { _id: energySplitId } : { _id: primaryId }) as never
    );

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "seizure",
      consequence: CONSEQ,
    });

    // Two re-parent updateOne calls, one per sector, each to its routed destination.
    const calls = db.collectionMocks.corporateSectors.updateOne.mock.calls.filter(
      (c) => c[1]?.$set?.corporationId != null
    );
    expect(calls).toHaveLength(2);
    const byDest = new Map(
      calls.map((c) => [c[1].$set.corporationId.toString(), (c[0]._id as ObjectId).toString()])
    );
    expect(byDest.get(energySplitId.toString())).toEqual(energySectorId.toString());
    expect(byDest.get(primaryId.toString())).toEqual(techSectorId.toString());
  });

  it("MERGES a seized sector into the NatCorp's existing (state, type) holding (no E11000)", async () => {
    const primaryId = new ObjectId();
    const targetId = new ObjectId();
    const donorSectorId = new ObjectId();
    const existingNatSectorId = new ObjectId();
    await setupTarget({ primaryId, targetId });

    db.collectionMocks.corporateSectors.find.mockReturnValue(
      findCursor([
        {
          _id: donorSectorId,
          corporationId: targetId,
          countryId: "CN",
          stateId: "CN-HD",
          sectorType: "energy",
          revenue: 6_000_000,
          workers: 500,
          currentGrowthCost: 100,
          profitMargin: 35,
        },
      ])
    );
    db.collectionMocks.bonds.find.mockReturnValue(findCursor([]));
    // The NatCorp ALREADY holds energy @ CN-HD — the merge-check finds it.
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: existingNatSectorId,
      corporationId: primaryId,
      countryId: "CN",
      stateId: "CN-HD",
      sectorType: "energy",
      revenue: 1_000_000,
      workers: 100,
      currentGrowthCost: 50,
    });
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: primaryId } as never);

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "seizure",
      consequence: CONSEQ,
    });

    // The donor's capacity is folded into the EXISTING NatCorp sector ($inc)…
    const merge = db.collectionMocks.corporateSectors.updateOne.mock.calls.find((c) =>
      (c[0]?._id as ObjectId)?.equals?.(existingNatSectorId)
    );
    expect(merge).toBeTruthy();
    // Folded-in chunk takes the 15% transition haircut (6M × 0.85).
    expect(merge![1].$inc.revenue).toBe(5_100_000);
    expect(merge![1].$set.nationalizedAtTurn).toBe(1);
    expect(merge![1].$inc.workers).toBe(500);
    // …and the donor row is DELETED (not blind-re-parented onto a colliding key).
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({
      _id: donorSectorId,
    });
    const blindReparent = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.corporationId != null
    );
    expect(blindReparent).toBeUndefined();
  });

  it("blocks nationalizing a state-owned corporation", async () => {
    const targetId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: targetId,
      name: "NC",
      countryId: "CN",
      countryOwnerId: "CN",
      ownershipState: "stateOwned",
    });

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    await expect(
      nationalizeWholeCorp(db as unknown as Db, {
        countryId: "CN",
        corporationId: targetId,
        tier: "fair",
        consequence: CONSEQ,
      })
    ).rejects.toThrow(/state-owned/);
    expect(db.collectionMocks.corporations.deleteOne).not.toHaveBeenCalled();
  });

  it("transfers shares owned by the seized corp to the National Corporation (Bug #0803)", async () => {
    const targetId = new ObjectId();
    const nationalCorpId = new ObjectId();
    const baowuCorpId = new ObjectId();

    // Setup: BYD owns shares in Baowu
    db.collectionMocks.corporations.findOne.mockImplementation((query) => {
      if ((query._id as ObjectId).equals(targetId)) {
        return Promise.resolve({
          _id: targetId,
          name: "BYD",
          countryId: "CN",
          countryOwnerId: null,
          ownershipState: null,
          liquidCapital: 1_000_000,
          liquidCurrencyCode: "CNY",
          sharePrice: 100,
          totalShares: 1000,
          shareholders: [],
          publicFloat: 1000,
          sectors: [],
        });
      } else if ((query._id as ObjectId).equals(nationalCorpId)) {
        return Promise.resolve({
          _id: nationalCorpId,
          name: "China National Corporation",
          countryId: "CN",
          countryOwnerId: "CN",
          ownershipState: "stateOwned",
          liquidCapital: 5_000_000,
          liquidCurrencyCode: "CNY",
          sharePrice: 1000,
          totalShares: 10000,
          shareholders: [],
          publicFloat: 0,
          sectors: [],
        });
      }
      return Promise.resolve(null);
    });

    // Baowu corporation where BYD owns shares
    db.collectionMocks.corporations.find.mockReturnValue(
      findCursor([
        {
          _id: baowuCorpId,
          name: "Baowu",
          countryId: "CN",
          liquidCapital: 2_000_000,
          liquidCurrencyCode: "CNY",
          sharePrice: 200,
          totalShares: 5000,
          shareholders: [
            {
              corporationId: targetId, // BYD owns 100 shares in Baowu
              shares: 100,
              avgCostPerShare: 150,
            },
          ],
          publicFloat: 4900,
          sectors: [],
        },
      ])
    );

    const { ensurePrimaryNationalCorporation } = await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue({ _id: nationalCorpId } as never);

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    await nationalizeWholeCorp(db as unknown as Db, {
      countryId: "CN",
      corporationId: targetId,
      tier: "fair",
      consequence: CONSEQ,
    });

    // Verify that BYD's shares in Baowu were removed
    const removeCall = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => c[1]?.$pull?.shareholders != null
    );
    expect(removeCall).toBeTruthy();
    expect(removeCall![1].$pull.shareholders).toEqual({ corporationId: targetId });

    // Verify that the National Corporation received the shares in Baowu
    const addCall = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => c[1]?.$push?.shareholders != null && (c[0]?._id as ObjectId)?.equals(baowuCorpId)
    );
    expect(addCall).toBeTruthy();
    expect(addCall![1].$push.shareholders).toEqual({
      corporationId: nationalCorpId,
      shares: 100,
      avgCostPerShare: 150,
    });

    // Verify that the National Corporation was credited with the value of the shares
    const creditCall = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => c[1]?.$inc?.liquidCapital != null && (c[0]?._id as ObjectId)?.equals(nationalCorpId)
    );
    expect(creditCall).toBeTruthy();
    // 100 shares * 200 CNY/share = 20,000 CNY
    expect(creditCall![1].$inc.liquidCapital).toBe(20_000);
  });
});
