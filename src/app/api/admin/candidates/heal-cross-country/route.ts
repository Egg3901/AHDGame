import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { NPP, Election, ElectionCandidate } from "@/lib/db/types";

/**
 * GET /api/admin/candidates/heal-cross-country
 * Diagnoses NPP candidates in elections from a different country.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get all NPPs with their country
    const allNPPs = await db
      .collection<NPP>("npps")
      .find({})
      .project({ _id: 1, name: 1, countryId: 1 })
      .toArray();
    const nppCountryMap = new Map(allNPPs.map((n) => [n._id.toString(), n]));

    // Get all active elections with their country
    const activeElections = await db
      .collection<Election>("elections")
      .find({ status: "active" })
      .project({ _id: 1, countryId: 1, electionType: 1, state: 1 })
      .toArray();
    const electionMap = new Map(activeElections.map((e) => [e._id.toString(), e]));

    // Find NPP candidates in these elections
    const electionIds = activeElections.map((e) => e._id);
    const nppCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        electionId: { $in: electionIds },
        isNPP: true,
        status: "active",
      })
      .toArray();

    // Find cross-country candidates
    const crossCountry: Array<{
      characterName: string;
      nppCountry: string;
      electionCountry: string;
      electionType: string;
      state: string;
    }> = [];

    for (const candidate of nppCandidates) {
      const npp = nppCountryMap.get(candidate.nppId?.toString() ?? "");
      const election = electionMap.get(candidate.electionId.toString());

      if (npp && election && npp.countryId !== election.countryId) {
        crossCountry.push({
          characterName: candidate.characterName,
          nppCountry: npp.countryId ?? "unknown",
          electionCountry: election.countryId ?? "unknown",
          electionType: election.electionType,
          state: election.state ?? "unknown",
        });
      }
    }

    return NextResponse.json({
      crossCountryCandidates: crossCountry.length,
      examples: crossCountry.slice(0, 10),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/candidates/heal-cross-country
 * Withdraws NPP candidates from elections in different countries.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Get all NPPs with their country
    const allNPPs = await db
      .collection<NPP>("npps")
      .find({})
      .project({ _id: 1, countryId: 1 })
      .toArray();
    const nppCountryMap = new Map(allNPPs.map((n) => [n._id.toString(), n.countryId]));

    // Get all active elections with their country
    const activeElections = await db
      .collection<Election>("elections")
      .find({ status: "active" })
      .project({ _id: 1, countryId: 1 })
      .toArray();
    const electionCountryMap = new Map(activeElections.map((e) => [e._id.toString(), e.countryId]));

    // Find and withdraw cross-country candidates
    const electionIds = activeElections.map((e) => e._id);
    const nppCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        electionId: { $in: electionIds },
        isNPP: true,
        status: "active",
      })
      .toArray();

    const toWithdraw: typeof nppCandidates = [];
    for (const candidate of nppCandidates) {
      const nppCountry = nppCountryMap.get(candidate.nppId?.toString() ?? "");
      const electionCountry = electionCountryMap.get(candidate.electionId.toString());

      if (nppCountry && electionCountry && nppCountry !== electionCountry) {
        toWithdraw.push(candidate);
      }
    }

    if (toWithdraw.length === 0) {
      return NextResponse.json({
        message: "No cross-country candidates found.",
      });
    }

    const withdrawIds = toWithdraw.map((c) => c._id);
    await db.collection<ElectionCandidate>("electionCandidates").updateMany(
      { _id: { $in: withdrawIds } },
      {
        $set: {
          status: "withdrawn",
          withdrawnAt: now,
        },
      }
    );

    return NextResponse.json({
      message: `Withdrew ${toWithdraw.length} cross-country candidate(s).`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
