/**
 * Absorb one country into another.
 *
 * Generic on purpose. The German Question is the first caller, but nothing here
 * knows about Germany: any merge is "move every region across, then retire the
 * shell". Keeping it country-agnostic is also what makes it testable without a
 * seeded world.
 *
 * WHAT THIS IS NOT. It is not a partial transfer. `transferRegion` already does
 * that (Northern Ireland into Ireland) and its contract assumes the source
 * survives — its evacuated NPPs retreat to another of the source's regions and
 * the source keeps its national layer. A merge inverts both: there is no
 * retreat, and the source's national layer stops existing. That difference is
 * why this cannot be a loop over `transferRegion` with the old arguments, and
 * why `relocateToRegionId` grew a null case.
 *
 * ORDER. Regions first, retirement last. A half-run merge then leaves a country
 * with fewer regions but still simulated — recoverable by re-running, because
 * `transferRegion` is idempotent per region and skips ones already moved. The
 * reverse order would retire a country that still owned regions, stranding them
 * in a state nothing enumerates.
 */
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { CountryGameState } from "@/lib/db/types/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { transferRegion } from "@/lib/referendum/transfer/transferRegion";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";

export interface MergeCountryArgs {
  /** The country being absorbed. Retired when this completes. */
  fromCountryId: CountryId;
  /** The country that survives and takes the regions. */
  toCountryId: CountryId;
  currentTurn: number;
}

export interface MergeCountryResult {
  ok: boolean;
  error?: string;
  regionsTransferred: number;
  regionsSkipped: number;
  retired: boolean;
}

export async function mergeCountry(db: Db, args: MergeCountryArgs): Promise<MergeCountryResult> {
  const { fromCountryId, toCountryId, currentTurn } = args;
  const empty = { regionsTransferred: 0, regionsSkipped: 0, retired: false };

  if (fromCountryId === toCountryId) {
    return { ok: false, error: "A country cannot absorb itself.", ...empty };
  }

  const gameStates = db.collection<CountryGameState>("countryGameStates");
  const already = await gameStates.findOne({ _id: fromCountryId });
  // Idempotent: a merge that already ran is a no-op, not an error. The turn
  // phase may see the same resolved crisis more than once.
  if (already?.dissolvedTurn != null) {
    return { ok: true, ...empty, retired: true };
  }

  // Refuse to retire a country into one that is itself gone.
  const target = await gameStates.findOne({ _id: toCountryId });
  if (target?.dissolvedTurn != null) {
    return { ok: false, error: "The absorbing country has itself been dissolved.", ...empty };
  }

  const regions = await db
    .collection<State>("states")
    .find({ countryId: fromCountryId }, { projection: { _id: 1, name: 1, region: 1 } })
    .toArray();

  let regionsTransferred = 0;
  let regionsSkipped = 0;

  for (const region of regions) {
    const result = await transferRegion(db, {
      regionId: String(region._id),
      fromCountryId,
      toCountryId,
      // The absorbed country's own name becomes the province label, so a
      // unified state can still tell where a Land came from.
      province: COUNTRY_CONFIGS[fromCountryId].name,
      // NULL: the source is dissolving, so nobody retreats into it.
      relocateToRegionId: null,
      currentTurn,
    });
    if (!result.ok) {
      // Stop at the first genuine failure rather than pressing on: a merge that
      // moved half a country and then retired it is worse than one that stopped
      // and can be re-run.
      return {
        ok: false,
        error: `Region ${String(region._id)} could not transfer (${result.skipped ?? "unknown"}).`,
        regionsTransferred,
        regionsSkipped,
        retired: false,
      };
    }
    if (result.skipped === "already-transferred") regionsSkipped++;
    else regionsTransferred++;
  }

  // Retire the shell. Not deletion — the documents stay for history and the
  // wiki; the country simply stops being enumerated, simulated, or joinable.
  await gameStates.updateOne(
    { _id: fromCountryId },
    {
      $set: {
        dissolvedTurn: currentTurn,
        enabledForPlayers: false,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  const fromName = COUNTRY_CONFIGS[fromCountryId].name;
  const toName = COUNTRY_CONFIGS[toCountryId].name;
  await recordCountryEvent(db, {
    countryId: toCountryId,
    turn: currentTurn,
    eventType: "region_transferred",
    title: `${fromName} was absorbed into ${toName}.`,
    details: { fromCountryId, toCountryId, regionsTransferred, merge: true },
  });

  return { ok: true, regionsTransferred, regionsSkipped, retired: true };
}
