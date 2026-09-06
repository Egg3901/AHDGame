/**
 * GET /api/country/[code]/fomc — committee state for the FOMC panel: the board
 * roster, the active meeting (motion + live tally), the per-term rate-change
 * budget, recent resolved sessions (how the votes went), the next scheduled
 * session, and whether the viewer holds a seat / may nominate.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COMMAND_CEILING, scheduledMarketizationLevel } from "@/lib/constants/commandEconomy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getGameState } from "@/lib/gameState";
import { resolveJurisdiction } from "@/lib/monetaryGovernance/jurisdiction";
import { bankToJurisdictionState } from "@/lib/monetaryGovernance/governanceShell";
import { allowedActionsFor } from "@/lib/monetaryGovernance/rules/allowedActions";
import { isBankGovernmentControlledLive } from "@/lib/centralBank/governance";
import type { CentralBank, FomcNomination } from "@/lib/db/types/centralBank";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import {
  RATE_CHANGES_PER_TERM,
  FOMC_TERM_TURNS,
  FOMC_MEETING_INTERVAL_TURNS,
} from "@/lib/db/types/centralBank";
import type { NPP } from "@/lib/db/types/npp";
import type { ElectedOfficial } from "@/lib/db/types";
import { majorityThreshold, tallyMeeting } from "@/lib/centralBank/fomc";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

/** Resolved sessions returned to the panel (newest last in storage). */
const MEETING_HISTORY_LIMIT = 10;

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const jurisdiction = await resolveJurisdiction(db, countryId);
    const { institutionId: bankId, memberCountryIds: memberCountries } = jurisdiction;
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank?.fomcBoard) return NextResponse.json({ hasCommittee: false, governance: null });

    const board = bank.fomcBoard;
    const viewerId = auth.character._id;
    const viewerSeat = board.find(
      (s) => s.occupantType === "player" && s.characterId?.equals(viewerId)
    );

    // NPP seats store nppId with characterName null at seed/refill; resolve names
    // in one batch so the Board of Governors doesn't render every technocrat as Vacant.
    const nppIds = board
      .filter((s) => s.occupantType === "npp" && s.nppId && !s.characterName)
      .map((s) => s.nppId!);
    const nppNameById = new Map<string, string>();
    if (nppIds.length > 0) {
      const npps = await db
        .collection<NPP>("npps")
        .find({ _id: { $in: nppIds } }, { projection: { name: 1 } })
        .toArray();
      for (const npp of npps) nppNameById.set(npp._id.toString(), npp.name);
    }

    const callerCountryId = auth.character.countryId as CountryId;
    const execOffice = COUNTRY_CONFIGS[callerCountryId]?.officeTypes.find((o) => o.isExecutive);
    const callerOffice = auth.character.currentOffice;
    const canNominate = Boolean(
      execOffice &&
      memberCountries.includes(callerCountryId) &&
      callerOffice &&
      callerOffice.type === execOffice.key
    );

    // Active Senate confirmations for this bank, and whether the viewer is a
    // senator who may vote on them. This is the "Senate confirms and it actually
    // works" surface — player senators cast ballots via the vote route.
    const [activeNoms, viewerSenator] = await Promise.all([
      db
        .collection<FomcNomination>("fomcNominations")
        .find({ countryId, status: "active" })
        .sort({ proposedAt: 1 })
        .toArray(),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ characterId: viewerId, officeType: "senate", countryId }),
    ]);
    const viewerIsSenator = Boolean(viewerSenator);
    const seatLabelById = new Map(board.map((s) => [s.seatId, s.isChair ? "Chair" : s.seatId]));
    const nominations = activeNoms.map((n) => ({
      id: n._id.toString(),
      seatId: n.seatId,
      seatLabel: n.makeChair ? "Chair" : (seatLabelById.get(n.seatId) ?? n.seatId),
      makeChair: n.makeChair === true,
      nomineeName: n.nomineeName,
      occupantType: n.occupantType,
      votesFor: n.votesFor ?? 0,
      votesAgainst: n.votesAgainst ?? 0,
      votesAbstain: n.votesAbstain ?? 0,
      votingEndsOnTurn: n.votingEndsOnTurn ?? null,
      viewerHasVoted: viewerId.toString() in (n.votes ?? {}),
    }));

    const meeting = bank.activeFomcMeeting ?? null;
    const votedSeatIds = new Set((meeting?.ballots ?? []).map((b) => b.seatId));
    const tally = meeting ? tallyMeeting(meeting.ballots, meeting.motion, board.length) : null;

    // Scheduling + budget context so players can see when sessions happen and
    // where their per-term rate-change budget went (ticket #1184).
    const currentTurn = await getCurrentTurn(db);
    const nextMeetingAtTurn =
      meeting === null
        ? typeof bank.lastFomcMeetingTurn === "number"
          ? bank.lastFomcMeetingTurn + FOMC_MEETING_INTERVAL_TURNS
          : currentTurn // No session yet on record: one opens on the next turn.
        : null;
    const termEndsAtTurn =
      typeof bank.fomcTermStartedAtTurn === "number"
        ? bank.fomcTermStartedAtTurn + FOMC_TERM_TURNS
        : null;
    // Machine-driven eligibility: what this viewer may do right now, why not,
    // the next deadline, and the grid of rates a direct set may pick.
    const fxDoc = await db
      .collection<ExchangeRate>("exchangeRates")
      .findOne({ countryId }, { projection: { fxRegime: 1, capitalControls: 1 } });
    const gameConfig = await db
      .collection<{ _id: string; commandEconomyEnabled?: boolean }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
    const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;
    // Per-country command gate (ticket #1270): the global flag alone blocked
    // EVERY bank, including the US Fed. Mirror the central-bank rate POST gate:
    // resolve this country's marketization level from the persisted value,
    // falling back to the era schedule.
    const gameState = await getGameState(db);
    const rateBudget = commandEconomyEnabled
      ? await db
          .collection<FederalBudget>("federalBudget")
          .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, {
            projection: { "economicFactors.marketizationLevel": 1 },
          })
      : null;
    const persistedLevel = rateBudget?.economicFactors?.marketizationLevel;
    const resolvedLevel =
      typeof persistedLevel === "number" && Number.isFinite(persistedLevel)
        ? persistedLevel
        : scheduledMarketizationLevel(countryId, gameState?.currentYear);
    const governanceState = bankToJurisdictionState(bank, {
      jurisdiction,
      governmentControlled: await isBankGovernmentControlledLive(
        bank,
        jurisdiction.anchorCountryId
      ),
      fxCommitment: fxDoc
        ? {
            regime: fxDoc.fxRegime ?? "float",
            capitalControls: fxDoc.capitalControls === true,
          }
        : null,
      commandEconomy: commandEconomyEnabled && resolvedLevel < COMMAND_CEILING,
    });
    const isAdmin = (auth as { isAdmin?: boolean }).isAdmin === true;
    const viewerRole = isAdmin
      ? "admin"
      : viewerSeat?.isChair
        ? "chair"
        : viewerSeat
          ? "member"
          : canNominate
            ? "executive"
            : "outsider";
    const governanceView = allowedActionsFor(
      governanceState,
      {
        kind: isAdmin ? "admin" : viewerSeat?.isChair ? "chair" : "governor",
        ...(viewerSeat ? { seatId: viewerSeat.seatId } : {}),
        characterId: viewerId.toString(),
        countryId: callerCountryId,
      },
      { turn: currentTurn, now: Date.now(), currentYear: null }
    );
    const governance = {
      institutionId: bankId,
      currency: jurisdiction.currency,
      memberCountryIds: memberCountries,
      viewerRole,
      allowedActions: governanceView.actions,
      nextDeadline: governanceView.nextDeadline,
      normalizedRateChoices: governanceView.normalizedRateChoices,
      primeRateOnGrid: governanceView.primeRateOnGrid,
    };

    const history = (bank.fomcMeetingHistory ?? []).slice(-MEETING_HISTORY_LIMIT).map((m) => {
      const t = tallyMeeting(m.ballots, m.motion, board.length);
      return {
        motion: m.motion,
        proposedDelta: m.proposedDelta,
        result: m.result,
        openedAtTurn: m.openedAtTurn,
        resolvedAtTurn: m.resolvedAtTurn ?? null,
        agree: t.agree,
        disagree: t.disagree,
        abstain: t.abstain,
      };
    });

    return NextResponse.json({
      hasCommittee: true,
      governance,
      primeRate: bank.primeRate,
      rateChangesThisTerm: bank.rateChangesThisTerm ?? 0,
      rateChangesPerTerm: RATE_CHANGES_PER_TERM,
      currentTurn,
      nextMeetingAtTurn,
      termEndsAtTurn,
      /** Votes needed to carry a motion: strict majority of the FULL board. */
      majorityNeeded: majorityThreshold(board.length),
      meetingHistory: history,
      canNominate,
      viewerIsSenator,
      nominations,
      viewerSeatId: viewerSeat?.seatId ?? null,
      board: board.map((s) => ({
        seatId: s.seatId,
        isChair: s.isChair,
        occupantType: s.occupantType,
        name:
          s.characterName ??
          (s.nppId ? nppNameById.get(s.nppId.toString()) : undefined) ??
          "Vacant",
        alignment: s.alignment,
        termExpiresAtTurn: s.termExpiresAtTurn,
      })),
      meeting: meeting
        ? {
            motion: meeting.motion,
            proposedDelta: meeting.proposedDelta,
            playerVoteDeadline: meeting.playerVoteDeadline,
            resolvesOnTurn: meeting.resolvesOnTurn,
            agree: tally?.agree ?? 0,
            disagree: tally?.disagree ?? 0,
            needed: tally?.needed ?? 0,
            viewerHasVoted: viewerSeat ? votedSeatIds.has(viewerSeat.seatId) : false,
            viewerCanVote:
              Boolean(viewerSeat) && !(viewerSeat && votedSeatIds.has(viewerSeat.seatId)),
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
