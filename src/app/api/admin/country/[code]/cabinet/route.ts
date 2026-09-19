/**
 * POST /api/admin/country/[code]/cabinet — admin cabinet seat management.
 * Actions: appoint (direct seat, bypasses PM appointment / Senate
 * confirmation), remove (no cooldown), resetCooldown (clears the per-seat
 * appointment cooldown so the seat can be reappointed early). Works for every country: the
 * parliamentary family (incl. one-party states) syncs both cabinet
 * collections; presidential countries use the unified one only.
 * Auth: requireAdmin
 * Errors: 400, 403, 404, 409
 */
import { NextResponse } from "next/server";
import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import {
  COUNTRY_CONFIGS,
  type CountryId,
  isParliamentarySystemForGovernmentType,
} from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { getCabinetEligibleOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import { getCountryState } from "@/lib/countryState";
import { getOfficeLabel } from "@/lib/utils/politics";
import type { Character, ElectedOfficial, CareerEvent } from "@/lib/db/types";
import type { OfficeType } from "@/lib/db/types/character";
import { getUKCabinetCooldownsCollection } from "@/lib/db/collections/ukGovernment";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { cabinetOfficeTypeForCountry } from "@/lib/actions/officeActionBonus";
import { resetCabinetSettingCooldowns } from "@/lib/db/collections/cabinetSettings";

const actionSchema = z
  .object({
    action: z.enum(["appoint", "remove", "resetCooldown"]),
    positionId: z.string(),
    characterId: z
      .string()
      .regex(/^[a-f0-9]{24}$/, "Invalid character ID")
      .optional(),
  })
  .refine((data) => data.action !== "appoint" || !!data.characterId, {
    message: "characterId is required to appoint",
  });

function cabinetOfficeFor(countryId: CountryId, positionId: string): OfficeType {
  return { type: cabinetOfficeTypeForCountry(countryId), positionId } as OfficeType;
}

/**
 * Withdraw any live Senate nomination for a seat. Presidential cabinets seat
 * via cabinetNominations → Senate vote; an admin direct appoint/remove must
 * close any open nomination for the position or the cabinet page's "awaiting
 * Senate vote" banner (and the Senate ballot) would reference a seat that is
 * already filled/vacated. No-op for the parliamentary family (no nominations).
 */
async function withdrawActiveNominations(
  db: Db,
  countryId: CountryId,
  positionId: string
): Promise<void> {
  await db
    .collection("cabinetNominations")
    .updateMany(
      { countryId, positionId, status: { $in: ["active", "proposed"] } },
      { $set: { status: "withdrawn", updatedAt: new Date() } }
    );
}

/** Vacate a seat: delete member rows and restore the holder's office state. */
async function vacateSeat(
  db: Db,
  countryId: CountryId,
  positionId: string
): Promise<{ characterId: ObjectId | null; characterName: string } | null> {
  const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
  if (!member) return null;

  const now = new Date();

  // Restore the character's currentOffice to their legislative seat (if any)
  // so they keep the right bonuses after leaving cabinet — mirrors the
  // PM-facing fire flow in src/lib/uk/cabinetApi.ts. An NPP-held seat has no
  // character office to restore, so this is skipped for NPP members.
  if (member.characterId) {
    const eligibleOfficeTypes = getCabinetEligibleOfficeTypes(countryId);
    const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: member.characterId,
      officeType: { $in: eligibleOfficeTypes },
      countryId,
    });
    if (seat) {
      const restoreOffice = { type: seat.officeType, state: seat.state! } as OfficeType;
      await db
        .collection<Character>("characters")
        .updateOne(
          { _id: member.characterId },
          { $set: { currentOffice: restoreOffice, updatedAt: now } }
        );
    } else {
      await db
        .collection<Character>("characters")
        .updateOne(
          { _id: member.characterId },
          { $unset: { currentOffice: "" }, $set: { updatedAt: now } }
        );
    }
  }

  await getCabinetMembersCollection(db).deleteOne({ countryId, positionId });

  return { characterId: member.characterId, characterName: member.characterName };
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, positionId } = parsed.data;

    const db = await getDb();

    const position = getCabinetPositions(countryId).find((p) => p.id === positionId);
    if (!position) {
      throw badRequest("Invalid cabinet position");
    }
    // Era gating (appoint only): admin appointments follow the same rule as
    // player appointments — a seat outside its yearEnabled/yearRetired range
    // cannot be filled. remove/resetCooldown stay available for cleanup of
    // seats that have since retired.
    if (action === "appoint" && !isSeatActive(position, await getLiveGameYear(db))) {
      throw badRequest("This cabinet position does not exist in the current era");
    }
    if (position.isHeadOfGovernment) {
      throw forbidden(
        "The head of government is seated through the Appoint Premier/Prime Minister flow, not cabinet appointments."
      );
    }

    // Runtime government type — consistent with the executive page dispatch,
    // so a converted country's admin tools follow its current cabinet flow.
    const runtime = await getCountryState(db, countryId);
    const isParliamentaryFamily = isParliamentarySystemForGovernmentType(runtime.governmentType);

    if (action === "resetCooldown") {
      await getUKCabinetCooldownsCollection(db).deleteOne({ countryId, positionId });
      return NextResponse.json({
        message: `Appointment cooldown cleared for ${position.name}`,
      });
    }

    if (action === "remove") {
      const removed = await vacateSeat(db, countryId, positionId);
      if (!removed) {
        throw notFound("No cabinet member found for this position");
      }
      if (!isParliamentaryFamily) {
        await withdrawActiveNominations(db, countryId, positionId);
      }
      // Admin removal leaves any existing appointment cooldown untouched and
      // imposes none of its own — like a PM firing, removal is unrestricted.
      return NextResponse.json({
        message: `${removed.characterName} removed from ${position.name}`,
      });
    }

    // action === "appoint"
    const characterId = new ObjectId(parsed.data.characterId!);
    const targetChar = await db.collection<Character>("characters").findOne({ _id: characterId });
    if (!targetChar) {
      throw notFound("Character");
    }
    if (!targetChar.userId) {
      throw forbidden("Can only appoint player characters to cabinet");
    }
    if ((targetChar.countryId ?? COUNTRY_CONFIGS.US.id) !== countryId) {
      throw forbidden("Cabinet members must be citizens of this country");
    }

    const existingSeat = await getCabinetMembersCollection(db).findOne({
      countryId,
      characterId: targetChar._id,
    });
    if (existingSeat && existingSeat.positionId !== positionId) {
      return NextResponse.json(
        { error: "This character already holds another cabinet position" },
        { status: 409 }
      );
    }

    // Replace semantics: vacate the current holder (if any) first.
    await vacateSeat(db, countryId, positionId);

    const now = new Date();
    const seat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: targetChar._id,
      officeType: { $in: getCabinetEligibleOfficeTypes(countryId) },
      countryId,
    });
    const party = seat?.party ?? targetChar.party;

    // Unified collection — feeds the overview, office pages, orders, action
    // regen, and foreign/trade-minister detection.
    await getCabinetMembersCollection(db).updateOne(
      { countryId, positionId },
      {
        $set: {
          characterId: targetChar._id,
          characterName: targetChar.name,
          party,
          appointedAt: now,
          confirmedAt: now,
          ...initialMinisterialActionFields(now),
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    const cabinetOffice = cabinetOfficeFor(countryId, positionId);
    const careerEvent: CareerEvent = {
      type: "appointed",
      office: cabinetOffice,
      officeLabel: getOfficeLabel(cabinetOffice, countryId),
      party,
      partyCountryId: countryId,
      date: now,
    };
    await db.collection<Character>("characters").updateOne(
      { _id: targetChar._id },
      {
        $set: { currentOffice: cabinetOffice, updatedAt: now },
        $push: { careerHistory: careerEvent },
      }
    );

    // Clear any position cooldown and the predecessor's setting cooldowns so
    // the new holder can act immediately.
    await getUKCabinetCooldownsCollection(db).deleteOne({ countryId, positionId });
    await resetCabinetSettingCooldowns(db, countryId, positionId);

    // Presidential seats confirm via the Senate; close any open nomination for
    // this position so a direct admin appointment doesn't leave one dangling.
    if (!isParliamentaryFamily) {
      await withdrawActiveNominations(db, countryId, positionId);
    }

    return NextResponse.json({
      message: `${targetChar.name} appointed as ${position.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
