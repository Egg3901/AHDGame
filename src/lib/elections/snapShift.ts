import type { Election } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { pickNextCanonicalCycle, type PickedCanonicalCycle } from "@/lib/elections/canonicalCycle";
import type { CycleAnchorContext } from "@/lib/elections/cycleAnchorContext";
import { snapElectionResolutionYear } from "@/lib/turn/rules/snapElection";
import { electionToLarpYear } from "@/lib/utils/formatters";

/**
 * The end time a snap election lends to the NEXT regular race, or null when it
 * lends none.
 *
 * THE SNAP-SHIFT RULE, in one place. Four spawn sites need it (Commons and
 * Shugiin and Bundestag in `perpetualElections`, plus Commons again in
 * `electionSpawning`), and before this helper each carried its own copy of the
 * condition. A rule with four copies is a rule that drifts.
 *
 * Two things return null, for different reasons:
 *
 *   - A REGULAR prior election. Only a snap anchors the next cycle; an
 *     admin-accelerated regular must not drag the LARP calendar. This is the
 *     original rule and is unchanged.
 *   - An IMPOSED snap. A peace settlement's regime change dissolves the chamber,
 *     and that is the whole of its business. Rescheduling every future election
 *     in the country would be a second, unannounced penalty riding along with the
 *     first. The next regular therefore lands on its canonical date, and
 *     `pickNextCanonicalCycle`'s existing window guard walks forward to the
 *     following cycle when that date no longer leaves room for a primary.
 *
 * Takes the expected snap type from the caller rather than testing a `snap_`
 * prefix: each spawn site is responsible for one chamber, and a Commons spawner
 * must not inherit an anchor from a Shugiin snap.
 */
export function snapAnchorEndTime(
  prev: Pick<Election, "electionType" | "endTime" | "imposedSnap"> | null | undefined,
  snapType: string
): Date | null {
  if (!prev || prev.electionType !== snapType) return null;
  if (!prev.endTime) return null;
  if (prev.imposedSnap === true) return null;
  return prev.endTime;
}

/**
 * The LARP end turn the next regular race of `electionType` must anchor to, or
 * null when the next race belongs on the canonical calendar.
 *
 * A snap resets the parliamentary term clock, and the reset has to hold for
 * every later term, not just the first one. Two priors therefore carry an
 * anchor:
 *
 *   - a called snap (see {@link snapAnchorEndTime}): its end turn;
 *   - a regular race spawned on a snap-shifted schedule: the scheduled end turn
 *     stamped on it at spawn (`shiftedScheduleEndTurn`).
 *
 * The second case is what keeps a post-snap Parliament from falling back to
 * the canonical calendar one term later. Without it, a 1977 snap followed by a
 * 1982 regular jumped to the canonical 1990 cycle: an eight-year Parliament.
 * The stamp is the SCHEDULED turn, not the actual end time, so an
 * admin-accelerated regular still cannot drag the calendar.
 */
export function shiftedAnchorTurn(
  prev:
    | Pick<Election, "electionType" | "endTime" | "imposedSnap" | "shiftedScheduleEndTurn">
    | null
    | undefined,
  electionType: string,
  snapType: string,
  endTimeToTurn: (endTime: Date) => number
): number | null {
  if (!prev) return null;
  const snapEnd = snapAnchorEndTime(prev, snapType);
  if (snapEnd) return endTimeToTurn(snapEnd);
  if (prev.electionType === electionType && typeof prev.shiftedScheduleEndTurn === "number") {
    return prev.shiftedScheduleEndTurn;
  }
  return null;
}

export interface NextLowerChamberCycle {
  spawn: PickedCanonicalCycle;
  electionYear: number;
  /**
   * Present when the race sits on a snap-shifted schedule. Spawn sites stamp it
   * on the new election so its successor keeps the shifted term clock.
   */
  shiftedScheduleEndTurn?: number;
}

/**
 * Pick the next regular lower-chamber cycle, honouring a snap-shifted term
 * clock, and label it with the game year it actually resolves in.
 *
 * One function for every lower-chamber spawn site (UK Commons twice, JP
 * Shugiin, DE Bundestag, beta parliaments) so the rule cannot drift between
 * copies. When the shifted deadline no longer leaves room for a primary and a
 * general (a long pause, say), the race falls back to the canonical calendar
 * rather than never spawning.
 */
export function planNextLowerChamberCycle(params: {
  electionType: string;
  snapType: string;
  prev:
    | Pick<
        Election,
        "electionType" | "endTime" | "imposedSnap" | "cycle" | "shiftedScheduleEndTurn"
      >
    | null
    | undefined;
  currentTurn: number;
  ctx: CycleAnchorContext;
  endTimeToTurn: (endTime: Date) => number;
  countryId?: CountryId;
}): NextLowerChamberCycle | null {
  const { electionType, snapType, prev, currentTurn, ctx, endTimeToTurn, countryId } = params;
  const base = {
    electionType,
    prevCycle: prev?.cycle ?? 0,
    currentTurn,
    ctx,
    ...(countryId ? { countryId } : {}),
  };
  const priorEndTurn = shiftedAnchorTurn(prev, electionType, snapType, endTimeToTurn);
  if (priorEndTurn != null) {
    const shifted = pickNextCanonicalCycle({ ...base, priorEndTurn });
    if (shifted) {
      return {
        spawn: shifted,
        electionYear: snapElectionResolutionYear(shifted.endTurn, ctx),
        shiftedScheduleEndTurn: shifted.endTurn,
      };
    }
  }
  const spawn = pickNextCanonicalCycle({ ...base, priorEndTurn: null });
  if (!spawn) return null;
  return {
    spawn,
    electionYear: electionToLarpYear(electionType, spawn.cycle, undefined, undefined, ctx),
  };
}
