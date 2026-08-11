/**
 * GET  /api/admin/country/[code]/cabinet-nominations — list all cabinet nominations
 * POST /api/admin/country/[code]/cabinet-nominations — force actions on nominations
 */
import { NextResponse } from "next/server";
import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseBoundedIntParam, parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import type { CabinetNomination, CabinetMember, Character, CareerEvent } from "@/lib/db/types";
import type { OfficeType } from "@/lib/db/types/character";
import { CABINET_POSITIONS, getCabinetPositionById } from "@/lib/constants";
import { UK_CABINET_POSITIONS } from "@/lib/constants/ukCabinet";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getOfficeLabel } from "@/lib/utils/politics";
import { resetCabinetSettingCooldowns } from "@/lib/db/collections/cabinetSettings";
import { getGameTime } from "@/lib/time/gameTime";
import { z } from "zod";

const actionSchema = z.object({
  nominationId: z.string().length(24),
  action: z.enum(["force_confirm", "force_reject", "withdraw", "reset"]),
});

const US_POSITION_IDS = CABINET_POSITIONS.map((p) => p.id);
const UK_POSITION_IDS = UK_CABINET_POSITIONS.map((p) => p.id);

function getPositionName(positionId: string): string {
  const us = getCabinetPositionById(positionId);
  if (us) return us.name;
  const uk = UK_CABINET_POSITIONS.find((p) => p.id === positionId);
  if (uk) return uk.name;
  return positionId;
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const limit = parseBoundedIntParam(searchParams, "limit", 10, 1, 100);

    const db = await getDb();

    const positionIds = countryId === COUNTRY_CONFIGS.UK.id ? UK_POSITION_IDS : US_POSITION_IDS;
    const query = { positionId: { $in: positionIds } };

    const collection = db.collection<CabinetNomination>("cabinetNominations");
    const [nominations, total] = await Promise.all([
      collection
        .find(query)
        .sort({ proposedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    return NextResponse.json({
      nominations: nominations.map((n) => ({
        id: n._id.toString(),
        positionId: n.positionId,
        positionName: getPositionName(n.positionId),
        nomineeCharacterId: n.nomineeCharacterId.toString(),
        nomineeCharacterName: n.nomineeCharacterName,
        nomineeParty: n.nomineeParty ?? null,
        proposedByPresidentName: n.proposedByPresidentName ?? "President",
        status: n.status,
        votesFor: n.votesFor ?? 0,
        votesAgainst: n.votesAgainst ?? 0,
        votesAbstain: n.votesAbstain ?? 0,
        votingEndsAt: n.votingEndsAt?.toISOString() ?? null,
        proposedAt: n.proposedAt?.toISOString() ?? new Date().toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { code } = await params;
  const routeCountryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[routeCountryId]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  try {
    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { nominationId, action } = parsed.data;

    const db = await getDb();
    const nomination = await db
      .collection<CabinetNomination>("cabinetNominations")
      .findOne({ _id: new ObjectId(nominationId), countryId: routeCountryId });

    if (!nomination) {
      return NextResponse.json({ error: "Nomination not found" }, { status: 404 });
    }

    const now = new Date();
    const posName = getCabinetPositionById(nomination.positionId)?.name ?? nomination.positionId;

    if (action === "force_confirm") {
      // Update nomination to confirmed
      await db.collection<CabinetNomination>("cabinetNominations").updateOne(
        { _id: nomination._id },
        {
          $set: {
            status: "confirmed",
            confirmedAt: now,
            updatedAt: now,
          },
        }
      );

      // Update or create cabinet member record
      await db.collection<CabinetMember>("cabinetMembers").updateOne(
        { countryId: nomination.countryId, positionId: nomination.positionId },
        {
          $set: {
            characterId: nomination.nomineeCharacterId,
            characterName: nomination.nomineeCharacterName,
            party: nomination.nomineeParty,
            appointedAt: now,
            confirmedAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            positionId: nomination.positionId,
            ...initialMinisterialActionFields(now),
            createdAt: now,
          },
        },
        { upsert: true }
      );

      // Clear the predecessor's setting cooldowns so the new holder can change
      // settings immediately (cabinetSettings is keyed by position, not holder).
      await resetCabinetSettingCooldowns(db, nomination.countryId ?? "US", nomination.positionId);

      // Add career history entry for cabinet confirmation (US only - UK uses direct appointment)
      if (nomination.countryId === "US") {
        const cabinetOffice: OfficeType = { type: "usCabinet", positionId: nomination.positionId };
        const careerEvent: CareerEvent = {
          type: "appointed",
          office: cabinetOffice,
          officeLabel: getOfficeLabel(cabinetOffice, "US"),
          party: nomination.nomineeParty,
          partyCountryId: "US",
          date: now,
        };
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: nomination.nomineeCharacterId },
            { $push: { careerHistory: careerEvent } }
          );
      }

      return NextResponse.json({
        message: `${nomination.nomineeCharacterName} confirmed as ${posName}`,
      });
    }

    if (action === "force_reject") {
      await db.collection<CabinetNomination>("cabinetNominations").updateOne(
        { _id: nomination._id },
        {
          $set: {
            status: "rejected",
            rejectedAt: now,
            updatedAt: now,
          },
        }
      );

      return NextResponse.json({
        message: `Nomination of ${nomination.nomineeCharacterName} for ${posName} rejected`,
      });
    }

    if (action === "withdraw") {
      await db.collection<CabinetNomination>("cabinetNominations").updateOne(
        { _id: nomination._id },
        {
          $set: {
            status: "withdrawn",
            updatedAt: now,
          },
        }
      );

      return NextResponse.json({
        message: `Nomination of ${nomination.nomineeCharacterName} for ${posName} withdrawn`,
      });
    }

    if (action === "reset") {
      // Anchor votingEndsAt + votingEndsOnTurn to the game clock so the
      // re-opened window matches what the user-facing POST writes.
      const gameTimeForReset = await getGameTime();
      const VOTING_DURATION_HOURS = 24;
      const votingEndsAt = new Date(
        gameTimeForReset.effectiveNow.getTime() + VOTING_DURATION_HOURS * 60 * 60 * 1000
      );
      const votingEndsOnTurn = gameTimeForReset.currentTurn + VOTING_DURATION_HOURS;
      await db.collection<CabinetNomination>("cabinetNominations").updateOne(
        { _id: nomination._id },
        {
          $set: {
            status: "active",
            votesFor: 0,
            votesAgainst: 0,
            votesAbstain: 0,
            votes: {},
            votingStartedAt: now,
            votingEndsAt,
            votingEndsOnTurn,
            updatedAt: now,
          },
          $unset: {
            confirmedAt: "",
            rejectedAt: "",
          },
        }
      );

      return NextResponse.json({
        message: `Nomination of ${nomination.nomineeCharacterName} for ${posName} reset to active voting`,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
