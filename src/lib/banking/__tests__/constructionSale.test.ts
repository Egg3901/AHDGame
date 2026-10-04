import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { buySecuredConstructionProperty, recoverConstructionSales } from "../constructionSale";
import { listDefaultedConstructionCollateral } from "../constructionForeclosure";
import { recoverConstructionServiceLeases } from "../constructionServiceLease";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { ConstructionBuildClaim } from "../rules/constructionBuild";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/currency/corporationCapital")>()),
  getCorpFxRate: vi.fn(async (_db, corporation) =>
    corporation.liquidCurrencyCode === "EUR" ? 2 : 1
  ),
}));

function world(
  options: {
    price?: number;
    epoch?: number;
    defaults?: boolean;
    euro?: boolean;
    repaid?: boolean;
  } = {}
) {
  const memory = createInMemoryDb();
  const bankId = new ObjectId(),
    borrowerId = new ObjectId(),
    buyerId = new ObjectId(),
    sectorId = new ObjectId(),
    loanId = new ObjectId();
  const order = {
    unitsOrdered: 100,
    costPaidAnchor: 100_000,
    startTurn: 10,
    onlineTurn: 14,
    smooth: true,
    constructionClaimId: "pledge",
    constructionLoanId: String(loanId),
  };
  const claim: ConstructionBuildClaim = {
    claimId: "pledge",
    loanId: String(loanId),
    bankId: String(bankId),
    charteredTurn: 2,
    borrowerId: String(borrowerId),
    currency: "USD",
    constructionCostLocal: 100_000,
    collateralCostLocal: 100_000,
    borrowerContributionLocal: 25_750,
    principal: 75_000,
    proceedsLocal: 74_250,
    termTurns: 48,
    ratePercent: 5,
    order,
    status: options.repaid ? "released" : "building",
    escrowLocal: 0,
    borrowerContributionPaid: true,
    loanFunded: true,
    fundingCleanupCompleted: true,
  };
  memory.seed("corporations", [
    { _id: borrowerId, liquidCurrencyCode: "USD", countryId: "US", liquidCapital: 50_000 },
    {
      _id: buyerId,
      liquidCurrencyCode: options.euro ? "EUR" : "USD",
      countryId: options.euro ? "DE" : "US",
      liquidCapital: 1_000_000,
    },
    {
      _id: bankId,
      liquidCapital: 0,
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: options.epoch ?? 2,
        cashReserves: 1_000_000,
        totalLoans: options.defaults || options.repaid ? 0 : 75_000,
      },
    },
  ]);
  memory.seed("corporateSectors", [
    {
      _id: sectorId,
      corporationId: borrowerId,
      stateId: "US-CA",
      sectorType: "manufacturing",
      capitalStock: 250,
      plantCount: 1,
      forSale: { priceAnchor: options.price ?? 150_000, npvAnchor: 150_000, listedAt: new Date(0) },
      buildQueue: [order],
      constructionFinancing: claim,
    },
  ]);
  memory.seed("bankLoans", [
    {
      _id: loanId,
      bankCorporationId: bankId,
      borrowerId,
      borrowerType: "corporation",
      charteredTurn: 2,
      currency: "USD",
      outstanding: options.repaid ? 0 : 75_000,
      status: options.repaid ? "repaid" : options.defaults ? "defaulted" : "current",
      constructionCollateral: { claimId: claim.claimId, sectorId, quotedCostLocal: 100_000 },
    },
  ]);
  memory.seed("centralBanks", [
    { _id: "US", forexRevenue: 0 },
    { _id: "ECB", spreadFeeReserveBalances: {} },
  ]);
  const db = memory as unknown as Db;
  return {
    memory,
    db,
    bankId,
    borrowerId,
    buyerId,
    sectorId,
    loanId,
    input: { db, sectorId, borrowerId, buyerId, turn: 10 },
  };
}

describe("buyer-funded secured property sale", () => {
  it.each(["media", "entertainment"])(
    "preserves canonical entertainment identity against a buyer's %s lane",
    async (buyerLane) => {
      const w = world();
      await w.db
        .collection("corporateSectors")
        .updateOne(
          { _id: w.sectorId },
          { $set: { sectorType: "media", mediaDiscriminator: "entertainment" } }
        );
      const original = w.memory.collection("corporateSectors").docs[0];
      w.memory.seed("corporateSectors", [
        original,
        { _id: new ObjectId(), corporationId: w.buyerId, stateId: "US-CA", sectorType: buyerLane },
      ]);
      const result = await buySecuredConstructionProperty(w.input);
      expect(result.ok).toBe(buyerLane === "media");
      expect(w.memory.collection("corporations").docs[1].liquidCapital).toBe(
        buyerLane === "media" ? 850_000 : 1_000_000
      );
    }
  );
  it("retains the cash obligation if payout is rejected after buyer funding landed", async () => {
    const w = world();
    const journals = w.db.collection("bankMoneyMoves");
    const findOne = journals.findOne.bind(journals);
    let interrupted = false;
    vi.spyOn(journals, "findOne").mockImplementation(async (...args) => {
      if (!interrupted && String(args[0]._id).endsWith(":payout")) {
        interrupted = true;
        (
          w.memory.collection("corporateSectors").docs[0] as unknown as CorporateSector
        ).constructionFinancing!.escrowLocal = 0;
      }
      return findOne(...args);
    });
    expect(await buySecuredConstructionProperty(w.input)).toMatchObject({ ok: false });
    expect(w.memory.collection("corporations").docs[1].liquidCapital).toBe(850_000);
    const sector = w.memory.collection("corporateSectors").docs[0] as unknown as CorporateSector;
    expect(sector.constructionFinancing!.sale!.aborted).not.toBe(true);
    expect(sector.constructionPropertyTransition).toMatchObject({ kind: "secured_sale" });
    expect(sector.corporationId).toEqual(w.borrowerId);
  });
  it("pays original principal first and transfers paid construction without old security", async () => {
    const w = world();
    expect(await buySecuredConstructionProperty(w.input)).toMatchObject({
      ok: true,
      quote: { principalRepaid: 75_000, ownerProceeds: 75_000 },
    });
    expect(await buySecuredConstructionProperty({ ...w.input, turn: 100 })).toMatchObject({
      ok: true,
    });
    expect(await w.db.collection("corporations").findOne({ _id: w.buyerId })).toMatchObject({
      liquidCapital: 850_000,
    });
    expect(await w.db.collection("corporations").findOne({ _id: w.borrowerId })).toMatchObject({
      liquidCapital: 125_000,
    });
    expect(await w.db.collection("corporations").findOne({ _id: w.bankId })).toMatchObject({
      bankCharter: { cashReserves: 1_075_000, totalLoans: 0 },
    });
    expect(await w.db.collection("bankLoans").findOne({ _id: w.loanId })).toMatchObject({
      outstanding: 0,
      status: "repaid",
    });
    expect(
      (await w.db.collection("bankLoans").findOne({ _id: w.loanId }))?.constructionCollateral
    ).toBeUndefined();
    const sector = await w.db.collection("corporateSectors").findOne({ _id: w.sectorId });
    expect(sector).toMatchObject({
      corporationId: w.buyerId,
      capitalStock: 250,
      plantCount: 1,
      constructionFinancing: {
        escrowLocal: 0,
        status: "released",
        sale: { cleanupCompleted: true },
      },
    });
    expect(sector?.buildQueue[0].constructionLoanId).toBeUndefined();
    expect(sector?.buildQueue[0]).toMatchObject({ unitsOrdered: 100, startTurn: 10 });
    expect(sector?.constructionPropertyTransition).toBeUndefined();
  });

  it.each(["buyer", "escrow", "creditor", "title", "security"])(
    "recovers a crash after %s delivery using the original quote",
    async (boundary) => {
      const w = world();
      const fault = withInjectedCrash(w.memory, {
        collection:
          boundary === "buyer" || boundary === "creditor"
            ? "corporations"
            : boundary === "security"
              ? "bankLoans"
              : "corporateSectors",
        op: "updateOne",
        onCall: 1,
        afterWrite: true,
        matches: (args) => {
          const update = args[1] as {
            $inc?: Record<string, unknown>;
            $set?: Record<string, unknown>;
            $unset?: Record<string, unknown>;
          };
          if (boundary === "buyer") return update.$inc?.liquidCapital === -150_000;
          if (boundary === "escrow")
            return update.$inc?.["constructionFinancing.escrowLocal"] === 150_000;
          if (boundary === "creditor") return update.$inc?.["bankCharter.cashReserves"] === 75_000;
          if (boundary === "security") return update.$unset?.constructionCollateral === "";
          return update.$set?.["constructionFinancing.sale.completed"] === true;
        },
      });
      await expect(
        buySecuredConstructionProperty({ ...w.input, db: fault.db })
      ).rejects.toBeInstanceOf(InjectedCrash);
      expect(await recoverConstructionServiceLeases(w.db, 100)).toEqual([]);
      expect(await recoverConstructionSales(w.db, 100)).toEqual([]);
      expect(await recoverConstructionSales(w.db, 101)).toEqual([]);
      expect(
        (await w.db.collection("corporations").findOne({ _id: w.buyerId }))?.liquidCapital
      ).toBe(850_000);
      expect(
        (await w.db.collection("corporations").findOne({ _id: w.borrowerId }))?.liquidCapital
      ).toBe(125_000);
      expect(
        (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankConstructionFunding
      ).toBeUndefined();
      expect(
        (await w.db.collection("bankLoans").findOne({ _id: w.loanId }))?.constructionSettlementOwner
      ).toBeUndefined();
    }
  );

  it("leaves a funded shortfall with the seller and does not write off the loan twice", async () => {
    const w = world({ price: 50_000, defaults: true });
    expect(await buySecuredConstructionProperty(w.input)).toMatchObject({
      ok: true,
      quote: { principalRepaid: 50_000, ownerProceeds: 0 },
    });
    expect(await w.db.collection("bankLoans").findOne({ _id: w.loanId })).toMatchObject({
      borrowerId: w.borrowerId,
      outstanding: 25_000,
      status: "defaulted",
    });
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankCharter.totalLoans
    ).toBe(0);
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.borrowerId }))?.liquidCapital
    ).toBe(50_000);
  });

  it("routes a prior epoch recovery to insurance without paying the rechartered vault", async () => {
    const w = world({ epoch: 3 });
    expect(await buySecuredConstructionProperty(w.input)).toMatchObject({
      ok: true,
      quote: { destination: "insurance" },
    });
    expect(
      (
        await w.db
          .collection<{ _id: string; balance: number }>("depositInsuranceFunds")
          .findOne({ _id: "USD" })
      )?.balance
    ).toBe(75_000);
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankCharter.cashReserves
    ).toBe(1_000_000);
  });

  it("routes a cross-currency sale fee from actual buyer cash without changing creditor units", async () => {
    const w = world({ euro: true });
    const result = await buySecuredConstructionProperty(w.input);
    expect(result).toMatchObject({
      ok: true,
      quote: { buyerCostLocal: 301_500, principalRepaid: 75_000, ownerProceeds: 75_000 },
    });
    expect((await w.db.collection("corporations").findOne({ _id: w.buyerId }))?.liquidCapital).toBe(
      698_500
    );
    expect(
      (
        await w.db
          .collection<{ _id: string; forexRevenue: number }>("centralBanks")
          .findOne({ _id: "ECB" })
      )?.forexRevenue
    ).toBe(375);
    expect(
      (
        await w.db
          .collection<{ _id: string; spreadFeeReserveBalances: Record<string, number> }>(
            "centralBanks"
          )
          .findOne({ _id: "US" })
      )?.spreadFeeReserveBalances.EUR
    ).toBe(750);
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankCharter.cashReserves
    ).toBe(1_075_000);
  });

  it("forecloses only an older default and lists the site without inventing recovery cash", async () => {
    const w = world({ defaults: true });
    w.memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    w.memory.seed("gameState", [{ _id: "current", preset: "1991", currentYear: 1991 }]);
    await w.db.collection("corporateSectors").updateOne(
      { _id: w.sectorId },
      {
        $unset: { forSale: "" },
        $set: { "constructionFinancing.defaultedTurn": 10 },
      }
    );
    expect(await listDefaultedConstructionCollateral(w.db, 10)).toBe(0);
    expect(await listDefaultedConstructionCollateral(w.db, 11)).toBe(1);
    expect(await listDefaultedConstructionCollateral(w.db, 100)).toBe(0);
    const site = await w.db.collection("corporateSectors").findOne({ _id: w.sectorId });
    expect(site?.constructionFinancing.foreclosure).toEqual({ turn: 11 });
    expect(site?.forSale.priceAnchor).toBeGreaterThan(0);
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.bankId }))?.bankCharter.cashReserves
    ).toBe(1_000_000);
    expect((await w.db.collection("bankLoans").findOne({ _id: w.loanId }))?.outstanding).toBe(
      75_000
    );
  });

  it("refuses an unaffordable buyer without paying the seller or moving title", async () => {
    const w = world();
    await w.db
      .collection("corporations")
      .updateOne({ _id: w.buyerId }, { $set: { liquidCapital: 1 } });
    expect(await buySecuredConstructionProperty(w.input)).toMatchObject({ ok: false });
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.borrowerId }))?.liquidCapital
    ).toBe(50_000);
    expect((await w.db.collection("bankLoans").findOne({ _id: w.loanId }))?.outstanding).toBe(
      75_000
    );
    const site = await w.db.collection("corporateSectors").findOne({ _id: w.sectorId });
    expect(site?.corporationId).toEqual(w.borrowerId);
    expect(site?.constructionPropertyTransition).toBeUndefined();
    expect(site?.constructionFinancing.sale.aborted).toBe(true);
  });

  it("preserves a fully repaid build's future cancellation for its funded buyer", async () => {
    const w = world({ repaid: true });
    expect(await buySecuredConstructionProperty(w.input)).toMatchObject({
      ok: true,
      quote: { principalRepaid: 0, ownerProceeds: 150_000 },
    });
    expect(
      (await w.db.collection("corporateSectors").findOne({ _id: w.sectorId }))?.buildQueue[0]
        .constructionClaimId
    ).toBeUndefined();
  });
});
