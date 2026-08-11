import { NextResponse } from "next/server";
import type { ObjectId, Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { FOREIGN_AFFAIRS_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";

export type ForeignMinisterAuth = {
  countryId: CountryId;
  /** Cabinet seat ID that authorized the action, or "head_of_government" for fallback. */
  positionId: string;
  /** Character ID confirmed as the foreign minister (or fallback head of gov). */
  characterId: ObjectId;
  characterName: string;
};

export type ForeignMinisterResult =
  { ok: true; auth: ForeignMinisterAuth } | { ok: false; response: NextResponse };

/**
 * Authorize a diplomatic action on behalf of `countryId` performed by `actorCharacterId`.
 *
 * Resolution order:
 *  1. If a foreign-affairs cabinet seat is configured for the country and a
 *     character holds it, that character must match the actor.
 *  2. Otherwise, fall back to the country's head of government (US president,
 *     UK/JP/DE prime minister/chancellor).
 *
 * Returns a 403 NextResponse on failure so route handlers can `if (!result.ok) return result.response`.
 */
export async function requireForeignMinister(
  countryId: CountryId,
  actorCharacterId: ObjectId,
  actorCharacterName: string,
  db?: Db
): Promise<ForeignMinisterResult> {
  const database = db ?? (await getDb());
  const fmPositionId = FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[countryId] ?? null;

  if (fmPositionId) {
    const cabinetCol = getCabinetMembersCollection(database);
    const member = await cabinetCol.findOne({ countryId, positionId: fmPositionId });
    // An NPP-held seat (null characterId) is not owned by any player actor →
    // treat like a vacant seat and fall through to the head-of-gov fallback.
    const holderCharacterId = member?.characterId ?? null;
    if (holderCharacterId) {
      if (holderCharacterId.toString() === actorCharacterId.toString()) {
        return {
          ok: true,
          auth: {
            countryId,
            positionId: fmPositionId,
            characterId: actorCharacterId,
            characterName: actorCharacterName,
          },
        };
      }
      return {
        ok: false,
        response: NextResponse.json(
          forbidden(`Only the ${countryId} foreign minister may perform this action.`).toJson(),
          { status: 403 }
        ),
      };
    }
    // Seat configured but vacant → fall through to head-of-government fallback.
  }

  // Head-of-government fallback. Presidential countries use the `officials`
  // collection; parliamentary countries (UK, JP, DE) keep the PM in
  // `governmentFormations` (with `parliamentaryGovernments` as legacy
  // fallback) — see headOfGovernment.ts for the canonical lookup.
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
        `Only the ${countryId} foreign minister or head of government may perform this action.`
      ).toJson(),
      { status: 403 }
    ),
  };
}
