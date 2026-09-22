import { NextResponse } from "next/server";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { loadCommonsVacancyStatus } from "@/lib/uk/elections/commonsVacancyStatus";

const NO_STORE = { "Cache-Control": "no-store, no-transform" };

// GET /api/uk/commons/vacancies?state=LON — live Commons vacancies, active
// recall petitions, covering special_commons races with candidates, and the
// viewer's held seat. Auth: requireAuthWithCharacter. Errors: 400, 401.
export async function GET(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rawState = new URL(request.url).searchParams.get("state");
    const state = rawState ? rawState.toUpperCase() : undefined;
    if (state !== undefined && !/^[A-Z]{2,4}$/.test(state)) {
      return NextResponse.json(badRequest("Invalid state filter").toJson(), {
        status: 400,
        headers: NO_STORE,
      });
    }

    const db = await getDb();
    const payload = await loadCommonsVacancyStatus(db, {
      ...(state ? { state } : {}),
      viewer: auth.user.character,
    });
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (error) {
    return handleRouteError(error);
  }
}
