import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { BillStatus } from "@/lib/db/types";

const LEGACY_UK_NATIONAL_STATE_PATTERN = "^uk_";

export function buildNationalBillCountryScopeFilter(countryId: CountryId): Record<string, unknown> {
  if (countryId !== COUNTRY_CONFIGS.UK.id) {
    return { countryId };
  }

  return {
    $or: [
      { countryId: COUNTRY_CONFIGS.UK.id },
      {
        countryId: { $exists: false },
        $or: [
          { stateId: "uk_national" },
          { stateId: { $regex: LEGACY_UK_NATIONAL_STATE_PATTERN } },
        ],
      },
    ],
  };
}

export function buildActiveNationalBillFilter(
  countryId: CountryId,
  terminalStatuses: BillStatus[]
): Record<string, unknown> {
  return {
    ...buildNationalBillCountryScopeFilter(countryId),
    status: { $nin: terminalStatuses },
  };
}
