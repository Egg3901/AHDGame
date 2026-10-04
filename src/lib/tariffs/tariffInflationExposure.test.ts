import { describe, expect, it } from "vitest";
import type { CommoditySourcingDoc } from "@/lib/logistics/sourcingLedger";
import { SHIPPED_COMMODITIES } from "@/lib/logistics/freightClass";
import {
  countryTurnTariffInflationExposure,
  loadTurnTariffInflationExposure,
} from "./tariffInflationExposure";

const doc = (
  commodity: CommoditySourcingDoc["commodity"],
  overrides: Partial<CommoditySourcingDoc> = {}
): CommoditySourcingDoc =>
  ({
    basis: "buyer_intent_sourcing",
    turn: 12,
    demandUnitsIntent: 10,
    intraStateUnits: 10,
    interStateUnits: 0,
    importUnits: 0,
    tariffPaid: 0,
    unmetUnits: 0,
    toleranceBoundUnits: 0,
    capacityBoundUnits: 0,
    shortageResponsiveUnits: 0,
    flows: [],
    purchaseExposureBasis: "proportional_modeled_demand_uses_v1",
    purchaseExposureMode: "active_delivered",
    purchaseExposureCoverageCountries: ["US"],
    purchaseExposureByCountry: {
      US: {
        householdFinal: {
          domesticUnits: 100,
          domesticPreDutyValue: 100,
          importUnits: 0,
          importPreDutyValue: 0,
          tariffPaid: 0,
          deliveredTariffPaid: 0,
        },
        productionInput: {
          domesticUnits: 50,
          domesticPreDutyValue: 50,
          importUnits: 0,
          importPreDutyValue: 0,
          tariffPaid: 0,
          deliveredTariffPaid: 0,
        },
      },
    },
    itemizedFlowCount: 0,
    totalFlowCount: 0,
    createdAt: new Date(0),
    commodity,
    ...overrides,
  }) as CommoditySourcingDoc;

const completeDocs = (
  overridesByCommodity: Partial<
    Record<CommoditySourcingDoc["commodity"], Partial<CommoditySourcingDoc>>
  > = {}
) => SHIPPED_COMMODITIES.map((commodity) => doc(commodity, overridesByCommodity[commodity]));

const dbFor = (docs: CommoditySourcingDoc[]) =>
  ({
    collection: () => ({
      find: (query: unknown) => ({
        query,
        toArray: async () => docs,
      }),
    }),
  }) as never;

describe("current-turn tariff exposure loader", () => {
  it("uses only exact-turn ACTIVE delivered rows and retains measured zero", async () => {
    const zeroUse = {
      householdFinal: {
        domesticUnits: 0,
        domesticPreDutyValue: 0,
        importUnits: 0,
        importPreDutyValue: 0,
        tariffPaid: 0,
        deliveredTariffPaid: 0,
      },
      productionInput: {
        domesticUnits: 0,
        domesticPreDutyValue: 0,
        importUnits: 0,
        importPreDutyValue: 0,
        tariffPaid: 0,
        deliveredTariffPaid: 0,
      },
    };
    const snapshot = await loadTurnTariffInflationExposure(
      dbFor(completeDocs().map((row) => ({ ...row, purchaseExposureByCountry: { US: zeroUse } }))),
      12
    );
    expect(snapshot).toMatchObject({ turn: 12, available: true, mode: "active_delivered" });
    expect(countryTurnTariffInflationExposure(snapshot, "US")).toMatchObject({
      available: true,
      tariffRate: 3,
      coveredCommodities: [...SHIPPED_COMMODITIES].sort(),
      mode: "active_delivered",
    });
  });

  it("keeps SHADOW sourcing visibly simulated and returns neutral unknown exposure", async () => {
    const snapshot = await loadTurnTariffInflationExposure(
      dbFor(
        completeDocs({ coal: { purchaseExposureMode: "shadow_simulated" } }).map((row) => ({
          ...row,
          purchaseExposureMode: "shadow_simulated",
        }))
      ),
      12
    );
    expect(snapshot).toMatchObject({ available: false, mode: "shadow_simulated" });
    expect(countryTurnTariffInflationExposure(snapshot, "US")).toMatchObject({
      available: false,
      tariffRate: 3,
      coveredCommodities: [],
      mode: "shadow_simulated",
    });
    const staleShadow = await loadTurnTariffInflationExposure(
      dbFor(
        completeDocs().map((row) => ({
          ...row,
          turn: 11,
          purchaseExposureMode: "shadow_simulated",
        }))
      ),
      12
    );
    expect(staleShadow).toMatchObject({ available: false, mode: "unavailable" });
  });

  it("treats missing country coverage and legacy rows as unavailable, not measured zero", async () => {
    const missingCountry = await loadTurnTariffInflationExposure(
      dbFor(completeDocs({ coal: { purchaseExposureCoverageCountries: [] } })),
      12
    );
    const legacy = await loadTurnTariffInflationExposure(
      dbFor(
        completeDocs({
          coal: { purchaseExposureBasis: undefined, purchaseExposureMode: undefined },
        })
      ),
      12
    );
    expect(countryTurnTariffInflationExposure(missingCountry, "US")).toMatchObject({
      available: false,
      mode: "unavailable",
      tariffRate: 3,
    });
    expect(legacy).toMatchObject({ available: false, mode: "unavailable" });
  });

  it("rejects a missing, duplicate, unexpected, or wrong-turn commodity row", async () => {
    const all = completeDocs();
    const missing = await loadTurnTariffInflationExposure(dbFor(all.slice(1)), 12);
    const duplicate = await loadTurnTariffInflationExposure(dbFor([...all, all[0]]), 12);
    const wrongTurn = await loadTurnTariffInflationExposure(
      dbFor(completeDocs({ coal: { turn: 13 } })),
      12
    );
    const unexpected = await loadTurnTariffInflationExposure(
      dbFor([...all.slice(1), doc("not_a_commodity" as CommoditySourcingDoc["commodity"])]),
      12
    );
    expect(missing).toMatchObject({ available: false, mode: "unavailable" });
    expect(duplicate).toMatchObject({ available: false, mode: "unavailable" });
    expect(wrongTurn).toMatchObject({ available: false, mode: "unavailable" });
    expect(unexpected).toMatchObject({ available: false, mode: "unavailable" });
  });

  it("rejects a country's non-finite or negative cohort values instead of counting them as zero", async () => {
    const badNaN = completeDocs({
      coal: {
        purchaseExposureByCountry: {
          US: {
            householdFinal: {
              domesticUnits: 0,
              domesticPreDutyValue: Number.NaN,
              importUnits: 0,
              importPreDutyValue: 0,
              tariffPaid: 0,
              deliveredTariffPaid: 0,
            },
            productionInput: {
              domesticUnits: 0,
              domesticPreDutyValue: 0,
              importUnits: 0,
              importPreDutyValue: 0,
              tariffPaid: 0,
              deliveredTariffPaid: 0,
            },
          },
        },
      },
    });
    const badNegative = completeDocs({
      coal: {
        purchaseExposureByCountry: {
          US: {
            householdFinal: {
              domesticUnits: 0,
              domesticPreDutyValue: 0,
              importUnits: 0,
              importPreDutyValue: 0,
              tariffPaid: 0,
              deliveredTariffPaid: 0,
            },
            productionInput: {
              domesticUnits: 0,
              domesticPreDutyValue: 0,
              importUnits: 0,
              importPreDutyValue: 0,
              tariffPaid: -1,
              deliveredTariffPaid: 0,
            },
          },
        },
      },
    });
    expect(
      countryTurnTariffInflationExposure(
        await loadTurnTariffInflationExposure(dbFor(badNaN), 12),
        "US"
      )
    ).toMatchObject({ available: false, tariffRate: 3, mode: "unavailable" });
    expect(
      countryTurnTariffInflationExposure(
        await loadTurnTariffInflationExposure(dbFor(badNegative), 12),
        "US"
      )
    ).toMatchObject({ available: false, tariffRate: 3, mode: "unavailable" });
  });
});
