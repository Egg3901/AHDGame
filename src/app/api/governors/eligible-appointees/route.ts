import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { getEligibleSenateAppointees } from "@/lib/government/queries/parliamentaryGovernment";

// GET /api/governors/eligible-appointees - Returns player characters and NPPs eligible for gubernatorial Senate appointment.
// Auth: requireBasicAuth
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const senateClassParam = searchParams.get("senateClass");
    if (!senateClassParam) {
      return NextResponse.json(badRequest("senateClass query parameter required").toJson(), {
        status: 400,
      });
    }

    const senateClass = parseInt(senateClassParam, 10);
    if (![1, 2, 3].includes(senateClass)) {
      return NextResponse.json(badRequest("senateClass must be 1, 2, or 3").toJson(), {
        status: 400,
      });
    }

    const db = await getDb();
    return NextResponse.json(
      await getEligibleSenateAppointees(db, auth.user.userId, senateClass as 1 | 2 | 3)
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
