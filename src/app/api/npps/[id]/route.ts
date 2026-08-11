import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getNppProfile } from "@/lib/npps/queries/profile";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/npps/[id] - Return the shared NPP profile payload.
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid NPP ID" }, { status: 400 });
    }

    const db = await getDb();
    const response = await getNppProfile(db, new ObjectId(id));
    if (!response) {
      return NextResponse.json({ error: "NPP not found" }, { status: 404 });
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
