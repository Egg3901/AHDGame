/**
 * Single source of truth for every persistent collection scoped to a
 * sub-national region. `transferRegion` rescopes each of these from the old
 * country to the new one by flipping `countryId`.
 *
 * Deliberately ABSENT:
 *  - `states`, `electedOfficials`, `seats`, `politicalParties` — handled by the
 *    dedicated region-doc / officials / party migration steps (they need more
 *    than a `countryId` flip: office-type remap, seat magnitude, party id map).
 *  - Country-level collections (`federalBudget`, `centralBank`, `countryState`,
 *    `governmentApprovals`, national party pools) — they belong to the country,
 *    not the region, and must NOT move.
 *  - Transient election-process artifacts (vote tallies, candidates, in-flight
 *    elections) and decaying caches (`partyStrengthPressure`, composite `_id`) —
 *    they regenerate; the orchestrator handles in-flight NIR elections separately.
 *
 * Collection name strings and region-key fields were confirmed against each
 * type's getter / definition (see `src/lib/db/types/*` and `db/collections/*`).
 *
 * Region-key variants:
 *   - "stateIdField":   the doc has a `stateId` field
 *   - "stateField":     the doc has a `state` field (officials / seats)
 *   - "idIsState":      the doc `_id` IS the region id (one doc per region)
 *   - "homeStateField": the doc keys residency by `homeState` (characters)
 *   - "compositeCountryState": the doc `_id` is `${countryId}_${stateId}` — the
 *       owner is baked into the key, so the doc must be RE-KEYED (you can't $set
 *       _id), not just have its `countryId` flipped, or callers that rebuild the
 *       key from the new owner orphan it.
 */
import type { Db } from "mongodb";

export type RegionKey =
  "stateIdField" | "stateField" | "idIsState" | "homeStateField" | "compositeCountryState";

export interface RegionScope {
  collection: string;
  key: RegionKey;
}

export const REGION_SCOPED_COLLECTIONS: RegionScope[] = [
  // ── stateId-field rows ──────────────────────────────────────────────────────
  // NB: the region's party collections (statePartyOrg, partyBudget, the PS/org
  // ledgers, billWhips, statePartyElections) are NOT here — they are DELETED by
  // `evacuateRegionPolitics`, not re-scoped (the target re-seeds its own).
  { collection: "statePolicies", key: "stateIdField" },
  { collection: "stateBills", key: "stateIdField" },
  { collection: "governorOfficeState", key: "stateIdField" },
  { collection: "governorLegislationQueue", key: "stateIdField" },
  { collection: "governorExecutiveOrders", key: "stateIdField" },
  { collection: "governorAddresses", key: "stateIdField" },
  { collection: "governorEndorsements", key: "stateIdField" },
  { collection: "executiveEndorsements", key: "stateIdField" },
  { collection: "stateResourceCapacity", key: "stateIdField" },
  { collection: "stateApprovalHistory", key: "stateIdField" },
  { collection: "characterStateOrg", key: "stateIdField" },
  { collection: "nppInfluenceAttempts", key: "stateIdField" },
  { collection: "subsidies", key: "stateIdField" },
  // Sectors (corp-owned and unowned) are keyed to where they OPERATE, so a sector
  // in the transferred region follows it across the border — its `countryId` must
  // track the region's owner for tax/tariff/metric resolution. An owning corp
  // keeps its own HQ country; a sector left behind in the source country stays put.
  // (Strategic-sector designations are country-level, not region-scoped, so absent.)
  { collection: "corporateSectors", key: "stateIdField" },
  { collection: "unownedSectors", key: "stateIdField" },
  // ── one-doc-per-region (_id IS the region id) ───────────────────────────────
  // Both halves of a region's metrics. The political board carries `countryId`
  // too, and the dynamics phase drives regions by that field — a transferred
  // region whose board still names its old country would be driven by the wrong
  // law catalog and scored against the wrong approval intercept.
  { collection: "macroMetrics", key: "idIsState" },
  { collection: "politicalMetrics", key: "idIsState" },
  { collection: "regionDemographics", key: "idIsState" },
  { collection: "stateDemographicTurnout", key: "idIsState" },
  { collection: "regionalBudgets", key: "idIsState" },
  // The per-state fiscal budget + the region's demographic profile/defaults also
  // carry the region's economy/people, so they follow it (distinct from the
  // region/turnout docs above — these are separate collections).
  { collection: "stateBudgets", key: "idIsState" },
  { collection: "stateDemographics", key: "idIsState" },
  { collection: "demographicDefaults", key: "idIsState" },
  // ── composite-key (_id is `${countryId}_${stateId}`) → must be re-keyed ──────
  { collection: "stateRegistrationPool", key: "compositeCountryState" },
  // ── records a DISSOLVING merge would otherwise strand ───────────────────────
  // These are region-keyed rows that the referendum path could leave behind
  // harmlessly — the source country survived to keep owning them — but that a
  // country merge cannot, because the country they point at stops existing.
  //
  // `enactedLaws` is the load-bearing one: a region's law book is part of the
  // region. Its `legislationTypeId`s keep resolving after the merge because
  // `legislationTypes` is a GLOBAL collection whose documents are not deleted
  // when a country dissolves — see `rescopeLegislationCatalogue`, which hands the
  // catalogue itself to the survivor so those laws stay amendable.
  //
  // `elections` carries the RESOLVED history only: `evacuateRegionPolitics` runs
  // first and deletes the active and upcoming races, so what is rescoped here is
  // the record of elections already held.
  { collection: "enactedLaws", key: "stateIdField" },
  { collection: "electionVoteTallies", key: "stateField" },
  { collection: "elections", key: "stateField" },
  { collection: "statePartyCandidates", key: "stateIdField" },
  { collection: "recruitmentSlates", key: "stateField" },
  { collection: "slateCandidates", key: "homeStateField" },
  { collection: "prospectingSurveys", key: "stateIdField" },
  // ── residents (flip countryId, KEEP homeState) ──────────────────────────────
  { collection: "characters", key: "homeStateField" },
];

function filterFor(scope: RegionScope, regionId: string): Record<string, string> {
  switch (scope.key) {
    case "stateIdField":
      return { stateId: regionId };
    case "stateField":
      return { state: regionId };
    case "idIsState":
      return { _id: regionId };
    case "homeStateField":
      return { homeState: regionId };
    case "compositeCountryState":
      // Re-keyed directly in rescopeRegionToCountry; never filtered here.
      return {};
  }
}

/**
 * Rescope every listed collection's region-matching documents to a new country
 * by `$set`-ting `countryId`. `_id`-keyed metric collections that don't reliably
 * carry a `countryId` still get it set (harmless denormalization the read paths
 * tolerate). `homeState` / `stateId` / `state` keys are NOT changed — the region
 * keeps its identity under the new country. Returns a matched-count report for
 * the conservation audit.
 */
export async function rescopeRegionToCountry(
  db: Db,
  regionId: string,
  fromCountryId: string,
  toCountryId: string,
  scopes: RegionScope[] = REGION_SCOPED_COLLECTIONS
): Promise<Array<{ collection: string; matched: number }>> {
  const now = new Date();
  const report: Array<{ collection: string; matched: number }> = [];
  for (const scope of scopes) {
    if (scope.key === "compositeCountryState") {
      // The owner is baked into `_id` (`${countryId}_${stateId}`); you can't $set
      // _id, so move the doc to its new key — else callers that rebuild the key
      // from the new owner (`${toCountryId}_${regionId}`) orphan the old one.
      const coll = db.collection<Record<string, unknown>>(scope.collection);
      const oldId = `${fromCountryId}_${regionId}`;
      const newId = `${toCountryId}_${regionId}`;
      const doc = await coll.findOne({ _id: oldId } as Record<string, unknown>);
      let matched = 0;
      if (doc) {
        // SECURE THE NEW KEY BEFORE RELEASING THE OLD ONE, and never blindly
        // insert. This re-key is not guarded by the region-doc idempotency
        // check above: a merge that crashed between this write and
        // `convertRegionDoc` leaves a region that straddles the two keys. The
        // retry re-reads the old `DD_MV` and finds a `DE_MV` from the first
        // attempt already seated under the new key, and a blind insert there
        // died with E11000, aborting the whole transfer half-done (ticket
        // #1247: a reunification dictated in the won-war panel stalled at its
        // second Land and never resumed). Upsert-replace instead: an existing
        // row under the new key is absorbed, its payload replaced with the
        // old row's, which is the authoritative one, and the delete below
        // then frees the old key.
        //
        // A CRASHED RETRY IS NOT THE ONLY WAY THE NEW KEY IS TAKEN. A world can
        // also carry an orphan under `${toCountryId}_${regionId}` from an
        // earlier transfer or an old seed, with no failed attempt behind it --
        // the live German world held four of them before any of this ran. Same
        // collision, same answer: the moving region's document wins, because it
        // is the one describing a region that actually exists.
        await coll.replaceOne(
          { _id: newId } as Record<string, unknown>,
          {
            ...doc,
            _id: newId,
            countryId: toCountryId,
            updatedAt: now,
          } as Record<string, unknown>,
          { upsert: true }
        );
        await coll.deleteOne({ _id: oldId } as Record<string, unknown>);
        matched = 1;
      }
      report.push({ collection: scope.collection, matched });
      continue;
    }
    const res = await db.collection(scope.collection).updateMany(filterFor(scope, regionId), {
      $set: { countryId: toCountryId, updatedAt: now },
    });
    report.push({ collection: scope.collection, matched: res.matchedCount ?? 0 });
  }
  return report;
}
