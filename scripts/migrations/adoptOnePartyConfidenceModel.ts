/**
 * Reconcile `countryState.hasLeaderConfidenceModel` with the compile-time
 * config for one-party states that are still one-party states.
 *
 * Why this needs a migration at all: `hasLeaderConfidenceModel` is a PROMOTED
 * runtime field (see 2026-05-28-promote-country-state). `seedAllCountryStates`
 * is deliberately insert-only — it skips any country that already has a doc —
 * so giving a country the field in `COUNTRY_CONFIGS` does nothing to a world
 * that has already been seeded. The DDR shipped without it, so the live 1953
 * world carries `DD.hasLeaderConfidenceModel: false`: no intra-party confidence
 * drift, no popular-legitimacy scalar, no regime escalation, and the two
 * nationalization consequence branches in `nationalization/consequences/apply`
 * silently skipped.
 *
 * RAISE-ONLY, and guarded on `governmentType === "onePartyState"`.
 *
 * The guard is the important part. `triggerSystemConversion` flips
 * `hasLeaderConfidenceModel` to false as a ONE-WAY act when a regime collapses
 * or converts by convention — that false is a legitimate mid-game mutation, not
 * a stale default. A blind "set runtime = config" reconciliation would
 * resurrect the confidence model on a country that had already fallen. Because
 * the same conversion also flips `governmentType` away from `onePartyState`,
 * filtering on it separates "never had the field" from "lost it on purpose".
 *
 * Never lowers true → false, so it cannot itself undo a live regime.
 */
import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import type { MigrationResult } from "@/lib/migrations/types";

export interface AdoptOnePartyConfidenceModelOptions {
  dryRun?: boolean;
}

export async function runAdoptOnePartyConfidenceModel(
  db: Db,
  opts: AdoptOnePartyConfidenceModelOptions = {}
): Promise<MigrationResult> {
  const dryRun = opts.dryRun === true;
  const coll = getCountryStateCollection(db);

  // Countries whose CONFIG says they should carry the model.
  const configured = (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
    (id) => COUNTRY_CONFIGS[id]?.hasLeaderConfidenceModel === true
  );
  if (configured.length === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, notes: ["No configured countries."] };
  }

  const candidates = await coll
    .find({
      _id: { $in: configured },
      governmentType: "onePartyState",
      hasLeaderConfidenceModel: { $ne: true },
    })
    .toArray();

  const notes: string[] = [
    `configured=${configured.join(",")}`,
    candidates.length === 0
      ? "no countries needed raising"
      : `raising: ${candidates.map((c) => c._id).join(",")}`,
  ];

  if (dryRun || candidates.length === 0) {
    return { documentsScanned: candidates.length, documentsUpdated: 0, notes };
  }

  const res = await coll.updateMany(
    {
      _id: { $in: candidates.map((c) => c._id) },
      governmentType: "onePartyState",
      hasLeaderConfidenceModel: { $ne: true },
    },
    { $set: { hasLeaderConfidenceModel: true, updatedAt: new Date() } }
  );

  return {
    documentsScanned: candidates.length,
    documentsUpdated: res.modifiedCount,
    notes,
  };
}
