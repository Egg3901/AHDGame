import { getDb } from "@/lib/mongodb";
import type { Corporation, Tariff, Subsidy } from "@/lib/db/types";
import { reconcileSignedTariffBills } from "@/lib/tariffs/reconcileTariffs";
import { assembleNationalPolicyRecords } from "@/lib/policy/nationalPolicyRecords";
import type { PolicyRecordResponse } from "@/lib/policy/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

function formatSectorLabel(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildTariffTargetText(
  tariff: Tariff,
  corporationNameById: Map<string, string>,
  hasSpecificTariffs: boolean
): string {
  switch (tariff.scopeType) {
    case "economy_wide":
      return tariff.rate === 0 && hasSpecificTariffs ? "All other imports" : "All imports";
    case "sector":
      return tariff.targetSectorType
        ? `${formatSectorLabel(tariff.targetSectorType)} sector imports`
        : "Sector imports";
    case "origin_country": {
      const targetCountry = tariff.targetOriginCountryId
        ? (COUNTRY_CONFIGS[tariff.targetOriginCountryId]?.name ?? tariff.targetOriginCountryId)
        : "selected-country";
      return `Imports from ${targetCountry}`;
    }
    case "corporation": {
      const corpName = tariff.targetCorporationId
        ? corporationNameById.get(tariff.targetCorporationId.toString())
        : null;
      return corpName ? `Imports from ${corpName}` : "Corporation-targeted imports";
    }
    default:
      return "Imports";
  }
}

function buildTariffResponse(
  tariff: Tariff,
  corporationNameById: Map<string, string>,
  hasSpecificTariffs: boolean
): PolicyRecordResponse {
  const targetText = buildTariffTargetText(tariff, corporationNameById, hasSpecificTariffs);
  return {
    recordType: "tariff",
    legislationTypeId: `tariff:${tariff._id.toString()}`,
    name: "Tariff",
    policyDomain: "trade",
    economic: 0,
    social: 0,
    nationalOnly: true,
    policyOptionName: `${tariff.rate}% tariff`,
    hasEconomic: false,
    hasSocial: false,
    metricEffects: [],
    detailText: targetText,
    tariffRate: tariff.rate,
    tariffScopeType: tariff.scopeType,
  };
}

function buildSubsidyDetailText(subsidy: Subsidy): string {
  const territory = subsidy.scope === "state" && subsidy.stateId ? subsidy.stateId : "National";
  const coverage =
    subsidy.scopeType === "sector" && subsidy.targetSectorType
      ? `${formatSectorLabel(subsidy.targetSectorType)} sector`
      : "Economy-wide";

  const details = [territory, coverage];
  if (subsidy.targetStrategyId) details.push(`Strategy: ${subsidy.targetStrategyId}`);
  if (subsidy.domesticOnly) details.push("Domestic only");

  return details.join(" | ");
}

export function buildSubsidyResponse(subsidy: Subsidy): PolicyRecordResponse {
  return {
    recordType: "subsidy",
    legislationTypeId: `subsidy:${subsidy._id.toString()}`,
    name: "Subsidy",
    policyDomain: "economic",
    economic: 0,
    social: 0,
    nationalOnly: subsidy.scope === "national",
    policyOptionName: "+7.5% margin subsidy",
    hasEconomic: false,
    hasSocial: false,
    metricEffects: [],
    detailText: buildSubsidyDetailText(subsidy),
    subsidyScope: subsidy.scope,
    subsidyScopeType: subsidy.scopeType,
    subsidyDomesticOnly: subsidy.domesticOnly,
    subsidyTargetSectorType: subsidy.targetSectorType ?? null,
    subsidyTargetStrategyId: subsidy.targetStrategyId ?? null,
  };
}

// GET /api/country/[code]/policy - Return national or state policy positions for all legislation types
// Auth: public
// Errors: 400
/**
 * Assemble the national policy record list (statutes + tariffs + subsidies) for
 * a country. Shared by the GET route (scope=national) and server components (the
 * policy page) so the page can seed its initial data with a direct DB call
 * instead of a client self-fetch through the CDN.
 */
export async function loadNationalPolicyRecords(
  countryId: CountryId
): Promise<PolicyRecordResponse[]> {
  const db = await getDb();
  await reconcileSignedTariffBills(db, countryId);
  const { records: out } = await assembleNationalPolicyRecords(db, countryId);
  const tariffs = await db
    .collection<Tariff>("tariffs")
    .find({ countryId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();
  const subsidies = await db
    .collection<Subsidy>("subsidies")
    .find({ countryId, active: true, scope: "national" })
    .sort({ scopeType: 1, targetSectorType: 1, targetStrategyId: 1, createdAt: 1 })
    .toArray();
  const corporationIds = tariffs
    .map((tariff) => tariff.targetCorporationId)
    .filter((value): value is NonNullable<Tariff["targetCorporationId"]> => value != null);
  const targetedCorporations =
    corporationIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corporationIds } }, { projection: { name: 1 } })
          .toArray()
      : [];
  const corporationNameById = new Map(
    targetedCorporations.map((corporation) => [corporation._id.toString(), corporation.name])
  );

  const hasSpecificTariffs = tariffs.some((tariff) => tariff.scopeType !== "economy_wide");
  const tariffOut = tariffs.map((tariff) =>
    buildTariffResponse(tariff, corporationNameById, hasSpecificTariffs)
  );
  const subsidyOut = subsidies.map((subsidy) => buildSubsidyResponse(subsidy));
  return [...out, ...tariffOut, ...subsidyOut];
}
