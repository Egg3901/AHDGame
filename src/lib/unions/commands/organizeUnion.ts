import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import type { CountryId } from "@/lib/constants/countries";
import { getFoundingFxRate } from "@/lib/corporations/foundingCosts";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { atomicallyDebitCharacterCash } from "@/lib/financialTxLog/atomicCashGuard";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isSameCountry } from "@/lib/api/sameCountry";
import {
  ORGANIZE_PERSONAL_COST,
  applyRecruit,
  isUnionLeadershipElectionOpen,
} from "@/lib/unions/unionEconomy";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";

export type OrganizeUnionResult =
  | {
      ok: true;
      status: 200;
      membershipPressure: number;
      electionOpen: boolean;
      cashSpent: number;
    }
  | { ok: false; status: number; error: string };

/**
 * Pre-leadership organizing: a character spends personal funds to raise an
 * unowned union's `membershipPressure`. Organizers earn the right to vote
 * once pressure crosses {@link LEADERSHIP_ELECTION_MIN_PRESSURE}.
 */
export async function organizeUnion(
  db: Db,
  character: Character,
  union: Union
): Promise<OrganizeUnionResult> {
  if (union.ownerId != null) {
    return { ok: false, status: 409, error: "This union already has a president." };
  }
  if (character.unionLeaderOf != null) {
    return { ok: false, status: 409, error: "You already lead a union." };
  }
  if (!isSameCountry(character, { countryId: union.countryId as CountryId })) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this union's country to help organize it.",
    };
  }
  // Union ban (player suggestion #93): organizing an outlawed union is blocked.
  if (await isUnionsBanned(db, union.countryId as CountryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  const forexEnabled = await isForexEnabled();
  const homeCurrency = getHomeCurrency(character);
  const fxRate = getFoundingFxRate(union.countryId, forexEnabled);
  const costLocal = Math.round(ORGANIZE_PERSONAL_COST * fxRate);

  const debit = await atomicallyDebitCharacterCash(
    db,
    character._id,
    homeCurrency,
    costLocal,
    forexEnabled
  );
  if (!debit.ok) {
    return {
      ok: false,
      status: 402,
      error: "Not enough personal funds to run an organize drive.",
    };
  }

  const now = new Date();
  const newPressure = applyRecruit(union.membershipPressure);
  const unionUpdate = await db.collection<Union>("unions").updateOne(
    {
      _id: union._id,
      ownerId: null,
      membershipPressure: union.membershipPressure,
    },
    { $set: { membershipPressure: newPressure, updatedAt: now } }
  );
  if (unionUpdate.modifiedCount === 0) {
    return { ok: false, status: 409, error: "Union state changed — please retry." };
  }

  await db.collection<UnionOrganizer>("unionOrganizers").updateOne(
    { unionId: union._id, characterId: character._id },
    {
      $inc: { organizeCount: 1, totalSpent: ORGANIZE_PERSONAL_COST },
      $setOnInsert: {
        unionId: union._id,
        characterId: character._id,
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true }
  );

  const electionOpen = isUnionLeadershipElectionOpen({
    ownerId: null,
    membershipPressure: newPressure,
  });

  return {
    ok: true,
    status: 200,
    membershipPressure: newPressure,
    electionOpen,
    cashSpent: costLocal,
  };
}
