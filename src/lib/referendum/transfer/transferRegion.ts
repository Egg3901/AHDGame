/**
 * Atomic driver that transfers a region from one country to another (NI →
 * Ireland). Modeled on `triggerSystemConversion`: run the focused migration
 * steps in dependency order, recompute both countries' national figures, and
 * record a country-history event for each side. Idempotent — re-firing on an
 * already-transferred region is a no-op.
 *
 * Order matters:
 *   1. Evacuate — NPPs relocate out (stay in the source country, corps follow),
 *                 players go Independent, region party orgs + officeholders +
 *                 seats are dissolved. NO party doc moves.
 *   2. Rescope   — flip countryId on the remaining region-scoped collections
 *                 (incl. the player residents left behind).
 *   3. Region    — convert the states doc + size the seat allocation.
 *   4. Recompute — national metrics for both countries; record history.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { computeNationalMetrics } from "@/lib/nationalMetrics";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import {
  evacuateRegionPolitics,
  type EvacuateRegionPoliticsResult,
} from "./evacuateRegionPolitics";
import { rescopeRegionToCountry } from "./regionScopedCollections";
import { convertRegionDoc } from "./convertRegionDoc";
import { reapportionNationalBudget } from "./reapportionNationalBudget";
import { convertTransferredResidentsCurrency } from "./convertTransferredResidentsCurrency";
import { reseedJoinedRegionElections } from "./reseedJoinedRegionElections";
import { rescaleRegionDelegations } from "@/lib/country/apportionChamber";

export interface TransferRegionArgs {
  regionId: string;
  fromCountryId: CountryId;
  toCountryId: CountryId;
  province: string;
  /** Optional display name the region takes in its new country (NIR → "Ulster"). */
  displayName?: string;
  /**
   * The electoral system the region adopts, defaulting to Ireland's PR-STV.
   *
   * A REFERENDUM transfer converts the region to its new country's system. A
   * MERGE preserves the region's own system, because both halves of a
   * reunifying country already run the same elections and converting them would
   * be a change nobody voted for.
   */
  votingSystem?: State["votingSystem"];
  /**
   * Where evacuated NPPs (+ their corporations) relocate in the source country.
   * NULL when the source is being dissolved by a merge — they cross with the
   * region instead. See `evacuateRegionPolitics`.
   */
  relocateToRegionId: string | null;
  currentTurn: number;
}

export interface TransferRegionResult {
  ok: boolean;
  skipped?: "already-transferred" | "region-not-found";
  report?: {
    evacuated: EvacuateRegionPoliticsResult;
    rescoped: Array<{ collection: string; matched: number }>;
  };
}

export async function transferRegion(
  db: Db,
  args: TransferRegionArgs
): Promise<TransferRegionResult> {
  const {
    regionId,
    fromCountryId,
    toCountryId,
    province,
    displayName,
    votingSystem,
    relocateToRegionId,
    currentTurn,
  } = args;

  // Idempotency: bail if the region doesn't exist or already belongs to target.
  const region = await db.collection<State>("states").findOne({ _id: regionId });
  if (!region) return { ok: false, skipped: "region-not-found" };
  if (region.countryId === toCountryId) return { ok: true, skipped: "already-transferred" };

  const evacuated = await evacuateRegionPolitics(db, {
    regionId,
    fromCountryId,
    toCountryId,
    relocateToRegionId,
  });
  const rescoped = await rescopeRegionToCountry(db, regionId, fromCountryId, toCountryId);
  await convertRegionDoc(db, { regionId, toCountryId, province, displayName, votingSystem });

  // A delegation carried in by a DISSOLVING source is sized for the chamber it
  // left, not the one it joined: East Germany's Saxony holds 151 Volkskammer
  // seats against the Bundestag delegation Saxony actually gets. Rescaled HERE
  // rather than inside `evacuateRegionPolitics`, because the size comes from the
  // region's `houseDistricts` / `stateSenateSeats` and `convertRegionDoc` only
  // just wrote them. On the evacuate path there is no carried delegation to
  // rescale -- the officials were deleted -- so this is a no-op.
  if (relocateToRegionId === null) {
    await rescaleRegionDelegations(db, { regionId, countryId: toCountryId, now: new Date() });
  }

  // Shift the region's GDP-weighted share of national tax bases + spending
  // baselines from the source country to the target (the budget docs stay
  // country-level; only their economy-sized magnitudes move). The dissolving
  // signal lets the LAST region of a merge carry the whole residual base
  // (weight 1), which a surviving source's transfer must never do. Best-effort:
  // a failure here must not abort the otherwise-complete transfer.
  await reapportionNationalBudget(
    db,
    regionId,
    fromCountryId,
    toCountryId,
    relocateToRegionId === null
  ).catch((err) => console.error(`${regionId} national-budget reapportion failed:`, err));

  // Re-denominate the region's corps + resident players into the new country's
  // currency (NI pounds → euro). Best-effort: a forex hiccup must not abort the
  // transfer (balances can be re-converted; the region has already moved).
  await convertTransferredResidentsCurrency(db, regionId, fromCountryId, toCountryId).catch((err) =>
    console.error(`${regionId} currency conversion failed:`, err)
  );

  // Recompute every country's national figures (drops NI from the old country,
  // adds it to the new) before recording history.
  await computeNationalMetrics(db);

  // Seed the joined region's races + grow its new chamber NOW, so the transfer's
  // full effects are visible immediately rather than next turn. Best-effort: the
  // turn's election phase re-runs the same idempotent spawners as a safety net.
  await reseedJoinedRegionElections(db, toCountryId, new Date()).catch((err) =>
    console.error(`${regionId} election re-seed failed (retries next turn):`, err)
  );

  const details = { regionId, fromCountryId, toCountryId };
  await recordCountryEvent(db, {
    countryId: fromCountryId,
    turn: currentTurn,
    eventType: "region_transferred",
    title: `${regionId} leaves ${fromCountryId} to join ${toCountryId}`,
    details,
  }).catch((err) => console.error(`${regionId} transfer history (from) failed:`, err));
  await recordCountryEvent(db, {
    countryId: toCountryId,
    turn: currentTurn,
    eventType: "region_transferred",
    title: `${regionId} joins ${toCountryId}`,
    details,
  }).catch((err) => console.error(`${regionId} transfer history (to) failed:`, err));

  return { ok: true, report: { evacuated, rescoped } };
}
