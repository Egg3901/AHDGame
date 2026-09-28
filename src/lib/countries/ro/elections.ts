import type { CountryElections } from "../contract";
import type { CountryElectionPhaseEntry } from "@/lib/turn/countryPhases";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurnAndCtx } from "@/lib/turn/perpetualElections/engine";
import {
  easternBlocElectionsLive,
  ensureEasternBlocAssemblyElections,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";

/** Romania's constituent bicameral parliament in 1991; Cold War assembly otherwise. */
export async function ensureROElections(now: Date, inFlightTurn?: number): Promise<void> {
  const db = await getDb();
  const { ctx } = await getCurrentTurnAndCtx(db);
  if (ctx.preset === "1991-default") {
    for (const [electionType, field, label] of [
      ["chamberOfDeputies", "houseDistricts", "Assembly of Deputies"],
      ["senat", "stateSenateSeats", "Senate"],
    ] as const) {
      await ensureRegionalDelegateElections(
        {
          countryId: "RO",
          electionType,
          seatsForRegions: (regions) => seatsFromRegionField(regions, field),
          openPrimaryImmediately: true,
          statusGated: true,
          electionsLiveGate: easternBlocElectionsLive,
          label,
        },
        now,
        inFlightTurn
      );
    }
    return;
  }
  await ensureEasternBlocAssemblyElections(
    "RO",
    "grandNationalAssembly",
    "Grand National Assembly",
    now,
    inFlightTurn
  );
}

/**
 * Romania's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ NO `spawn`. Romania has no row in
 * `SPAWN_ELECTIONS_REGISTRY`; these phases run through
 * `COUNTRY_ELECTION_PHASES`, in this order. Adding a `spawn` would run them a
 * second time each turn. The RO spawner lives here and uses shared election
 * helpers without moving the other countries' phases.
 *
 * ⚠️ NO `seats`. There is no seat table for Romania anywhere;
 * apportionment is read from the live regions, the way East Germany's
 * Volkskammer and Brazil's Senate are. An empty `byChamber` would describe a
 * chamber with no seats rather than one whose seats live elsewhere.
 */
const phases: CountryElectionPhaseEntry[] = [
  { name: "roGrandNationalAssemblyElections", fn: ensureROElections },
];

export const RO_ELECTIONS: CountryElections = {
  electionPhases: phases,
};
