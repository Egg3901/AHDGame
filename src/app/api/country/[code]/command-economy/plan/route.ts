// POST /api/country/[code]/command-economy/plan
// Command Economy v2 (P2) — the Gosplan Planner allocates the national plan:
// output quotas (plan targets) across the country's SOEs. Writes soe.planTarget
// per enterprise (the quota SOE directors execute against, and the base the
// engine scores fulfillment and sizes directed credit from).
// Auth: the Gosplan seat holder or the head of government. Errors: 400/401/403/404/429.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { badRequest, forbidden, handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Corporation } from "@/lib/db/types/corporation";
import { MAX_PLAN_TARGET_CAPACITY_MULTIPLE } from "@/lib/constants/commandEconomyOffices";
import { canOperateGosplan } from "@/lib/economy/commandEconomyAuth";
import { resolveWriteContext } from "@/lib/economy/queries/commandEconomyWriteContext";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  /** corpId → new plan target (output units). */
  targets: z.record(z.string(), z.number().min(0).max(1e15)),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const setup = await resolveWriteContext(code);
    if (!setup.ok) return setup.response;
    const { db, countryId, characterId, roles } = setup.ctx;

    if (!canOperateGosplan(roles)) {
      return NextResponse.json(
        forbidden(
          "Only the Gosplan chair or the head of government can set the national plan."
        ).toJson(),
        { status: 403 }
      );
    }

    const rate = checkRateLimit(String(characterId), 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const entries = Object.entries(parsed.data.targets);
    if (entries.length === 0) {
      return NextResponse.json(badRequest("No plan targets supplied.").toJson(), { status: 400 });
    }

    // Only this country's SOE corps are settable; a quota may not exceed a sane
    // multiple of the SOE's current capacity (an impossible target is useless).
    const ids: ObjectId[] = [];
    for (const [id] of entries) {
      if (ObjectId.isValid(id)) ids.push(new ObjectId(id));
    }
    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: ids }, countryId, soe: { $exists: true } },
        { projection: { _id: 1, soe: 1 } }
      )
      .toArray();
    const capById = new Map<string, number>();
    for (const c of corps) capById.set(String(c._id), c.soe?.capacity ?? 0);

    const ops = entries
      .filter(([id]) => capById.has(id))
      .map(([id, target]) => {
        const cap = capById.get(id) ?? 0;
        const ceiling = cap > 0 ? cap * MAX_PLAN_TARGET_CAPACITY_MULTIPLE : target;
        const clamped = Math.max(0, Math.min(ceiling, target));
        return {
          updateOne: {
            filter: { _id: new ObjectId(id) },
            update: { $set: { "soe.planTarget": Math.round(clamped) } },
          },
        };
      });

    if (ops.length === 0) {
      return NextResponse.json(
        badRequest("None of the supplied enterprises belong to this country.").toJson(),
        { status: 400 }
      );
    }

    await db.collection<Corporation>("corporations").bulkWrite(ops);

    return NextResponse.json({ success: true, updated: ops.length });
  } catch (error) {
    return handleRouteError(error);
  }
}
