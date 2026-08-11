import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { NATIONAL_SCOPE } from "@/lib/constants/nationalScope";
import type { Bill } from "@/lib/db/types";
import type { State } from "@/lib/db/types";

/**
 * Infer country from pseudo-state ids used for national-scope bills (federal, uk_national, ca_national, …).
 * Keeps config in sync with `NATIONAL_SCOPE` plus `{cc}_national` for any configured CountryId.
 */
export function inferCountryIdFromStateId(stateId: string): CountryId | undefined {
  const fromTable = NATIONAL_SCOPE[stateId];
  if (fromTable) return fromTable;

  if (stateId.endsWith("_national")) {
    const prefix = stateId.slice(0, -"_national".length).toUpperCase();
    if (prefix in COUNTRY_CONFIGS) {
      return prefix as CountryId;
    }
  }
  return undefined;
}

/**
 * Authoritative country for a bill: prefer persisted `bill.countryId`, else state row, else pseudo-state / legacy fallback.
 */
export async function resolveBillCountryId(
  db: Db,
  bill: Pick<Bill, "countryId" | "stateId">
): Promise<CountryId> {
  if (bill.countryId) return bill.countryId;

  const sid = bill.stateId;
  if (sid) {
    const inferred = inferCountryIdFromStateId(sid);
    if (inferred) return inferred;

    const state = await db
      .collection<State>("states")
      .findOne({ _id: sid }, { projection: { countryId: 1 } });
    if (state?.countryId) return state.countryId;
  }

  // Legacy US Congress bills: real state abbreviations only, no countryId field
  return "US";
}
