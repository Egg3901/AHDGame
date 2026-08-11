import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

export interface TariffProvisionInput {
  scopeType: "economy_wide" | "sector" | "origin_country";
  targetSectorType?: CorporationType;
  targetOriginCountryId?: CountryId;
  rate: number;
}

export interface TariffProvisionPayload {
  type: "tariff";
  scopeType: TariffProvisionInput["scopeType"];
  targetSectorType?: CorporationType;
  targetOriginCountryId?: CountryId;
  rate: number;
}

export function toPayload(input: TariffProvisionInput): TariffProvisionPayload {
  return {
    type: "tariff",
    scopeType: input.scopeType,
    ...(input.targetSectorType && { targetSectorType: input.targetSectorType }),
    ...(input.targetOriginCountryId && { targetOriginCountryId: input.targetOriginCountryId }),
    rate: input.rate,
  };
}

function rowKey(r: TariffProvisionInput): string {
  return [r.scopeType, r.targetSectorType ?? "", r.targetOriginCountryId ?? ""].join("|");
}

export function validateRows(rows: TariffProvisionInput[]): string | null {
  if (rows.length === 0) return "Trade bills must contain at least one tariff provision.";

  for (const r of rows) {
    if (r.scopeType === "sector" && !r.targetSectorType) {
      return "Sector-scoped tariffs must specify a target sector.";
    }
    if (r.scopeType === "origin_country" && !r.targetOriginCountryId) {
      return "Origin-country-scoped tariffs must specify a target origin country.";
    }
  }

  const seen = new Set<string>();
  for (const r of rows) {
    const key = rowKey(r);
    if (seen.has(key)) return "Duplicate tariff scope in the same bill.";
    seen.add(key);
  }

  return null;
}
