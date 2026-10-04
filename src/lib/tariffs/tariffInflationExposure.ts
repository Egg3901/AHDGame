/**
 * Loads the exact-turn sourcing summary and delegates its eligibility rules.
 */
import type { Db } from "mongodb";
import { SHIPPED_COMMODITIES } from "@/lib/logistics/freightClass";
import type { CommoditySourcingDoc } from "@/lib/logistics/sourcingLedger";
import {
  countryTurnTariffInflationExposure,
  qualifyTariffExposureRows,
} from "./rules/tariffInflationExposure";
import type {
  CountryTariffInflationExposure,
  TurnTariffInflationExposure,
} from "./rules/tariffInflationExposure";

export { countryTurnTariffInflationExposure };
export type { CountryTariffInflationExposure, TurnTariffInflationExposure };

/** Read one turn's projected commodity rows once; no country-specific reads. */
export async function loadTurnTariffInflationExposure(
  db: Db,
  turn: number
): Promise<TurnTariffInflationExposure> {
  const rows = await db
    .collection<CommoditySourcingDoc>("commoditySourcingFlows")
    .find(
      { turn },
      {
        projection: {
          turn: 1,
          commodity: 1,
          purchaseExposureBasis: 1,
          purchaseExposureMode: 1,
          purchaseExposureCoverageCountries: 1,
          purchaseExposureByCountry: 1,
        },
      }
    )
    .toArray();
  return qualifyTariffExposureRows(rows, turn, SHIPPED_COMMODITIES);
}
