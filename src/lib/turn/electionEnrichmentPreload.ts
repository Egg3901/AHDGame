import type { Db } from "mongodb";
import type { Election } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryState, primeCountryStates, updateCountryState } from "@/lib/countryState";
import {
  resolveEnrichmentCountryConfig,
  type EnrichmentCountryConfig,
} from "@/lib/electionEngine/candidateEnrichment";

/**
 * Resolve runtime vote configuration for a sweep. The one-shot honest-election
 * override is assigned to the first election for its country, then consumed
 * here in the turn shell so candidate enrichment remains read-only.
 */
export async function loadEnrichmentCountryConfigsByElection(
  db: Db,
  elections: readonly Election[]
): Promise<Map<string, EnrichmentCountryConfig>> {
  const byElection = new Map<string, EnrichmentCountryConfig>();
  const countries = [
    ...new Set(elections.map((election) => (election.countryId ?? "US") as CountryId)),
  ];
  await primeCountryStates(db, countries);

  for (const countryId of countries) {
    const runtime = await getCountryState(db, countryId);
    const countryElections = elections.filter(
      (election) => (election.countryId ?? "US") === countryId
    );
    countryElections.forEach((election, index) => {
      byElection.set(
        election._id.toString(),
        resolveEnrichmentCountryConfig(runtime, countryId, index === 0)
      );
    });
    if (runtime.pendingHonestByElection && countryElections.length > 0) {
      await updateCountryState(db, countryId, { pendingHonestByElection: undefined });
    }
  }
  return byElection;
}
