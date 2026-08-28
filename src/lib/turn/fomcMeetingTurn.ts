import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CentralBank,
  FomcSeat,
  FomcMeeting,
  FomcBallot,
  RateChangeRecord,
} from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { getInflationTarget } from "@/lib/budget/inflation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  RATE_CHANGES_PER_TERM,
  FOMC_TERM_TURNS,
  FOMC_MEETING_INTERVAL_TURNS,
  FOMC_PLAYER_VOTE_WINDOW_MS,
  FOMC_VOTE_WINDOW_TURNS,
  RATE_CHANGE_COOLDOWN_TURNS,
  NPP_CHAIR_TARGET_GROWTH,
  COC_SMOOTHING_TURNS,
} from "@/lib/db/types/centralBank";
import {
  proposeChairMotion,
  seatPreferredVote,
  tallyMeeting,
  isAutoSeat,
  playerSeats,
  type FomcMacroContext,
} from "@/lib/centralBank/fomc";
import { spawnTechnocratNpp } from "@/lib/npp/generator";
import { oppositeAlignment } from "@/lib/centralBank/chairAlignment";

const FOMC_MEETING_HISTORY_MAX = 24;
const RATE_HISTORY_MAX = 96;
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
 * Mirror the board's chair seat onto the bank's legacy single-chair fields.
 *
 * The mode must follow the SEAT, not be assumed. Stamping `chairMode: "npp"`
 * unconditionally demoted a player chair the moment any unrelated seat rolled
 * over, and left the outgoing player's `chairCharacterId` behind as a ghost —
 * prod carried US as `chairCharacterId: <player>` with `chairMode: "npp"` and
 * an NPP `chairNppId` at the same time, so the page showed a technocrat while
 * the player still resolved as chair everywhere that reads the mirror.
 */
function mirrorChairOntoBank(set: Record<string, unknown>, chair: FomcSeat): void {
  set.chairAlignment = chair.alignment;
  set.chairTermExpiresAtTurn = chair.termExpiresAtTurn;
  if (chair.occupantType === "player" && chair.characterId) {
    set.chairMode = "character";
    set.chairCharacterId = chair.characterId;
    set.chairCharacterName = chair.characterName;
    set.chairNppId = null;
  } else {
    set.chairMode = "npp";
    set.chairNppId = chair.nppId;
    set.chairCharacterId = null;
    set.chairCharacterName = null;
  }
}

/**
 * Vacate any seat whose staggered term has expired and appoint an autonomous
 * technocrat replacement (flipped alignment, fresh full term) so the board is
 * never short a governor. A player whose term lapses is removed and their seat
 * reverts to an NPP — the President can later re-nominate a player via the
 * confirmation flow. Returns a new board when anything changed, else null.
 *
 * `chairRefreshed` reports whether the CHAIR seat was one of the replacements,
 * so the caller can hand the vacancy to the player selection pipeline instead
 * of locking the technocrat in for a full 4-year term.
 */
async function refreshExpiredSeats(
  db: Db,
  bank: Pick<CentralBank, "_id" | "countryId">,
  board: FomcSeat[],
  currentTurn: number
): Promise<{ board: FomcSeat[]; replaced: number; chairRefreshed: boolean } | null> {
  let replaced = 0;
  let chairRefreshed = false;
  const next: FomcSeat[] = [];
  for (const seat of board) {
    if (seat.termExpiresAtTurn != null && seat.termExpiresAtTurn <= currentTurn) {
      const npp = await spawnTechnocratNpp(db, bank.countryId, "fomcMember");
      next.push({
        ...seat,
        occupantType: "npp",
        characterId: null,
        characterName: npp.name,
        nppId: npp._id,
        alignment: oppositeAlignment(seat.alignment),
        appointedByPresidentId: null,
        appointedAtTurn: currentTurn,
        termExpiresAtTurn: currentTurn + FOMC_TERM_TURNS,
      });
      replaced++;
      if (seat.isChair) chairRefreshed = true;
    } else {
      next.push(seat);
    }
  }
  return replaced > 0 ? { board: next, replaced, chairRefreshed } : null;
}

/** Whether the committee is allowed to move the rate at all right now. */
function canChangeRate(
  bank: Pick<CentralBank, "rateChangesThisTerm" | "lastRateChangeTurn">,
  currentTurn: number,
  commandEconomy: boolean
): boolean {
  if (commandEconomy) return false;
  if ((bank.rateChangesThisTerm ?? 0) >= RATE_CHANGES_PER_TERM) return false;
  const last = bank.lastRateChangeTurn;
  if (typeof last === "number" && currentTurn - last < RATE_CHANGE_COOLDOWN_TURNS) return false;
  return true;
}

/**
 * Open a new meeting: the chair tables a motion, and every auto (NPP / vacant)
 * seat casts immediately. Player seats are left unvoted — they vote live or
 * abstain at resolution. Returns the meeting with initial ballots.
 */
function openMeeting(
  board: FomcSeat[],
  ctx: FomcMacroContext,
  currentTurn: number,
  now: Date,
  allowChange: boolean
): FomcMeeting {
  const chair = chairSeat(board);
  const chairAlignment = chair?.alignment ?? "hawk";
  const { motion, proposedDelta } = proposeChairMotion(chairAlignment, ctx, {
    canChangeRate: allowChange,
  });

  const ballots: FomcBallot[] = [];
  for (const seat of board) {
    // Vacant seats abstain (no ballot). NPP seats vote their own preference now.
    if (seat.occupantType === "npp" && isAutoSeat(seat)) {
      ballots.push({
        seatId: seat.seatId,
        vote: seatPreferredVote(seat.alignment, ctx),
        auto: true,
        castAt: now,
      });
    }
  }

  return {
    meetingId: new ObjectId().toHexString(),
    openedAtTurn: currentTurn,
    openedAt: now,
    motion,
    proposedDelta,
    status: "voting",
    ballots,
    playerVoteDeadline: new Date(now.getTime() + FOMC_PLAYER_VOTE_WINDOW_MS),
    // Hard game-clock deadline mirroring the 24h player window (~1 turn/hour).
    resolvesOnTurn: currentTurn + FOMC_VOTE_WINDOW_TURNS,
  };
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
  bank: Pick<CentralBank, "primeRate" | "rateHistory" | "fomcMeetingHistory">,
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
    const newRate = previousRate + meeting.proposedDelta;
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
  }

  set.activeFomcMeeting = null;
  set.fomcMeetingHistory = [...(bank.fomcMeetingHistory ?? []), resolved].slice(
    -FOMC_MEETING_HISTORY_MAX
  );
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
  if (!bank || !meeting || meeting.status !== "voting") return { ok: false, reason: "no-meeting" };

  const seat = board.find((s) => s.occupantType === "player" && s.characterId?.equals(characterId));
  if (!seat) return { ok: false, reason: "not-seated" };
  if (meeting.ballots.some((b) => b.seatId === seat.seatId)) {
    return { ok: false, reason: "already-voted" };
  }

  const updatedMeeting: FomcMeeting = {
    ...meeting,
    ballots: [...meeting.ballots, { seatId: seat.seatId, vote, auto: false, castAt: now }],
  };

  const set: Record<string, unknown> = { updatedAt: now };
  const outcome = resolveMeetingInto(set, bank, board, updatedMeeting, currentTurn, now, {
    changesThisTerm: bank.rateChangesThisTerm ?? 0,
    forceDeadline: false,
  });
  if (!outcome.resolved) set.activeFomcMeeting = updatedMeeting;

  await db.collection<CentralBank>("centralBanks").updateOne({ _id: bankId }, { $set: set });
  return { ok: true, resolved: outcome.resolved, motion: meeting.motion, moved: outcome.moved };
}

export interface FomcMeetingTurnResult {
  banksProcessed: number;
  meetingsOpened: number;
  meetingsResolved: number;
  ratesChanged: number;
  seatsReplaced: number;
}

/**
 * Per-turn FOMC committee phase. For every bank carrying a committee board:
 *   1. roll the 4-year term (resets the 16-change budget),
 *   2. resolve the active meeting if it is decided with no player ballot
 *      pending, or has hit its deadline,
 *   3. open a fresh meeting on cadence when none is active.
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
    let board = bank.fomcBoard ?? [];
    if (board.length === 0) continue;
    // A government-controlled bank holds no rate meetings even if a board doc
    // survives from before independence was revoked — the Treasury sets the
    // rate directly and the committee is dormant until independence returns.
    if (await isBankGovernmentControlledLive(bank, bank.countryId as CountryId)) continue;
    result.banksProcessed++;
    const countryId = bank.countryId;
    const commandEconomy = isCommandEconomy(countryId, currentYear, commandEconomyEnabled);

    const set: Record<string, unknown> = { updatedAt: now };

    // 0. Vacate expired seats and appoint autonomous replacements so the board
    //    stays full. Persist immediately so the meeting below votes on the new
    //    roster and the single-chair mirror stays coherent when the chair lapses.
    const refreshed = await refreshExpiredSeats(db, bank, board, currentTurn);
    if (refreshed) {
      board = refreshed.board;
      set.fomcBoard = refreshed.board;
      result.seatsReplaced += refreshed.replaced;
      const chair = chairSeat(refreshed.board);
      if (chair) {
        mirrorChairOntoBank(set, chair);
        // A technocrat keeps the committee quorate, but it must NOT silently
        // become the appointment. `centralBankChairSelection` runs LATER in the
        // same phase list and only fires on an expired/absent term — writing a
        // fresh 4-year `chairTermExpiresAtTurn` here pre-empted it every single
        // time, so an executive's nominations sat unread for the whole term and
        // no player has held a chair anywhere in the world. Flag the vacancy
        // instead and let the selection phase draw from the nomination pool.
        if (refreshed.chairRefreshed) {
          // A player offer already in flight must not be treated as a fresh
          // vacancy: that re-entered selection every turn and re-appointed
          // over the pending nominee. The caretaker keeps the committee
          // quorate; accept/decline still owns the seat.
          if (!bank.chairSelectionPending) {
            set.vacancyAwaitingAutomaticSelection = true;
            set.chairTermExpiresAtTurn = null;
          }
        }
      }
    }

    // 1. Term rollover — resets the per-term rate-change budget.
    let termStart = bank.fomcTermStartedAtTurn;
    let changesThisTerm = bank.rateChangesThisTerm ?? 0;
    if (typeof termStart !== "number") {
      termStart = currentTurn;
      set.fomcTermStartedAtTurn = termStart;
    } else if (currentTurn - termStart >= FOMC_TERM_TURNS) {
      termStart = currentTurn;
      changesThisTerm = 0;
      set.fomcTermStartedAtTurn = termStart;
      set.rateChangesThisTerm = 0;
    }

    let meeting = bank.activeFomcMeeting ?? null;

    // 2. Open a meeting when none is active and cadence is due.
    let justOpened = false;
    if (!meeting) {
      const dueForMeeting =
        typeof bank.lastFomcMeetingTurn !== "number" ||
        currentTurn - bank.lastFomcMeetingTurn >= FOMC_MEETING_INTERVAL_TURNS;
      if (dueForMeeting) {
        const ctx = await loadMacroContext(db, bank, countryId, currentYear);
        const allowChange = canChangeRate(
          { rateChangesThisTerm: changesThisTerm, lastRateChangeTurn: bank.lastRateChangeTurn },
          currentTurn,
          commandEconomy
        );
        meeting = openMeeting(board, ctx, currentTurn, now, allowChange);
        set.lastFomcMeetingTurn = currentTurn;
        set.activeFomcMeeting = meeting;
        result.meetingsOpened++;
        justOpened = true;
      }
    }

    // 3. Resolve the active meeting if decided, past its wall-clock window, or
    //    at the game-clock deadline. Turns never pause: no-shows abstain.
    //
    // A meeting OPENED this very phase is never resolved in the same phase, even
    // if the NPP/auto seats alone already decide the tally. Otherwise a board with
    // no seated player — or one where the auto block holds the majority — opens and
    // resolves a rate motion inside one turn, so the chair and members never see it
    // ("bills insta-pass without the fed chair even seeing them", #1211). It stays
    // open for its window; the deadline (which cannot fall on the opening turn,
    // resolvesOnTurn = openedAtTurn + FOMC_VOTE_WINDOW_TURNS) still force-resolves.
    if (meeting && meeting.status === "voting" && !justOpened) {
      const deadlineHit =
        currentTurn >= meeting.resolvesOnTurn ||
        now.getTime() >= meeting.playerVoteDeadline.getTime();
      const outcome = resolveMeetingInto(set, bank, board, meeting, currentTurn, now, {
        changesThisTerm,
        forceDeadline: deadlineHit,
      });
      if (outcome.resolved) {
        result.meetingsResolved++;
        if (outcome.moved) result.ratesChanged++;
        changesThisTerm = outcome.changesThisTerm;
      } else {
        // Still taking votes — persist any ballots cast this cycle.
        set.activeFomcMeeting = meeting;
      }
    }

    await db.collection<CentralBank>("centralBanks").updateOne({ _id: bank._id }, { $set: set });
  }

  return result;
}
