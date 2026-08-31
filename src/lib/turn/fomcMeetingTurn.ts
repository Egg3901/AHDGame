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
  RATE_CHANGES_PER_TERM,
  FOMC_TERM_TURNS,
  FOMC_MEETING_INTERVAL_TURNS,
  FOMC_PLAYER_VOTE_WINDOW_MS,
  FOMC_VOTE_WINDOW_TURNS,
  FOMC_VACANCY_REMINDER_INTERVAL_TURNS,
  FOMC_COMMITTEE_COUNTRY_IDS,
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
  boardCanCarryMotions,
  type FomcMacroContext,
} from "@/lib/centralBank/fomc";
import { logger } from "../observability/logger";

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
  } else if (chair.occupantType === "vacant") {
    // A vacant chair mirrors as no one: clear the person fields but leave
    // chairMode alone. The vacancy itself is signalled by chairCharacterId=null
    // plus `vacancyAwaitingAutomaticSelection` (set by the caller), which the
    // chair-selection phase reads to open nominations. Fabricating an NPP here
    // is exactly the auto-stock we're removing.
    set.chairCharacterId = null;
    set.chairNppId = null;
    set.chairCharacterName = null;
  } else {
    set.chairMode = "npp";
    set.chairNppId = chair.nppId;
    set.chairCharacterId = null;
    set.chairCharacterName = null;
  }
}

/**
 * VACATE any seat whose staggered term has expired. The seat is left empty
 * (occupantType "vacant"), NOT auto-filled with a technocrat NPP: the committee
 * is staffed by presidential nomination + Senate confirmation, never stocked by
 * the engine. A vacant seat abstains on rate motions, so an unstaffed board
 * simply cannot move the rate until the President fills it — which is the point.
 * Returns a new board when anything changed, else null.
 *
 * `chairRefreshed` reports whether the CHAIR seat was one of the vacancies, so
 * the caller can hand it to the chair selection / nomination pipeline.
 */
async function refreshExpiredSeats(
  _db: Db,
  _bank: Pick<CentralBank, "_id" | "countryId">,
  board: FomcSeat[],
  currentTurn: number
): Promise<{ board: FomcSeat[]; replaced: number; chairRefreshed: boolean } | null> {
  let replaced = 0;
  let chairRefreshed = false;
  const next: FomcSeat[] = [];
  for (const seat of board) {
    if (seat.termExpiresAtTurn != null && seat.termExpiresAtTurn <= currentTurn) {
      next.push({
        ...seat,
        occupantType: "vacant",
        characterId: null,
        characterName: null,
        nppId: null,
        appointedByPresidentId: null,
        appointedAtTurn: currentTurn,
        // No term on a vacant seat — it stays open until a nominee is confirmed.
        termExpiresAtTurn: null,
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

    // 0. Vacate any seats whose term has expired. Persist immediately so the
    //    meeting below votes on the new roster and the single-chair mirror stays
    //    coherent when the chair lapses.
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

    // 0b. Vacancy signal (ticket #1238). Seats are staffed by presidential
    //     nomination + Senate confirmation only (#1195), so an expired board
    //     stays vacant until the executive acts. That action was previously
    //     invisible: motions just failed 1-0-6 forever. Tell the nominating
    //     executive (and the news feed) when seats first fall vacant, and
    //     re-remind at most once per reminder interval while no nomination is
    //     already before the Senate.
    const vacantSeatCount = board.filter((s) => s.occupantType === "vacant").length;
    if (
      vacantSeatCount > 0 &&
      FOMC_COMMITTEE_COUNTRY_IDS.has(countryId) &&
      (refreshed !== null ||
        typeof bank.lastFomcVacancyNoticeAtTurn !== "number" ||
        currentTurn - bank.lastFomcVacancyNoticeAtTurn >= FOMC_VACANCY_REMINDER_INTERVAL_TURNS)
    ) {
      const activeNominations = await db
        .collection<FomcNomination>("fomcNominations")
        .find({ bankId: bank._id, status: "active" })
        .project<{ _id: ObjectId }>({ _id: 1 })
        .toArray();
      if (activeNominations.length === 0) {
        set.lastFomcVacancyNoticeAtTurn = currentTurn;
        await notifyFomcVacancy(db, bank, board, now);
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

    // 2. Open a meeting when none is active and cadence is due — unless the
    //    board has decayed below the carry-a-motion threshold. With fewer seated
    //    members than a strict majority of the full board, every motion fails
    //    on the tally regardless of how the seated members vote, so opening
    //    another meeting just re-runs the 1-0-6 auto-fail loop (ticket #1238
    //    follow-up). The chairman holds the rate directly until nominations
    //    restore a working board; an ALREADY-OPEN meeting still resolves
    //    normally below.
    let justOpened = false;
    if (!meeting) {
      const dueForMeeting =
        typeof bank.lastFomcMeetingTurn !== "number" ||
        currentTurn - bank.lastFomcMeetingTurn >= FOMC_MEETING_INTERVAL_TURNS;
      if (dueForMeeting && boardCanCarryMotions(board)) {
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
