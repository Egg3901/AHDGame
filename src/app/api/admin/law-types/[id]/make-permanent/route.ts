import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { LegislationType } from "@/lib/db/types";
import { writeAdminSeedFile, ADMIN_SEED_FILE } from "@/lib/admin/seedFileGenerator";

// POST /api/admin/law-types/[id]/make-permanent — Marks a law type as permanent and regenerates the admin seed file.
// Auth: requireAdmin
// Errors: 401, 403, 404
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    // Get the law type from DB
    const lawType = await db.collection<LegislationType>("legislationTypes").findOne({ _id: id });

    if (!lawType) {
      return NextResponse.json({ error: `Law type "${id}" not found` }, { status: 404 });
    }

    // Set isPermanent to true
    await db
      .collection<LegislationType>("legislationTypes")
      .updateOne({ _id: id }, { $set: { isPermanent: true, updatedAt: new Date() } });

    // Get all permanent admin types from DB
    const permanentTypes = await db
      .collection<LegislationType>("legislationTypes")
      .find({ source: "admin", isPermanent: true })
      .toArray();

    // Generate and write the seed file
    await writeAdminSeedFile(permanentTypes);

    return NextResponse.json({
      message: `Law type "${id}" marked as permanent`,
      permanentCount: permanentTypes.length,
      seedFilePath: ADMIN_SEED_FILE.replace(process.cwd(), "").replace(/^[/\\]/, ""),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
