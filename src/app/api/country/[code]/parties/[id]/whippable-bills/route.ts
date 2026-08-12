// src/app/api/parties/[id]/whippable-bills/route.ts
import { NextResponse } from "next/server";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getCountryConfig, COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { resolveWhipIssuerRole } from "@/lib/congress/billWhipPanelData";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getGameState } from "@/lib/gameState";
import type { Bill, BillWhip, ElectedOfficial } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  summarizePlayerWhips,
  type PlayerWhipSummaryEntry,
} from "@/lib/partyWhips/playerWhipSummary";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

interface WhipSummary {
  existingWhips: Array<{
    direction: string;
    attemptNumber: number;
    issuedByRole?: string;
    mode: "soft" | "hard";
  }>;
  canWhip: boolean;
}

interface PlayerWhipSummary {
  existingWhips: PlayerWhipSummaryEntry[];
  canWhip: boolean;
}

interface BillWhipItem {
  bill: { id: string; title: string; status: string };
  // Per-audience whip status
  nppWhip: WhipSummary;
  playerWhip: PlayerWhipSummary;
  // Back-compat aliases — mirror nppWhip.*; remove after consumer audit
  existingWhips: Array<{ direction: string; attemptNumber: number; issuedByRole?: string }>;
  canWhip: boolean;
}

// GET /api/country/[code]/parties/[id]/whippable-bills — Return active federal bills where the party has legislators
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
/**
 * GET /api/parties/[id]/whippable-bills
 * Returns federal bills where any party member (NPP or character) is a legislator,
 * with per-audience whip status so the UI can gate the FOR/AGAINST buttons correctly.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const authData = authResult.user;

    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    const characterId = authData.character._id;
    const isChair = party.chairId?.equals(characterId);
    const isViceChair = party.viceChairId?.equals(characterId);
    const isAdmin = authData.isAdmin;
    if (!isChair && !isViceChair && !isAdmin) {
      return NextResponse.json(
        forbidden("Only the Chair or Vice Chair can view whippable bills").toJson(),
        { status: 403 }
      );
    }

    const now = new Date();
    const gameStateForBills = await getGameState(db);
    const currentTurnForBills = gameStateForBills?.currentTurn ?? 0;
    const stillOpen = (turnField: string, dateField: string) => ({
      $or: [
        { [turnField]: { $gt: currentTurnForBills } },
        { [turnField]: { $exists: false }, [dateField]: { $gt: now } },
      ],
    });

    const countryLowerKey = getCountryConfig(countryId).legislature.lowerChamber.key;
    const countryUpperKey = getCountryConfig(countryId).upperElectionSystem
      ? (getCountryConfig(countryId).legislature.upperChamber?.key ?? null)
      : null;
    const countryChambers = countryUpperKey
      ? [countryLowerKey, countryUpperKey]
      : [countryLowerKey];
    const billCountryFilter = {
      $or: [
        { countryId },
        { countryId: { $exists: false }, currentChamber: { $in: countryChambers } },
      ],
    };

    const activeBills = await db
      .collection<Bill>("bills")
      .find({
        $and: [
          billCountryFilter,
          {
            $or: [
              { status: "active", ...stillOpen("votingEndsOnTurn", "votingEndsAt") },
              {
                status: "active_other",
                ...stillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
              },
              {
                // Whippable while EITHER chamber is open. Nested, not spread: stillOpen
                // returns an $or object on the turn branch and a flat one otherwise.
                status: "active_both",
                $or: [
                  stillOpen("votingEndsOnTurn", "votingEndsAt"),
                  stillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
                ],
              },
              {
                status: "veto_override",
                ...stillOpen("overrideVotingEndsOnTurn", "overrideVotingEndsAt"),
              },
              // JP Shūgiin override (Sangiin rejection) reuses the main votingEndsAt;
              // the override vote happens in the Shūgiin only.
              { status: "override_shugiin", ...stillOpen("votingEndsOnTurn", "votingEndsAt") },
            ],
          },
        ],
      })
      .toArray();

    const config = getCountryConfig(countryId);
    const upperKey = config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? null)
      : null;
    const lowerKey = config.legislature.lowerChamber.key;
    const chamberKeys = upperKey ? [upperKey, lowerKey] : [lowerKey];

    // Resolve each chamber key to the office type its members are stored under
    // (CN: "npc" → "npcDelegate"; identity for every other country). Querying the
    // raw chamber key found zero CN delegates, so the CN whip panel showed no
    // bills at all.
    const officeTypeByChamberKey = new Map(
      chamberKeys.map((key) => [key, getOfficeTypeForChamber(countryId, key)])
    );

    // Union of NPP and character officials so we surface bills for either audience.
    // Country-scoped because party sequentialIds collide across countries and some
    // office types (e.g. "senate") are shared between countries (bug #0699).
    const allOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId,
        party: partyIdStr,
        officeType: { $in: [...officeTypeByChamberKey.values()] },
      })
      .toArray();

    if (allOfficials.length === 0) {
      const emptyResult: Record<string, BillWhipItem[]> = {};
      for (const key of chamberKeys) emptyResult[key] = [];
      return NextResponse.json(emptyResult);
    }

    const billIds = activeBills.map((b) => b._id);
    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType: "bill",
        targetId: { $in: billIds },
        partyId: partyIdStr,
        issuedBy: "nationalParty",
      })
      .toArray();

    // Group whips by (bill, chamber, audience). Legacy rows without audience are "npp".
    const nppWhips = new Map<string, BillWhip[]>();
    const charWhips = new Map<string, BillWhip[]>();
    for (const w of existingWhips) {
      const key = `${w.targetId}_${w.chamber}`;
      const target = w.audience === "character" ? charWhips : nppWhips;
      if (!target.has(key)) target.set(key, []);
      target.get(key)!.push(w);
    }

    const result: Record<string, BillWhipItem[]> = {};
    for (const key of chamberKeys) result[key] = [];

    for (const bill of activeBills) {
      const activeChambers: string[] = [];
      if (bill.status === "veto_override") {
        activeChambers.push(...chamberKeys);
      } else if (bill.currentChamber && chamberKeys.includes(bill.currentChamber)) {
        activeChambers.push(bill.currentChamber);
      }

      for (const chamber of activeChambers) {
        const hasPartyMembersInChamber = allOfficials.some(
          (o) => o.officeType === officeTypeByChamberKey.get(chamber)
        );
        if (!hasPartyMembersInChamber) continue;

        const whipKey = `${bill._id}_${chamber}`;
        const npp = nppWhips.get(whipKey) ?? [];
        const char = charWhips.get(whipKey) ?? [];

        const nppSummary: WhipSummary = {
          existingWhips: npp.map((w) => ({
            direction: w.direction,
            attemptNumber: w.attemptNumber,
            issuedByRole: resolveWhipIssuerRole(w, party),
            mode: w.mode ?? "hard",
          })),
          canWhip: npp.length < 2,
        };
        const playerSummary: PlayerWhipSummary = {
          existingWhips: summarizePlayerWhips(char, party),
          canWhip: char.length < 1,
        };

        result[chamber].push({
          bill: {
            id: bill._id.toString(),
            title: bill.title,
            status: bill.status,
          },
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          // Back-compat — same as nppWhip.*
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
