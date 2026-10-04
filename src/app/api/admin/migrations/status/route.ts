import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, errorResponse } from "@/lib/api/errors";

interface MigrationRecord {
  _id: string;
  completedAt: Date;
  result?: string;
}

// GET /api/admin/migrations/status — List all completed migration records.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const migrations = await db.collection<MigrationRecord>("migrations").find({}).toArray();

    return NextResponse.json({
      migrations: migrations.map((m) => ({
        id: m._id,
        completedAt: m.completedAt.toISOString(),
        result: m.result,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/admin/migrations/status — Delete a migration record by ID to allow re-running it.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return errorResponse(400, "Migration ID required");
    }

    const db = await getDb();
    const result = await db.collection<MigrationRecord>("migrations").deleteOne({ _id: id });

    if (result.deletedCount === 0) {
      return errorResponse(404, "Migration record not found");
    }

    return NextResponse.json({ success: true, message: `Deleted migration record: ${id}` });
  } catch (error) {
    return handleRouteError(error);
  }
}
