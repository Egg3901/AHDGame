/**
 * POST /api/country/[code]/regime/decision/[id]/resolve
 *
 * Resolve the active regime-escalation decision by choosing one of its
 * registered options. Body carries `{ optionId, payload? }` — the
 * payload merges into `activeDecision.payload` so option handlers that
 * need extra parameters (e.g. Stage 2 `selectiveConcession` taking a
 * banned partyId) can pass them in here without needing a separate
 * route per option.
 *
 * Auth: sitting head of government (the same gate as
 * `/reform/[action]`). The decision-id in the URL must match
 * `activeDecision.id` to guard against stale UI replays.
 *
 * Errors:
 *   400 — unknown country / invalid body
 *   401 — not authenticated
 *   403 — caller is not the sitting leader
 *   404 — no active decision (queue is empty)
 *   409 — decision-id in URL doesn't match the active slot OR unknown optionId
 *   500 — anything else
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { resolveActiveDecision } from "@/lib/onePartyState/decisionQueue";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";

const bodySchema = z.object({
  optionId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    let decisionObjectId: ObjectId;
    try {
      decisionObjectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Invalid decision id" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return NextResponse.json(
        { error: "Only the sitting leader can resolve regime decisions" },
        { status: 403 }
      );
    }

    // Stale-UI guard: confirm the supplied decision-id matches the
    // active slot. A null active means there's nothing to resolve;
    // an id mismatch means the UI is acting on a stale state (e.g.
    // the decision already timed out and the default fired).
    const coll = getRegimeEscalationCollection(db);
    const state = await coll.findOne({ _id: countryId });
    if (!state?.activeDecision) {
      return NextResponse.json({ error: "No active decision to resolve" }, { status: 404 });
    }
    if (!state.activeDecision.id.equals(decisionObjectId)) {
      return NextResponse.json(
        {
          error: "Decision id mismatch — the active decision has changed since you loaded the page",
        },
        { status: 409 }
      );
    }

    // Merge the supplied payload into activeDecision.payload so the
    // handler reads the combined shape. (e.g. Stage 2 selectiveConcession
    // expects payload.bannedPartyId, which only the UI knows.)
    if (parsed.data.payload) {
      await coll.findOneAndUpdate(
        { _id: countryId, "activeDecision.id": decisionObjectId },
        {
          $set: {
            "activeDecision.payload": {
              ...state.activeDecision.payload,
              ...parsed.data.payload,
            },
            updatedAt: new Date(),
          },
        }
      );
    }

    const currentTurn = await getCurrentTurn(db);

    try {
      await resolveActiveDecision(db, countryId, parsed.data.optionId, currentTurn);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unknown option|no handler/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true, atTurn: currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
