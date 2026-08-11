// POST/DELETE /api/country/[code]/strategic-sector
// Head-of-government designates (POST) or removes (DELETE) a strategic sector type
// (spec §6.3/§8), arming / disarming the strategic nationalization trigger.
// Auth: requireHumanSession + isSittingLeader. Errors: 400, 401, 403, 429
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import {
  designateStrategicSector,
  removeStrategicSectorDesignation,
  getDesignatedSectorTypes,
} from "@/lib/nationalization/strategicSectors";
import { MAX_STRATEGIC_SECTOR_DESIGNATIONS } from "@/lib/nationalization/constants";
import { designateStrategicSectorSchema } from "@/lib/api/schemas/nationalization";

interface RouteParams {
  params: Promise<{ code: string }>;
}

type Gate =
  | { ok: false; response: Response }
  | { ok: true; db: Awaited<ReturnType<typeof getDb>>; countryId: CountryId };

async function authorize(request: Request, code: string): Promise<Gate> {
  const auth = await requireHumanSession(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  const rl = checkRateLimit(auth.user.userId, 10, 60000);
  if (!rl.ok) return { ok: false, response: rateLimitResponse(rl.retryAfter) };

  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid country code" }, { status: 400 }),
    };
  }

  const db = await getDb();
  const character = await getCharacterByUserId(db, auth.user.userId);
  if (!character || !(await isSittingLeader(db, countryId, character._id))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only the head of government may designate strategic sectors." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, db, countryId };
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const gate = await authorize(request, code);
    if (!gate.ok) return gate.response;
    const parsed = await parseJsonBody(request, designateStrategicSectorSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const sectorType = parsed.data.sectorType as CorporationType;
    // Cap the number of concurrently-designated sectors. Re-designating an
    // already-strategic sector is idempotent and never trips the cap.
    const designated = await getDesignatedSectorTypes(gate.db, gate.countryId);
    if (!designated.has(sectorType) && designated.size >= MAX_STRATEGIC_SECTOR_DESIGNATIONS) {
      return NextResponse.json(
        {
          error: `A country may designate at most ${MAX_STRATEGIC_SECTOR_DESIGNATIONS} strategic sectors. Remove one before adding another.`,
        },
        { status: 409 }
      );
    }
    const turn = await getCurrentTurn(gate.db);
    await designateStrategicSector(gate.db, {
      countryId: gate.countryId,
      sectorType,
      turn,
      source: "executive",
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const gate = await authorize(request, code);
    if (!gate.ok) return gate.response;
    const parsed = await parseJsonBody(request, designateStrategicSectorSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    await removeStrategicSectorDesignation(
      gate.db,
      gate.countryId,
      parsed.data.sectorType as CorporationType
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
