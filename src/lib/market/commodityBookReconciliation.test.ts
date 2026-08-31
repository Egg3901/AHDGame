import { describe, expect, it } from "vitest";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import type { CommoditySourcingDoc } from "@/lib/logistics/sourcingLedger";
import { reconcileCommodityBooks } from "./commodityBookReconciliation";

const createdAt = new Date("2026-08-25T00:00:00.000Z");

function ledgerDoc(
  values: Pick<
    CommodityFlow,
    | "commodity"
    | "supplyUnits"
    | "demandUnits"
    | "demandUnitsLedger"
    | "clearedUnits"
    | "clearedUnitsPooled"
    | "unmetDemandUnits"
    | "unmetDemandUnitsPooled"
    | "surplusUnits"
    | "surplusUnitsPooled"
    | "byCountry"
  >
): CommodityFlow {
  return {
    basis: "ledger_aggregate",
    clearingBasis: "global_pooled_availability",
    turn: 365,
    price: 1,
    stockUnits: null,
    coverTurns: null,
    spoiledUnits: 0,
    createdAt,
    ...values,
  };
}

function sourcingDoc(
  values: Pick<
    CommoditySourcingDoc,
    | "commodity"
    | "demandUnitsIntent"
    | "intraStateUnits"
    | "interStateUnits"
    | "importUnits"
    | "unmetUnits"
  >
): CommoditySourcingDoc {
  return {
    basis: "buyer_intent_sourcing",
    turn: 365,
    tariffPaid: 0,
    toleranceBoundUnits: 0,
    capacityBoundUnits: 0,
    shortageResponsiveUnits: 0,
    flows: [],
    itemizedFlowCount: 0,
    totalFlowCount: 0,
    createdAt,
    ...values,
  };
}

describe("reconcileCommodityBooks", () => {
  it("reports the known t365-shaped divergence without normalizing any book", () => {
    const ledger = [
      ledgerDoc({
        commodity: "energy",
        supplyUnits: 61_800_000,
        demandUnits: 100_000_000,
        demandUnitsLedger: 100_000_000,
        clearedUnits: 61_800_000,
        clearedUnitsPooled: 61_800_000,
        unmetDemandUnits: 38_200_000,
        unmetDemandUnitsPooled: 38_200_000,
        surplusUnits: 0,
        surplusUnitsPooled: 0,
        byCountry: {
          US: {
            basis: "country_scoped_ledger",
            supply: 40_000_000,
            demand: 60_000_000,
            cleared: 40_000_000,
            clearedUnitsScoped: 40_000_000,
            price: 1,
          },
        },
      }),
      ledgerDoc({
        commodity: "steel",
        supplyUnits: 135_400_000,
        demandUnits: 256_000_000,
        demandUnitsLedger: 256_000_000,
        clearedUnits: 135_400_000,
        clearedUnitsPooled: 135_400_000,
        unmetDemandUnits: 120_600_000,
        unmetDemandUnitsPooled: 120_600_000,
        surplusUnits: 0,
        surplusUnitsPooled: 0,
        byCountry: {
          US: {
            basis: "country_scoped_ledger",
            supply: 79_700_000,
            demand: 100_000_000,
            cleared: 79_700_000,
            clearedUnitsScoped: 79_700_000,
            price: 1,
          },
        },
      }),
    ];
    const sourcing = [
      sourcingDoc({
        commodity: "energy",
        demandUnitsIntent: 182_000_000,
        intraStateUnits: 20_000_000,
        interStateUnits: 20_000_000,
        importUnits: 26_800_000,
        unmetUnits: 115_200_000,
      }),
      sourcingDoc({
        commodity: "steel",
        demandUnitsIntent: 233_000_000,
        intraStateUnits: 60_000_000,
        interStateUnits: 40_000_000,
        importUnits: 20_000_000,
        unmetUnits: 113_000_000,
      }),
    ];

    const result = reconcileCommodityBooks({ ledger, sourcing });

    expect(result.worldDemand.ledger.units).toBe(356_000_000);
    expect(result.worldDemand.sourcing.units).toBe(415_000_000);
    expect(result.worldDemand.divergenceUnits).toBe(59_000_000);
    expect(result.worldDemand.divergencePctOfLedger).toBeCloseTo(16.57, 2);

    expect(result.byCommodity.energy.demand.divergencePctOfLedger).toBe(82);
    expect(result.byCommodity.energy.unmetDemand.ledger.units).toBe(38_200_000);
    expect(result.byCommodity.energy.unmetDemand.sourcing.units).toBe(115_200_000);
    expect(result.byCommodity.energy.unmetDemand.divergenceUnits).toBe(77_000_000);

    expect(result.clearing.pooled.units).toBe(197_200_000);
    expect(result.clearing.countryScoped.units).toBe(119_700_000);
    expect(result.clearing.divergenceUnits).toBe(77_500_000);
    expect(result.clearing.explanation.code).toBe("pooled_min_is_not_sum_of_scoped_minima");
  });

  it("preserves persisted basis markers through JSON round-trip", () => {
    const persisted = JSON.parse(
      JSON.stringify({
        ledger: ledgerDoc({
          commodity: "energy",
          supplyUnits: 10,
          demandUnits: 20,
          demandUnitsLedger: 20,
          clearedUnits: 10,
          clearedUnitsPooled: 10,
          unmetDemandUnits: 10,
          unmetDemandUnitsPooled: 10,
          surplusUnits: 0,
          surplusUnitsPooled: 0,
          byCountry: {
            US: {
              basis: "country_scoped_ledger",
              supply: 10,
              demand: 20,
              cleared: 10,
              clearedUnitsScoped: 10,
              price: 1,
            },
          },
        }),
        sourcing: sourcingDoc({
          commodity: "energy",
          demandUnitsIntent: 20,
          intraStateUnits: 10,
          interStateUnits: 0,
          importUnits: 0,
          unmetUnits: 10,
        }),
      })
    );

    expect(persisted.ledger.basis).toBe("ledger_aggregate");
    expect(persisted.ledger.clearingBasis).toBe("global_pooled_availability");
    expect(persisted.ledger.byCountry.US.basis).toBe("country_scoped_ledger");
    expect(persisted.sourcing.basis).toBe("buyer_intent_sourcing");
  });

  it("degrades rather than throwing when a doc predates the basis markers", () => {
    // The flow ledger is retained for a full window of turns, so pre-deploy
    // rows legitimately lack markers. Reporting them beats refusing to run.
    const stale = {
      ...ledgerDoc({
        commodity: "iron",
        supplyUnits: 10,
        demandUnits: 20,
        demandUnitsLedger: 20,
        clearedUnits: 10,
        clearedUnitsPooled: 10,
        unmetDemandUnits: 10,
        unmetDemandUnitsPooled: 10,
        surplusUnits: 0,
        surplusUnitsPooled: 0,
        byCountry: {},
      }),
      basis: undefined as unknown as "ledger_aggregate",
    };
    const result = reconcileCommodityBooks({
      ledger: [stale],
      sourcing: [
        sourcingDoc({
          commodity: "iron",
          demandUnitsIntent: 25,
          intraStateUnits: 5,
          interStateUnits: 0,
          importUnits: 5,
          unmetUnits: 15,
        }),
      ],
    });
    expect(result.coverage.unmarkedBases.length).toBeGreaterThan(0);
    expect(result.coverage.unmarkedBases.join(" ")).toContain("iron");
  });

  it("computes the headline demand divergence over the shared basket only", () => {
    // The ledger carries every commodity, the sourcing book only the shipped
    // ones. A commodity present in just one book must not inflate divergence.
    const iron = ledgerDoc({
      commodity: "iron",
      supplyUnits: 10,
      demandUnits: 20,
      demandUnitsLedger: 20,
      clearedUnits: 10,
      clearedUnitsPooled: 10,
      unmetDemandUnits: 10,
      unmetDemandUnitsPooled: 10,
      surplusUnits: 0,
      surplusUnitsPooled: 0,
      byCountry: {},
    });
    const services = ledgerDoc({
      commodity: "financial_services",
      supplyUnits: 100,
      demandUnits: 100,
      demandUnitsLedger: 100,
      clearedUnits: 100,
      clearedUnitsPooled: 100,
      unmetDemandUnits: 0,
      unmetDemandUnitsPooled: 0,
      surplusUnits: 0,
      surplusUnitsPooled: 0,
      byCountry: {},
    });
    const result = reconcileCommodityBooks({
      ledger: [iron, services],
      sourcing: [
        sourcingDoc({
          commodity: "iron",
          demandUnitsIntent: 25,
          intraStateUnits: 5,
          interStateUnits: 0,
          importUnits: 5,
          unmetUnits: 15,
        }),
      ],
    });
    expect(result.coverage.sharedCommodities).toEqual(["iron"]);
    expect(result.worldDemand.basket).toBe("shared");
    expect(result.worldDemand.ledger.units).toBe(20);
    expect(result.worldDemand.sourcing.units).toBe(25);
    expect(result.worldDemand.fullBasket.ledgerAllCommodities).toBe(120);
  });
});
