import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { createAdminLog } from "@/lib/adminLog";
import { createNotification } from "@/lib/notifications";
import { parseJsonBody } from "@/lib/api/validate";
import { adminOfficialsAppointSchema } from "@/lib/api/schemas/admin";
import type { Character, ElectedOfficial, OfficeType, User } from "@/lib/db/types";

// POST /api/admin/officials/appoint — Appoints or vacates a character in an elected office position, with admin logging.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminOfficialsAppointSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { officialId, characterId, officeType, state, seatsHeld } = parsed.data;

    const db = await getDb();
    const now = new Date();

    // Handle creating new House representative
    if (officeType === "house" && state && seatsHeld && characterId) {
      let characterObjectId: ObjectId;
      try {
        characterObjectId = new ObjectId(characterId);
      } catch {
        return NextResponse.json({ error: "Invalid characterId format" }, { status: 400 });
      }

      const character = await db.collection<Character>("characters").findOne({
        _id: characterObjectId,
      });

      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }

      // If character already holds an office, remove them from it
      if (character.currentOffice) {
        await db.collection("electedOfficials").updateOne(
          { characterId: characterObjectId },
          {
            $set: {
              characterId: null,
              characterName: null,
              party: null,
              electedAt: null,
              updatedAt: now,
            },
          }
        );
      }

      // Create new House representative record
      const newOfficial: Omit<ElectedOfficial, "_id"> = {
        officeType: "house",
        state: state.toUpperCase(),
        isAppointment: false,
        seatsHeld,
        characterId: characterObjectId,
        characterName: character.name,
        party: character.party,
        electedAt: now,
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection("electedOfficials").insertOne(newOfficial);

      // Update character's current office
      await db.collection("characters").updateOne(
        { _id: characterObjectId },
        {
          $set: {
            currentOffice: { type: "house", state: state.toUpperCase(), seatsHeld },
            updatedAt: now,
          },
        }
      );

      // Get user for logging
      const user = await db.collection<User>("users").findOne({ _id: character.userId });

      // Log the appointment
      await createAdminLog({
        category: "election",
        action: "official_appointed",
        username: user?.username || "unknown",
        characterName: character.name,
        adminUsername: admin.username,
        details: `Appointed as House Representative for ${state} (${seatsHeld} seat${seatsHeld > 1 ? "s" : ""})`,
      });

      return NextResponse.json({
        success: true,
        message: `${character.name} appointed as House Representative for ${state} (${seatsHeld} seat${seatsHeld > 1 ? "s" : ""})`,
        officialId: result.insertedId,
      });
    }

    // Handle existing official positions (Senate, etc.)
    if (!officialId) {
      return NextResponse.json(
        { error: "officialId is required for non-House appointments" },
        { status: 400 }
      );
    }

    // Find the elected official position
    let officialObjectId: ObjectId;
    try {
      officialObjectId = new ObjectId(officialId);
    } catch {
      return NextResponse.json({ error: "Invalid officialId format" }, { status: 400 });
    }

    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      _id: officialObjectId,
    });

    if (!official) {
      return NextResponse.json({ error: "Elected official position not found" }, { status: 404 });
    }

    // If there's a current office holder, remove their office
    if (official.characterId) {
      await db.collection("characters").updateOne(
        { _id: official.characterId },
        {
          $set: {
            currentOffice: null,
            updatedAt: now,
          },
        }
      );
    }

    // For executive positions (president/vicePresident), clear ALL characters
    // claiming this office type in the same country - handles cases with
    // duplicate records or characters who got the office via other paths.
    // Scoped to `official.countryId` so the bulk clear cannot reach across
    // countries (CN now also has a ceremonial President auto-populated from
    // CCP.chairId — that lives on a separate countryId and must not be
    // touched here).
    if (official.officeType === "president" || official.officeType === "vicePresident") {
      const officialCountryId = official.countryId ?? "US";
      await db
        .collection("characters")
        .updateMany(
          { countryId: officialCountryId, "currentOffice.type": official.officeType },
          { $set: { currentOffice: null, updatedAt: now } }
        );
    }

    // If appointing a new character
    if (characterId) {
      let characterObjectId: ObjectId;
      try {
        characterObjectId = new ObjectId(characterId);
      } catch {
        return NextResponse.json({ error: "Invalid characterId format" }, { status: 400 });
      }

      // Find the character
      const character = await db.collection<Character>("characters").findOne({
        _id: characterObjectId,
      });

      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }

      // If character already holds an office, remove them from it
      if (character.currentOffice) {
        await db.collection("electedOfficials").updateOne(
          { characterId: characterObjectId },
          {
            $set: {
              characterId: null,
              characterName: null,
              party: null,
              electedAt: null,
              updatedAt: now,
            },
          }
        );
      }

      // Build the office type for the character
      let officeType: OfficeType;
      switch (official.officeType) {
        case "senate":
          officeType = { type: "senate", state: official.state! };
          break;
        case "house":
          officeType = {
            type: "house",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "governor":
          officeType = { type: "governor", state: official.state! };
          break;
        case "president":
          officeType = { type: "president" };
          break;
        case "vicePresident":
          officeType = { type: "vicePresident" };
          break;
        case "stateSenate":
          officeType = {
            type: "stateSenate",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "commons":
          officeType = {
            type: "commons",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "regionalCouncil":
          officeType = {
            type: "regionalCouncil",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "primeMinister":
          officeType = { type: "primeMinister" };
          break;
        case "shugiin":
          officeType = {
            type: "shugiin",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "sangiin":
          officeType = {
            type: "sangiin",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "bundestag":
          officeType = {
            type: "bundestag",
            state: official.state!,
          };
          break;
        case "landtag":
          officeType = {
            type: "landtag",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "ministerPresident":
          officeType = { type: "ministerPresident", state: official.state! };
          break;
        case "chancellor":
          officeType = { type: "chancellor" };
          break;
        case "npcDelegate":
          officeType = {
            type: "npcDelegate",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "peoplesCongress":
          officeType = {
            type: "peoplesCongress",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "dail":
          officeType = {
            type: "dail",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "seanad":
          officeType = {
            type: "seanad",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        case "uachtaran":
          // National single-seat, no state (matches the president pattern).
          officeType = { type: "uachtaran" };
          break;
        case "localCouncil":
          officeType = {
            type: "localCouncil",
            state: official.state!,
            seatsHeld: official.seatsHeld || 1,
          };
          break;
        default:
          return NextResponse.json({ error: "Unknown office type" }, { status: 400 });
      }

      // Update the elected official position
      await db.collection("electedOfficials").updateOne(
        { _id: officialObjectId },
        {
          $set: {
            characterId: characterObjectId,
            characterName: character.name,
            party: character.party,
            electedAt: now,
            updatedAt: now,
          },
        }
      );

      // Update the character's current office
      await db.collection("characters").updateOne(
        { _id: characterObjectId },
        {
          $set: {
            currentOffice: officeType,
            updatedAt: now,
          },
        }
      );

      // Get user for logging
      const user = await db.collection<User>("users").findOne({ _id: character.userId });

      // Log the appointment
      await createAdminLog({
        category: "election",
        action: "official_appointed",
        username: user?.username || "unknown",
        characterName: character.name,
        adminUsername: admin.username,
        details: `Appointed to ${official.officeType}${official.state ? ` (${official.state})` : ""}`,
      });

      try {
        const { checkOfficeHeldAchievements } = await import("@/lib/achievements/triggers");
        await checkOfficeHeldAchievements(character.userId, characterObjectId, official.officeType);
      } catch (e) {
        console.error("Achievement check failed:", e);
      }

      if (official.officeType === "president" || official.officeType === "vicePresident") {
        const title =
          official.officeType === "president" ? "Appointed President" : "Appointed Vice President";
        const msg =
          official.officeType === "president"
            ? "You have been appointed President of the United States by an admin."
            : "You have been appointed Vice President of the United States by an admin.";
        await createNotification({
          userId: character.userId,
          type: "system",
          title,
          message: msg,
          metadata: { officeType: official.officeType, type: "executive_appointed" },
        });
      }

      return NextResponse.json({
        success: true,
        message: `${character.name} appointed to ${official.officeType}${official.state ? ` (${official.state})` : ""}`,
        official: {
          ...official,
          characterId: characterObjectId,
          characterName: character.name,
          party: character.party,
        },
      });
    } else {
      // Vacating the position - log removal if there was a previous holder
      if (official.characterId && official.characterName) {
        // Get the previous holder's user for logging
        const prevCharacter = await db
          .collection<Character>("characters")
          .findOne({ _id: official.characterId });
        const prevUser = prevCharacter
          ? await db.collection<User>("users").findOne({ _id: prevCharacter.userId })
          : null;

        await createAdminLog({
          category: "election",
          action: "official_removed",
          username: prevUser?.username || "unknown",
          characterName: official.characterName,
          adminUsername: admin.username,
          details: `Removed from ${official.officeType}${official.state ? ` (${official.state})` : ""}`,
        });
      }

      await db.collection("electedOfficials").updateOne(
        { _id: officialObjectId },
        {
          $set: {
            characterId: null,
            characterName: null,
            party: null,
            electedAt: null,
            updatedAt: now,
          },
        }
      );

      return NextResponse.json({
        success: true,
        message: `Position vacated: ${official.officeType}${official.state ? ` (${official.state})` : ""}`,
      });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/admin/officials/appoint?countryId=US — Returns characters for the admin appointment dropdown, filtered by country.
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const countryId = searchParams.get("countryId")?.toUpperCase();

    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (countryId) filter.countryId = countryId;

    const characters = await db
      .collection<Character>("characters")
      .find(filter)
      .project({
        _id: 1,
        name: 1,
        party: 1,
        countryId: 1,
        homeState: 1,
        currentOffice: 1,
        sequentialId: 1,
      })
      .sort({ name: 1 })
      .toArray();

    return NextResponse.json({
      characters,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
