import { z } from "zod";
import { getCabinetEligibleOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { assertSameCountry } from "@/lib/api/sameCountry";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { createNotification } from "@/lib/notifications";
import type { Db } from "mongodb";
import { type CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  getCabinetEligibleChamberLabel,
  requireCurrentPrimeMinister,
} from "@/lib/countries/uk/cabinetEligibility";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";

const whipTargetSchema = z.object({
  characterId: z.string().regex(/^[a-f0-9]{24}$/, "Invalid character ID"),
});

// ── Whip withdrawal (party suspension + reselection risk) ────────────────────

/** Player-facing reselection standing derived from whip state. */
export type ReselectionRisk = "standard" | "elevated";

export function reselectionRiskFor(official: { whipWithdrawn?: boolean | null }): ReselectionRisk {
  return official.whipWithdrawn ? "elevated" : "standard";
}

interface WhipTarget {
  targetChar: Character;
  official: ElectedOfficial;
}

/**
 * Resolve and validate a whip-withdrawal target. Shared by withdraw/restore so
 * both agree on who the PM may suspend: a player MP of the governing party
 * holding a lower-chamber seat, who is neither the PM nor a serving minister
 * (ministers leave via fire/resignation, not suspension).
 */
async function resolveWhipTarget(
  db: Db,
  countryId: CountryId,
  characterIdStr: string
): Promise<WhipTarget> {
  const targetChar = await db
    .collection<Character>("characters")
    .findOne({ _id: new ObjectId(characterIdStr) });
  if (!targetChar) {
    throw notFound("Character");
  }
  if (!targetChar.userId) {
    throw forbidden("The whip can only be withdrawn from player MPs");
  }
  assertSameCountry(
    targetChar,
    { countryId },
    { message: "The whip can only be withdrawn from MPs of this country" }
  );

  const eligibleOfficeTypes = getCabinetEligibleOfficeTypes(countryId);
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: targetChar._id,
    officeType: { $in: eligibleOfficeTypes },
    countryId,
  });
  if (!official) {
    throw forbidden(
      `The whip can only be withdrawn from MPs holding a seat in the ${getCabinetEligibleChamberLabel(countryId)}`
    );
  }

  const govFormation = await getGovernmentFormationsCollection(db).findOne({
    _id: countryId,
  });
  if (!govFormation) {
    throw forbidden("No active government");
  }
  if (govFormation.pmCharacterId && targetChar._id.equals(govFormation.pmCharacterId)) {
    throw forbidden("The whip cannot be withdrawn from the Prime Minister");
  }
  // The PM suspends rebels from their own parliamentary party, not the opposition.
  const pmChar = govFormation.pmCharacterId
    ? await db.collection<Character>("characters").findOne({ _id: govFormation.pmCharacterId })
    : null;
  const governingParty = govFormation.governingPartyId ?? pmChar?.party ?? null;
  const targetParty = official.party ?? targetChar.party ?? null;
  if (!governingParty || targetParty !== governingParty) {
    throw forbidden("The whip can only be withdrawn from MPs of the governing party");
  }

  const ministerSeat = await getCabinetMembersCollection(db).findOne({
    countryId,
    characterId: targetChar._id,
  });
  if (ministerSeat) {
    throw forbidden(
      "Serving ministers leave through the cabinet fire flow, not whip withdrawal. Fire or await resignation first."
    );
  }

  return { targetChar, official };
}

/**
 * Withdraw the whip (epic #856, ticket #859): PM-only party suspension.
 *
 * The MP keeps their seat but sits as an independent with elevated reselection
 * risk, and is barred from cabinet appointment until restored. The guarded
 * `updateOne` filter is the concurrency lock: a repeat or raced withdrawal
 * matches nothing and resolves to a 409, never a double write.
 */
export async function withdrawWhipHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, whipTargetSchema);
    if (!parsed.success) {
      throw badRequest(parsed.error);
    }

    const db = await getDb();
    const { pmCharacter } = await requireCurrentPrimeMinister(
      db,
      countryId,
      auth.user.userId,
      "Only the Prime Minister can withdraw the whip"
    );
    const { targetChar, official } = await resolveWhipTarget(
      db,
      countryId,
      parsed.data.characterId
    );

    const now = new Date();
    const updated = await db.collection<ElectedOfficial>("electedOfficials").updateOne(
      { _id: official._id, whipWithdrawn: { $ne: true } },
      {
        $set: {
          whipWithdrawn: true,
          whipWithdrawnAt: now,
          whipWithdrawnByCharacterId: pmCharacter._id,
          updatedAt: now,
        },
      }
    );
    if (updated.matchedCount === 0) {
      const current = await db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ _id: official._id });
      if (current?.whipWithdrawn) {
        throw conflict("The whip has already been withdrawn from this MP");
      }
      throw notFound("This MP no longer holds a seat");
    }

    if (targetChar.userId) {
      await createNotification({
        userId: targetChar.userId,
        title: "Whip withdrawn",
        message:
          "The Prime Minister has withdrawn the whip. You sit as an independent with elevated reselection risk until it is restored.",
        type: "system",
        metadata: { recipientCharacterId: targetChar._id.toString() },
      });
    }

    return NextResponse.json({
      success: true,
      reselectionRisk: "elevated" as ReselectionRisk,
      message: `The whip has been withdrawn from ${targetChar.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Restore a withdrawn whip. PM-only; mirrors the withdraw lock so a repeat or
 * raced restore resolves to a 409.
 */
export async function restoreWhipHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, whipTargetSchema);
    if (!parsed.success) {
      throw badRequest(parsed.error);
    }

    const db = await getDb();
    await requireCurrentPrimeMinister(
      db,
      countryId,
      auth.user.userId,
      "Only the Prime Minister can restore the whip"
    );
    const { targetChar, official } = await resolveWhipTarget(
      db,
      countryId,
      parsed.data.characterId
    );

    const now = new Date();
    const updated = await db.collection<ElectedOfficial>("electedOfficials").updateOne(
      { _id: official._id, whipWithdrawn: true },
      {
        $set: { updatedAt: now },
        $unset: { whipWithdrawn: "", whipWithdrawnAt: "", whipWithdrawnByCharacterId: "" },
      }
    );
    if (updated.matchedCount === 0) {
      const current = await db
        .collection<ElectedOfficial>("electedOfficials")
        .findOne({ _id: official._id });
      if (current && !current.whipWithdrawn) {
        throw conflict("This MP currently holds the whip");
      }
      throw notFound("This MP no longer holds a seat");
    }

    if (targetChar.userId) {
      await createNotification({
        userId: targetChar.userId,
        title: "Whip restored",
        message:
          "The Prime Minister has restored the whip. You sit with the parliamentary party again.",
        type: "system",
        metadata: { recipientCharacterId: targetChar._id.toString() },
      });
    }

    return NextResponse.json({
      success: true,
      reselectionRisk: "standard" as ReselectionRisk,
      message: `The whip has been restored to ${targetChar.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * List MPs currently serving a whip withdrawal. PM-only; drives the
 * player-facing whip panel on the cabinet page.
 */
export async function getWhipWithdrawnHandler(_request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    await requireCurrentPrimeMinister(
      db,
      countryId,
      auth.user.userId,
      "Only the Prime Minister can view whip suspensions"
    );

    const withdrawn = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId, whipWithdrawn: true })
      .toArray();

    return NextResponse.json({
      success: true,
      withdrawn: withdrawn.map((official) => ({
        characterId: official.characterId?.toString() ?? null,
        characterName: official.characterName ?? "Unknown",
        constituency: official.constituency ?? official.state ?? null,
        party: official.party ?? null,
        whipWithdrawnAt: official.whipWithdrawnAt?.toISOString() ?? null,
        reselectionRisk: reselectionRiskFor(official),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
