import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import {
  findUkConstituency,
  getConstituenciesForUkRegion,
} from "@/lib/constituencies/ukWestminster2024";
import { getOfficeLabel } from "@/lib/utils/politics";

type CommonsOffice = {
  type: "commons";
  state: string;
  seatsHeld?: number;
  constituency?: string;
  constituencyId?: string;
};

type PrimeMinisterOffice = {
  type: "primeMinister";
  state: string;
  constituency?: string;
  constituencyId?: string;
};

type UkConstituencyOffice = CommonsOffice | PrimeMinisterOffice;

const selectConstituencySchema = z.object({
  constituencyId: z.string().trim().min(1, "Choose a constituency"),
});

function isCommonsOffice(office: Character["currentOffice"]): office is CommonsOffice {
  return (
    !!office && office.type === "commons" && "state" in office && typeof office.state === "string"
  );
}

function isPrimeMinisterOffice(office: Character["currentOffice"]): office is PrimeMinisterOffice {
  return (
    !!office &&
    office.type === "primeMinister" &&
    "state" in office &&
    typeof office.state === "string"
  );
}

function isUkConstituencyOffice(
  office: Character["currentOffice"]
): office is UkConstituencyOffice {
  return isCommonsOffice(office) || isPrimeMinisterOffice(office);
}

// GET /api/character/constituency — Returns the current constituency choices for a UK Commons MP or Prime Minister.
// Auth: requireAuthWithCharacter
// Errors: 401
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const office = auth.user.character.currentOffice;
    if (!isUkConstituencyOffice(office)) {
      return NextResponse.json({
        eligible: false,
        constituencies: [],
        selected: null,
      });
    }

    const constituencies = getConstituenciesForUkRegion(office.state);
    return NextResponse.json({
      eligible: true,
      officeType: office.type,
      regionId: office.state,
      selected: office.constituencyId
        ? { id: office.constituencyId, name: office.constituency ?? office.constituencyId }
        : null,
      constituencies,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/character/constituency — Updates a UK Commons MP's or Prime Minister's constituency within their current region.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, selectConstituencySchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest("Choose a constituency").toJson(), { status: 400 });
    }
    const { constituencyId } = parsed.data;

    const character = auth.user.character;
    const office = character.currentOffice;
    if (!isUkConstituencyOffice(office)) {
      return NextResponse.json(
        badRequest("Only sitting UK MPs and Prime Ministers can choose a constituency").toJson(),
        { status: 400 }
      );
    }

    const constituency = findUkConstituency(office.state, constituencyId);
    if (!constituency) {
      return NextResponse.json(
        badRequest("That constituency is not in your current UK region").toJson(),
        { status: 400 }
      );
    }

    const db = await getDb();
    const characterId = new ObjectId(character._id);

    // Check no other official already holds this constituency
    const existing = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      countryId: "UK",
      constituencyId,
      characterId: { $ne: characterId },
    });
    if (existing) {
      return NextResponse.json(
        badRequest(`${constituency.name} is already represented by another player`).toJson(),
        { status: 400 }
      );
    }

    const nextOffice: UkConstituencyOffice = {
      ...office,
      constituency: constituency.name,
      constituencyId: constituency.id,
    };
    const officeLabel = getOfficeLabel(nextOffice, "UK");
    const now = new Date();

    if (isCommonsOffice(office)) {
      // Commons: update the electedOfficials record then the character
      const officialUpdate = await db.collection<ElectedOfficial>("electedOfficials").updateOne(
        {
          officeType: "commons",
          countryId: "UK",
          state: office.state,
          characterId,
        },
        {
          $set: {
            constituency: constituency.name,
            constituencyId: constituency.id,
            updatedAt: now,
          },
        }
      );
      if (officialUpdate.matchedCount === 0) {
        return NextResponse.json(notFound("Commons seat not found").toJson(), { status: 404 });
      }

      await db.collection<Character>("characters").updateOne(
        { _id: characterId },
        {
          $set: {
            currentOffice: nextOffice,
            updatedAt: now,
          },
        }
      );

      await db.collection<Character>("characters").updateOne(
        {
          _id: characterId,
          careerHistory: {
            $elemMatch: {
              type: "elected",
              "office.type": "commons",
              "office.state": office.state,
            },
          },
        },
        {
          $set: {
            "careerHistory.$[event].office.constituency": constituency.name,
            "careerHistory.$[event].office.constituencyId": constituency.id,
            "careerHistory.$[event].officeLabel": officeLabel,
            updatedAt: now,
          },
        },
        {
          arrayFilters: [
            {
              "event.type": "elected",
              "event.office.type": "commons",
              "event.office.state": office.state,
            },
          ],
        }
      );
    } else {
      // Prime Minister: no electedOfficials record — update character directly
      await db.collection<Character>("characters").updateOne(
        { _id: characterId },
        {
          $set: {
            currentOffice: nextOffice,
            updatedAt: now,
          },
        }
      );

      await db.collection<Character>("characters").updateOne(
        {
          _id: characterId,
          careerHistory: {
            $elemMatch: {
              type: "appointed",
              "office.type": "primeMinister",
            },
          },
        },
        {
          $set: {
            "careerHistory.$[event].office.constituency": constituency.name,
            "careerHistory.$[event].office.constituencyId": constituency.id,
            "careerHistory.$[event].officeLabel": officeLabel,
            updatedAt: now,
          },
        },
        {
          arrayFilters: [
            {
              "event.type": "appointed",
              "event.office.type": "primeMinister",
            },
          ],
        }
      );
    }

    return NextResponse.json({
      success: true,
      selected: { id: constituency.id, name: constituency.name },
      officeLabel,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
