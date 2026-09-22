import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";
import { getCabinetEligibleOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import {
  handleRouteError,
  badRequest,
  conflict,
  forbidden,
  isDuplicateKeyError,
  notFound,
} from "@/lib/api/errors";
import { assertSameCountry } from "@/lib/api/sameCountry";
import { checkRateLimit, CONGRESS_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { createNotification } from "@/lib/notifications";
import type { Db } from "mongodb";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { getOfficeLabel } from "@/lib/utils/politics";
import { type CountryId } from "@/lib/constants/countries";
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
} from "@/lib/countries/uk/cabinetEligibility";
import { canHoldAdditionalAppointment, roleSlotForPosition } from "@/lib/uk/dualMinistry/rules";
import { reconcileUkSharedPool } from "@/lib/cabinet/ministerialActionPool";
import { preserveSurvivingCabinetRow } from "@/lib/uk/dualMinistry/survivor";
import { applyConfidenceEventToGov } from "@/lib/countries/uk/confidence/confidenceGaugeStore";
import { GREAT_OFFICE_POSITION_IDS } from "@/lib/countries/uk/confidence/confidenceGauge";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { canReshuffle, getReshuffleIdentity } from "@/lib/countries/uk/cabinet/reshuffleLimit";

const appointSchema = z.object({
  positionId: z.string(),
  characterId: z.string().regex(/^[a-f0-9]{24}$/, "Invalid character ID"),
});

const fireSchema = z.object({
  positionId: z.string(),
});

const resignSchema = z.object({
  positionId: z.string(),
});

const whipTargetSchema = z.object({
  characterId: z.string().regex(/^[a-f0-9]{24}$/, "Invalid character ID"),
});

const reshuffleAppointmentSchema = z.object({
  positionId: z.string(),
  characterId: z.string().regex(/^[a-f0-9]{24}$/, "Invalid character ID"),
});

const reshuffleSchema = z.object({
  appointments: z.array(reshuffleAppointmentSchema).min(1),
});

// A cabinet seat can only be (re)appointed once every COOLDOWN_TURNS turns. The
// lock is set when a minister is APPOINTED and persists through firing — firing
// itself is unrestricted and imposes no cooldown.
const COOLDOWN_TURNS = 24;

// Territorial secretary positions with advocacy toggles, keyed by country
const TERRITORIAL_POSITIONS_BY_COUNTRY: Partial<Record<CountryId, string[]>> = {
  UK: ["northern_ireland", "scotland", "wales"],
};

/**
 * Restore a departing minister's character office after they leave cabinet
 * (fire, resignation, reshuffle): back to their legislative seat so they keep
 * receiving MP action bonuses and NPI, or to private-citizen status when they
 * hold no seat (One Party State appointees). Shared by every vacate path so a
 * departure never strands a character in a cabinet office they no longer hold.
 */
export async function restoreCharacterOfficeAfterCabinet(
  db: Db,
  countryId: CountryId,
  holderCharacterId: ObjectId,
  now: Date
): Promise<void> {
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
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: holderCharacterId },
        { $unset: { currentOffice: "" }, $set: { updatedAt: now } }
      );
  }
}

export async function getCabinetCharactersHandler(request: Request, countryId: CountryId) {
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

    // Position-aware candidacy (issue #2049): when the caller names the vacant
    // seat, complementary single-slot UK holders stay eligible. Unknown seats
    // fall back to the legacy exclude-all-holders list.
    let vacancyPositionId: string | null = null;
    try {
      const requested = new URL(request.url).searchParams.get("positionId");
      if (requested) {
        const seats = getCabinetPositions(countryId);
        if (seats.some((seat) => seat.id === requested)) vacancyPositionId = requested;
      }
    } catch {
      vacancyPositionId = null;
    }

    return NextResponse.json({
      success: true,
      characters: await getEligibleCabinetCharacters(
        db,
        countryId,
        pmCharacterId,
        vacancyPositionId
      ),
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
    // immediately — and pass that same runtime shape to `isBannedParty` below,
    // which re-tests `isOnePartyState` for itself.
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
      // RUNTIME shape, not `config`. `isOps` above is already read from runtime;
      // passing the static config here re-tested `isOnePartyState` against a
      // value that never learns about a conversion, so the ban never bit for a
      // runtime-converted country.
      if (isBannedParty({ governmentType: runtime.governmentType }, appointeeParty)) {
        throw forbidden("Members of banned parties cannot be appointed to cabinet.");
      }
    }

    // Party suspension teeth (issue #859): an MP serving a whip withdrawal
    // sits as an independent and cannot serve in the party's government until
    // the whip is restored.
    if (lowerOfficial?.whipWithdrawn) {
      throw forbidden(
        "This MP is suspended from the parliamentary party (whip withdrawn) and cannot be appointed to cabinet."
      );
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

    // Dual-ministry slot check (issue #2049): a UK player may add the
    // complementary slot (one department plus one central title) but never two
    // departments, both central titles, or a third seat. Other countries keep
    // one seat per character. Stored `roleSlot` wins; legacy rows derive it.
    const targetSlot = roleSlotForPosition(countryId, positionId);
    const heldRows = await getCabinetMembersCollection(db)
      .find({ countryId, characterId: targetChar._id })
      .project({ positionId: 1, roleSlot: 1 })
      .toArray();
    const heldSlots = heldRows
      .map((row) => row.roleSlot ?? roleSlotForPosition(countryId, row.positionId))
      .filter((slot): slot is NonNullable<typeof slot> => slot != null);
    // Outside the UK rows carry no slot, so the slot check below is vacuous
    // there: any held row blocks a second seat (the pre-#2049 one-seat rule,
    // previously an explicit findOne guard with this same message).
    if (targetSlot == null && heldRows.length > 0) {
      throw forbidden("This character already holds a cabinet position");
    }
    const holdCheck = canHoldAdditionalAppointment(countryId, heldSlots, targetSlot);
    if (!holdCheck.ok) {
      throw forbidden(holdCheck.reason);
    }

    const now = new Date();
    // Single source of truth: the unified cabinetMembers collection (office
    // pages, ministerial orders, action regen, foreign/trade-minister detection
    // all read this). The seat and character were both verified free above,
    // but those checks can be raced by a concurrent appointment. The
    // collection's unique indexes are the real lock, so a duplicate-key
    // insert here is a lost race, not a fault.
    let member;
    try {
      member = await getCabinetMembersCollection(db).insertOne({
        countryId,
        positionId,
        // UK rows carry their role slot for the dual-ministry unique index.
        ...(countryId === ("UK" as CountryId) && targetSlot ? { roleSlot: targetSlot } : {}),
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
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw conflict(
          "A conflicting appointment was just made. Refresh the cabinet and try again."
        );
      }
      throw error;
    }

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

    // Shared pool (issue #2049): recompute from all holder rows and mirror it,
    // so a fresh cap row cannot lift the surviving balance on a second title.
    if (countryId === ("UK" as CountryId)) {
      await reconcileUkSharedPool(db, targetChar._id, now);
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

    // Vacate first, guarded by _id: a concurrent fire/resignation wins, and
    // the loser re-reads a lost race here and reports 404 before restoring an
    // office, writing a gauge event, or sending a notification for a seat it
    // never vacated.
    const removed = await getCabinetMembersCollection(db).deleteOne({ _id: member._id });
    if (removed.deletedCount === 0) {
      throw notFound("No cabinet member found for this position");
    }

    // A surviving second row keeps the holder in cabinet (issue #2049): the
    // helper repoints currentOffice at it and reports true. Only a fully
    // departed holder falls through to the legislative-seat restore. An
    // NPP-held seat has a null characterId — there is no player office to
    // restore, so this is skipped.
    const survivorKept =
      member.characterId != null &&
      (await preserveSurvivingCabinetRow(db, countryId, member.characterId, now));
    if (!survivorKept && member.characterId) {
      await restoreCharacterOfficeAfterCabinet(db, countryId, member.characterId, now);
    }
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

/**
 * A minister resigns their own seat (epic #856, ticket #859).
 *
 * Authority is the holder, not the PM: the caller must own the character that
 * holds `positionId`. The seat is vacated (office restored via the shared
 * helper) and the confidence gauge takes the flat `ministerResigned` hit —
 * heavier for a Great Office of State, matching the fire flow's weighting.
 * The head-of-government seat cannot be resigned here; the PM leaves through
 * the Appoint-Premier / no-confidence flow. NPP-held seats have no player to
 * resign them; NPP resignations are decided by the turn runner
 * (`resignNppCaretakerMinister`).
 */
export async function resignCabinetMemberHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, resignSchema);
    if (!parsed.success) {
      throw badRequest(parsed.error);
    }
    const { positionId } = parsed.data;

    const db = await getDb();
    const caller = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(auth.user.userId) });
    if (!caller) {
      throw forbidden("Only a sitting minister can resign from cabinet");
    }

    const positions = getCabinetPositions(countryId);
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) {
      throw badRequest("Invalid cabinet position");
    }
    if (position.isHeadOfGovernment) {
      throw forbidden(
        "The head of government leaves through the Appoint Premier flow, not resignation."
      );
    }

    const member = await getCabinetMembersCollection(db).findOne({
      countryId,
      positionId,
    });
    if (!member || !member.characterId || !member.characterId.equals(caller._id)) {
      throw notFound("You do not hold this cabinet seat");
    }

    const now = new Date();
    // Vacate first, guarded by _id plus holder: a concurrent fire/resignation
    // wins, and the loser reports 404 here before restoring an office or
    // writing a gauge event for a seat it never vacated. The holder predicate
    // keeps the delete atomic with the ownership check above.
    const removed = await getCabinetMembersCollection(db).deleteOne({
      _id: member._id,
      characterId: caller._id,
    });
    if (removed.deletedCount === 0) {
      throw notFound("You do not hold this cabinet seat");
    }
    await restoreCharacterOfficeAfterCabinet(db, countryId, member.characterId, now);

    // Confidence gauge (epic #856): a resignation is a flat hit each — waves
    // sum to destabilise — heavier for a Great Office of State. Same UK-only
    // persistence as the fire flow; no consequence until
    // UK_CONFIDENCE_GAUGE_DISSOLUTION is enabled.
    // eslint-disable-next-line local/no-country-literals -- the confidence gauge and Great Offices are UK-specific structures (ukGovernment singleton)
    if (countryId === "UK") {
      const greatOffice = GREAT_OFFICE_POSITION_IDS.has(positionId);
      await applyConfidenceEventToGov(db, { kind: "ministerResigned", greatOffice }, now);
    }

    return NextResponse.json({
      success: true,
      message: `You have resigned as ${position.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

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

/**
 * Reshuffle the entire cabinet in one action (epic #856, ticket #859).
 *
 * The PM submits the complete new roster. Every player-held seat is vacated
 * and the listed appointments are seated atomically. Enforces the
 * once-per-parliament-per-government limit from `reshuffleLimit.ts`, persisted
 * as an additive `reshuffleLog` on the `governmentFormations` document (a
 * runtime collection, so it is wiped on world reset like the rest of cabinet
 * state — no seed-manifest change needed).
 *
 * Deliberate divergences from the single-seat appoint flow:
 * - Per-seat appointment cooldowns are NOT checked: the spent reshuffle token
 *   is the throttle for bulk churn. Fresh cooldowns ARE set on the incoming
 *   ministers so later individual churn stays gated.
 * - NPP-held seats (null characterId) are preserved untouched: they are not
 *   the PM's to re-decide and the reshuffle body cannot name them (it only
 *   accepts player characters).
 * - No confidence-gauge event is emitted. Individual firings each dent the
 *   gauge via `ministerFired`; applying that per seat here would bottom the
 *   gauge out on every reshuffle. The token limit is the reshuffle's cost.
 *
 * Concurrency: the `canReshuffle` read above is a fast-path repeat check, not
 * the lock. The lock is the conditional `$push` below — a single atomic
 * `updateOne` on the authoritative `governmentFormations` document whose
 * filter only matches while no entry for this (governmentId, parliamentId)
 * pair exists. Exactly one of two concurrent requests claims the token; the
 * loser re-reads the formation and returns the same 409 repeat contract
 * before touching any cabinet row. A claim whose roster write then fails is
 * compensated with a `$pull` so a retry reconciles instead of wedging.
 */
export async function reshuffleCabinetHandler(request: Request, countryId: CountryId) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(
      auth.user.userId,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, reshuffleSchema);
    if (!parsed.success) {
      throw badRequest(parsed.error);
    }

    const db = await getDb();
    const { pmCharacterId, pmCharacter } = await requireCurrentPrimeMinister(
      db,
      countryId,
      auth.user.userId,
      "Only the Prime Minister can reshuffle the cabinet"
    );

    const govFormation = await getGovernmentFormationsCollection(db).findOne({
      _id: countryId,
    });
    if (!govFormation) {
      throw forbidden("No active government");
    }
    const { governmentId, parliamentId } = getReshuffleIdentity(govFormation);
    const reshuffleLog = govFormation.reshuffleLog ?? [];

    // Limit first: a refused reshuffle consumes nothing, so the check runs
    // before any validation or mutation. Refused with 409 + the limiter's
    // reason, never a generic 400.
    const decision = canReshuffle(reshuffleLog, governmentId, parliamentId);
    if (!decision.allowed) {
      throw conflict(
        `Cabinet reshuffle already used for this parliament (${decision.reason}). A new parliament or a new government restores it.`
      );
    }

    const positions = getCabinetPositions(countryId);
    const liveYear = await getLiveGameYear(db);
    const seenPositions = new Set<string>();
    const seenCharacters = new Set<string>();

    interface ValidatedAppointment {
      positionId: string;
      targetChar: Character;
      lowerOfficial: ElectedOfficial | null;
    }
    const validated: ValidatedAppointment[] = [];

    const runtime = await getCountryState(db, countryId);
    const isOps = runtime.governmentType === "onePartyState";
    const eligibleOfficeTypes = getCabinetEligibleOfficeTypes(countryId);

    for (const { positionId, characterId: characterIdStr } of parsed.data.appointments) {
      if (seenPositions.has(positionId)) {
        throw badRequest(`Duplicate cabinet position in reshuffle: ${positionId}`);
      }
      seenPositions.add(positionId);

      const position = positions.find((candidate) => candidate.id === positionId);
      if (!position) {
        throw badRequest("Invalid cabinet position");
      }
      if (!isSeatActive(position, liveYear)) {
        throw badRequest("This cabinet position does not exist in the current era");
      }
      if (position.isHeadOfGovernment) {
        throw forbidden(
          "The head of government is seated through the Appoint Premier/Prime Minister flow, not cabinet appointments."
        );
      }

      const characterId = new ObjectId(characterIdStr);
      if (seenCharacters.has(characterIdStr)) {
        throw forbidden("This character already holds a cabinet position");
      }
      seenCharacters.add(characterIdStr);

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

      const lowerOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        characterId: targetChar._id,
        officeType: { $in: eligibleOfficeTypes },
        countryId,
      });
      if (!isOps && !lowerOfficial) {
        throw forbidden(
          `Cabinet ministers must hold a seat in the ${getCabinetEligibleChamberLabel(countryId)}`
        );
      }
      if (isOps) {
        const appointeePartySeqId = parseInt(targetChar.party ?? "0", 10);
        const appointeeParty = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ sequentialId: appointeePartySeqId, countryId });
        if (isBannedParty({ governmentType: runtime.governmentType }, appointeeParty)) {
          throw forbidden("Members of banned parties cannot be appointed to cabinet.");
        }
      }
      // Party suspension teeth (issue #859): matches the single-seat flow.
      if (lowerOfficial?.whipWithdrawn) {
        throw forbidden(
          "This MP is suspended from the parliamentary party (whip withdrawn) and cannot be appointed to cabinet."
        );
      }
      if (targetChar._id.equals(pmCharacterId)) {
        throw forbidden("The Prime Minister cannot appoint themselves to a cabinet position");
      }

      validated.push({ positionId, targetChar, lowerOfficial });
    }

    // Caretaker guard: an NPP-held seat still occupies its (countryId,
    // positionId) unique slot, so seating a player there would fail on insert
    // AFTER the old roster was vacated — a refused roster must never wipe the
    // cabinet. Refuse upfront: the PM dismisses the caretaker first, then
    // reshuffles, matching the single-seat appoint contract.
    const namedPositionIds = validated.map((appointment) => appointment.positionId);
    const namedOccupants = await getCabinetMembersCollection(db)
      .find({ countryId, positionId: { $in: namedPositionIds } })
      .toArray();
    const caretakerSeat = namedOccupants.find(
      (occupant) => occupant.characterId == null || occupant.isNPP === true
    );
    if (caretakerSeat) {
      const caretakerPosition = positions.find(
        (candidate) => candidate.id === caretakerSeat.positionId
      );
      throw conflict(
        `The ${caretakerPosition?.name ?? caretakerSeat.positionId} is held by a caretaker. Dismiss the caretaker first, then reshuffle.`
      );
    }

    // All validation passed: claim the token BEFORE touching any cabinet row.
    // The filter only matches while no entry for this pair exists, so this
    // single atomic write is the whole lock — no in-process mutex could span
    // Railway instances. The formation-identity predicates pin the claim to
    // the government we validated against: a PM change or election that lands
    // between our read and this write matches nothing instead of spending a
    // stale token on the new government's document.
    const now = new Date();
    const claimFilter: Record<string, unknown> = {
      _id: countryId,
      reshuffleLog: { $not: { $elemMatch: { governmentId, parliamentId } } },
      pmCharacterId: govFormation.pmCharacterId ?? null,
      cycle: govFormation.cycle ?? 0,
    };
    if (govFormation.formedTurn != null) {
      claimFilter.formedTurn = govFormation.formedTurn;
    }
    const claim = await getGovernmentFormationsCollection(db).updateOne(claimFilter, {
      $push: { reshuffleLog: { governmentId, parliamentId, at: now } },
      $set: { updatedAt: now },
    });
    if (claim.matchedCount === 0) {
      // Lost the race (or the government turned over mid-request): re-read so
      // the response describes current state. A spent token returns the exact
      // repeat contract above; anything else is a refresh-and-retry 409.
      const current = await getGovernmentFormationsCollection(db).findOne({
        _id: countryId,
      });
      const fresh = current ? getReshuffleIdentity(current) : { governmentId, parliamentId };
      const spent = current
        ? !canReshuffle(current.reshuffleLog ?? [], fresh.governmentId, fresh.parliamentId).allowed
        : true;
      throw conflict(
        spent
          ? `Cabinet reshuffle already used for this parliament (already reshuffled this parliament). A new parliament or a new government restores it.`
          : "A conflicting reshuffle was just recorded. Refresh the cabinet and try again."
      );
    }

    try {
      // Token claimed: vacate every player-held seat, then seat the new
      // roster. NPP-held seats (null characterId) are preserved.
      const outgoing = await getCabinetMembersCollection(db).find({ countryId }).toArray();
      for (const member of outgoing) {
        if (!member.characterId) continue;
        await restoreCharacterOfficeAfterCabinet(db, countryId, member.characterId, now);
      }
      await getCabinetMembersCollection(db).deleteMany({
        countryId,
        characterId: { $ne: null },
      });

      const cabinetType = countryId === ("UK" as CountryId) ? "ukCabinet" : "parliamentaryCabinet";
      const { currentTurn: reshuffleTurn } = await getGameTime();
      const turnLengthMinutes = await loadTurnLengthMinutes(db);
      const territorialPositions = TERRITORIAL_POSITIONS_BY_COUNTRY[countryId];

      let appointed = 0;
      for (const { positionId, targetChar, lowerOfficial } of validated) {
        try {
          await getCabinetMembersCollection(db).insertOne({
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
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw conflict(
              "A conflicting appointment was just made. Refresh the cabinet and try again."
            );
          }
          throw error;
        }

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
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: targetChar._id },
            { $set: { currentOffice: cabinetOffice, updatedAt: now } }
          );

        // Fresh appointment cooldown (checked on the NEXT single-seat
        // appointment, not on this reshuffle) plus the same setting-cooldown
        // reset and territorial advocacy reset as the appoint flow.
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
              cooldownUntilTurn: reshuffleTurn + COOLDOWN_TURNS,
            },
          },
          { upsert: true }
        );
        await resetCabinetSettingCooldowns(db, countryId, positionId);
        if (territorialPositions?.includes(positionId)) {
          await getCabinetSettingsCollection(db).updateOne(
            { _id: `${countryId}_${positionId}` },
            { $set: { advocacyActive: false, updatedAt: new Date() } }
          );
        }
        appointed += 1;
      }

      return NextResponse.json({
        success: true,
        appointed,
        message: `Cabinet reshuffled: ${appointed} minister${appointed === 1 ? "" : "s"} appointed`,
      });
    } catch (error) {
      // The roster write failed after the token was claimed: release our
      // entry (unique to this pair, so the $pull cannot take another
      // government's token) so a retry reconciles instead of wedging on a
      // spent token for a roster that never landed.
      await getGovernmentFormationsCollection(db).updateOne(
        { _id: countryId },
        { $pull: { reshuffleLog: { governmentId, parliamentId } } }
      );
      throw error;
    }
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
