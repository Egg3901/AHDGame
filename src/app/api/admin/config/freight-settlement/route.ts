import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { getCurrentTurn } from "@/lib/currentTurn";
import type { GameConfig } from "@/lib/db/types";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";

const patchSchema = z.object({
  mode: z.enum(["shadow", "active"]),
});

type FreightSettlementMode = "shadow" | "active";

function resolveMode(value: unknown): FreightSettlementMode {
  return value === "active" ? "active" : "shadow";
}

// GET /api/admin/config/freight-settlement - Freight settlement rollout mode
// Auth: requireAdmin
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { freightSettlementMode: 1 } });

    return NextResponse.json({ mode: resolveMode(config?.freightSettlementMode) });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/freight-settlement - Set the freight settlement rollout
// Auth: requireAdmin
// Errors: 400, 403, 409
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { mode } = parsed.data;
    const db = await getDb();
    const gameConfig = db.collection<GameConfig>("gameConfig");
    const priorConfig = await gameConfig.findOne(
      { _id: "default" },
      { projection: { freightSettlementMode: 1 } }
    );
    const priorMode = resolveMode(priorConfig?.freightSettlementMode);
    const marketSystemMode = await getMarketSystemModeForDb(db);

    // Active settlement changes the next corporation turn's physical input
    // availability. Throughput begins at clearing, so refuse a configuration
    // that would look live but have no economic effect.
    if (mode === "active" && !marketAtLeast(marketSystemMode, "clearing")) {
      return NextResponse.json(
        { error: "Freight settlement requires market system mode clearing or higher." },
        { status: 409 }
      );
    }

    const currentTurn = await getCurrentTurn(db);
    const changedAt = new Date().toISOString();
    await gameConfig.updateOne(
      { _id: "default" },
      {
        $set: {
          freightSettlementMode: mode,
          freightSettlementModeUpdatedBy: auth.admin.username,
          freightSettlementModeUpdatedAt: changedAt,
          freightSettlementModeUpdatedTurn: currentTurn,
        },
      },
      { upsert: true }
    );

    await createAdminLog({
      category: "system",
      action: mode === "active" ? "freight_settlement_activated" : "freight_settlement_shadowed",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details:
        mode === "active"
          ? `Freight settlement activated (was "${priorMode}") at turn ${currentTurn}. Next corporation turn uses lagged delivered input availability.`
          : `Freight settlement set to shadow (was "${priorMode}") at turn ${currentTurn}. Routes remain observable with no plant-input effect.`,
    });

    return NextResponse.json({ success: true, mode, priorMode, currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
