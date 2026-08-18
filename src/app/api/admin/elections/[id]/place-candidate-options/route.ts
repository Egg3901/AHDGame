/**
 * GET /api/admin/elections/[id]/place-candidate-options
 * Admin: List characters and NPPs available to place in a presidential election.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election, Character, NPP, PoliticalParty } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/admin/elections/[id]/place-candidate-options — Lists characters and NPPs available to place in a presidential election.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id: electionId } = await params;
    let electionObjectId: ObjectId;
    try {
      electionObjectId = new ObjectId(electionId);
    } catch {
      return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
    }

    const db = await getDb();
    const election = await db.collection<Election>("elections").findOne({
      _id: electionObjectId,
    });

    if (!election || election.electionType !== "president") {
      return NextResponse.json({ error: "Not a presidential election" }, { status: 404 });
    }

    const existingCandidateIds = await db
      .collection("electionCandidates")
      .find({ electionId: electionObjectId, status: "active" })
      .project({ characterId: 1, nppId: 1, isNPP: 1 })
      .toArray();

    const existingCharIds = new Set(
      existingCandidateIds
        .filter((c) => c.characterId && !c.isNPP)
        .map((c) => c.characterId!.toString())
    );
    const existingNppIds = new Set(
      existingCandidateIds.filter((c) => c.nppId).map((c) => c.nppId!.toString())
    );

    const [characters, npps, parties] = await Promise.all([
      db
        .collection<Character>("characters")
        .find({})
        .project({ _id: 1, name: 1, party: 1, homeState: 1 })
        .sort({ name: 1 })
        .toArray(),
      db
        .collection<NPP>("npps")
        .find({})
        .project({ _id: 1, name: 1, party: 1 })
        .sort({ name: 1 })
        .toArray(),
      db
        .collection<PoliticalParty>("politicalParties")
        .find({})
        .project({ _id: 1, name: 1 })
        .toArray(),
    ]);

    const characterOptions = characters.map((c) => ({
      id: c._id.toString(),
      name: c.name,
      party: c.party,
      homeState: c.homeState,
      inRace: existingCharIds.has(c._id.toString()),
    }));

    const nppOptions = npps.map((n) => ({
      id: n._id.toString(),
      name: n.name,
      party: n.party,
      inRace: existingNppIds.has(n._id.toString()),
    }));

    const partyOptions = parties.map((p) => ({
      id: p._id as string,
      name: p.name as string,
    }));

    return NextResponse.json({
      characters: characterOptions,
      npps: nppOptions,
      parties: partyOptions,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
