// POST /api/country/[code]/national-corporation/[id]/treasury-draw
// The seated CEO draws capital from the people's budget into the corp, up to the
// minister-set per-turn cap. Spec P6g §5.2.
// Auth: requireAuthWithCharacter + seated-CEO check. Errors: 400, 401, 403, 404, 429
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { drawFromTreasury } from "@/lib/nationalization/treasury";
import { computeDrawAllowance } from "@/lib/nationalization/ceoFinance";
import { DEFAULT_TREASURY_DRAW_CAP } from "@/lib/nationalization/constants";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import { requireSeatedCeo } from "@/lib/nationalization/ceoRouteGuard";

const schema = z.object({ amount: z.number().positive() });

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const idQuery = corporationQueryFromParamId(id);
    if (!idQuery) {
      return NextResponse.json({ error: "Invalid corporation ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const target = await db
      .collection<Corporation>("corporations")
      .findOne({ ...idQuery, countryOwnerId: countryId });
    if (!target || !isStateOwned(target)) {
      return NextResponse.json(
        { error: "National Corporation not found for this country." },
        { status: 404 }
      );
    }
    const ceoGate = requireSeatedCeo(target, auth.user.character._id);
    if (ceoGate) return ceoGate;

    const amount = Math.round(parsed.data.amount);
    const cap = target.treasuryDrawCap ?? DEFAULT_TREASURY_DRAW_CAP;
    const currentTurn = await getCurrentTurn(db);
    const sameTurn = target.treasuryDrawTurn === currentTurn;
    const allowance = computeDrawAllowance({
      cap,
      drawnThisTurn: target.treasuryDrawnThisTurn ?? 0,
      sameTurn,
    });
    if (amount > allowance) {
      return NextResponse.json(
        { error: `Draw exceeds this turn's remaining allowance (${allowance}).` },
        { status: 400 }
      );
    }

    const now = new Date();
    // The draw is unconditional — it may push the reserve negative (national
    // debt). The per-turn allowance above is the only hard limit; a minister who
    // wants to forbid draws sets treasuryDrawCap to 0.
    await drawFromTreasury(db, { countryId, corpId: target._id, amountLocal: amount }, now);

    // Track the per-turn tally (reset on a new turn).
    await db.collection<Corporation>("corporations").updateOne(
      { _id: target._id },
      sameTurn
        ? { $inc: { treasuryDrawnThisTurn: amount }, $set: { updatedAt: now } }
        : {
            $set: {
              treasuryDrawnThisTurn: amount,
              treasuryDrawTurn: currentTurn,
              updatedAt: now,
            },
          }
    );

    return NextResponse.json({ success: true, drawn: amount });
  } catch (error) {
    return handleRouteError(error);
  }
}
