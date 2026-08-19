import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { SENATE_CLASSES } from "@/lib/constants";

// POST /api/admin/officials/heal-senate — Deletes senate official and election records with invalid senate classes for their state.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Build a set of valid (stateId, class) pairs
    const validPairs = new Set<string>();
    for (const [stateId, classes] of Object.entries(SENATE_CLASSES)) {
      for (const cls of classes) {
        validPairs.add(`${stateId}_${cls}`);
      }
    }

    // Find all senate ElectedOfficial records with a senateClass set
    const allSenateOfficials = await db
      .collection("electedOfficials")
      .find({ officeType: "senate", senateClass: { $exists: true }, state: { $exists: true } })
      .toArray();

    const orphanOfficialIds = allSenateOfficials
      .filter((o) => !validPairs.has(`${o.state}_${o.senateClass}`))
      .map((o) => o._id);

    let deletedOfficials = 0;
    if (orphanOfficialIds.length > 0) {
      const result = await db
        .collection("electedOfficials")
        .deleteMany({ _id: { $in: orphanOfficialIds } });
      deletedOfficials = result.deletedCount;
    }

    // Find all senate elections with a senateClass set
    const allSenateElections = await db
      .collection("elections")
      .find({ electionType: "senate", senateClass: { $exists: true }, state: { $exists: true } })
      .toArray();

    const orphanElectionIds = allSenateElections
      .filter((e) => !validPairs.has(`${e.state}_${e.senateClass}`))
      .map((e) => e._id);

    let deletedElections = 0;
    if (orphanElectionIds.length > 0) {
      const result = await db
        .collection("elections")
        .deleteMany({ _id: { $in: orphanElectionIds } });
      deletedElections = result.deletedCount;
    }

    return NextResponse.json({
      success: true,
      message: `Healed senate classes: removed ${deletedOfficials} orphan official(s) and ${deletedElections} orphan election(s).`,
      deletedOfficials,
      deletedElections,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/admin/officials/heal-senate — Dry-run that returns counts of senate official and election records with invalid senate classes.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const validPairs = new Set<string>();
    for (const [stateId, classes] of Object.entries(SENATE_CLASSES)) {
      for (const cls of classes) {
        validPairs.add(`${stateId}_${cls}`);
      }
    }

    const allSenateOfficials = await db
      .collection("electedOfficials")
      .find({ officeType: "senate", senateClass: { $exists: true }, state: { $exists: true } })
      .toArray();

    const orphanOfficials = allSenateOfficials.filter(
      (o) => !validPairs.has(`${o.state}_${o.senateClass}`)
    );

    const allSenateElections = await db
      .collection("elections")
      .find({ electionType: "senate", senateClass: { $exists: true }, state: { $exists: true } })
      .toArray();

    const orphanElections = allSenateElections.filter(
      (e) => !validPairs.has(`${e.state}_${e.senateClass}`)
    );

    return NextResponse.json({
      orphanOfficials: orphanOfficials.length,
      orphanElections: orphanElections.length,
      examples: {
        officials: orphanOfficials.slice(0, 5).map((o) => ({
          state: o.state,
          senateClass: o.senateClass,
          characterId: o.characterId,
        })),
        elections: orphanElections.slice(0, 5).map((e) => ({
          state: e.state,
          senateClass: e.senateClass,
          status: e.status,
        })),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
