import type { CountryGameState } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurnAndCtx } from "@/lib/turn/perpetualElections/engine";
import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import {
  easternBlocElectionsLive,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";
import { bgElectionSeatsForPreset } from "./rules/assemblyTransition";
import { getElectionMethod } from "@/lib/elections/electionMethod";
import { bindBgFoundingCampaigns } from "./foundingCampaignBinding1990";
import { bgAssemblyCohortCanSpawn, bgGrandAssemblyRegularAnchor } from "./rules/assemblyClock1991";
import { loadBgGrandAssemblyClock } from "./grandAssemblyClock1991";
import { buildBg1991AssemblySpawn } from "./assemblyClock1991";

export function bgAssemblySeatMapForPreset(
  regions: Parameters<typeof seatsFromRegionField>[0],
  preset: string | undefined,
  preIterationActive: boolean,
  authorized: boolean = false
): Record<string, number> {
  if (
    preset === "2027-default" &&
    getElectionMethod("BG", "nationalAssembly", preset) !== "pr_hareQuota"
  ) {
    throw new Error("Bulgaria 2027 Assembly requires parliamentary proportional representation");
  }
  return bgElectionSeatsForPreset(
    seatsFromRegionField(regions, "houseDistricts"),
    preset,
    preIterationActive,
    authorized
  );
}

/** Bulgaria's regional National Assembly election. */
export async function ensureBGElections(now: Date, inFlightTurn?: number): Promise<void> {
  const db = await getDb();
  const { ctx, currentTurn } = await getCurrentTurnAndCtx(db);
  const country =
    ctx.preset === "1991-default"
      ? await db.collection<CountryGameState>("countryGameStates").findOne(
          { _id: "BG" },
          {
            projection: {
              bgConstitution1991SinceTurn: 1,
              bgOrdinaryAssemblySinceTurn: 1,
              bgGrandAssemblyContinuationSinceTurn: 1,
              bgGrandAssemblyDissolutionSinceTurn: 1,
            },
          }
        )
      : null;
  const authorized =
    country?.bgConstitution1991SinceTurn != null || country?.bgOrdinaryAssemblySinceTurn != null;
  const continued =
    country?.bgGrandAssemblyContinuationSinceTurn != null &&
    country?.bgGrandAssemblyDissolutionSinceTurn == null &&
    country?.bgOrdinaryAssemblySinceTurn == null;
  const nativeGrandAnchorTurn =
    authorized && !continued
      ? undefined
      : await loadBgGrandAssemblyClock(db, ctx, inFlightTurn ?? currentTurn, now);
  await ensureRegionalDelegateElections(
    {
      countryId: "BG",
      electionType: "nationalAssembly",
      seatsForRegions: (regions, preset, ctx) =>
        bgAssemblySeatMapForPreset(regions, preset, ctx.preIterationActive === true, authorized),
      preserveLiveSeatCounts: ctx.preset === "1991-default",
      openPrimaryImmediately: true,
      minPrimaryHours: 12,
      canSpawnCohort: ctx.preset === "1991-default" ? bgAssemblyCohortCanSpawn : undefined,
      buildSpawn: (input) =>
        buildBg1991AssemblySpawn(input, {
          authorized,
          nativeGrandAnchorTurn,
          firstOrdinaryEndTurn: continued
            ? (nativeGrandAnchorTurn ?? bgGrandAssemblyRegularAnchor(ctx))
            : undefined,
        }),
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label: "National Assembly",
    },
    now,
    inFlightTurn
  );
  if (ctx.preset === "1991-default") await bindBgFoundingCampaigns(db, now);
}

/**
 * Bulgaria's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn`. Bulgaria has no row in
 * `SPAWN_ELECTIONS_REGISTRY`; these phases run through
 * `COUNTRY_ELECTION_PHASES`, in this order. Adding a `spawn` would run them a
 * second time each turn. The BG spawner lives here and uses shared election
 * helpers without moving the other countries' phases.
 *
 * ⚠️ NO `seats`. There is no seat table for Bulgaria anywhere;
 * apportionment is read from the live regions, the way East Germany's
 * Volkskammer and Brazil's Senate are. An empty `byChamber` would describe a
 * chamber with no seats rather than one whose seats live elsewhere.
 */
const phases: CountryElectionPhaseEntry[] = [
  { name: "bgNationalAssemblyElections", fn: ensureBGElections },
];

export const BG_ELECTIONS: CountryElections = {
  electionPhases: phases,
};
