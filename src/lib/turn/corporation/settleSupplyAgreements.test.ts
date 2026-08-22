import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  computeDemandCappedContractReservations,
  computeSupplyAgreementBuyerDemand,
  computeSupplyAgreementSettlements,
  settleSupplyAgreements,
  type SettleCorpInfo,
} from "./settleSupplyAgreements";
import {
  CONTRACT_DAMAGES_CAP_FRACTION,
  CONTRACT_SHORTFALL_PENALTY,
} from "@/lib/db/types/supplyAgreement";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { CorporationLookups } from "./types";

const now = new Date("2026-01-01T00:00:00Z");
const commodity = Object.keys(COMMODITY_BASE_PRICES)[0] as CommodityType;
const base = COMMODITY_BASE_PRICES[commodity];
const ratio: ReadonlyMap<CommodityType, number> = new Map([[commodity, 1]]);

const supId = new ObjectId();
const buyId = new ObjectId();
const S = supId.toString();
const B = buyId.toString();

function makeInfo(
  fxRate = 1,
  ccy: CurrencyCode | undefined = "USD" as CurrencyCode
): (id: string) => SettleCorpInfo | undefined {
  return (id) =>
    id === S
      ? { _id: supId, name: "Sup", ccy, fxRate }
      : id === B
        ? { _id: buyId, name: "Buy", ccy, fxRate }
        : undefined;
}

describe("computeSupplyAgreementSettlements", () => {
  it("measures the buyer's current input consumption on the live plants unit basis", () => {
    const demand = computeSupplyAgreementBuyerDemand({
      sectors: [
        {
          corporationId: B,
          sectorType: "manufacturing",
          revenueAnchor: 30_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          producedUnits: 50,
          capacityUnits: 100,
          mothballed: false,
          isNatcorp: false,
        },
        {
          corporationId: B,
          sectorType: "manufacturing",
          revenueAnchor: 30_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          producedUnits: 100,
          capacityUnits: 100,
          mothballed: true,
          isNatcorp: false,
        },
      ],
      currentTurn: 5,
      unitScale: 3,
      plantsEnabled: true,
    });

    expect(demand.get(B)?.get("energy")).toBe(150);
  });

  it("caps clearing reservations at named buyers' combined physical demand", () => {
    const supplier2 = new ObjectId().toString();
    const buyer2 = new ObjectId().toString();
    const reservations = computeDemandCappedContractReservations({
      agreements: [
        {
          supplierCorpId: S,
          buyerCorpId: B,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
        {
          supplierCorpId: S,
          buyerCorpId: buyer2,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
        {
          supplierCorpId: supplier2,
          buyerCorpId: B,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
      ],
      buyerDemandByCorpCommodity: new Map([
        [B, new Map([[commodity, 100]])],
        [buyer2, new Map([[commodity, 100]])],
      ]),
    });

    expect(reservations.get(S)?.get(commodity)).toBe(150);
    expect(reservations.get(supplier2)?.get(commodity)).toBe(50);
  });

  it("caps a buyer's delivery and premium at its actual commodity consumption", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        {
          agreementId: "agreement-1",
          supplierCorpId: S,
          buyerCorpId: B,
          commodity,
          volumeCap: 100,
          pricePremium: 0.2,
        },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 100]])]]),
      buyerDemandByCorpCommodity: new Map([[B, new Map([[commodity, 30]])]]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });

    expect(r.deliveries).toEqual([
      {
        agreementId: "agreement-1",
        supplierCorpId: S,
        buyerCorpId: B,
        commodity,
        contractedUnits: 100,
        deliveredUnits: 30,
        turn: 5,
      },
    ]);
    expect(r.deltaByCorp.get(S)).toBe(Math.round(30 * base * 0.2));
    expect(r.deltaByCorp.get(B)).toBe(-Math.round(30 * base * 0.2));
  });

  it("routes available contract supply across buyers without stranding deliverable units", () => {
    const supplier2 = new ObjectId().toString();
    const buyer2 = new ObjectId().toString();
    const r = computeSupplyAgreementSettlements({
      agreements: [
        {
          agreementId: "s1-b1",
          supplierCorpId: S,
          buyerCorpId: B,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
        {
          agreementId: "s1-b2",
          supplierCorpId: S,
          buyerCorpId: buyer2,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
        {
          agreementId: "s2-b1",
          supplierCorpId: supplier2,
          buyerCorpId: B,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
      ],
      contractSettlementByCorp: new Map([
        [S, new Map([[commodity, 100]])],
        [supplier2, new Map([[commodity, 100]])],
      ]),
      buyerDemandByCorpCommodity: new Map([
        [B, new Map([[commodity, 100]])],
        [buyer2, new Map([[commodity, 100]])],
      ]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: () => undefined,
      turn: 5,
      now,
    });

    expect(r.deliveries.reduce((sum, delivery) => sum + delivery.deliveredUnits, 0)).toBe(200);
    expect(r.deliveries.find((delivery) => delivery.agreementId === "s1-b2")?.deliveredUnits).toBe(
      100
    );
    expect(r.deliveries.find((delivery) => delivery.agreementId === "s2-b1")?.deliveredUnits).toBe(
      100
    );
  });

  it("credits supplier and debits buyer the premium; conserves cash", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0.2 },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 100]])]]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    const expected = Math.round(100 * base * 0.2);
    expect(r.deltaByCorp.get(S)).toBe(expected);
    expect(r.deltaByCorp.get(B)).toBe(-expected);
    expect(r.deltaByCorp.get(S)! + r.deltaByCorp.get(B)!).toBe(0); // conserved (same fx)
    expect(r.settledCount).toBe(1);
    expect(r.txEntries).toHaveLength(2);
    expect(r.txEntries[0]!.type).toBe("corp_supply_agreement");
  });

  it("negative premium reverses direction (supplier subsidises buyer)", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: -0.1 },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 100]])]]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    const expected = Math.round(100 * base * -0.1);
    expect(r.deltaByCorp.get(S)).toBe(expected); // negative → supplier loses
    expect(r.deltaByCorp.get(B)).toBe(-expected); // buyer gains
  });

  it("splits a supplier's cleared units across its agreements pro-rata by cap", () => {
    const B2 = new ObjectId();
    const info = (id: string): SettleCorpInfo | undefined =>
      id === S
        ? { _id: supId, name: "Sup", ccy: "USD" as CurrencyCode, fxRate: 1 }
        : id === B
          ? { _id: buyId, name: "Buy1", ccy: "USD" as CurrencyCode, fxRate: 1 }
          : id === B2.toString()
            ? { _id: B2, name: "Buy2", ccy: "USD" as CurrencyCode, fxRate: 1 }
            : undefined;
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0.1 },
        {
          supplierCorpId: S,
          buyerCorpId: B2.toString(),
          commodity,
          volumeCap: 300,
          pricePremium: 0.1,
        },
      ],
      // Supplier only cleared 200 of the 400 contracted units.
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 200]])]]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: info,
      turn: 5,
      now,
    });
    const p1 = Math.round(50 * base * 0.1); // 200 × 100/400 = 50 units
    const p2 = Math.round(150 * base * 0.1); // 200 × 300/400 = 150 units
    expect(r.deltaByCorp.get(B)).toBe(-p1);
    expect(r.deltaByCorp.get(B2.toString())).toBe(-p2);
    expect(r.deltaByCorp.get(S)).toBe(p1 + p2); // supplier accrues both legs
  });

  it("settles nothing when no contracted units cleared", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0.2 },
      ],
      contractSettlementByCorp: new Map(), // nothing cleared
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    expect(r.settledCount).toBe(0);
    expect(r.deltaByCorp.size).toBe(0);
    expect(r.txEntries).toHaveLength(0);
  });

  it("skips an agreement whose counterparty corp is missing", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0.2 },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 100]])]]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: (id) =>
        id === S ? { _id: supId, name: "Sup", ccy: "USD" as CurrencyCode, fxRate: 1 } : undefined,
      turn: 5,
      now,
    });
    expect(r.settledCount).toBe(0);
  });

  it("conserves value in ₳ across currencies (local legs differ by fx)", () => {
    // Supplier books in a ~100/₳ currency, buyer in USD (~1/₳).
    const info = (id: string): SettleCorpInfo | undefined =>
      id === S
        ? { _id: supId, name: "Sup", ccy: "JPY" as CurrencyCode, fxRate: 100 }
        : id === B
          ? { _id: buyId, name: "Buy", ccy: "USD" as CurrencyCode, fxRate: 1 }
          : undefined;
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0.2 },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 100]])]]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: info,
      turn: 5,
      now,
    });
    const premiumAnchor = 100 * base * 0.2;
    expect(r.deltaByCorp.get(S)).toBe(Math.round(premiumAnchor * 100)); // supplier ccy
    expect(r.deltaByCorp.get(B)).toBe(-Math.round(premiumAnchor * 1)); // buyer ccy
    // Convert each leg back to ₳ → equal and opposite.
    const supAnchor = r.deltaByCorp.get(S)! / 100;
    const buyAnchor = r.deltaByCorp.get(B)! / 1;
    expect(Math.abs(supAnchor + buyAnchor)).toBeLessThan(1); // conserved within rounding
  });
});

describe("settleSupplyAgreements delivery persistence", () => {
  it("records every agreement's delivered units even when its price is exactly at market", async () => {
    const db = createMockDb();
    db.collection("corporations");
    db.collection("supplyAgreements");
    const agreementId = new ObjectId();

    await settleSupplyAgreements({
      db: db as unknown as Db,
      lookups: {
        eraUnitScale: 1,
        corpById: new Map(),
        exchangeRatesByCurrency: new Map(),
      } as unknown as CorporationLookups,
      agreements: [
        {
          agreementId: agreementId.toString(),
          supplierCorpId: S,
          buyerCorpId: B,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 100]])]]),
      buyerDemandByCorpCommodity: new Map([[B, new Map([[commodity, 30]])]]),
      priceRatioByCommodity: ratio,
      turn: 5,
      now,
      thresholds: {} as never,
    });

    expect(db.collectionMocks.supplyAgreements.bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: agreementId },
          update: {
            $set: {
              lastDeliveryTurn: 5,
              lastDeliveredUnits: 30,
              updatedAt: now,
            },
          },
        },
      },
    ]);
  });
});

describe("computeSupplyAgreementSettlements — shortfall damages (P3b)", () => {
  it("does not penalize a supplier for contracted volume the buyer does not consume", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        {
          agreementId: "agreement-1",
          supplierCorpId: S,
          buyerCorpId: B,
          commodity,
          volumeCap: 100,
          pricePremium: 0,
        },
      ],
      contractSettlementByCorp: new Map(),
      buyerDemandByCorpCommodity: new Map([[B, new Map([[commodity, 30]])]]),
      producedByCorpCommodity: new Map(),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });

    const penalty = Math.round(30 * base * CONTRACT_SHORTFALL_PENALTY);
    expect(r.deltaByCorp.get(S)).toBe(-penalty);
    expect(r.deltaByCorp.get(B)).toBe(penalty);
  });

  it("charges the supplier when it produced less than it contracted", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0 },
      ],
      // Delivered 60 of 100; only 60 were ever made.
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 60]])]]),
      producedByCorpCommodity: new Map([[S, new Map([[commodity, 60]])]]),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    const penalty = Math.round(40 * base * CONTRACT_SHORTFALL_PENALTY);
    expect(r.deltaByCorp.get(S)).toBe(-penalty);
    expect(r.deltaByCorp.get(B)).toBe(penalty);
    expect(r.deltaByCorp.get(S)! + r.deltaByCorp.get(B)!).toBe(0); // conserved
  });

  it("charges nothing when production met the contract but the market did not take it", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0 },
      ],
      // Only 30 cleared, but the supplier MADE all 100 — not its breach.
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 30]])]]),
      producedByCorpCommodity: new Map([[S, new Map([[commodity, 100]])]]),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    expect(r.settledCount).toBe(0);
    expect(r.deltaByCorp.size).toBe(0);
  });

  it("nets damages against the premium on the same agreement", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0.2 },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 50]])]]),
      producedByCorpCommodity: new Map([[S, new Map([[commodity, 50]])]]),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    const premium = 50 * base * 0.2;
    const penalty = 50 * base * CONTRACT_SHORTFALL_PENALTY;
    expect(r.deltaByCorp.get(S)).toBe(Math.round(premium - penalty));
    expect(r.deltaByCorp.get(B)).toBe(-Math.round(premium - penalty));
  });

  it("splits a shortfall across the supplier's agreements pro-rata by cap", () => {
    const B2 = new ObjectId();
    const info = (id: string): SettleCorpInfo | undefined =>
      id === S
        ? { _id: supId, name: "Sup", ccy: "USD" as CurrencyCode, fxRate: 1 }
        : id === B
          ? { _id: buyId, name: "Buy", ccy: "USD" as CurrencyCode, fxRate: 1 }
          : id === B2.toString()
            ? { _id: B2, name: "Buy2", ccy: "USD" as CurrencyCode, fxRate: 1 }
            : undefined;
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 75, pricePremium: 0 },
        {
          supplierCorpId: S,
          buyerCorpId: B2.toString(),
          commodity,
          volumeCap: 25,
          pricePremium: 0,
        },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 40]])]]),
      producedByCorpCommodity: new Map([[S, new Map([[commodity, 40]])]]),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: info,
      turn: 5,
      now,
    });
    // 60-unit shortfall on a 100-unit book: 45 to the 75-cap buyer, 15 to the
    // 25-cap one. The 75-cap leg's raw damages (45 x 0.5 = 22.5 units of value)
    // exceed the C6 ceiling of 0.25 x its own notional (75 x 0.25 = 18.75), so
    // it settles AT the cap; the 25-cap leg (15 x 0.5 = 7.5 vs 6.25) is capped
    // too. Both stay pro-rata in the sense that matters: each contract's damages
    // are bounded by its own contracted size.
    expect(r.deltaByCorp.get(B)).toBe(Math.round(75 * base * CONTRACT_DAMAGES_CAP_FRACTION));
    expect(r.deltaByCorp.get(B2.toString())).toBe(
      Math.round(25 * base * CONTRACT_DAMAGES_CAP_FRACTION)
    );
  });

  it("penalizes the AGGREGATE shortfall when each contract alone is covered (H1)", () => {
    // The round-4 audit's exact counterexample. Production P = 100. Two contracts
    // of 80 each: EITHER one is individually covered by P, but together they
    // promise 160 against 100 made. A per-contract test (`volumeCap - produced`)
    // finds max(0, 80 - 100) = 0 twice and the seller walks. The settlement must
    // measure the seller's WHOLE book on that commodity: 160 promised, 100 made,
    // 60 short, split pro-rata (30 / 30 on equal caps).
    const B2 = new ObjectId();
    const info = (id: string): SettleCorpInfo | undefined =>
      id === S
        ? { _id: supId, name: "Sup", ccy: "USD" as CurrencyCode, fxRate: 1 }
        : id === B
          ? { _id: buyId, name: "Buy", ccy: "USD" as CurrencyCode, fxRate: 1 }
          : id === B2.toString()
            ? { _id: B2, name: "Buy2", ccy: "USD" as CurrencyCode, fxRate: 1 }
            : undefined;
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 80, pricePremium: 0 },
        {
          supplierCorpId: S,
          buyerCorpId: B2.toString(),
          commodity,
          volumeCap: 80,
          pricePremium: 0,
        },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 100]])]]),
      producedByCorpCommodity: new Map([[S, new Map([[commodity, 100]])]]),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: info,
      turn: 5,
      now,
    });
    const perBuyer = Math.round(30 * base * CONTRACT_SHORTFALL_PENALTY);
    expect(r.deltaByCorp.get(B)).toBe(perBuyer);
    expect(r.deltaByCorp.get(B2.toString())).toBe(perBuyer);
    // Equal and opposite: the seller pays exactly the sum of both buyers' credits.
    expect(r.deltaByCorp.get(S)).toBe(-2 * perBuyer);
  });

  it("assesses no damages at all when no production map is supplied (non-plants)", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0 },
      ],
      contractSettlementByCorp: new Map([[S, new Map([[commodity, 10]])]]),
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    expect(r.settledCount).toBe(0);
  });
  // Mothball exploit regression: clearing only records sellers with units > 0,
  // so a corp that shut its plants has NO entry in the production map. Reading
  // that as "unknown ⇒ no damages" made producing zero strictly cheaper than
  // producing one unit. A supplied map means a missing entry is zero produced.
  it("charges a mothballed seller the FULL shortfall penalty", () => {
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0 },
      ],
      // Nothing cleared and the supplier is absent from the production sink.
      contractSettlementByCorp: new Map(),
      producedByCorpCommodity: new Map(),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    // Full 100-unit shortfall: raw damages are 100 x 0.5, above the C6 ceiling
    // of 0.25 x notional, so a total non-delivery settles at the cap.
    const penalty = Math.round(100 * base * CONTRACT_DAMAGES_CAP_FRACTION);
    expect(r.deltaByCorp.get(S)).toBe(-penalty);
    expect(r.deltaByCorp.get(B)).toBe(penalty);
  });

  // ...and mothballing must never beat producing a single unit.
  it("never makes mothballing cheaper than producing one unit", () => {
    const call = (produced: Map<CommodityType, number> | undefined) =>
      computeSupplyAgreementSettlements({
        agreements: [
          { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0 },
        ],
        contractSettlementByCorp: new Map(),
        producedByCorpCommodity: new Map(produced ? [[S, produced]] : []),
        plantsEnabled: true,
        eraUnitScale: 1,
        priceRatioByCommodity: ratio,
        corpInfo: makeInfo(),
        turn: 5,
        now,
      });
    const mothballed = call(undefined).deltaByCorp.get(S)!;
    const oneUnit = call(new Map([[commodity, 1]])).deltaByCorp.get(S)!;
    expect(mothballed).toBeLessThanOrEqual(oneUnit);
  });

  // The production sink is only meaningful under plants: outside it, clearing's
  // `s.units` is the post-normalization revenue nameplate, not real output.
  it("refuses a production map without the plants gate", () => {
    expect(() =>
      computeSupplyAgreementSettlements({
        agreements: [
          { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0 },
        ],
        contractSettlementByCorp: new Map([[S, new Map([[commodity, 10]])]]),
        producedByCorpCommodity: new Map([[S, new Map([[commodity, 10]])]]),
        eraUnitScale: 1,
        priceRatioByCommodity: ratio,
        corpInfo: makeInfo(),
        turn: 5,
        now,
      })
    ).toThrow(/plantsEnabled/);
  });
});

describe("C6 — damages are bounded and solvency-floored", () => {
  const solventInfo = (
    supplierAnchor: number,
    buyerAnchor = 1e15
  ): ((id: string) => SettleCorpInfo | undefined) => {
    return (id) =>
      id === S
        ? {
            _id: supId,
            name: "Sup",
            ccy: "USD" as CurrencyCode,
            fxRate: 1,
            liquidCapitalAnchor: supplierAnchor,
          }
        : id === B
          ? {
              _id: buyId,
              name: "Buy",
              ccy: "USD" as CurrencyCode,
              fxRate: 1,
              liquidCapitalAnchor: buyerAnchor,
            }
          : undefined;
  };

  /**
   * THE COLLUSION SCENARIO. Two players sign one contract for an absurd volume
   * — the pair that signs it also sets `volumeCap`, so nothing outside the deal
   * bounds it — and the supplier simply never produces. Uncapped, the supplier
   * wires `shortfall x price x 0.5` to the buyer every turn, for ever, with no
   * counterparty and no ceiling: an unlimited cash pump between two accounts.
   */
  it("bounds a colluding pair's per-turn wire to a fraction of the notional", () => {
    const absurdCap = 1_000_000_000;
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: absurdCap, pricePremium: 0 },
      ],
      contractSettlementByCorp: new Map(),
      producedByCorpCommodity: new Map(), // produced nothing
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: solventInfo(1e15),
      turn: 5,
      now,
    });
    const wired = r.deltaByCorp.get(B) ?? 0;
    const uncapped = absurdCap * base * CONTRACT_SHORTFALL_PENALTY;
    const ceiling = absurdCap * base * CONTRACT_DAMAGES_CAP_FRACTION;
    expect(wired).toBeLessThanOrEqual(Math.round(ceiling));
    expect(wired).toBeLessThan(uncapped);
    // Still equal-and-opposite: the cap is a bound, not a leak.
    expect(r.deltaByCorp.get(S)).toBe(-wired);
  });

  it("never wires more than the payer actually has", () => {
    const broke = 5_000;
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 1_000_000, pricePremium: 0 },
      ],
      contractSettlementByCorp: new Map(),
      producedByCorpCommodity: new Map(),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: solventInfo(broke),
      turn: 5,
      now,
    });
    expect(r.deltaByCorp.get(S)).toBe(-broke);
    expect(r.deltaByCorp.get(B)).toBe(broke);
  });

  it("shares one payer's balance across its contracts instead of paying it twice", () => {
    const broke = 5_000;
    const B2 = new ObjectId();
    const info = (id: string): SettleCorpInfo | undefined =>
      id === S
        ? {
            _id: supId,
            name: "Sup",
            ccy: "USD" as CurrencyCode,
            fxRate: 1,
            liquidCapitalAnchor: broke,
          }
        : id === B
          ? { _id: buyId, name: "Buy", ccy: "USD" as CurrencyCode, fxRate: 1 }
          : id === B2.toString()
            ? { _id: B2, name: "Buy2", ccy: "USD" as CurrencyCode, fxRate: 1 }
            : undefined;
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 1_000_000, pricePremium: 0 },
        {
          supplierCorpId: S,
          buyerCorpId: B2.toString(),
          commodity,
          volumeCap: 1_000_000,
          pricePremium: 0,
        },
      ],
      contractSettlementByCorp: new Map(),
      producedByCorpCommodity: new Map(),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: info,
      turn: 5,
      now,
    });
    expect(r.deltaByCorp.get(S)).toBe(-broke);
    const paidOut = (r.deltaByCorp.get(B) ?? 0) + (r.deltaByCorp.get(B2.toString()) ?? 0);
    expect(paidOut).toBe(broke);
  });

  it("keeps the pre-C6 behaviour when no balance is supplied", () => {
    // Callers/tests that do not resolve balances must not have every settlement
    // silently floored to zero.
    const r = computeSupplyAgreementSettlements({
      agreements: [
        { supplierCorpId: S, buyerCorpId: B, commodity, volumeCap: 100, pricePremium: 0 },
      ],
      contractSettlementByCorp: new Map(),
      producedByCorpCommodity: new Map(),
      plantsEnabled: true,
      eraUnitScale: 1,
      priceRatioByCommodity: ratio,
      corpInfo: makeInfo(),
      turn: 5,
      now,
    });
    expect(r.deltaByCorp.get(B)).toBe(Math.round(100 * base * CONTRACT_DAMAGES_CAP_FRACTION));
  });
});
