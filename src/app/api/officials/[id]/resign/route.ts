import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, unauthorized, notFound, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { ObjectId } from "mongodb";
import { createNotification } from "@/lib/notifications";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";
import { resignExecutiveOffice } from "@/lib/elections/resignExecutiveOffice";
import type { ElectedOfficial, Character } from "@/lib/db/types";

// POST /api/officials/[id]/resign — Resigns the authenticated character (or any official for admins) from their elected office.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json(badRequest("Invalid official ID").toJson(), { status: 400 });
    }
    const officialId = new ObjectId(id);

    const db = await getDb();
    const officialsCollection = db.collection<ElectedOfficial>("electedOfficials");
    const charactersCollection = db.collection<Character>("characters");

    // Find the official
    const official = await officialsCollection.findOne({ _id: officialId });
    if (!official) {
      return NextResponse.json(notFound("Official not found").toJson(), { status: 404 });
    }

    if (!official.characterId) {
      return NextResponse.json(badRequest("Cannot resign from vacant office").toJson(), {
        status: 400,
      });
    }

    // Check auth: must be the character holding the office OR admin
    const character = await charactersCollection.findOne({ _id: official.characterId });
    if (!character) {
      return NextResponse.json(notFound("Character not found").toJson(), { status: 404 });
    }

    const isOwner = user.userId === character.userId?.toString();
    if (!isOwner && !user.isAdmin) {
      return NextResponse.json(unauthorized("You can only resign from your own offices").toJson(), {
        status: 401,
      });
    }

    const isExecutiveOffice =
      official.officeType === "president" || official.officeType === "vicePresident";

    // Legislative resignations are blocked during active candidacies; executive
    // resignations are allowed so a VP can step down before a contingent ballot.
    if (!isExecutiveOffice) {
      const activeElection = await db.collection("electionCandidates").findOne({
        characterId: official.characterId,
        electionId: { $exists: true },
        status: "active",
      });

      if (activeElection) {
        return NextResponse.json(
          badRequest("Cannot resign while actively running in an election").toJson(),
          { status: 400 }
        );
      }
    }

    const now = new Date();

    if (isExecutiveOffice) {
      await resignExecutiveOffice(db, official, character, now);
    } else {
      await officialsCollection.deleteOne({ _id: officialId });
    }

    // If Senate, notify governor
    if (official.officeType === "senate" && official.state) {
      await notifyGovernorOfSenateVacancy(db, official.state, official.senateClass);
    }

    // Send resignation notification to character
    if (character.userId) {
      const officeDisplay =
        official.officeType === "senate"
          ? `US Senator for ${official.state}`
          : official.officeType === "house"
            ? `US Representative for ${official.state}-${official.district}`
            : official.officeType === "governor"
              ? `Governor of ${official.state}`
              : official.officeType === "vicePresident"
                ? "Vice President of the United States"
                : official.officeType === "president"
                  ? "President of the United States"
                  : official.officeType === "stateSenate"
                    ? `State Senator for ${official.state}`
                    : official.officeType === "commons"
                      ? `MP for ${official.state}`
                      : official.officeType === "landtag"
                        ? `Member of Landtag for ${official.state}`
                        : official.officeType === "regionalCouncil"
                          ? `Regional Councillor for ${official.state}`
                          : official.officeType === "npcDelegate"
                            ? `NPC Delegate for ${official.state}`
                            : official.officeType === "peoplesCongress"
                              ? `People's Congress Delegate for ${official.state}`
                              : official.officeType;

      await createNotification({
        userId: character.userId,
        title: "Resigned from Office",
        message: `You have resigned from ${officeDisplay}.`,
        type: "system",
      });
    }

    return NextResponse.json({
      success: true,
      message: `You have resigned from ${official.officeType === "senate" ? `US Senator for ${official.state}` : official.officeType}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
