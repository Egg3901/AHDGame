/**
 * GET /api/country/[code]/fomc — committee state for the FOMC panel: the board
 * roster, the active meeting (motion + live tally), the per-term rate-change
 * budget, and whether the viewer holds a seat / may nominate.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { RATE_CHANGES_PER_TERM } from "@/lib/db/types/centralBank";
import type { NPP } from "@/lib/db/types/npp";
import { tallyMeeting } from "@/lib/centralBank/fomc";

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
    const { bankId, memberCountries } = await getCentralBankScope(db, countryId);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank?.fomcBoard) return NextResponse.json({ hasCommittee: false });

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

    const meeting = bank.activeFomcMeeting ?? null;
    const votedSeatIds = new Set((meeting?.ballots ?? []).map((b) => b.seatId));
    const tally = meeting ? tallyMeeting(meeting.ballots, meeting.motion, board.length) : null;

    return NextResponse.json({
      hasCommittee: true,
      primeRate: bank.primeRate,
      rateChangesThisTerm: bank.rateChangesThisTerm ?? 0,
      rateChangesPerTerm: RATE_CHANGES_PER_TERM,
      canNominate,
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
