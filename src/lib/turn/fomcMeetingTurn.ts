/**
 * Committee meetings collect ballots and execute carried motions only while
 * current monetary policy permits the move. processFomcMeetings advances the
 * deadline; castFomcBallot records a player's vote using the same rules.
 */
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CentralBank, FomcSeat, FomcBallot, FomcNomination } from "@/lib/db/types/centralBank";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { getInflationTarget } from "@/lib/budget/inflation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { createSystemNewsPost } from "@/lib/news";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { NPP_CHAIR_TARGET_GROWTH, COC_SMOOTHING_TURNS } from "@/lib/db/types/centralBank";
import { boardCanCarryMotions, type FomcMacroContext } from "@/lib/centralBank/fomc";
import { logger } from "../observability/logger";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { resolveJurisdiction } from "@/lib/monetaryGovernance/jurisdiction";
import {
  bankToJurisdictionState,
  materializeTransitionSet,
  stateToSeat,
} from "@/lib/monetaryGovernance/governanceShell";
import { loadExecutionPolicies } from "@/lib/monetaryGovernance/executionPolicy";
import { decideGovernance } from "@/lib/monetaryGovernance/rules/machine";

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
  now: Date,
  currentYear: number | null = null
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
  const config = await db
    .collection<{ _id: string; commandEconomyEnabled?: boolean }>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const policies = await loadExecutionPolicies(
    db,
    [jurisdiction.anchorCountryId],
    currentYear,
    config?.commandEconomyEnabled === true
  );
  const state = bankToJurisdictionState(bank, {
    jurisdiction,
    governmentControlled: await isBankGovernmentControlledLive(bank, bank.countryId),
    ...policies.get(jurisdiction.anchorCountryId)!,
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
    { turn: currentTurn, now: clockMs, currentYear }
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

  const candidates = await db
    .collection<CentralBank>("centralBanks")
    .find({ fomcBoard: { $exists: true, $ne: [] } })
    .toArray();

  const banks: CentralBank[] = [];
  for (const bank of candidates) {
    if ((bank.fomcBoard ?? []).length === 0) continue;
    // Preserve dormant meetings while government control suspends the committee.
    if (await isBankGovernmentControlledLive(bank, bank.countryId as CountryId)) continue;
    banks.push(bank);
  }
  const jurisdictions = await Promise.all(
    banks.map((bank) => resolveJurisdiction(db, bank.countryId))
  );
  const policies = await loadExecutionPolicies(
    db,
    jurisdictions.map((j) => j.anchorCountryId),
    currentYear,
    commandEconomyEnabled
  );
  for (const [index, bank] of banks.entries()) {
    const board = bank.fomcBoard ?? [];
    result.banksProcessed++;
    const countryId = bank.countryId;

    // Thin shell over the governance machine: load the bank into a
    // JurisdictionState, feed one turn_start deadline event, persist the
    // returned mutations with one updateOne, and emit its events.
    const jurisdiction = jurisdictions[index];
    const state = bankToJurisdictionState(bank, {
      jurisdiction,
      governmentControlled: false,
      ...policies.get(jurisdiction.anchorCountryId)!,
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
