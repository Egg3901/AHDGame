// GET /api/country/[code]/sector-nationalization-preview?sectorType=…&carveFraction=…&scope=…
// Read-only preview for an industry-wide sector nationalization bill provision:
// the affected corporations + estimated compensation each (treasury cost, country
// currency), the free unowned-market slice, and the total. No mutation.
// Thin wrapper over the shared computeSectorNationalizationPreview helper (also
// used by the enacted-bill detail view) so the estimate never drifts.
// Auth: requireAuthWithCharacter. Errors: 400, 401
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { computeSectorNationalizationPreview } from "@/lib/nationalization/billTargetPreview";
import type { SectorScope } from "@/lib/nationalization/nationalizeSectorWide";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const sp = new URL(request.url).searchParams;
    const sectorType = sp.get("sectorType") as CorporationType | null;
    if (!sectorType || !CORPORATION_TYPES.includes(sectorType)) {
      return NextResponse.json({ error: "Invalid sector type" }, { status: 400 });
    }
    const carveFraction = Math.min(1, Math.max(0, Number(sp.get("carveFraction") ?? 1)));
    const scopeRaw = sp.get("scope") ?? "all";
    const scope = (
      ["all", "corporations", "unowned"].includes(scopeRaw) ? scopeRaw : "all"
    ) as SectorScope;

    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);
    const preview = await computeSectorNationalizationPreview(db, {
      countryId,
      sectorType,
      carveFraction,
      scope,
      currentTurn,
    });

    return NextResponse.json(preview);
  } catch (error) {
    return handleRouteError(error);
  }
}
