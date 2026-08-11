import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getPublicVacancies } from "@/lib/government/queries/parliamentaryGovernment";

// GET /api/vacancies — Returns vacant elected offices (senate, house, governor) across all states.
// Auth: public
// Errors: (none)
export async function GET() {
  try {
    const db = await getDb();
    return NextResponse.json(await getPublicVacancies(db));
  } catch (error) {
    return handleRouteError(error);
  }
}
