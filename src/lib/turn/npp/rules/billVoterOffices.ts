/**
 * NPC deputies vote only in the active national legislature. resolveNppBillVoterOffices
 * selects ordinary, concurrent and override chambers from the same constitution
 * used to load their policy positions, excluding dissolved and obsolete chambers.
 */
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";
import type { Bill } from "@/lib/db/types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { RuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { resolveCountryOfficeLayout } from "@/lib/countries/rules/officeLayout";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";

export function resolveNppBillCountryId(
  bill: Pick<Bill, "countryId" | "stateId">,
  statesById?: ReadonlyMap<string, { countryId: CountryId }>
): CountryId {
  return (
    bill.countryId ??
    (bill.stateId
      ? (inferCountryIdFromStateId(bill.stateId) ?? statesById?.get(bill.stateId)?.countryId)
      : undefined) ??
    "US"
  );
}

export function resolveNppBillVoterOffices(
  bill: Pick<Bill, "countryId" | "stateId" | "status" | "currentChamber">,
  preset?: string,
  runtime?: RuntimeCountryOffices
): { officeTypes: string[]; lowerOfficeType: string } {
  const countryId = resolveNppBillCountryId(bill);
  const layout = runtime ?? resolveCountryOfficeLayout(getCountryConfig(countryId, preset));
  const empty = { officeTypes: [], lowerOfficeType: layout.lowerOfficeType };
  if (layout.config.legislature.lowerChamber.seats < 1) return empty;
  if (bill.status === "active_both" || bill.status === "veto_override") {
    return { officeTypes: layout.jointSittingOfficeTypes, lowerOfficeType: layout.lowerOfficeType };
  }
  const officeType =
    bill.status === "override_shugiin"
      ? "shugiin"
      : getOfficeTypeForChamber(countryId, bill.currentChamber ?? "house", preset, layout.config);
  return {
    officeTypes: [layout.lowerOfficeType, layout.upperOfficeType].includes(officeType)
      ? [officeType]
      : [],
    lowerOfficeType: layout.lowerOfficeType,
  };
}
