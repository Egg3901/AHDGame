import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { getCurrentTurn } from "@/lib/currentTurn";
import { tradeBankTreasuryBill } from "@/lib/banking/bankTreasury";
import type { Corporation } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("subscribePrimary"),
    bondId: z.string().regex(/^[a-f\d]{24}$/i),
    units: z.number().int().positive().max(1_000_000_000),
    maxCostLocal: z.number().finite().positive(),
    requestId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("toggleAutoSweep"),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("trade"),
    side: z.enum(["buy", "sell"]),
    bondId: z.string().regex(/^[a-f\d]{24}$/i),
    units: z.number().int().positive().max(1_000_000_000),
    requestId: z.string().uuid(),
  }),
]);

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`bank-treasury:${auth.user.userId}`, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const policy = await loadBankingPolicy(db);
    if (
      !policy.bankTreasury ||
      (parsed.data.action === "subscribePrimary" && !policy.sovereignPrimary)
    )
      throw notFound("Not found");
    const turnLock = await rejectDuringTurn(db);
    if (turnLock) return turnLock;

    const resolved = await resolveCorporation(db, (await params).id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;
    const charter = corporation.bankCharter;
    if (charter?.status !== "active") {
      return NextResponse.json({ error: "An active bank charter is required." }, { status: 400 });
    }

    if (parsed.data.action === "toggleAutoSweep") {
      const updated = await db.collection<Corporation>("corporations").updateOne(
        {
          _id: corporation._id,
          "bankCharter.status": "active",
          "bankCharter.charteredTurn": charter.charteredTurn,
        },
        {
          $set: {
            "bankCharter.sovereignTreasuryAutoSweep": parsed.data.enabled,
            updatedAt: new Date(),
          },
        }
      );
      if (updated.matchedCount !== 1) {
        return NextResponse.json(
          { error: "The bank charter changed. Reload and try again." },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true, autoSweep: parsed.data.enabled });
    }

    const result = await tradeBankTreasuryBill(db, {
      bankId: corporation._id,
      bondId: new ObjectId(parsed.data.bondId),
      side: parsed.data.action === "subscribePrimary" ? "buy" : parsed.data.side,
      ...(parsed.data.action === "subscribePrimary"
        ? { primary: true, maxCostLocal: parsed.data.maxCostLocal }
        : {}),
      units: parsed.data.units,
      turn: await getCurrentTurn(db),
      policy,
      tradeId: `treasury:${corporation._id.toHexString()}:${charter.charteredTurn}:${parsed.data.requestId}`,
    });
    return NextResponse.json(result, {
      status: result.status === "completed" ? 200 : result.status === "pending" ? 202 : 400,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
