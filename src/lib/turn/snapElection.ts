/**
 * Shared snap-election trigger used by both the player-facing PM route and
 * the turn-phase auto-snap watcher.
 *
 * A snap election:
 *   1. Cancels active/upcoming regular lower-chamber elections for the country.
 *   2. Fails in-progress bills whose `currentChamber` is the country's lower
 *      chamber (via `failInProgressBills`). Upper-chamber bills, JP cabinet
 *      review, and enrolled bills are preserved — those chambers are not
 *      dissolved.
 *   3. Spawns fresh `snap_${lowerChamberKey}` elections per region, starting
 *      immediately with a 48h window (24h primary + 24h general).
 *   4. Increments `snapElectionsUsed` and stamps `lastSnapElectionTurn`.
 *   5. Vacates the sitting PM and unforms the government via
 *      `unformGovernmentAndVacatePM` — status → "pending", cabinet and PM
 *      `currentOffice` cleared, 96-turn vacancy clock re-armed.
 *   6. Updates government cycle/seat counters via
 *      `resetParliamentaryGovernmentAfterElection` (now takes the
 *      no-sitting-PM branch).
 *
 * Gates are enforced unless `bypassLimits: true`. Auto-snap and admin tools
 * bypass; PM-triggered snaps do not. PM-triggered snaps additionally fail if
 * an active `noConfidenceVotes` doc exists for the country — a PM cannot
 * preempt a pending VONC by calling snap.
 */
import type { Db } from "mongodb";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  supportsSnapElections,
  type CountryId,
} from "@/lib/constants/countries";
import {
  getGovernmentFormationsCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { getSeatIdFromElection } from "@/lib/seats";
import {
  resetParliamentaryGovernmentAfterElection,
  unformGovernmentAndVacatePM,
  failInProgressBills,
} from "@/lib/turn/parliamentaryGovernment";
import { DEFAULT_DURATIONS } from "@/lib/turn/perpetualElections";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { cycleAnchorContextFromGameState } from "@/lib/elections/cycleAnchorContext";
import { electionToLarpYear } from "@/lib/utils/formatters";
import type { Election, ElectionStatus, GameState, Seat } from "@/lib/db/types";

export const SNAP_ELECTION_LIMIT = 2;
export const SNAP_ELECTION_COOLDOWN_TURNS = 336;

/**
 * Why a snap was called.
 *
 * `regime-change` is the only reason not initiated from inside the country: a
 * peace settlement imposed it from outside. It clears the parliamentary-only
 * gate, spends none of the head of government's snap allowance, and leaves the
 * LARP calendar on its canonical dates.
 */
export type SnapReason = "pm-trigger" | "auto-snap" | "admin" | "regime-change";

export interface TriggerSnapOptions {
  reason: SnapReason;
  /** Skip limit + cooldown checks. Used for auto-snap and admin tools. */
  bypassLimits?: boolean;
  /** Human-friendly name for Discord embed. Defaults to country config label. */
  actorName?: string;
}

export interface TriggerSnapResult {
  electionsSpawned: number;
  snapElectionsUsed: number;
  snapElectionsRemaining: number;
  snapElectionType: string;
  currentTurn: number;
}

export class SnapElectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapElectionError";
  }
}

export async function triggerSnapElection(
  db: Db,
  countryId: CountryId,
  now: Date,
  opts: TriggerSnapOptions
): Promise<TriggerSnapResult> {
  if (!COUNTRY_CONFIGS[countryId]) {
    throw new SnapElectionError(`Invalid country: ${countryId}`);
  }
  const config = getCountryConfig(countryId);
  // A regime change imposed by a peace settlement is not a strategic dissolution,
  // so the parliamentary-only rule does not apply to it. Scoped to the REASON and
  // deliberately NOT to `bypassLimits`: admin tools and the auto-snap watcher keep
  // obeying the shipped rule exactly as they do today.
  //
  // Note this reads the STATIC config, which still carries the pre-conversion
  // government type at the moment a settlement runs. That is why the override is
  // needed rather than something to fix: the check would otherwise refuse a country
  // that has already been converted, on the strength of what it used to be.
  const imposed = opts.reason === "regime-change";
  if (!imposed && !supportsSnapElections(config)) {
    throw new SnapElectionError(`Snap elections are not allowed in ${countryId}`);
  }
  const lowerChamberKey = config.legislature.lowerChamber.key;

  const govCol = getGovernmentFormationsCollection(db);
  const gov = await govCol.findOne({ _id: countryId });
  if (!gov) {
    throw new SnapElectionError(`No government formation record for ${countryId}`);
  }

  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn ?? 0;
  const ctx = cycleAnchorContextFromGameState(gameState);
  const snapUsed = gov.snapElectionsUsed ?? 0;

  if (!opts.bypassLimits) {
    if (snapUsed >= SNAP_ELECTION_LIMIT) {
      throw new SnapElectionError(
        `Snap election limit reached (${SNAP_ELECTION_LIMIT} per appointment)`
      );
    }
    const lastSnap = gov.lastSnapElectionTurn ?? 0;
    if (lastSnap > 0 && currentTurn - lastSnap < SNAP_ELECTION_COOLDOWN_TURNS) {
      const turnsRemaining = SNAP_ELECTION_COOLDOWN_TURNS - (currentTurn - lastSnap);
      throw new SnapElectionError(
        `Snap election cooldown active (${turnsRemaining} turns remaining)`
      );
    }
    // PM cannot preempt a pending VONC by calling snap. Admin bypasses.
    const activeVonc = await getNoConfidenceVotesCollection(db).findOne({
      countryId,
      status: "active",
    });
    if (activeVonc) {
      throw new SnapElectionError(
        "Cannot trigger snap election while a vote of no confidence is active"
      );
    }
  }

  // 1. Cancel active/upcoming regular lower-chamber elections for this country.
  //    Capture the affected election ids first so we can withdraw the candidate
  //    rows attached to them — leaving them `active` orphans the rows and
  //    blocks the same characters from being slated/entered into the snap race
  //    (see slate invitations / findBlockingActiveCandidacy guards).
  const electionsToCancel = await db
    .collection<Election>("elections")
    .find(
      {
        countryId,
        electionType: lowerChamberKey,
        status: { $in: ["active", "upcoming"] as ElectionStatus[] },
      },
      { projection: { _id: 1 } }
    )
    .toArray();
  const cancelledElectionIds = electionsToCancel.map((e) => e._id);

  if (cancelledElectionIds.length > 0) {
    await db
      .collection<Election>("elections")
      .updateMany(
        { _id: { $in: cancelledElectionIds } },
        { $set: { status: "cancelled" as ElectionStatus, updatedAt: now } }
      );
    await db
      .collection("electionCandidates")
      .updateMany(
        { electionId: { $in: cancelledElectionIds }, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
  }

  // 2. Fail in-progress bills whose currentChamber is the lower chamber.
  //    Upper-chamber bills, JP cabinet_review, and enrolled bills are
  //    preserved — their chambers are not dissolved.
  await failInProgressBills(db, countryId, now);

  // 3. Spawn fresh snap elections per region.
  const snapElectionType = `snap_${lowerChamberKey}`;
  const snapDur = DEFAULT_DURATIONS[snapElectionType] ?? DEFAULT_DURATIONS.snap_lowerChamber;

  const regions = await db
    .collection<{ _id: string }>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();

  const seats = await db
    .collection<Seat>("seats")
    .find({ countryId, electionType: lowerChamberKey })
    .toArray();
  const seatsByRegion = new Map(seats.map((s) => [s.state, s.totalSeats ?? 1]));

  // Inherit cycle number from most recent regular-or-snap election per region,
  // so snap elections slot into the same cycle sequence as regulars.
  const lastElections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: { $in: [lowerChamberKey, snapElectionType] },
      status: { $in: ["completed", "resolved"] },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  const lastByRegion = new Map<string, Election>();
  for (const e of lastElections) {
    if (!lastByRegion.has(e.state)) lastByRegion.set(e.state, e);
  }

  const snapElections: Omit<Election, "_id">[] = regions.map((r) => {
    const regionId = r._id as string;
    const prev = lastByRegion.get(regionId);
    const cycle = (prev?.cycle ?? 0) + 1;
    return {
      countryId,
      electionType: snapElectionType,
      state: regionId,
      seatId: getSeatIdFromElection({
        countryId,
        electionType: lowerChamberKey,
        state: regionId,
      }),
      cycle,
      electionYear: electionToLarpYear(snapElectionType, cycle, undefined, undefined, ctx),
      status: "active" as ElectionStatus,
      // Read by the perpetual spawner. A PM snap drags the LARP calendar forward
      // for the next regular race; an imposed one must not, because dissolving a
      // chamber is the settlement's business and rescheduling every future
      // election is not.
      ...(imposed && { imposedSnap: true }),
      totalSeats: seatsByRegion.get(regionId) ?? 1,
      startTime: now,
      primaryEndTime: new Date(now.getTime() + snapDur.primaryDurationHours * 3_600_000),
      endTime: new Date(now.getTime() + snapDur.durationHours * 3_600_000),
      startTurn: currentTurn,
      primaryEndTurn: currentTurn + snapDur.primaryDurationHours,
      endTurn: currentTurn + snapDur.durationHours,
      durationHours: snapDur.durationHours,
      primaryDurationHours: snapDur.primaryDurationHours,
      createdAt: now,
      updatedAt: now,
    };
  });

  if (snapElections.length > 0) {
    await db.collection<Election>("elections").insertMany(snapElections as Election[]);
  }

  // 4. Increment counters. Auto-snap still increments so operators can see
  //    that an auto-snap fired; the only difference is that the limit was
  //    not enforced on entry.
  //
  //    An IMPOSED snap is the exception: `snapElectionsUsed` is a budget the head
  //    of government spends on strategic dissolutions, and a settlement forced on
  //    the country from outside must not spend it. The turn is still stamped, so
  //    operators can still see that a snap fired here.
  await govCol.updateOne(
    { _id: countryId },
    {
      $set: {
        ...(imposed ? {} : { snapElectionsUsed: snapUsed + 1 }),
        lastSnapElectionTurn: currentTurn,
        updatedAt: now,
      },
    }
  );

  // 5. Vacate the sitting PM and unform the government. Must run BEFORE the
  //    reset below so the reset takes the no-sitting-PM branch and only
  //    touches cycle/seat fields.
  await unformGovernmentAndVacatePM(db, countryId, now, { reason: "snap" });

  // 6. Reset government cycle/seat counters.
  await resetParliamentaryGovernmentAfterElection(db, countryId, now);

  const chamberName = config.legislature.lowerChamber.name;
  sendCountryGameEvent(countryId, {
    // An imposed dissolution is not the executive's doing, and a headline
    // crediting them for it would misdescribe what happened to the country.
    title: imposed
      ? `${chamberName} Dissolved Under a Peace Settlement`
      : `${config.executiveTitle} Dissolves ${chamberName}`,
    description: imposed
      ? `The terms of a peace settlement dissolve the ${chamberName} and call fresh elections. All active legislation has been cancelled.`
      : opts.reason === "auto-snap"
        ? `**No ${config.executiveTitle}** was appointed within the ${chamberName} vacancy window. The ${chamberName} is automatically dissolved and a snap election called.`
        : `**${opts.actorName ?? config.executiveTitle}** has dissolved the ${chamberName} and called a snap election. All active legislation has been cancelled.`,
    color: DISCORD_COLORS.govCollapsed,
    footer: { text: "A House Divided" },
    timestamp: now.toISOString(),
  }).catch(() => {});

  const usedAfter = imposed ? snapUsed : snapUsed + 1;
  return {
    electionsSpawned: snapElections.length,
    snapElectionsUsed: usedAfter,
    snapElectionsRemaining: Math.max(0, SNAP_ELECTION_LIMIT - usedAfter),
    snapElectionType,
    currentTurn,
  };
}
