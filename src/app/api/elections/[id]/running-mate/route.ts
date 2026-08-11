/**
 * POST /api/elections/[id]/running-mate
 * Set running mate (VP) for a presidential candidate. Only the candidate can set their own running mate.
 * Running mates must be eligible player characters from the same country and cannot be the current President.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { z } from "zod";
import type { Election, ElectionCandidate, Character, ElectedOfficial, User } from "@/lib/db/types";
import { isHexObjectIdString } from "@/lib/utils/objectIdHex";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { hasReachedExecutiveTermLimit } from "@/lib/elections/executiveTermLimits";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Determines if the given ID is a seatId (e.g., "US-president") or an ObjectId.
 */
function isSeatId(id: string): boolean {
  if (isHexObjectIdString(id)) return false;
  const parts = id.split("-");
  if (parts.length < 2) return false;
  if (!/^[A-Z]{2}$/i.test(parts[0])) return false;
  return true;
}

// POST /api/elections/[id]/running-mate — Sets or clears the running mate for the authenticated presidential candidate.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { user } = auth;
    const character = user.character;

    const rateLimit = checkRateLimit(user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id: electionId } = await params;
    const parsed = await parseJsonBody(
      request,
      z.object({
        runningMateId: z
          .union([schemas.objectId, z.literal("")])
          .nullish()
          .transform((v) => (v === "" ? null : v)),
      })
    );
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const runningMateId = parsed.data.runningMateId;

    const db = await getDb();

    // Resolve election by seatId or ObjectId
    let election: Election | null = null;
    if (isSeatId(electionId)) {
      election = await db.collection<Election>("elections").findOne({
        seatId: electionId,
        status: { $in: ["active", "upcoming"] },
      });
    } else {
      let electionObjectId: ObjectId;
      try {
        electionObjectId = new ObjectId(electionId);
      } catch {
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      election = await db.collection<Election>("elections").findOne({ _id: electionObjectId });
    }
    if (!election || election.electionType !== "president") {
      return NextResponse.json({ error: "Not a presidential election" }, { status: 400 });
    }

    if (election.status !== "active" && election.status !== "upcoming") {
      return NextResponse.json({ error: "Election is not active" }, { status: 400 });
    }

    const myCandidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: election._id,
      characterId: character._id,
      status: "active",
    });
    if (!myCandidate) {
      return NextResponse.json(
        { error: "You are not a candidate in this election" },
        { status: 403 }
      );
    }

    if (runningMateId === null || runningMateId === undefined || runningMateId === "") {
      await db
        .collection<ElectionCandidate>("electionCandidates")
        .updateOne(
          { _id: myCandidate._id },
          { $unset: { runningMateId: "" }, $set: { updatedAt: new Date() } }
        );
      return NextResponse.json({
        success: true,
        message: "Running mate cleared.",
      });
    }

    let runningMateObjectId: ObjectId;
    try {
      runningMateObjectId = new ObjectId(runningMateId);
    } catch {
      return NextResponse.json({ error: "Invalid running mate ID" }, { status: 400 });
    }

    const electionCountry = (election.countryId ?? COUNTRY_CONFIGS.US.id) as CountryId;
    const countryConfig = getCountryConfig(electionCountry);

    const currentPresident = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      ...getExecutiveOfficialFilter(electionCountry, "president"),
      characterId: { $ne: null },
    });
    if (currentPresident?.characterId?.equals(runningMateObjectId)) {
      return NextResponse.json(
        { error: "The current President cannot be a running mate" },
        { status: 400 }
      );
    }

    const runningMateChar = await db
      .collection<Character>("characters")
      .findOne({ _id: runningMateObjectId });
    if (!runningMateChar) {
      return NextResponse.json({ error: "Running mate character not found" }, { status: 404 });
    }
    if (!runningMateChar.userId) {
      return NextResponse.json(
        { error: "That character is not eligible to be selected as running mate" },
        { status: 400 }
      );
    }

    const runningMateUser = await db
      .collection<User>("users")
      .findOne({ _id: runningMateChar.userId }, { projection: { _id: 1, isBanned: 1 } });
    if (!runningMateUser || runningMateUser.isBanned) {
      return NextResponse.json(
        { error: "That character is not eligible to be selected as running mate" },
        { status: 400 }
      );
    }

    if (runningMateChar._id.equals(character._id)) {
      return NextResponse.json(
        { error: "You cannot select yourself as running mate" },
        { status: 400 }
      );
    }

    if (!isSameCountry(runningMateChar, { countryId: electionCountry })) {
      return NextResponse.json(
        { error: "Your running mate must be from the same country" },
        { status: 400 }
      );
    }

    if (
      countryConfig.executiveTermLimit?.blocksRunningMateSelection &&
      hasReachedExecutiveTermLimit(runningMateChar, electionCountry)
    ) {
      return NextResponse.json(
        {
          error:
            "That character has already served the maximum number of presidential terms and cannot be selected as Vice President.",
        },
        { status: 400 }
      );
    }

    // A candidate who suspended their own campaign to endorse is allowed to be a
    // running mate; only a genuinely-active (non-suspended) candidate is blocked.
    const isAlreadyCandidate = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne({
        electionId: election._id,
        characterId: runningMateObjectId,
        status: "active",
        campaignSuspended: { $ne: true },
      });
    if (isAlreadyCandidate) {
      return NextResponse.json(
        { error: "That character is already a candidate in this election" },
        { status: 400 }
      );
    }

    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne(
        { _id: myCandidate._id },
        { $set: { runningMateId: runningMateObjectId, updatedAt: new Date() } }
      );

    return NextResponse.json({
      success: true,
      message: `${runningMateChar.name} is now your running mate.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
