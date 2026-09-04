import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  IntelligenceAgency,
  IntelligenceCoverage,
  IntelligenceNetwork,
  IntelligenceOpLog,
} from "../types/intelligence";

export const INTELLIGENCE_AGENCIES = "intelligenceAgencies";
export const INTELLIGENCE_NETWORKS = "intelligenceNetworks";
export const INTELLIGENCE_COVERAGE = "intelligenceCoverage";
export const INTELLIGENCE_OP_LOG = "intelligenceOpLog";

/**
 * Every collection this feature owns.
 *
 * Exported so the manifest test can assert all four are classified: they are
 * reached through these constants, and `bootstrapContract`'s scan only sees
 * collection names written inline as string literals at the call site. An
 * unclassified collection silently survives every world reset, which is exactly
 * what `covertNuclearPrograms` does today.
 */
export const INTELLIGENCE_COLLECTIONS = [
  INTELLIGENCE_AGENCIES,
  INTELLIGENCE_NETWORKS,
  INTELLIGENCE_COVERAGE,
  INTELLIGENCE_OP_LOG,
] as const;

export async function getIntelligenceAgenciesCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<IntelligenceAgency>(INTELLIGENCE_AGENCIES);
}

export async function getIntelligenceNetworksCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<IntelligenceNetwork>(INTELLIGENCE_NETWORKS);
}

export async function getIntelligenceCoverageCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<IntelligenceCoverage>(INTELLIGENCE_COVERAGE);
}

export async function getIntelligenceOpLogCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<IntelligenceOpLog>(INTELLIGENCE_OP_LOG);
}
