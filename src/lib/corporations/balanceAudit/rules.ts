/**
 * Pure metric contract for corporation balance audits.
 *
 * Money is supplied in anchor currency by the host. This module deliberately
 * knows nothing about Mongo, FX storage, or the current world so the same
 * cohort and denominator rules can run in ops scripts and headless sims.
 */

export const CORPORATION_BALANCE_AUDIT_SCHEMA_VERSION = 1 as const;

export type CorporationManagementCohort =
  | "state-controlled"
  | "vacant"
  | "npp-managed"
  | "player-managed"
  | "imperial-managed"
  | "unclassified";

export interface CorporationAuditInput {
  id: string;
  ceoType?: "character" | "imperial" | "npp" | null;
  ceoVacant?: boolean;
  countryOwnerId?: string | null;
  ownershipState?: "private" | "stateOwned" | null;
  userId?: string | null;
  revenueAnchor: number;
  profitAnchor: number;
  marketCapAnchor: number | null;
}

export interface CorporationCohortMetrics {
  corporations: number;
  revenueActiveCorporations: number;
  revenueAnchor: number;
  profitAnchor: number;
  marketCapAnchor: number;
  listedCorporations: number;
  revenueShare: number | null;
  listedMarketCapShare: number | null;
  margin: number | null;
}

export interface CorporationBalanceAudit {
  schemaVersion: typeof CORPORATION_BALANCE_AUDIT_SCHEMA_VERSION;
  definitions: {
    revenueActive: "revenueAnchor > 0";
    listedMarketCap: "marketCapAnchor != null";
    cohortPrecedence: readonly CorporationManagementCohort[];
  };
  denominators: {
    corporations: number;
    revenueActiveCorporations: number;
    revenueAnchor: number;
    listedCorporations: number;
    listedMarketCapAnchor: number;
  };
  cohorts: Record<CorporationManagementCohort, CorporationCohortMetrics>;
}

const SYSTEM_USER_ID = "000000000000000000000000";

export const COHORT_PRECEDENCE = [
  "state-controlled",
  "vacant",
  "npp-managed",
  "player-managed",
  "imperial-managed",
  "unclassified",
] as const satisfies readonly CorporationManagementCohort[];

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function classifyCorporationManagement(
  row: Pick<
    CorporationAuditInput,
    "ceoType" | "ceoVacant" | "countryOwnerId" | "ownershipState" | "userId"
  >
): CorporationManagementCohort {
  if (row.ownershipState === "stateOwned" || row.countryOwnerId) return "state-controlled";
  if (row.ceoVacant === true) return "vacant";
  if (row.ceoType === "npp") return "npp-managed";
  if (row.ceoType === "character") return "player-managed";
  if (row.ceoType === "imperial") return "imperial-managed";
  if (row.userId && row.userId !== SYSTEM_USER_ID) return "player-managed";
  return "unclassified";
}

function emptyMetrics(): CorporationCohortMetrics {
  return {
    corporations: 0,
    revenueActiveCorporations: 0,
    revenueAnchor: 0,
    profitAnchor: 0,
    marketCapAnchor: 0,
    listedCorporations: 0,
    revenueShare: null,
    listedMarketCapShare: null,
    margin: null,
  };
}

export function buildCorporationBalanceAudit(
  rows: readonly CorporationAuditInput[]
): CorporationBalanceAudit {
  const cohorts = Object.fromEntries(
    COHORT_PRECEDENCE.map((key) => [key, emptyMetrics()])
  ) as Record<CorporationManagementCohort, CorporationCohortMetrics>;

  for (const row of rows) {
    const metrics = cohorts[classifyCorporationManagement(row)];
    const revenue = finite(row.revenueAnchor);
    const profit = finite(row.profitAnchor);
    metrics.corporations++;
    if (revenue > 0) metrics.revenueActiveCorporations++;
    metrics.revenueAnchor += revenue;
    metrics.profitAnchor += profit;
    if (row.marketCapAnchor !== null && Number.isFinite(row.marketCapAnchor)) {
      metrics.listedCorporations++;
      metrics.marketCapAnchor += row.marketCapAnchor;
    }
  }

  const denominators = Object.values(cohorts).reduce(
    (total, row) => ({
      corporations: total.corporations + row.corporations,
      revenueActiveCorporations: total.revenueActiveCorporations + row.revenueActiveCorporations,
      revenueAnchor: total.revenueAnchor + row.revenueAnchor,
      listedCorporations: total.listedCorporations + row.listedCorporations,
      listedMarketCapAnchor: total.listedMarketCapAnchor + row.marketCapAnchor,
    }),
    {
      corporations: 0,
      revenueActiveCorporations: 0,
      revenueAnchor: 0,
      listedCorporations: 0,
      listedMarketCapAnchor: 0,
    }
  );

  for (const row of Object.values(cohorts)) {
    row.revenueShare =
      denominators.revenueAnchor > 0 ? row.revenueAnchor / denominators.revenueAnchor : null;
    row.listedMarketCapShare =
      denominators.listedMarketCapAnchor > 0
        ? row.marketCapAnchor / denominators.listedMarketCapAnchor
        : null;
    row.margin = row.revenueAnchor !== 0 ? row.profitAnchor / row.revenueAnchor : null;
  }

  return {
    schemaVersion: CORPORATION_BALANCE_AUDIT_SCHEMA_VERSION,
    definitions: {
      revenueActive: "revenueAnchor > 0",
      listedMarketCap: "marketCapAnchor != null",
      cohortPrecedence: COHORT_PRECEDENCE,
    },
    denominators,
    cohorts,
  };
}
