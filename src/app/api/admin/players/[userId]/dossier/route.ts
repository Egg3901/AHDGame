// GET /api/admin/players/[userId]/dossier — per-account forensic footprint
// Auth: requireModerator (moderators and admins read; PII masked for non-admins)
// Errors: 400, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { schemas } from "@/lib/api/validate";
import { queryDossier } from "@/lib/audit/dossier";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { userId: userIdParam } = await params;
    const parsedId = schemas.objectId.safeParse(userIdParam);
    if (!parsedId.success) {
      return errorResponse(400, "Invalid user ID");
    }

    const userId = new ObjectId(parsedId.data);
    const isAdmin = auth.user.isAdmin === true;

    const db = await getDb();
    const dossier = await queryDossier(db, userId, isAdmin);
    if (!dossier) {
      return errorResponse(404, "User not found");
    }

    return NextResponse.json(dossier);
  } catch (error) {
    return handleRouteError(error);
  }
}
