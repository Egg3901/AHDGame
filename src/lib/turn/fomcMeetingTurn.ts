import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CentralBank,
  FomcSeat,
  FomcMeeting,
  FomcBallot,
  FomcNomination,
  RateChangeRecord,
} from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { getInflationTarget } from "@/lib/budget/inflation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  RATE_HISTORY_MAX,
  NPP_CHAIR_TARGET_GROWTH,
  COC_SMOOTHING_TURNS,
  snapToPrimeRateGrid,
} from "@/lib/db/types/centralBank";
import {
  tallyMeeting,
  playerSeats,
  boardCanCarryMotions,
  type FomcMacroContext,
} from "@/lib/centralBank/fomc";
import { logger } from "../observability/logger";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { resolveJurisdiction } from "@/lib/monetaryGovernance/jurisdiction";
import {
  bankToJurisdictionState,
  materializeTransitionSet,
  stateToSeat,
} from "@/lib/monetaryGovernance/governanceShell";
import { decideGovernance } from "@/lib/monetaryGovernance/rules/machine";

const FOMC_MEETING_HISTORY_MAX = 24;
// Shared with the direct-set and autonomous-chair writers so no path truncates
// another's records; see RATE_HISTORY_MAX in db/types/centralBank.

/** System actor stamped on committee-driven rate changes. */
const FOMC_SYSTEM_ACTOR = new ObjectId("000000000000000000000000");

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Load the macro inputs every seat reasons over for one meeting. Mirrors nppChairAutoRate. */
async function loadMacroContext(
  db: Db,
  bank: Pick<CentralBank, "primeRate">,
  countryId: CountryId,
  currentYear: number | null | undefined
): Promise<FomcMacroContext> {
  const targetInflation = getInflationTarget(countryId, currentYear);

  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) });
  const inflationRate = finiteOr(budget?.economicFactors?.inflationRate, targetInflation);

  const nationalDocId = getNationalDocId(countryId);
  const nationalMetrics = nationalDocId
    ? await db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
    : null;
  const gdpGrowth = finiteOr(nationalMetrics?.economic?.gdpGrowth?.value, NPP_CHAIR_TARGET_GROWTH);

  const neutralRate =
    getEraMonetaryBaseline(countryId, currentYear)?.neutralPrimeRate ??
    COUNTRY_CONFIGS[countryId].centralBank.defaultPrimeRate;

  return { neutralRate, inflationRate, targetInflation, gdpGrowth, currentRate: bank.primeRate };
}

/** The chair seat, falling back to the first seat if none is flagged. */
function chairSeat(board: FomcSeat[]): FomcSeat | undefined {
  return board.find((s) => s.isChair) ?? board[0];
}

/**
 * Player characters who currently hold a member country's nominating executive
 * office (the same office the FOMC nominate route authorizes, e.g. the US
 * President). These are the only players who can fill vacant committee seats.
 */
async function findNominationExecutives(
  db: Db,
  countryId: CountryId
): Promise<Array<{ userId: ObjectId; characterName: string }>> {
  // Committee banks are single-country institutions (FOMC_COMMITTEE_COUNTRY_IDS
  // gates the whole vacancy path on bank.countryId), so one exec key suffices.
  const execKey = COUNTRY_CONFIGS[countryId]?.officeTypes.find((o) => o.isExecutive)?.key;
  if (!execKey) return [];

  const chars = await db
    .collection<Character>("characters")
    .find({ countryId, userId: { $exists: true }, "currentOffice.type": execKey })
    .project<Pick<Character, "name" | "userId">>({ name: 1, userId: 1 })
    .toArray();
  return chars.map((char) => ({ userId: char.userId, characterName: char.name }));
}

/**
 * Tell the world a committee board has gone understaffed (ticket #1238).
 *
 * Vacant seats are by design (#1195: the engine never seats a machine
 * candidate; the President nominates and the Senate confirms), but before this
 * notice the vacancy was silent: motions just started failing 1-0-6 with no
 * signal to the one player who can fix it, and the board stayed dead for good.
 * Notifies every nominating executive in-app and posts a system news item so
 * the chair and community can see why the board cannot move the rate.
 */
async function notifyFomcVacancy(
  db: Db,
  bank: Pick<CentralBank, "_id" | "countryId">,
  board: FomcSeat[],
  now: Date
): Promise<void> {
  const countryId = bank.countryId as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  const bankLabel = config?.centralBank.name ?? "the central bank";
  const execTitle =
    config?.officeTypes.find((o) => o.isExecutive)?.label.toLowerCase() ?? "the executive";
  const vacantCount = board.filter((s) => s.occupantType === "vacant").length;
  // A board that still has enough seated members to carry a motion only needs a
  // nudge to fill the gaps; a board below the threshold is dead and the chair
  // holds the rate until it is filled.
  const chairHoldsRate = !boardCanCarryMotions(board);
  const message = chairHoldsRate
    ? `${vacantCount} of ${board.length} committee seats are vacant, so the board cannot carry a rate motion. The chair holds the rate directly until enough governors are confirmed. Nominate replacements from the central bank's committee page; the Senate confirms them.`
    : `${vacantCount} of ${board.length} committee seats are vacant. Nominate governors from the central bank's committee page; the Senate confirms them.`;

  const notifications: NotificationInput[] = [];
  const executives = await findNominationExecutives(db, countryId);
  for (const exec of executives) {
    notifications.push({
      userId: exec.userId,
      type: "system",
      title: `${bankLabel}: board seats vacant`,
      message,
      metadata: { type: "central_bank_fomc_vacancy", countryId, bankId: bank._id, at: now },
    });
  }
  await createNotifications(notifications);

  createSystemNewsPost(
    chairHoldsRate
      ? `${vacantCount} of ${board.length} seats on the ${bankLabel}'s rate-setting board are vacant, so the board cannot carry a rate motion. The chair is setting the rate directly until the ${execTitle} nominates governors and the Senate confirms them.`
      : `${vacantCount} of ${board.length} seats on the ${bankLabel}'s rate-setting board are vacant. The board can still carry motions; the ${execTitle} should nominate governors and the Senate confirm them.`,
    "executive"
  ).catch((err) => logger.error("FomcMeetingTurn", "vacancy news post failed", err));
}

interface ResolveOptions {
  changesThisTerm: number;
  /** When true, resolve even if the tally is not yet mathematically decided (no-shows abstain). */
  forceDeadline: boolean;
}

interface ResolveOutcome {
  resolved: boolean;
  moved: boolean;
  changesThisTerm: number;
}

/**
 * Shared meeting resolver used by both the turn phase and the live player-vote
 * route. Writes resolution mutations into `set` when the meeting resolves (a
 * majority is reached, a majority becomes impossible, or the deadline is hit).
 * Leaves `set` untouched and returns resolved:false while votes are still open.
 *
 * A decided tally alone never closes a meeting while a seated player can still
 * ballot: NPP seats auto-vote the moment a meeting opens, so on a board where
 * the NPP block alone holds the majority the meeting would otherwise open and
 * resolve inside the same turn phase and the player seats would never see the
 * documented 24-turn vote window. Early resolution therefore waits until every
 * player seat has cast a ballot; the deadline still force-resolves with
 * no-shows abstaining.
 */
export function resolveMeetingInto(
  set: Record<string, unknown>,
  bank: Pick<CentralBank, "primeRate" | "rateHistory" | "fomcMeetingHistory"> & {
    /** The bank's own id, for the audit trail. Optional for legacy callers. */
    bankId?: string;
  },
  board: FomcSeat[],
  meeting: FomcMeeting,
  currentTurn: number,
  now: Date,
  opts: ResolveOptions
): ResolveOutcome {
  const tally = tallyMeeting(meeting.ballots, meeting.motion, board.length);
  const awaitingPlayerBallot = playerSeats(board).some(
    (s) => !meeting.ballots.some((b) => b.seatId === s.seatId)
  );
  if ((!tally.decided || awaitingPlayerBallot) && !opts.forceDeadline) {
    return { resolved: false, moved: false, changesThisTerm: opts.changesThisTerm };
  }

  const passed = tally.passed;
  const moved = passed && meeting.motion !== "hold" && Math.abs(meeting.proposedDelta) > 1e-9;
  let changesThisTerm = opts.changesThisTerm;

  const resolved: FomcMeeting = {
    ...meeting,
    status: "resolved",
    result: passed ? "passed" : "failed",
    resolvedAt: now,
    resolvedAtTurn: currentTurn,
  };

  if (moved) {
    const previousRate = bank.primeRate;
    // Snap onto the quarter-point grid: a stored off-grid rate plus a motion
    // delta stays off-grid, and the next on-grid action would never validate.
    const newRate = snapToPrimeRateGrid(snapToPrimeRateGrid(previousRate) + meeting.proposedDelta);
    const chair = chairSeat(board);
    const record: RateChangeRecord = {
      previousRate,
      newRate,
      changedBy: chair?.characterId ?? chair?.nppId ?? FOMC_SYSTEM_ACTOR,
      changedByName: chair?.characterName ?? "FOMC",
      changedAt: now,
      reason: `FOMC ${meeting.motion} carried ${tally.agree}-${tally.disagree}`,
    };
    set.primeRate = newRate;
    set.lastRateChangeTurn = currentTurn;
    changesThisTerm += 1;
    set.rateChangesThisTerm = changesThisTerm;
    set.rateHistory = [...(bank.rateHistory ?? []), record].slice(-RATE_HISTORY_MAX);
    emitBankingAuditEvent({
      kind: "policy.rate_changed",
      command: "monetary.meeting.resolve",
      turn: currentTurn,
      outcome: "ok",
      ...(bank.bankId ? { bankId: bank.bankId } : {}),
      subjectType: "meeting",
      subjectId: meeting.meetingId,
      statusBefore: String(previousRate),
      statusAfter: String(newRate),
      meta: { previousRate, newRate, motion: meeting.motion, changesThisTerm },
    });
  }

  set.activeFomcMeeting = null;
  set.fomcMeetingHistory = [...(bank.fomcMeetingHistory ?? []), resolved].slice(
    -FOMC_MEETING_HISTORY_MAX
  );
  emitBankingAuditEvent({
    kind: "meeting.transitioned",
    command: "monetary.meeting.resolve",
    turn: currentTurn,
    outcome: "ok",
    ...(bank.bankId ? { bankId: bank.bankId } : {}),
    subjectType: "meeting",
    subjectId: meeting.meetingId,
    statusBefore: "voting",
    statusAfter: "resolved",
    meta: {
      motion: meeting.motion,
      result: passed ? "passed" : "failed",
      agree: tally.agree,
      disagree: tally.disagree,
      abstain: tally.abstain,
      forcedDeadline: opts.forceDeadline,
      moved,
    },
  });
  return { resolved: true, moved, changesThisTerm };
}

export type CastBallotResult =
  | { ok: false; reason: "no-meeting" | "not-seated" | "already-voted" }
  | { ok: true; resolved: boolean; motion: string; moved: boolean };

/**
 * Record a live player board member's ballot on the active meeting and, per the
 * "auto-pass before the timer" rule, resolve immediately once the outcome is
 * decided and no other player seat is still waiting to ballot. Idempotent per
 * seat per meeting: a seat that has already voted is rejected.
 */
export async function castFomcBallot(
  db: Db,
  bankId: string,
  characterId: ObjectId,
  vote: FomcBallot["vote"],
  currentTurn: number,
  now: Date
): Promise<CastBallotResult> {
  const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
  const meeting = bank?.activeFomcMeeting;
  const board = bank?.fomcBoard ?? [];
  const refuse = (reason: "no-meeting" | "not-seated" | "already-voted"): CastBallotResult => {
    emitBankingAuditEvent(
      {
        kind: "meeting.voted",
        command: "monetary.meeting.vote",
        turn: currentTurn,
        outcome: "rejected",
        reason,
        bankId,
        subjectType: "meeting",
        ...(meeting ? { subjectId: meeting.meetingId } : {}),
        meta: { vote },
      },
      db
    );
    return { ok: false, reason };
  };
  if (!bank || !meeting || meeting.status !== "voting") return refuse("no-meeting");

  const seat = board.find((s) => s.occupantType === "player" && s.characterId?.equals(characterId));
  const clockMs = now.getTime();
  const jurisdiction = await resolveJurisdiction(db, bank.countryId);
  const state = bankToJurisdictionState(bank, {
    jurisdiction,
    governmentControlled: await isBankGovernmentControlledLive(bank, bank.countryId),
    fxCommitment: null,
    commandEconomy: false,
  });
  const decision = decideGovernance(
    state,
    { type: "cast_ballot", seatId: seat?.seatId ?? "", vote, countryId: bank.countryId },
    {
      kind: "governor",
      ...(seat ? { seatId: seat.seatId } : {}),
      characterId: characterId.toString(),
      countryId: bank.countryId,
    },
    { turn: currentTurn, now: clockMs, currentYear: null }
  );
  if (!decision.allowed) {
    // A closed window reads as no meeting; a foreign or committee-less
    // viewpoint reads as not seated. Both keep the route's status mapping.
    if (decision.reason === "no-meeting" || decision.reason === "deadline-passed") {
      return refuse("no-meeting");
    }
    if (decision.reason === "already-voted") return refuse("already-voted");
    return refuse("not-seated");
  }

  const set = materializeTransitionSet(bank, decision.transition, now);
  set.updatedAt = now;
  await db.collection<CentralBank>("centralBanks").updateOne({ _id: bankId }, { $set: set });
  for (const event of decision.transition.events) emitBankingAuditEvent(event, db);
  const resolved = decision.next.activeMeeting == null;
  const moved = decision.transition.events.some(
    (e) => e.kind === "policy.rate_changed" && e.outcome === "ok"
  );
  return { ok: true, resolved, motion: meeting.motion, moved };
}

export interface FomcMeetingTurnResult {
  banksProcessed: number;
  meetingsOpened: number;
  meetingsResolved: number;
  ratesChanged: number;
  seatsReplaced: number;
}

/**
 * Per-turn FOMC committee phase. For every bank carrying a committee board,
 * this is a thin shell: it loads the bank into a JurisdictionState, feeds one
 * turn_start deadline event through the governance machine (seat expiry, term
 * rollover, deadline resolution, cadence opening), and persists the returned
 * transition. The machine owns every branch; see the rules for the order.
 *
 * No-op for banks without a `fomcBoard` (legacy single-chair banks are untouched).
 * Turns are never paused: an unresolved meeting is force-resolved at its deadline
 * with any no-show player seats counting as abstentions.
 */
export async function processFomcMeetings(
  db: Db,
  currentTurn: number,
  currentYear: number | null | undefined,
  now: Date
): Promise<FomcMeetingTurnResult> {
  const result: FomcMeetingTurnResult = {
    banksProcessed: 0,
    meetingsOpened: 0,
    meetingsResolved: 0,
    ratesChanged: 0,
    seatsReplaced: 0,
  };

  const gameConfig = await db
    .collection<{ _id: string; commandEconomyEnabled?: boolean }>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;

  // Advance the cost-of-capital EMA for EVERY bank, every turn — including
  // dormant/government-controlled ones the meeting loop below skips. The
  // share-price formula reads primeRateSmoothed; leaving a bank out would pin
  // its market's discount rate at whatever the EMA last was.
  {
    const allBanks = await db
      .collection<CentralBank>("centralBanks")
      .find({}, { projection: { primeRate: 1, primeRateSmoothed: 1 } })
      .toArray();
    const emaOps = allBanks
      .filter((b) => typeof b.primeRate === "number" && Number.isFinite(b.primeRate))
      .map((b) => {
        const prev =
          typeof b.primeRateSmoothed === "number" && Number.isFinite(b.primeRateSmoothed)
            ? b.primeRateSmoothed
            : b.primeRate;
        const next = prev + (b.primeRate - prev) / COC_SMOOTHING_TURNS;
        return {
          updateOne: {
            filter: { _id: b._id },
            update: { $set: { primeRateSmoothed: Math.round(next * 1e6) / 1e6 } },
          },
        };
      });
    if (emaOps.length > 0) {
      await db.collection<CentralBank>("centralBanks").bulkWrite(emaOps);
    }
  }

  const banks = await db
    .collection<CentralBank>("centralBanks")
    .find({ fomcBoard: { $exists: true, $ne: [] } })
    .toArray();

  for (const bank of banks) {
    const board = bank.fomcBoard ?? [];
    if (board.length === 0) continue;
    // A government-controlled bank holds no rate meetings even if a board doc
    // survives from before independence was revoked — the Treasury sets the
    // rate directly and the committee is dormant until independence returns.
    if (await isBankGovernmentControlledLive(bank, bank.countryId as CountryId)) continue;
    result.banksProcessed++;
    const countryId = bank.countryId;
    const commandEconomy = isCommandEconomy(countryId, currentYear, commandEconomyEnabled);

    // Thin shell over the governance machine: load the bank into a
    // JurisdictionState, feed one turn_start deadline event, persist the
    // returned mutations with one updateOne, and emit its events.
    const jurisdiction = await resolveJurisdiction(db, countryId);
    const state = bankToJurisdictionState(bank, {
      jurisdiction,
      governmentControlled: false,
      fxCommitment: null,
      commandEconomy,
    });
    const macro = await loadMacroContext(db, bank, countryId, currentYear);
    let hasActiveNomination = false;
    if (board.some((s) => s.occupantType === "vacant")) {
      const activeNominations = await db
        .collection<FomcNomination>("fomcNominations")
        .find({ bankId: bank._id, status: "active" })
        .project<{ _id: ObjectId }>({ _id: 1 })
        .toArray();
      hasActiveNomination = activeNominations.length > 0;
    }
    const clockMs = now.getTime();
    const decision = decideGovernance(
      state,
      {
        type: "turn_start",
        turn: currentTurn,
        now: clockMs,
        macro,
        countryId,
        hasActiveNomination,
      },
      { kind: "system" },
      { turn: currentTurn, now: clockMs, currentYear: currentYear ?? null }
    );
    if (!decision.allowed) continue;

    const set = materializeTransitionSet(bank, decision.transition, now);
    // Vacancy exposure stays gated on the jurisdiction: a legacy board doc on
    // a non-committee bank still processes mechanically, but the notice that
    // names the nominating executive only goes out for committee institutions.
    const exposed = jurisdiction.committeeBank;
    if (!exposed) delete set.lastFomcVacancyNoticeAtTurn;
    const wasVacant = new Set(
      board.filter((s) => s.occupantType === "vacant").map((s) => s.seatId)
    );
    result.seatsReplaced += decision.next.board.filter(
      (s) => s.occupantType === "vacant" && !wasVacant.has(s.seatId)
    ).length;
    for (const event of decision.transition.events) {
      if (event.command === "monetary.meeting.open") result.meetingsOpened++;
      if (event.kind === "meeting.transitioned" && event.command === "monetary.meeting.resolve") {
        result.meetingsResolved++;
      }
      if (event.kind === "policy.rate_changed" && event.outcome === "ok") result.ratesChanged++;
      emitBankingAuditEvent(event, db);
    }
    for (const notification of decision.transition.notifications) {
      if (notification.kind === "vacancy_notice" && exposed) {
        set.lastFomcVacancyNoticeAtTurn = notification.stampNoticeTurn;
        await notifyFomcVacancy(db, bank, decision.next.board.map(stateToSeat), now);
      }
    }
    set.updatedAt = now;

    await db.collection<CentralBank>("centralBanks").updateOne({ _id: bank._id }, { $set: set });
  }

  return result;
}
