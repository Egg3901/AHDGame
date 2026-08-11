/**
 * POST /api/country/[code]/convention/draft
 *
 * Lock the convention's targetSystem + legacyReservation +
 * electionDelayTurns. Must be invoked while a convention is in the
 * `announced` phase. Auth: sitting head of government.
 *
 * Body: { targetSystem, legacyReservation, electionDelayTurns }
 *
 * Errors:
 *   400 — unknown country / invalid body / target not in allowlist /
 *         reservation out of range / delay not in {12,24,48}
 *   401 — not authenticated
 *   403 — caller is not the sitting leader
 *   409 — no convention in progress OR convention not in 'announced' phase
 *   500 — anything else
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { submitConventionDraft } from "@/lib/onePartyState/constitutionalConvention";

// targetSystem deliberately omits `onePartyState` — a convention is
// the *exit* path from a one-party state, not a way to re-enter one.
// The handler-level allowlist check enforces the same rule, but
// rejecting at the schema gives a cleaner 400 with a clearer message.
const draftBodySchema = z.object({
  targetSystem: z.enum(["presidential", "parliamentaryMonarchy", "parliamentaryRepublic"]),
  legacyReservation: z.number().int().min(0).max(35),
  electionDelayTurns: z.union([z.literal(12), z.literal(24), z.literal(48)]),
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

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, draftBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return NextResponse.json(
        { error: "Only the sitting leader can submit a convention draft" },
        { status: 403 }
      );
    }

    const currentTurn = await getCurrentTurn(db);

    try {
      await submitConventionDraft(db, countryId, parsed.data, currentTurn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no convention in progress|not "announced"/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      if (/not in .* allowlist|0 and 35|12, 24, or 48/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true, atTurn: currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
