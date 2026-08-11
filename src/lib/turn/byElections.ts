import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Election, ElectedOfficial } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryAccessFromDb } from "@/lib/countryAccess";
import { getSeatIdFromElection } from "@/lib/seats/seatId";
import { turnToWallClock } from "@/lib/elections/canonicalCycle";

/**
 * By-elections — fill a seat that goes VACANT MID-TERM (resignation, retirement,
 * death, or — from Phase 3 — impeachment) with an off-calendar special election,
 * instead of leaving it empty until the next canonical cycle.
 *
 * Scope: **regional chief executives** (`officeType: "governor"`) in the
 * countries listed in `BY_ELECTION_COUNTRIES` — US Governors and RU republic
 * First Secretaries. Governor is exactly one holder per region, so a
 * single-seat special election is unambiguous. US House / stateSenate are elected
 * as a whole state delegation in one race (seatId `US-house-CA`, not per-district),
 * so a "single vacant seat" by-election there needs a per-district design decision
 * and is deferred. DE Landesliste list-seat promotion is also deferred.
 *
 * NON-INTERFERENCE with the regular election engine is achieved by giving the
 * by-election a DISTINCT electionType (`special_governor`): it therefore lands in
 * its own group in `cleanupDuplicateElections` (keyed by countryId_type_state) and
 * is invisible to `ensurePerpetualElections` (which keys off `governor`), so the
 * regular governor cycle is neither deleted nor blocked. The winner still seats as
 * a plain `governor` (see the electionType->officeType switch in generalResolution),
 * and the next regular governor election spawns on the canonical calendar as usual.
 */

export const SPECIAL_GOVERNOR_ELECTION_TYPE = "special_governor";
/**
 * A by-election needs a filing/primary window: the candidate-entry route only
 * accepts filings while the primary is open (`primaryEnded === false`). Opening
 * straight to the general (primaryEndTurn === startTurn) makes `primaryEnded`
 * true immediately, so NOBODY could file and every by-election resolved empty.
 * So it runs like a compressed regular race: a short filing/primary window, then
 * a general. The generic (non-president, seatId-based) primary + general
 * resolvers pick it up by type-agnostic paths.
 */
export const SPECIAL_GOVERNOR_FILING_TURNS = 24;
export const SPECIAL_GOVERNOR_GENERAL_TURNS = 24;
/**
 * After a by-election resolves (including one nobody contested), wait this many
 * turns before spawning another for the same seat — otherwise an uncontested
 * vacancy would re-spawn a special election every turn forever.
 */
export const BY_ELECTION_RETRY_COOLDOWN_TURNS = 48;

/**
 * Countries whose regional chief executive is watched for mid-term vacancies.
 * Status-gated countries (RU) are additionally checked for beta/active at
 * runtime so a coming-soon world never spawns specials.
 */
export const BY_ELECTION_COUNTRIES: readonly CountryId[] = ["US", "RU"];

/** Countries whose governor rows predate the explicit countryId field. */
const LEGACY_UNTAGGED_ROW_COUNTRIES: ReadonlySet<CountryId> = new Set(["US"]);

/** Countries whose runtime status (beta/active) gates the watcher. */
const STATUS_GATED_COUNTRIES: ReadonlySet<CountryId> = new Set(["RU"]);

/** Per-country scope filter, matching legacy untagged rows where applicable. */
function countryScope(countryId: CountryId) {
  if (LEGACY_UNTAGGED_ROW_COUNTRIES.has(countryId)) {
    return { $or: [{ countryId }, { countryId: { $exists: false } }] };
  }
  return { countryId };
}

/**
 * Spawn one governor by-election for a vacant state seat. Timing is set directly
 * (not via the canonical scheduler): a filing/primary window opens now, then a
 * general. Candidates file during the primary window (the entry route requires
 * `primaryEnded === false`); the generic primary + general resolvers then run.
 */
export async function spawnGovernorByElection(
  db: Db,
  state: string,
  currentTurn: number,
  now: Date,
  countryId: CountryId = "US"
): Promise<ObjectId> {
  const primaryEndTurn = currentTurn + SPECIAL_GOVERNOR_FILING_TURNS;
  const endTurn = primaryEndTurn + SPECIAL_GOVERNOR_GENERAL_TURNS;
  const doc: Election = {
    _id: new ObjectId(),
    electionType: SPECIAL_GOVERNOR_ELECTION_TYPE,
    state,
    countryId,
    seatId: getSeatIdFromElection({
      countryId,
      electionType: SPECIAL_GOVERNOR_ELECTION_TYPE,
      state,
    }),
    // Off-calendar: use the current turn as a unique cycle marker so the
    // historical race id (seatId-c<cycle>) never collides with a regular cycle.
    cycle: currentTurn,
    status: "active",
    totalSeats: 1,
    startTurn: currentTurn,
    primaryEndTurn,
    endTurn,
    startTime: now,
    primaryEndTime: turnToWallClock(primaryEndTurn, now, currentTurn),
    endTime: turnToWallClock(endTurn, now, currentTurn),
    durationHours: SPECIAL_GOVERNOR_FILING_TURNS + SPECIAL_GOVERNOR_GENERAL_TURNS,
    primaryDurationHours: SPECIAL_GOVERNOR_FILING_TURNS,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<Election>("elections").insertOne(doc);
  return doc._id;
}

/**
 * Turn phase: spawn governor by-elections for mid-term vacancies. Must run AFTER
 * `electionResolution` + `perpetualElections` so it reads settled seat state.
 *
 * A seat is a mid-term vacancy iff a `governor` official ROW exists for the state
 * with no holder (characterId null AND nppId null) — the tombstone left by
 * resignExecutiveOffice / retireCharacter. A state that has simply never seated a
 * governor has NO row and is filled by the regular cycle, so it is skipped (no
 * flood of specials at game start).
 */
export async function processByElectionWatcher(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<{ spawned: number }> {
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const elections = db.collection<Election>("elections");

  let spawned = 0;
  for (const countryId of BY_ELECTION_COUNTRIES) {
    // Status-gated countries (RU): only watch runtime-live worlds, so an
    // admin removal in a coming-soon country never spawns a special.
    if (STATUS_GATED_COUNTRIES.has(countryId)) {
      const { status } = await getCountryAccessFromDb(db, countryId);
      if (status !== "beta" && status !== "active") continue;
    }
    const scope = countryScope(countryId);

    const govRows = await officials.find({ officeType: "governor", ...scope }).toArray();
    const vacantStates = [
      ...new Set(
        govRows
          .filter((o) => o.state && o.characterId == null && o.nppId == null)
          .map((o) => o.state as string)
      ),
    ];

    for (const state of vacantStates) {
      // Suppress if a regular governor race is already live — the seat fills on
      // schedule and a by-election would race it.
      const liveRegular = await elections.findOne({
        ...scope,
        state,
        electionType: "governor",
        status: { $in: ["active", "upcoming"] },
      });
      if (liveRegular) continue;

      // Suppress if a special is live, or one resolved within the cooldown (an
      // uncontested by-election leaves the seat vacant — don't re-spawn every turn).
      const lastSpecial = (
        await elections
          .find({ ...scope, state, electionType: SPECIAL_GOVERNOR_ELECTION_TYPE })
          .sort({ endTurn: -1 })
          .limit(1)
          .toArray()
      )[0];
      if (lastSpecial) {
        if (lastSpecial.status === "active" || lastSpecial.status === "upcoming") continue;
        if ((lastSpecial.endTurn ?? 0) > currentTurn - BY_ELECTION_RETRY_COOLDOWN_TURNS) continue;
      }

      await spawnGovernorByElection(db, state, currentTurn, now, countryId);
      spawned++;
    }
  }

  if (spawned > 0) {
    console.log(`[Turn] Spawned ${spawned} governor by-election(s)`);
  }
  return { spawned };
}
