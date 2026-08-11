import type { Db, Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";

export async function getExtractionContractsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<ExtractionContract>("extractionContracts");
}

/**
 * Canonical filter for contracts that ACTIVELY allocate state capacity.
 *
 * A contract counts as active when it is:
 *   - non-revoked (`revokedTurn` unset), AND
 *   - not `offered` and not `declined`.
 *
 * ABSENT `status` means a legacy / admin-granted contract, which is active as
 * soon as it is non-revoked (those predate the offer→accept flow). This is
 * correctness-critical: an `offered` contract is a pending proposal and must
 * NEVER reserve capacity in the extraction-capacity multiplier or the 75% cap.
 *
 * Spread this into every extractionContracts read that feeds capacity
 * allocation so the rule lives in exactly one place.
 */
export function activeExtractionContractFilter(): Filter<ExtractionContract> {
  return {
    revokedTurn: { $exists: false },
    status: { $nin: ["offered", "declined"] },
  };
}
