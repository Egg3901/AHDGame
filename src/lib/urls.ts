import { compactRegionCode, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";

// ── Internal helpers ──
// Defensive coercions so URL builders never throw when a caller hands in an
// undefined countryId/regionCode. A bug in a parent component shouldn't
// take down the whole app via the global error boundary; falling back to a
// sane default produces a clearly-wrong URL (which 404s) instead of a crash.
function lowerCountry(countryId: CountryId | string | null | undefined): string {
  return typeof countryId === "string" && countryId.length > 0 ? countryId.toLowerCase() : "us";
}

function upperRegion(regionCode: string | null | undefined): string {
  return typeof regionCode === "string" && regionCode.length > 0 ? regionCode.toUpperCase() : "";
}

// ── Page URL helpers ──

export function regionUrl(countryId: CountryId | string, regionCode: string): string {
  // Prefixed region ids (HU_BUD) render as their short form (BUD) — the route
  // resolvers re-expand via canonicalRegionId, and full-id URLs stay valid.
  const country = typeof countryId === "string" ? countryId.toUpperCase() : countryId;
  return `/country/${lowerCountry(countryId)}/region/${upperRegion(
    compactRegionCode(country, regionCode ?? "")
  )}`;
}

export function regionRedistrictUrl(countryId: CountryId | string, regionCode: string): string {
  return `${regionUrl(countryId, regionCode)}/redistrict`;
}

/**
 * A region's Elections sub-tab: /country/us/region/NY?tab=politics&sub=elections
 *
 * This is where a player actually sees the races they can file for, so it is
 * the right destination for "file for a race" rather than the country-wide
 * elections index. The `?tab=&sub=` shape is RegionTabNav's contract.
 */
export function regionElectionsUrl(countryId: CountryId | string, regionCode: string): string {
  return `${regionUrl(countryId, regionCode)}?tab=politics&sub=elections`;
}

export function regionLegislatureUrl(countryId: CountryId | string, regionCode: string): string {
  return `${regionUrl(countryId, regionCode)}/legislature`;
}

/** Single state / devolved legislature bill detail page */
export function regionStateBillUrl(
  countryId: CountryId | string,
  regionCode: string,
  billId: string
): string {
  return `${regionLegislatureUrl(countryId, regionCode)}/bills/${billId}`;
}

export function regionPartyUrl(
  countryId: CountryId | string,
  regionCode: string,
  partyId: number | string
): string {
  return `${regionUrl(countryId, regionCode)}/party/${partyId}`;
}

export function regionMetricUrl(
  countryId: CountryId | string,
  regionCode: string,
  category: string,
  metricId: string
): string {
  return `${regionUrl(countryId, regionCode)}/metrics/${category}/${metricId}`;
}

export function countryUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}`;
}

export function countryMapUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/map`;
}

export function legislatureUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/legislature`;
}

export function executiveUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/executive`;
}

export function cabinetUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/executive/cabinet`;
}

export function cabinetOfficeUrl(countryId: CountryId | string, positionId: string): string {
  return `/country/${lowerCountry(countryId)}/executive/cabinet/${positionId}/office`;
}

// SCOTUS is US-only (#3581) — these still take a countryId param for URL-builder
// consistency, but only ever resolve to a real page under "us".
export function scotusUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/executive/supreme-court`;
}

export function scotusJusticeOfficeUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/executive/supreme-court/justice`;
}

export function countryElectionsUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/elections`;
}

export function electionRegionUrl(
  electionId: string,
  countryId: CountryId | string,
  regionCode: string
): string {
  return `/elections/${electionId}/country/${lowerCountry(countryId)}/region/${upperRegion(regionCode)}`;
}

// ── API URL helpers ──

export function regionApiUrl(countryId: CountryId | string, regionCode: string): string {
  return `/api/country/${lowerCountry(countryId)}/region/${upperRegion(regionCode)}`;
}

export function regionPartyApiUrl(
  countryId: CountryId | string,
  regionCode: string,
  partyId: number | string
): string {
  return `${regionApiUrl(countryId, regionCode)}/party/${partyId}`;
}

export function regionApiSubUrl(
  countryId: CountryId | string,
  regionCode: string,
  subPath: string
): string {
  return `${regionApiUrl(countryId, regionCode)}/${subPath}`;
}

export function legislatureApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/legislature`;
}

export function executiveApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/executive`;
}

export function socialAxisApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/social-axis`;
}

// ── Page URL helpers (pass 2) ──

export function partiesUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/parties`;
}

export function partyUrl(countryId: CountryId | string, partyId: number | string): string {
  return `/country/${lowerCountry(countryId)}/parties/${partyId}`;
}

export function coalitionUrl(countryId: CountryId | string, coalitionId: string): string {
  return `/country/${lowerCountry(countryId)}/parties/coalition/${coalitionId}`;
}

export function politiciansUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/politicians`;
}

export function metricsUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/metrics`;
}

/** Political Metrics v1 dashboard (playable US/UK/RU/DD set only). */
export function politicalMetricsUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/political-metrics`;
}

export function policyUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/policy`;
}

export function approvalUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/approval`;
}

/** Per-region approval breakdown page (country-scoped; avoids ambiguous bare state IDs). */
export function regionApprovalUrl(countryId: CountryId | string, regionCode: string): string {
  return `${regionUrl(countryId, regionCode)}/approval`;
}

export function budgetUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/budget`;
}

export function economyUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/economy`;
}

/** Country-scoped unions roster: /country/uk/unions */
export function unionsUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/unions`;
}

/** Referendums index for a country: /country/uk/referendums */
export function referendumsUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/referendums`;
}

/**
 * Per-region referendum detail page. The current (latest) referendum resolves
 * with no cycle; pass `cycle` for a historical one:
 *   /country/uk/referendums/nir  ·  /country/uk/referendums/nir?cycle=2
 */
export function referendumDetailUrl(
  countryId: CountryId | string,
  regionId: string,
  cycle?: number
): string {
  const base = `/country/${lowerCountry(countryId)}/referendums/${regionId.toLowerCase()}`;
  return cycle != null ? `${base}?cycle=${cycle}` : base;
}

export function currencyCentralBankUrl(code: CurrencyCode): string {
  return `/centralbank/${code.toLowerCase()}`;
}

export function centralBankUrl(countryId: CountryId | string): string {
  const normalizedCountryId = (
    typeof countryId === "string" ? countryId.toUpperCase() : countryId
  ) as CountryId;
  const currency = COUNTRY_CURRENCY_MAP[normalizedCountryId];
  if (currency) return currencyCentralBankUrl(currency);
  // Unknown ids (defensive) keep the legacy country-scoped shape.
  return `/country/${lowerCountry(countryId)}/central-bank`;
}

export function stockmarketUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/stockmarket`;
}

export function forexUrl(countryId: CountryId | string): string {
  return `/country/${lowerCountry(countryId)}/forex`;
}

// ── API URL helpers (pass 2) ──

export function partiesApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/parties`;
}

export function partyApiUrl(countryId: CountryId | string, partyId: number | string): string {
  return `/api/country/${lowerCountry(countryId)}/parties/${partyId}`;
}

export function coalitionsApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/coalitions`;
}

export function coalitionApiUrl(countryId: CountryId | string, coalitionId: string): string {
  return `/api/country/${lowerCountry(countryId)}/coalitions/${coalitionId}`;
}

export function politiciansApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/politicians`;
}

export function metricsApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/metrics`;
}

export function approvalApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/approval`;
}

export function policyApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/policy`;
}

export function nationalAxesApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/national-axes`;
}

export function overviewCountsApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/overview-counts`;
}

export function budgetApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/budget/federal`;
}

export function centralBankApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/central-bank`;
}

export function intorgCentralBankApiUrl(orgId: string): string {
  return `/api/intorg/${lowerCountry(orgId)}/central-bank`;
}

export function congressMembersApiUrl(countryId: CountryId | string): string {
  return `/api/country/${lowerCountry(countryId)}/congress/members`;
}

/**
 * Per-party primary page for a given race tier. Presidential lives at
 * `/president/primary/[partyId]` (preserved for backwards compat); the
 * lower tiers — Senate, Governor, House — share the new
 * `/elections/primary/[tier]/[partyId]` tree built out as part of the
 * tier-selector activation feature.
 */
export function tierPrimaryRoute(
  tier: "president" | "senate" | "stateSenate" | "governor" | "house",
  partyId: string
): string {
  if (tier === "president") return `/president/primary/${partyId}`;
  return `/elections/primary/${tier}/${partyId}`;
}

/** External operations dashboard (admin-only link in the navbar). */
export const OPS_DASHBOARD_URL = "https://ops.ahousedividedgame.com";
