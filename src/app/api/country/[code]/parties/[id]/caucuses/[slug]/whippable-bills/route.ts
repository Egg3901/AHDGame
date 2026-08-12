import { NextResponse } from "next/server";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug, listCaucusMemberships } from "@/lib/db/caucusLookup";
import { getCountryConfig, COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Bill, BillWhip } from "@/lib/db/types";
import {
  summarizePlayerWhips,
  type PlayerWhipSummaryEntry,
} from "@/lib/partyWhips/playerWhipSummary";
import { ObjectId } from "mongodb";
import { getGameState } from "@/lib/gameState";

interface RouteParams {
  params: Promise<{ code: string; id: string; slug: string }>;
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
  nppWhip: WhipSummary;
  playerWhip: PlayerWhipSummary;
  existingWhips: Array<{
    direction: string;
    attemptNumber: number;
    issuedByRole?: string;
    mode: "soft" | "hard";
  }>;
  canWhip: boolean;
}

function resolveCaucusWhipRole(
  whip: Pick<BillWhip, "issuedByRole" | "issuedByCharacterId">,
  chairId: ObjectId | null,
  viceChairId: ObjectId | null
): string | undefined {
  if (whip.issuedByRole === "chair") return "Chair";
  if (whip.issuedByRole === "viceChair") return "Vice Chair";
  if (whip.issuedByRole === "admin") return "Admin";
  if (whip.issuedByCharacterId && chairId?.equals(whip.issuedByCharacterId)) return "Chair";
  if (whip.issuedByCharacterId && viceChairId?.equals(whip.issuedByCharacterId))
    return "Vice Chair";
  return undefined;
}

// GET /api/country/[code]/parties/[id]/caucuses/[slug]/whippable-bills — Return active bills where caucus members can be whipped
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId, slug } = await params;
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
    const resolved = await findCaucusBySlug(db, countryId, partyIdStr, slug);
    if (!resolved) {
      return NextResponse.json(notFound("Caucus not found").toJson(), { status: 404 });
    }

    const { caucus } = resolved;
    const isChair = caucus.chairId?.equals(authData.character._id);
    if (!isChair && !authData.isAdmin) {
      return NextResponse.json(
        forbidden("Only the Caucus Chair can view caucus whip targets").toJson(),
        { status: 403 }
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const selectedStateId = searchParams.get("stateId");
    const now = new Date();
    const gameStateForBills = await getGameState(db);
    const currentTurnForBills = gameStateForBills?.currentTurn ?? 0;
    const stillOpen = (turnField: string, dateField: string) => ({
      $or: [
        { [turnField]: { $gt: currentTurnForBills } },
        { [turnField]: { $exists: false }, [dateField]: { $gt: now } },
      ],
    });

    const memberships = await listCaucusMemberships(db, caucus._id);
    const caucusCharacterIds = memberships
      .filter((membership) => membership.memberType === "character")
      .map((membership) => membership.memberId);
    const caucusNppIds = memberships
      .filter((membership) => membership.memberType === "npp")
      .map((membership) => membership.memberId);

    if (caucusCharacterIds.length === 0 && caucusNppIds.length === 0) {
      return NextResponse.json(selectedStateId ? { stateSenate: [] } : {});
    }

    const activeBills = selectedStateId
      ? await db
          .collection<Bill>("bills")
          .find({
            $and: [
              {
                stateId: selectedStateId,
                currentChamber: "stateSenate",
              },
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
                  // State bills don't enter override_shugiin — that's federal-JP only.
                ],
              },
            ],
          })
          .toArray()
      : await db
          .collection<Bill>("bills")
          .find({
            $and: [
              {
                $or: [
                  { countryId },
                  {
                    countryId: { $exists: false },
                    currentChamber: {
                      $in: [
                        getCountryConfig(countryId).legislature.lowerChamber.key,
                        ...(getCountryConfig(countryId).upperElectionSystem
                          ? ([getCountryConfig(countryId).legislature.upperChamber?.key].filter(
                              Boolean
                            ) as string[])
                          : []),
                      ],
                    },
                  },
                ],
              },
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
                  // JP Shūgiin override reuses the main votingEndsAt;
                  // currentChamber is "shugiin" so the chamber loop routes correctly.
                  {
                    status: "override_shugiin",
                    ...stillOpen("votingEndsOnTurn", "votingEndsAt"),
                  },
                ],
              },
            ],
          })
          .toArray();

    const billIds = activeBills.map((bill) => bill._id);
    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType: "bill",
        targetId: { $in: billIds },
        partyId: partyIdStr,
        issuedBy: "caucus",
        caucusId: caucus._id,
      })
      .toArray();

    const nppWhips = new Map<string, BillWhip[]>();
    const characterWhips = new Map<string, BillWhip[]>();
    for (const whip of existingWhips) {
      const key = `${whip.targetId}_${whip.chamber}`;
      const target = whip.audience === "character" ? characterWhips : nppWhips;
      if (!target.has(key)) target.set(key, []);
      target.get(key)!.push(whip);
    }

    if (selectedStateId) {
      const items: BillWhipItem[] = [];
      for (const bill of activeBills) {
        const chamber = "stateSenate";
        const whipKey = `${bill._id}_${chamber}`;
        const npp = nppWhips.get(whipKey) ?? [];
        const character = characterWhips.get(whipKey) ?? [];
        const nppSummary: WhipSummary = {
          existingWhips: npp.map((whip) => ({
            direction: whip.direction,
            attemptNumber: whip.attemptNumber,
            issuedByRole: resolveCaucusWhipRole(whip, caucus.chairId, caucus.viceChairId),
            mode: whip.mode ?? "hard",
          })),
          canWhip: npp.length < 2,
        };
        const playerSummary: PlayerWhipSummary = {
          existingWhips: summarizePlayerWhips(character, {
            chairId: caucus.chairId,
            viceChairId: caucus.viceChairId,
          }),
          canWhip: character.length < 2,
        };
        items.push({
          bill: {
            id: bill._id.toString(),
            title: bill.title,
            status: bill.status,
          },
          nppWhip: nppSummary,
          playerWhip: playerSummary,
          existingWhips: nppSummary.existingWhips,
          canWhip: nppSummary.canWhip,
        });
      }

      return NextResponse.json({ stateSenate: items });
    }

    const result: Record<string, BillWhipItem[]> = {};
    const config = getCountryConfig(countryId);
    const lowerKey = config.legislature.lowerChamber.key;
    const upperKey = config.upperElectionSystem
      ? (config.legislature.upperChamber?.key ?? null)
      : null;
    const chamberKeys = upperKey ? [upperKey, lowerKey] : [lowerKey];
    for (const chamberKey of chamberKeys) result[chamberKey] = [];

    for (const bill of activeBills) {
      const activeChambers: string[] = [];
      if (bill.status === "veto_override") {
        activeChambers.push(...chamberKeys);
      } else if (bill.currentChamber && chamberKeys.includes(bill.currentChamber)) {
        activeChambers.push(bill.currentChamber);
      }

      for (const chamber of activeChambers) {
        const whipKey = `${bill._id}_${chamber}`;
        const npp = nppWhips.get(whipKey) ?? [];
        const character = characterWhips.get(whipKey) ?? [];
        const nppSummary: WhipSummary = {
          existingWhips: npp.map((whip) => ({
            direction: whip.direction,
            attemptNumber: whip.attemptNumber,
            issuedByRole: resolveCaucusWhipRole(whip, caucus.chairId, caucus.viceChairId),
            mode: whip.mode ?? "hard",
          })),
          canWhip: npp.length < 2,
        };
        const playerSummary: PlayerWhipSummary = {
          existingWhips: summarizePlayerWhips(character, {
            chairId: caucus.chairId,
            viceChairId: caucus.viceChairId,
          }),
          canWhip: character.length < 2,
        };

        result[chamber].push({
          bill: {
            id: bill._id.toString(),
            title: bill.title,
            status: bill.status,
          },
          nppWhip: nppSummary,
          playerWhip: playerSummary,
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
