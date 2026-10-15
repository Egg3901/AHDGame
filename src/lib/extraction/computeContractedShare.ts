import type { Db, Filter } from "mongodb";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { getExtractionContractsCollection } from "@/lib/db/collections/extractionContracts";
import { GOVT_CONTRACT_MAX_TOTAL_SHARE } from "@/lib/constants/prospecting";

/**
 * Filter for contracts that COUNT TOWARD the 75% headroom cap on a
 * (state, resource): every non-revoked contract, INCLUDING pending `offered`
 * ones. This intentionally differs from activeExtractionContractFilter (which
 * excludes offered) — an outstanding offer reserves headroom even though it does
 * not yet allocate capacity, so a new offer cannot exceed the cap by racing an
 * un-accepted one. Terminal states (declined / expired / defaulted / revoked)
 * all set `revokedTurn`, so `revokedTurn: {$exists:false}` excludes them.
 */
export function contractedShareFilter(
  stateId: string,
  resource: ExtractableResource
): Filter<ExtractionContract> {
  return { stateId, resource, revokedTurn: { $exists: false } };
}

/**
 * Sum of `share` over every contract counting toward the cap for a
 * (state, resource). Reusable by the contract-issuance package to compute
 * remaining headroom and enforce GOVT_CONTRACT_MAX_TOTAL_SHARE.
 */
export async function computeContractedShare(
  db: Db,
  stateId: string,
  resource: ExtractableResource,
  countryId?: string
): Promise<number> {
  // Read reservations first: an award cannot disappear between the reservation and contract reads.
  const reserved = await db
    .collection<import("@/lib/governmentContracts/types").GovernmentTender>("governmentTenders")
    .find(
      {
        "terms.type": "extraction",
        "terms.stateId": stateId,
        "terms.resource": resource,
        status: { $in: ["publishing", "open", "awarding"] },
        ...(countryId
          ? { countryId: countryId as import("@/lib/constants/countries").CountryId }
          : {}),
      },
      { projection: { _id: 1, terms: 1 } }
    )
    .toArray();
  const contracts = await (
    await getExtractionContractsCollection(db)
  )
    .find({
      ...contractedShareFilter(stateId, resource),
      ...(countryId
        ? { countryId: countryId as import("@/lib/constants/countries").CountryId }
        : {}),
    })
    .toArray();
  const linked = new Set(contracts.map((c) => c.tenderId).filter(Boolean));
  return (
    contracts.reduce((sum, c) => sum + (c.share ?? 0), 0) +
    reserved.reduce(
      (sum, t) => sum + (!linked.has(t._id) && t.terms.type === "extraction" ? t.terms.share : 0),
      0
    )
  );
}

/**
 * Remaining share that can still be contracted for a (state, resource) before
 * hitting the 75% cap. Never negative.
 */
export async function computeRemainingContractHeadroom(
  db: Db,
  stateId: string,
  resource: ExtractableResource
): Promise<number> {
  const used = await computeContractedShare(db, stateId, resource);
  return Math.max(0, GOVT_CONTRACT_MAX_TOTAL_SHARE - used);
}
