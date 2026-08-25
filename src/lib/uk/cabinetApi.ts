import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";
import { getCabinetEligibleOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { assertSameCountry } from "@/lib/api/sameCountry";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { getOfficeLabel } from "@/lib/utils/politics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial, CareerEvent, PoliticalParty } from "@/lib/db/types";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { getGameTime } from "@/lib/time/gameTime";
import type { OfficeType } from "@/lib/db/types/character";
import { getUKCabinetCooldownsCollection } from "@/lib/db/collections/ukGovernment";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import {
  getCabinetSettingsCollection,
  resetCabinetSettingCooldowns,
} from "@/lib/db/collections/cabinetSettings";
import {
  getCabinetEligibleChamberLabel,
  getEligibleCabinetCharacters,
  requireCurrentPrimeMinister,
} from "./cabinetEligibility";
import { applyConfidenceEventToGov } from "./confidence/confidenceGaugeStore";
import { GREAT_OFFICE_POSITION_IDS } from "./confidence/confidenceGauge";

const appointSchema = z.object({
  positionId: z.string(),
  characterId: z.string().regex(/^[a-f0-9]{24}$/, "Invalid character ID"),
});

const fireSchema = z.object({
  positionId: z.string(),
});

// A cabinet seat can only be (re)appointed once every COOLDOWN_TURNS turns. The
// lock is set when a minister is APPOINTED and persists through firing — firing
// itself is unrestricted and imposes no cooldown.
const COOLDOWN_TURNS = 24;

// Territorial secretary positions with advocacy toggles, keyed by country
const TERRITORIAL_POSITIONS_BY_COUNTRY: Partial<Record<CountryId, string[]>> = {
  UK: ["northern_ireland", "scotland", "wales"],
};

export async function getCabinetCharactersHandler(_request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const { pmCharacterId } = await requireCurrentPrimeMinister(
      db,
      countryId,
      auth.user.userId,
      "Only the Prime Minister can view eligible cabinet candidates"
    );

    return NextResponse.json({
      success: true,
      characters: await getEligibleCabinetCharacters(db, countryId, pmCharacterId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function appointCabinetMemberHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success) {
      throw badRequest(parsed.error);
    }

    const { positionId, characterId: characterIdStr } = parsed.data;
    const characterId = new ObjectId(characterIdStr);

    const db = await getDb();
    const { pmCharacterId, pmCharacter } = await requireCurrentPrimeMinister(
      db,
      countryId,
      auth.user.userId,
      "Only the Prime Minister can appoint cabinet ministers"
    );

    const positions = getCabinetPositions(countryId);
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) {
      throw badRequest("Invalid cabinet position");
    }

    // Era gating: a seat outside its yearEnabled/yearRetired range cannot be
    // filled (hidden client-side too, but the server is the authority).
    if (!isSeatActive(position, await getLiveGameYear(db))) {
      throw badRequest("This cabinet position does not exist in the current era");
    }

    // The head-of-government seat (CN Premier, IE Taoiseach) is auto-assigned
    // from the sitting PM via the Appoint-Premier flow — never the cabinet flow.
    if (position.isHeadOfGovernment) {
      throw forbidden(
        "The head of government is seated through the Appoint Premier/Prime Minister flow, not cabinet appointments."
      );
    }

    const targetChar = await db.collection<Character>("characters").findOne({ _id: characterId });
    if (!targetChar) {
      throw notFound("Character");
    }

    if (!targetChar.userId) {
      throw forbidden("Can only appoint player characters to cabinet");
    }

    assertSameCountry(
      targetChar,
      { countryId },
      {
        message: "Cabinet ministers must be from the same country as the government",
      }
    );

    // Government type drives the eligibility rule. Read runtime governmentType
    // (not the seed config) so a post-Stage-4 conversion takes effect
    // immediately. (`config` is still needed for `isBannedParty`, which carries
    // the seed-time per-country banned-list config.)
    const config = COUNTRY_CONFIGS[countryId];
    const runtime = await getCountryState(db, countryId);
    const isOps = runtime.governmentType === "onePartyState";

    const eligibleOfficeTypes = getCabinetEligibleOfficeTypes(countryId);
    const lowerOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: targetChar._id,
      officeType: { $in: eligibleOfficeTypes },
      countryId,
    });
    // Non-OPS governments require a legislative seat. One Party States may
    // appoint any (non-banned-party) player citizen, so the seat check is
    // skipped. See docs/superpowers/specs/2026-06-05-ops-cabinet-any-player-design.md.
    if (!isOps && !lowerOfficial) {
      throw forbidden(
        `Cabinet ministers must hold a seat in the ${getCabinetEligibleChamberLabel(countryId)}`
      );
    }

    // One-party-state guard: banned-party characters cannot be appointed to
    // cabinet, even when the seat requirement is lifted.
    if (isOps) {
      const appointeePartySeqId = parseInt(targetChar.party ?? "0", 10);
      const appointeeParty = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ sequentialId: appointeePartySeqId, countryId });
      if (isBannedParty(config, appointeeParty)) {
        throw forbidden("Members of banned parties cannot be appointed to cabinet.");
      }
    }

    if (targetChar._id.equals(pmCharacterId)) {
      throw forbidden("The Prime Minister cannot appoint themselves to a cabinet position");
    }

    const existingMember = await getCabinetMembersCollection(db).findOne({
      countryId,
      positionId,
    });
    if (existingMember) {
      return NextResponse.json({ error: "This position is already filled" }, { status: 409 });
    }

    const cooldown = await getUKCabinetCooldownsCollection(db).findOne({
      countryId,
      positionId,
    });
    // Turn-first cooldown check (drift-immune, freezes on pause) with a Date
    // fallback for legacy cooldowns lacking a turn mirror. The lock reflects the
    // most recent appointment to this seat, so it blocks re-appointment even
    // after the previous holder was fired.
    const { currentTurn: appointTurn, effectiveNow: appointNow } = await getGameTime();
    const onCooldown =
      cooldown != null &&
      (typeof cooldown.cooldownUntilTurn === "number"
        ? cooldown.cooldownUntilTurn > appointTurn
        : cooldown.cooldownUntil > appointNow);
    if (onCooldown) {
      const turnsRemaining =
        typeof cooldown!.cooldownUntilTurn === "number"
          ? cooldown!.cooldownUntilTurn - appointTurn
          : null;
      return NextResponse.json(
        {
          error: turnsRemaining
            ? `This position was recently filled and can be reappointed in ${turnsRemaining} turn${turnsRemaining === 1 ? "" : "s"}.`
            : `This position is on cooldown until ${cooldown!.cooldownUntil.toISOString()}`,
          cooldownUntil: cooldown!.cooldownUntil.toISOString(),
        },
        { status: 409 }
      );
    }

    const existingAppointment = await getCabinetMembersCollection(db).findOne({
      countryId,
      characterId: targetChar._id,
    });
    if (existingAppointment) {
      throw forbidden("This character already holds a cabinet position");
    }

    const now = new Date();
    // Single source of truth: the unified cabinetMembers collection (office
    // pages, ministerial orders, action regen, foreign/trade-minister detection
    // all read this). The seat is guaranteed empty here (the existingMember
    // 409-guard above), so a direct insert is safe and yields the new _id.
    const member = await getCabinetMembersCollection(db).insertOne({
      countryId,
      positionId,
      characterId: targetChar._id,
      characterName: targetChar.name,
      party: lowerOfficial?.party ?? targetChar.party,
      appointedByCharacterId: pmCharacter._id,
      appointedAt: now,
      confirmedAt: now,
      ...initialMinisterialActionFields(now),
      createdAt: now,
      updatedAt: now,
    } as never);

    // Add career history entry — UK uses legacy "ukCabinet" type, others use "parliamentaryCabinet"
    const cabinetType = countryId === ("UK" as CountryId) ? "ukCabinet" : "parliamentaryCabinet";
    const cabinetOffice: OfficeType = { type: cabinetType, positionId };
    const careerEvent: CareerEvent = {
      type: "appointed",
      office: cabinetOffice,
      officeLabel: getOfficeLabel(cabinetOffice, countryId),
      party: lowerOfficial?.party ?? targetChar.party,
      partyCountryId: countryId,
      date: now,
    };
    await db
      .collection<Character>("characters")
      .updateOne({ _id: targetChar._id }, { $push: { careerHistory: careerEvent } });

    // Set currentOffice so the character receives the ukCabinet NPI bonus in actionRefresh
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: targetChar._id },
        { $set: { currentOffice: cabinetOffice, updatedAt: now } }
      );

    // Lock the seat for COOLDOWN_TURNS turns from this appointment. Keyed to the
    // appointment, so it gates the NEXT appointment to this seat and persists
    // even if this minister is fired before it elapses. Turn-first with a
    // wall-clock mirror sized from the live turn cadence for display countdowns.
    const turnLengthMinutes = await loadTurnLengthMinutes(db);
    await getUKCabinetCooldownsCollection(db).updateOne(
      { countryId, positionId },
      {
        $set: {
          countryId,
          positionId,
          appointedCharacterId: targetChar._id,
          appointedByPmCharacterId: pmCharacter._id,
          appointedAt: now,
          cooldownUntil: new Date(now.getTime() + COOLDOWN_TURNS * turnLengthMinutes * 60_000),
          cooldownUntilTurn: appointTurn + COOLDOWN_TURNS,
        },
      },
      { upsert: true }
    );

    // Clear the predecessor's setting cooldowns so the new minister can change
    // settings immediately (cabinetSettings is keyed by position, not holder).
    await resetCabinetSettingCooldowns(db, countryId, positionId);

    // Reset advocacy toggle for territorial secretary positions
    const territorialPositions = TERRITORIAL_POSITIONS_BY_COUNTRY[countryId];
    if (territorialPositions?.includes(positionId)) {
      await getCabinetSettingsCollection(db).updateOne(
        { _id: `${countryId}_${positionId}` },
        { $set: { advocacyActive: false, updatedAt: new Date() } }
      );
    }

    return NextResponse.json({
      success: true,
      member: {
        _id: member.insertedId,
        countryId,
        positionId,
        characterId: targetChar._id,
        characterName: targetChar.name,
        party: lowerOfficial?.party ?? targetChar.party,
        appointedByPmCharacterId: pmCharacter._id,
        appointedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      message: `${targetChar.name} appointed as ${position.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function fireCabinetMemberHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, fireSchema);
    if (!parsed.success) {
      throw badRequest(parsed.error);
    }

    const { positionId } = parsed.data;

    const db = await getDb();
    // Authorize: only the sitting PM may fire (throws otherwise).
    await requireCurrentPrimeMinister(
      db,
      countryId,
      auth.user.userId,
      "Only the Prime Minister can fire cabinet ministers"
    );

    const positions = getCabinetPositions(countryId);
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) {
      throw badRequest("Invalid cabinet position");
    }

    // The head-of-government seat is auto-assigned from the sitting PM; it is
    // vacated only through the Appoint-Premier / no-confidence flow.
    if (position.isHeadOfGovernment) {
      throw forbidden("The head of government cannot be dismissed via the cabinet flow.");
    }

    const member = await getCabinetMembersCollection(db).findOne({
      countryId,
      positionId,
    });
    if (!member) {
      throw notFound("No cabinet member found for this position");
    }

    const now = new Date();

    // Restore the character's currentOffice to their legislative seat so they
    // continue receiving MP action bonuses and NPI after leaving cabinet. An
    // NPP-held seat has a null characterId — there is no player office to
    // restore, so this is skipped.
    if (member.characterId) {
      const holderCharacterId = member.characterId;
      const eligibleOfficeTypes = getCabinetEligibleOfficeTypes(countryId);
      const lowerOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        characterId: holderCharacterId,
        officeType: { $in: eligibleOfficeTypes },
        countryId,
      });
      if (lowerOfficial) {
        const restoreOffice: OfficeType =
          lowerOfficial.officeType === "commons"
            ? { type: "commons", state: lowerOfficial.state! }
            : { type: lowerOfficial.officeType, state: lowerOfficial.state! };
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: holderCharacterId },
            { $set: { currentOffice: restoreOffice, updatedAt: now } }
          );
      } else {
        // Non-legislator appointee (One Party State): no seat to return to —
        // restore private-citizen status so they stop receiving office bonuses.
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: holderCharacterId },
            { $unset: { currentOffice: "" }, $set: { updatedAt: now } }
          );
      }
    }

    await getCabinetMembersCollection(db).deleteOne({ _id: member._id });

    // Firing is unrestricted and imposes no cooldown of its own. Any existing
    // appointment cooldown on this seat (set when the minister was appointed) is
    // intentionally left in place so the seat stays locked for the remainder of
    // its 24-turn window.

    // Confidence gauge (epic #856): firing a minister dents government
    // confidence — heavier for a Great Office of State. Persists only; no
    // consequence until UK_CONFIDENCE_GAUGE_DISSOLUTION is enabled.
    // eslint-disable-next-line local/no-country-literals -- the confidence gauge and Great Offices are UK-specific structures (ukGovernment singleton)
    if (countryId === "UK") {
      const greatOffice = GREAT_OFFICE_POSITION_IDS.has(positionId);
      await applyConfidenceEventToGov(db, { kind: "ministerFired", greatOffice }, new Date());
    }

    return NextResponse.json({
      success: true,
      message: `${member.characterName} removed from ${position.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// ── Legacy UK-specific wrappers (for backward compat) ──────────────────────

/** @deprecated Use getCabinetCharactersHandler with countryId */
export function getUKCabinetCharactersHandler(request: Request) {
  return getCabinetCharactersHandler(request, "UK");
}

/** @deprecated Use appointCabinetMemberHandler with countryId */
export function appointUKCabinetMemberHandler(request: Request) {
  return appointCabinetMemberHandler(request, "UK");
}

/** @deprecated Use fireCabinetMemberHandler with countryId */
export function fireUKCabinetMemberHandler(request: Request) {
  return fireCabinetMemberHandler(request, "UK");
}
