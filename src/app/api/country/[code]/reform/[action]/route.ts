/**
 * Phase-5 liberalization reform trigger endpoint.
 *
 * POST /api/country/[code]/reform/[action]
 *
 * `[action]` is one of:
 *   - `legalizeParty`            — body `{ partyId: number }`
 *   - `reduceVoteMultipliers`    — no body
 *   - `holdHonestByElection`     — no body
 *   - `anticorruptionPurge`      — no body
 *   - `constitutionalAmendment`  — no body
 *
 * Auth: must be authenticated AND the sitting head of government for
 * the country (President for presidential systems, PM / Chancellor /
 * Premier for parliamentary + one-party-state systems via
 * `isSittingLeader`).
 *
 * Errors:
 *   400 — unknown country / unknown action / invalid body
 *   401 — not authenticated
 *   403 — caller is not the sitting leader
 *   409 — action is on cooldown OR already used (constitutional amendment)
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
import {
  anticorruptionPurgeAction,
  constitutionalAmendmentAction,
  holdHonestByElectionAction,
  legalizePartyAction,
  reduceVoteMultipliersAction,
  type ReformActionContext,
} from "@/lib/onePartyState/reformActions";

const REFORM_ACTIONS = [
  "legalizeParty",
  "reduceVoteMultipliers",
  "holdHonestByElection",
  "anticorruptionPurge",
  "constitutionalAmendment",
] as const;
type ReformActionParam = (typeof REFORM_ACTIONS)[number];

const legalizePartyBodySchema = z.object({ partyId: z.number().int().positive() });

interface RouteParams {
  params: Promise<{ code: string; action: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, action } = await params;

    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!REFORM_ACTIONS.includes(action as ReformActionParam)) {
      return NextResponse.json({ error: "Unknown reform action" }, { status: 400 });
    }
    const reformAction = action as ReformActionParam;

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return NextResponse.json(
        { error: "Only the sitting leader can trigger reform actions" },
        { status: 403 }
      );
    }

    const currentTurn = await getCurrentTurn(db);
    const ctx: ReformActionContext = {
      db,
      countryId,
      leaderCharacterId: auth.user.character._id,
      currentTurn,
    };

    try {
      switch (reformAction) {
        case "legalizeParty": {
          const parsed = await parseJsonBody(request, legalizePartyBodySchema);
          if (!parsed.success) {
            return NextResponse.json({ error: parsed.error }, { status: parsed.status });
          }
          await legalizePartyAction(ctx, parsed.data.partyId);
          break;
        }
        case "reduceVoteMultipliers":
          await reduceVoteMultipliersAction(ctx);
          break;
        case "holdHonestByElection":
          await holdHonestByElectionAction(ctx);
          break;
        case "anticorruptionPurge":
          await anticorruptionPurgeAction(ctx);
          break;
        case "constitutionalAmendment":
          await constitutionalAmendmentAction(ctx);
          break;
      }
    } catch (err) {
      // Cooldown / one-time-used violations surface as 409 (the action
      // is well-formed; the resource just isn't available right now).
      const msg = err instanceof Error ? err.message : String(err);
      if (/on cooldown|already used/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true, action: reformAction, atTurn: currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
