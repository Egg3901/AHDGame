import type { Db } from "mongodb";
import { COUNTRY_ORDER, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import { loadCountryPresentationOverrides } from "@/lib/country/countryIdentity";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";
import { shapeWorldTradeLedger, type WorldTradeLedger } from "./worldTradeLedger";

/** Load the latest trade-flow snapshot and shape it for the ledger surface. */
export async function loadWorldTradeLedger(db: Db): Promise<WorldTradeLedger | null> {
  const snap = await db
    .collection<TradeFlowSnapshot>("tradeFlowSnapshots")
    .find({}, { sort: { turn: -1 }, limit: 1 })
    .next();
  if (!snap) return null;
  const [preset, overrides] = await Promise.all([
    loadWorldPreset(db),
    loadCountryPresentationOverrides(db),
  ]);
  const nameOf = (c: CountryId): string => overrides[c]?.name ?? getCountryDisplayName(c, preset);
  return shapeWorldTradeLedger(snap, COUNTRY_ORDER, nameOf);
}
