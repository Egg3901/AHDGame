import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import {
  easternBlocElectionsLive,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";
import { bgElectionSeatsForPreset } from "./rules/assemblyTransition";
import { getElectionMethod } from "@/lib/elections/electionMethod";

export function bgAssemblySeatMapForPreset(
  regions: Parameters<typeof seatsFromRegionField>[0],
  preset: string | undefined,
  preIterationActive: boolean
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
    preIterationActive
  );
}

/** Bulgaria's regional National Assembly election. */
export async function ensureBGElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "BG",
      electionType: "nationalAssembly",
      seatsForRegions: (regions, preset, ctx) =>
        bgAssemblySeatMapForPreset(regions, preset, ctx.preIterationActive === true),
      openPrimaryImmediately: true,
      minPrimaryHours: 12,
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label: "National Assembly",
    },
    now,
    inFlightTurn
  );
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
