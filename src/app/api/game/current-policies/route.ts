import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { StatePolicy, GovernorExecutiveOrder } from "@/lib/db/types";
import { canonicalizeLegislationTypeId } from "@/lib/legislationTypeAliases";
import { ObjectId } from "mongodb";

// GET /api/game/current-policies — Returns current policy option indices for a given state or federal level.
// Auth: public
// Errors: (none)
/**
 * GET /api/game/current-policies?stateId=federal
 *
 * Returns current policy positions for a given state/federal level.
 * Used by bill proposal UI to calculate shift-based archetype approval previews.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("stateId") ?? "federal";

    const db = await getDb();

    const policies = await db.collection<StatePolicy>("statePolicies").find({ stateId }).toArray();

    // Executive orders are temporary nudges, not real law. For bill-proposal
    // purposes (which is what this endpoint feeds), the "current law" is the
    // pre-order base — that way bills can either codify the order's effect or
    // restore the base, without being blocked.
    const orderIds = policies
      .map((p) => (p.enactedBy?.kind === "order" ? p.enactedBy.id : null))
      .filter((id): id is ObjectId => id != null);
    const orderById = orderIds.length
      ? new Map(
          (
            await db
              .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
              .find({ _id: { $in: orderIds } })
              .toArray()
          ).map((o) => [o._id!.toString(), o])
        )
      : new Map<string, GovernorExecutiveOrder>();

    // Return a map of legislationTypeId -> policyOptionIndex for easy lookup
    const policyMap: Record<string, number> = {};
    const canonicalSources = new Set<string>();
    for (const policy of policies) {
      const canonicalId = canonicalizeLegislationTypeId(policy.legislationTypeId);
      if (!canonicalId) continue;

      const exactCanonical = policy.legislationTypeId === canonicalId;
      if (!exactCanonical && canonicalSources.has(canonicalId)) continue;

      const order =
        policy.enactedBy?.kind === "order" ? orderById.get(policy.enactedBy.id.toString()) : null;
      policyMap[canonicalId] = order ? order.policyOptionIndexBefore : policy.policyOptionIndex;
      if (exactCanonical) canonicalSources.add(canonicalId);
    }

    return NextResponse.json(policyMap, {
      headers: {
        // cache policy: game-state — policies change when bills pass; SWR = max-age (not longer)
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
