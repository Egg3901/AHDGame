/**
 * Internal supply policy settings. The CEO chooses market, own-plant or wholly
 * owned group priority. Changes take effect in the next plants-tier clearing.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { parseJsonBody } from "@/lib/api/validate";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import {
  DEFAULT_INTERNAL_SUPPLY_POLICY,
  ownRouteIdentity,
  resolveSupplyPolicies,
} from "@/lib/market/internalSupply/rules";
import type { SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";
import type { Corporation, CorporateSector, GameConfig, GameState } from "@/lib/db/types";

export const internalSupplyPolicySchema = z
  .object({
    priority: z.enum(["market", "own", "group"]),
    discount: z.number().finite().min(0).max(0.2),
    ownFirstAcrossStates: z.boolean().optional(),
  })
  .strict();
type Params = { params: Promise<{ id: string }> };

export async function internalSupplyPolicy(request: Request, { params }: Params) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const db = await getDb();
    const resolved = await resolveCorporation(db, (await params).id);
    if (!resolved.ok) return resolved.response;
    const corporation = resolved.corporation;
    const denied = requireCeo(corporation, auth.user.userId);
    if (denied) return denied;
    const mode = await getMarketSystemMode();
    const [config, world] = await Promise.all([
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { groupSupplyCoordinationEnabled: 1 } }),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { subsidiaryCorporationsEnabled: 1 } }),
    ]);
    const groupCoordinationActive =
      mode === "plants" &&
      config?.groupSupplyCoordinationEnabled === true &&
      world?.subsidiaryCorporationsEnabled === true;
    const available = marketAtLeast(mode, "plants") && !groupCoordinationActive;
    const owners = await db
      .collection<Corporation>("corporations")
      .find(
        {},
        { projection: { _id: 1, totalShares: 1, shareholders: 1, internalSupplyPolicy: 1 } }
      )
      .toArray();
    const effective = resolveSupplyPolicies(
      owners.map((c) => ({
        id: c._id.toString(),
        totalShares: c.totalShares,
        holders: (c.shareholders ?? []).map((h) => ({
          corporationId: h.corporationId?.toString(),
          shares: h.shares,
        })),
        policy: c.internalSupplyPolicy,
      }))
    ).get(corporation._id.toString());
    const inherited =
      effective?.root !== undefined && effective.root !== corporation._id.toString();
    if (request.method === "GET") {
      const sectors = await db
        .collection<CorporateSector>("corporateSectors")
        .find(
          { corporationId: corporation._id },
          {
            projection: {
              internalSupplyReceipt: 1,
            },
          }
        )
        .toArray();
      const lastTurn = Math.max(0, ...sectors.map((s) => s.internalSupplyReceipt?.turn ?? 0));
      const received: Record<string, number> = {};
      const reserved: Record<string, number> = {};
      let discountCostAnchor = 0;
      for (const s of sectors) {
        if (s.internalSupplyReceipt?.turn !== lastTurn) continue;
        for (const [key, units] of Object.entries(s.internalSupplyReceipt.received))
          received[key] = (received[key] ?? 0) + (units ?? 0);
        for (const [key, units] of Object.entries(s.internalSupplyReceipt.reserved))
          reserved[key] = (reserved[key] ?? 0) + (units ?? 0);
        discountCostAnchor += s.internalSupplyReceipt.discountCostAnchor ?? 0;
      }
      const network = await db
        .collection<SourcingNetworkDoc>("sourcingNetworkLoad")
        .findOne({}, { sort: { turn: -1 }, projection: { turn: 1, ownRouteDelivered: 1 } });
      const routeIdentity = ownRouteIdentity(corporation._id.toString(), effective);
      const ownHauls = (network?.ownRouteDelivered ?? [])
        .filter(
          (r) =>
            (r.corporationId === corporation._id.toString() || r.corporationId === routeIdentity) &&
            r.units > 0
        )
        .map((r) => ({
          commodity: r.commodity,
          originStateId: r.originStateId,
          destStateId: r.destStateId,
          units: r.units,
          freightPerUnitAnchor: (r.freightCharge ?? 0) / r.units,
        }));
      return NextResponse.json(
        {
          ownHaulTurn: network?.turn ?? null,
          ownHauls,
          policy: corporation.internalSupplyPolicy ?? DEFAULT_INTERNAL_SUPPLY_POLICY,
          effectivePolicy: effective?.policy ?? DEFAULT_INTERNAL_SUPPLY_POLICY,
          inherited,
          parentId: inherited ? effective?.root : null,
          available,
          groupCoordinationActive,
          lastTurn: lastTurn || null,
          received,
          reserved,
          discountCostAnchor,
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }
    if (groupCoordinationActive)
      return errorResponse(
        409,
        "Subsidiary Group coordination replaces internal priority in this world. Existing preferences are retained."
      );
    if (!available) return errorResponse(400, "Internal supply requires physical plant clearing");
    if (inherited)
      return errorResponse(409, "The wholly owning parent sets this group's supply policy");
    const parsed = await parseJsonBody(request, internalSupplyPolicySchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const write = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id, userId: corporation.userId, ceoVacant: { $ne: true } },
        { $set: { internalSupplyPolicy: parsed.data, updatedAt: new Date() } }
      );
    if (write.matchedCount !== 1)
      return errorResponse(409, "CEO authority changed; reload before saving");
    return NextResponse.json(
      { success: true, policy: parsed.data },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
