/**
 * POST /api/admin/elections/spawn/[code]
 *
 * Admin tool: dispatch to the country's ensure-elections handler via
 * SPAWN_ELECTIONS_REGISTRY. Returns a normalized envelope across all
 * countries (success, ms, message, optional electionId/created).
 *
 * Auth: requireAdmin
 * Errors: 403, 404 (no handler registered for country)
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { SPAWN_ELECTIONS_REGISTRY } from "@/lib/turn/perpetualElections";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    const handler = SPAWN_ELECTIONS_REGISTRY[countryId];
    if (!handler) {
      return NextResponse.json(
        { error: `No spawn-elections handler registered for country '${countryId}'.` },
        { status: 404 }
      );
    }

    const start = Date.now();
    const now = new Date();
    const result = (await handler(now)) ?? { message: `${countryId} spawn complete.` };
    const ms = Date.now() - start;

    return NextResponse.json({
      success: true,
      ms,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
