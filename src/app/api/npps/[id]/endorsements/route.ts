import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getNppEndorsements } from "@/lib/npps/queries/endorsements";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/npps/[id]/endorsements - Return the shared endorsement history payload.
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid NPP ID");
    }

    const db = await getDb();
    const response = await getNppEndorsements(db, new ObjectId(id));
    if (!response) {
      return errorResponse(404, "NPP not found");
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
