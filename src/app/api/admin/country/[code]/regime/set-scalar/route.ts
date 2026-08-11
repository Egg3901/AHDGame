/**
 * POST /api/admin/country/[code]/regime/set-scalar
 *
 * Admin-only: set `popularLegitimacy` or `partyConfidence` directly on
 * the ruling-party leader's state row, with the history entry tagged
 * "admin" so the override is auditable.
 *
 * Body: { scalar: "popularLegitimacy" | "partyConfidence", value: number }
 *
 * No-op (404) when the country has no ruling-party leader state to
 * mutate. Clamping is delegated to the underlying adjust* helpers.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getCountryState } from "@/lib/countryState";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import { adjustPopularLegitimacy } from "@/lib/turn/popularLegitimacy";

const bodySchema = z.object({
  scalar: z.enum(["popularLegitimacy", "partyConfidence"]),
  value: z.number().finite(),
});

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const runtime = await getCountryState(db, countryId);

    // Resolve the current head of government through the canonical
    // helper (governmentFormations → parliamentaryGovernments →
    // electedOfficials). Falls back to the legacy governingPartyId
    // lookup only when no head-of-government can be resolved at all.
    const hogId = await getHeadOfGovernmentCharacterId(db, countryId);
    const leaderColl = getCountryLeaderStatesCollection(db);
    let leaderState = hogId
      ? await leaderColl.findOne({ countryId, leaderCharacterId: hogId })
      : null;
    if (!leaderState && runtime.rulingPartyId !== null) {
      leaderState = await leaderColl.findOne({
        countryId,
        governingPartyId: String(runtime.rulingPartyId),
      });
    }
    if (!leaderState && !hogId) {
      return NextResponse.json(
        { error: "Country has no resolvable head of government to adjust" },
        { status: 404 }
      );
    }

    const currentTurn = await getCurrentTurn(db);
    const reason = "admin override";

    // If no leader-state row exists yet, the underlying adjust* helpers
    // self-heal it via ensureLeaderStateExists. Compute the delta from
    // the current value (existing row, or INITIAL defaults if missing).
    const targetCharacterId = leaderState?.leaderCharacterId ?? hogId!;
    if (parsed.data.scalar === "popularLegitimacy") {
      const current = leaderState?.popularLegitimacy ?? 75;
      const delta = parsed.data.value - current;
      await adjustPopularLegitimacy(db, countryId, targetCharacterId, delta, reason, currentTurn);
    } else {
      const current = leaderState?.partyConfidence ?? 75;
      const delta = parsed.data.value - current;
      await adjustLeaderConfidence(db, countryId, targetCharacterId, delta, reason, currentTurn);
    }

    return NextResponse.json({
      ok: true,
      scalar: parsed.data.scalar,
      target: parsed.data.value,
      atTurn: currentTurn,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
