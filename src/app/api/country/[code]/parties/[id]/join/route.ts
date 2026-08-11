import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { createNotification } from "@/lib/notifications";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { Character, GameConfig, GameState, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isSameCountry, resolveCountry } from "@/lib/api/sameCountry";
import {
  getPartySwitchCooldown,
  getPurgeRejoinBlock,
  isFreePartyMoveWindowOpen,
} from "@/lib/parties/antiAbuseGuards";
import { applyCharacterPartyJoin } from "@/lib/parties/applyCharacterPartyJoin";
import { getActingChairId } from "@/lib/parties/actingChair";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

// POST /api/country/[code]/parties/[id]/join — Join a political party
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const auth = authResult.user;

    const db = await getDb();

    const [party, gameConfig, currentTurn, gameState] = await Promise.all([
      findPartyBySequentialId(db, id, countryId),
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { firstJoinerBecomesPartyChair: 1 } }),
      getCurrentTurn(db),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { freePartyMovesOpen: 1 } }),
    ]);

    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdStr = String(party.sequentialId);

    // Block cross-country party membership first (before "already in party" check)
    const partyCountry = resolveCountry(party);
    const charCountry = resolveCountry(auth.character);
    if (!isSameCountry(auth.character, party)) {
      return NextResponse.json(
        {
          error: `This party is for ${partyCountry} characters only. Your character belongs to ${charCountry}.`,
        },
        { status: 403 }
      );
    }

    // Check if already in this party (safe now since we've verified country match)
    if (auth.character.party === partyIdStr) {
      return NextResponse.json(
        { error: "You are already a member of this party" },
        { status: 400 }
      );
    }

    const now = new Date();
    const switchCooldown = getPartySwitchCooldown(auth.character, now);
    // One free party move while the admin-controlled launch window is open:
    // if the 24h switch cooldown would block this move and the player has not yet
    // spent their free move, let it through once and stamp it consumed. Only open
    // (non-approval) joins carry the allowance, since that is the only path that
    // applies the membership change (and its consume stamp) inline.
    const freeMoveAvailable =
      isFreePartyMoveWindowOpen(gameState) &&
      party.membershipMode !== "approval" &&
      !auth.character.freePartyMoveUsedAt;
    const consumeFreePartyMove = !auth.isAdmin && !switchCooldown.ok && freeMoveAvailable;
    if (!auth.isAdmin && !switchCooldown.ok && !consumeFreePartyMove) {
      return NextResponse.json({ error: switchCooldown.error }, { status: 429 });
    }

    // Per-party block: a purged member cannot rejoin the party that purged them
    // until the cooldown elapses. Other parties are unaffected.
    const purgeBlock = getPurgeRejoinBlock(
      auth.character.purgeRejoinBlocks,
      partyIdStr,
      countryId,
      currentTurn
    );
    if (!auth.isAdmin && purgeBlock.blocked) {
      return NextResponse.json(
        {
          error: `You were expelled from ${party.name}. You can rejoin in ${purgeBlock.turnsRemaining} turn${purgeBlock.turnsRemaining === 1 ? "" : "s"}.`,
          turnsRemaining: purgeBlock.turnsRemaining,
        },
        { status: 429 }
      );
    }

    // Approval-gated parties (suggestion #72): instead of joining immediately,
    // file a pending request for a party leader to accept or decline. Mirrors
    // the coalition join-request flow. Idempotent — re-requesting is a no-op.
    if (party.membershipMode === "approval") {
      const alreadyRequested = (party.pendingJoinRequests ?? []).some(
        (r) => String(r.characterId) === String(auth.character._id)
      );
      if (!alreadyRequested) {
        await db.collection<PoliticalParty>("politicalParties").updateOne(
          { _id: party._id },
          {
            $push: {
              pendingJoinRequests: {
                characterId: auth.character._id,
                characterName: auth.character.name,
                requestedAt: now,
              },
            },
            $set: { updatedAt: now },
          }
        );

        // Notify the party leader (chair, or acting vice-chair when the seat is vacant).
        const leaderId = getActingChairId(party);
        if (leaderId) {
          const leaderChar = await db
            .collection<Character>("characters")
            .findOne({ _id: leaderId }, { projection: { userId: 1 } });
          if (leaderChar) {
            await createNotification({
              userId: leaderChar.userId,
              type: "party_join_request",
              title: `Join Request: ${auth.character.name}`,
              message: `${auth.character.name} has requested to join ${party.name}.`,
              metadata: {
                partyId: party.sequentialId,
                partyName: party.name,
                countryId,
                characterId: auth.character._id.toString(),
                characterName: auth.character.name,
              },
            });
          }
        }
      }

      return NextResponse.json({
        success: true,
        pending: true,
        message: alreadyRequested
          ? `You already have a pending request to join the ${party.name}.`
          : `Your request to join the ${party.name} has been submitted for the party leadership to review.`,
        party: {
          id: partyIdStr,
          name: party.name,
          abbreviation: party.abbreviation,
        },
      });
    }

    // Open membership (default): apply the join immediately.
    const { becameChair } = await applyCharacterPartyJoin({
      db,
      character: auth.character,
      party,
      countryId,
      currentTurn,
      now,
      autoChairWhenVacant: gameConfig?.firstJoinerBecomesPartyChair !== false,
      actor: auth.character,
      actorRole: "self",
      consumeFreePartyMove,
    });

    const message = becameChair
      ? `You have joined the ${party.name} and became ${getPartyRoleLabel(countryId, "chair")}`
      : `You have joined the ${party.name}`;

    return NextResponse.json({
      success: true,
      message,
      becameChair,
      party: {
        id: partyIdStr,
        name: party.name,
        abbreviation: party.abbreviation,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
