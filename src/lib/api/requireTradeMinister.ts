import { NextResponse } from "next/server";
import type { ObjectId, Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { TRADE_MINISTER_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";

export type TradeMinisterAuth = {
  countryId: CountryId;
  /** Cabinet seat ID that authorized the action, or "head_of_government". */
  positionId: string;
  characterId: ObjectId;
  characterName: string;
};

export type TradeMinisterResult =
  { ok: true; auth: TradeMinisterAuth } | { ok: false; response: NextResponse };

/**
 * Authorize a trade action (e.g. a temporary embargo) on behalf of `countryId`.
 * Resolution: the configured trade-policy cabinet seat holder, else the head of
 * government. Mirrors `requireForeignMinister`. Returns a 403 NextResponse on
 * failure so handlers can `if (!result.ok) return result.response`.
 */
export async function requireTradeMinister(
  countryId: CountryId,
  actorCharacterId: ObjectId,
  actorCharacterName: string,
  db?: Db,
  isAdmin = false
): Promise<TradeMinisterResult> {
  const database = db ?? (await getDb());
  const positionId = TRADE_MINISTER_POSITION_BY_COUNTRY[countryId] ?? null;

  // Admins may act on behalf of any country's trade ministry (mirrors the
  // `isHolder || isAdmin` allowance across the cabinet system). No cabinet
  // action is charged for an admin override (handled by the route).
  if (isAdmin) {
    return {
      ok: true,
      auth: {
        countryId,
        positionId: "admin",
        characterId: actorCharacterId,
        characterName: actorCharacterName,
      },
    };
  }

  if (positionId) {
    const cabinetCol = await getCabinetMembersCollection(database);
    const member = await cabinetCol.findOne({ countryId, positionId });
    // An NPP-held seat (null characterId) is not owned by any player actor →
    // treat like a vacant seat and fall through to the head-of-gov fallback.
    if (member && member.characterId) {
      if (member.characterId.toString() === actorCharacterId.toString()) {
        return {
          ok: true,
          auth: {
            countryId,
            positionId,
            characterId: actorCharacterId,
            characterName: actorCharacterName,
          },
        };
      }
      return {
        ok: false,
        response: NextResponse.json(
          forbidden(`Only the ${countryId} trade minister may perform this action.`).toJson(),
          { status: 403 }
        ),
      };
    }
    // Seat configured but vacant → head-of-government fallback.
  }

  const hogCharId = await getHeadOfGovernmentCharacterId(database, countryId);
  if (hogCharId && hogCharId.toString() === actorCharacterId.toString()) {
    return {
      ok: true,
      auth: {
        countryId,
        positionId: "head_of_government",
        characterId: actorCharacterId,
        characterName: actorCharacterName,
      },
    };
  }

  return {
    ok: false,
    response: NextResponse.json(
      forbidden(
        `Only the ${countryId} trade minister or head of government may perform this action.`
      ).toJson(),
      { status: 403 }
    ),
  };
}
