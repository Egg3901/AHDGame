// GET diagnoses / POST destructively rebuilds all UK Commons electedOfficials from most recent resolved election tallies.
// Auth: requireAdmin
// Errors: 403
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type {
  Election,
  ElectionVoteTally,
  ElectionCandidate,
  ElectedOfficial,
} from "@/lib/db/types";
import { getUkCommonsSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { allocateSeats, getMajoritarianBonus } from "@/lib/turn/election/seatAllocation";

interface RegionDiagnostic {
  region: string;
  electionId: string;
  status: "missing" | "mismatch" | "ok";
  expectedSeats: number;
  actualSeats: number;
  winners: { name: string; party: string; seats: number }[];
}

/**
 * GET /api/admin/heal/uk-commons-seats
 * Diagnoses UK Commons electedOfficials by comparing to most recent resolved elections
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const commonsSeats = getUkCommonsSeats(await getGameStatePreset(db));

    // Find most recent resolved commons elections per UK region
    const recentElections = await db
      .collection<Election>("elections")
      .find({
        electionType: "commons",
        countryId: "UK",
        status: "resolved",
      })
      .sort({ updatedAt: -1 })
      .toArray();

    // Group by region, keeping only the most recent per region
    const latestByRegion = new Map<string, Election>();
    for (const election of recentElections) {
      if (!latestByRegion.has(election.state)) {
        latestByRegion.set(election.state, election);
      }
    }

    if (latestByRegion.size === 0) {
      return NextResponse.json({
        status: "no_data",
        message: "No resolved UK Commons elections found.",
        regions: [],
      });
    }

    // Get current electedOfficials for UK Commons
    const currentOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        officeType: "commons",
        countryId: "UK",
      })
      .toArray();

    const officialsByRegion = new Map<string, ElectedOfficial[]>();
    for (const official of currentOfficials) {
      const region = official.state ?? "";
      const existing = officialsByRegion.get(region) ?? [];
      existing.push(official);
      officialsByRegion.set(region, existing);
    }

    const diagnostics: RegionDiagnostic[] = [];
    let issuesFound = 0;

    for (const [region, election] of latestByRegion) {
      const officials = officialsByRegion.get(region) ?? [];
      const actualSeats = officials.reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0);
      const expectedSeats = commonsSeats[region] ?? election.totalSeats ?? 0;

      let status: "missing" | "mismatch" | "ok" = "ok";
      if (officials.length === 0) {
        status = "missing";
        issuesFound++;
      } else if (actualSeats !== expectedSeats) {
        status = "mismatch";
        issuesFound++;
      }

      diagnostics.push({
        region,
        electionId: election._id.toString(),
        status,
        expectedSeats,
        actualSeats,
        winners: officials.map((o) => ({
          name: o.characterName ?? "Unknown",
          party: o.party ?? "Unknown",
          seats: o.seatsHeld ?? 1,
        })),
      });
    }

    return NextResponse.json({
      status: issuesFound === 0 ? "ok" : "issues_found",
      message:
        issuesFound === 0
          ? `All ${latestByRegion.size} UK regions have correct seat allocations.`
          : `Found ${issuesFound} region(s) with missing or mismatched seat allocations.`,
      totalRegions: latestByRegion.size,
      issuesFound,
      regions: diagnostics.filter((d) => d.status !== "ok"),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/uk-commons-seats
 * Recreates UK Commons electedOfficials from the most recent resolved elections
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const commonsSeats = getUkCommonsSeats(await getGameStatePreset(db));
    const now = new Date();

    // Find most recent resolved commons elections per UK region
    const recentElections = await db
      .collection<Election>("elections")
      .find({
        electionType: "commons",
        countryId: "UK",
        status: "resolved",
      })
      .sort({ updatedAt: -1 })
      .toArray();

    // Group by region, keeping only the most recent per region
    const latestByRegion = new Map<string, Election>();
    for (const election of recentElections) {
      if (!latestByRegion.has(election.state)) {
        latestByRegion.set(election.state, election);
      }
    }

    if (latestByRegion.size === 0) {
      return NextResponse.json({
        success: false,
        message: "No resolved UK Commons elections found to heal from.",
      });
    }

    // Get tallies and candidates for these elections
    const electionIds = Array.from(latestByRegion.values()).map((e) => e._id);

    const [tallies, candidates] = await Promise.all([
      db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .find({ electionId: { $in: electionIds } })
        .toArray(),
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: { $in: electionIds } })
        .toArray(),
    ]);

    const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));
    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    for (const c of candidates) {
      const key = c.electionId.toString();
      const existing = candidatesByElection.get(key) ?? [];
      existing.push(c);
      candidatesByElection.set(key, existing);
    }

    // Delete all existing UK Commons electedOfficials
    const deleteResult = await db.collection<ElectedOfficial>("electedOfficials").deleteMany({
      officeType: "commons",
      countryId: "UK",
    });

    // FPTP winner's bonus (#3244): heal must reallocate with the exact rules
    // the resolver used — cube-law while the CURRENT in-game year is pre-1999,
    // proportional from 1999 on (getMajoritarianBonus returns undefined there).
    const gsForYear = await db
      .collection<{ _id: string; currentYear?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
    const majoritarianBonus = getMajoritarianBonus("commons", gsForYear?.currentYear);

    // Recreate from election results
    const toInsert: ElectedOfficial[] = [];
    let regionsHealed = 0;

    for (const [region, election] of latestByRegion) {
      const tally = tallyMap.get(election._id.toString());
      const electionCandidates = candidatesByElection.get(election._id.toString()) ?? [];

      if (!tally || Object.keys(tally.totalVotes ?? {}).length === 0) {
        console.warn(`[Heal UK Commons] No tally data for ${region}, skipping`);
        continue;
      }

      const candidateMap = new Map(electionCandidates.map((c) => [c._id.toString(), c]));
      const totalVotesCast = Object.values(tally.totalVotes).reduce((s, v) => s + v, 0);

      if (totalVotesCast === 0) continue;

      const ranked = Object.entries(tally.totalVotes)
        .map(([id, votes]) => ({ id, votes, party: candidateMap.get(id)?.party }))
        .filter(({ id }) => candidateMap.has(id))
        .sort((a, b) => b.votes - a.votes);

      if (ranked.length === 0) continue;

      const totalSeats = election.totalSeats ?? commonsSeats[region] ?? 1;
      const { winners } = allocateSeats(
        "commons",
        region,
        totalSeats,
        ranked,
        totalVotesCast,
        undefined,
        majoritarianBonus,
        undefined,
        commonsSeats
      );

      for (const [candidateId, seats] of winners) {
        const candidate = candidateMap.get(candidateId);
        if (!candidate || seats === 0) continue;

        toInsert.push({
          _id: new ObjectId(),
          officeType: "commons",
          countryId: "UK",
          state: region,
          isAppointment: false,
          seatsHeld: seats,
          characterId: candidate.isNPP ? null : (candidate.characterId ?? null),
          characterName: candidate.characterName,
          party: candidate.party,
          isNPP: candidate.isNPP ?? false,
          nppId: candidate.nppId,
          electedAt: election.updatedAt ?? now,
          createdAt: now,
          updatedAt: now,
        });
      }

      regionsHealed++;
    }

    if (toInsert.length > 0) {
      await db.collection<ElectedOfficial>("electedOfficials").insertMany(toInsert);
    }

    return NextResponse.json({
      success: true,
      message: `Healed UK Commons seats: deleted ${deleteResult.deletedCount} old records, created ${toInsert.length} new records across ${regionsHealed} regions.`,
      deleted: deleteResult.deletedCount,
      created: toInsert.length,
      regionsHealed,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
