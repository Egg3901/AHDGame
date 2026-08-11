// GET /api/admin/config/extraction - Current prospecting / contract-issuance flag state.
// PATCH /api/admin/config/extraction - Toggle prospecting / contract-issuance feature flags.
// Auth: requireAdmin
// Errors: 400, 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";
import { adminExtractionConfigSchema } from "@/lib/api/schemas/prospecting";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          prospectingEnabled: 1,
          prospectingEnabledUpdatedBy: 1,
          prospectingEnabledUpdatedAt: 1,
          contractIssuanceEnabled: 1,
          contractIssuanceEnabledUpdatedBy: 1,
          contractIssuanceEnabledUpdatedAt: 1,
        },
      }
    );

    return NextResponse.json({
      prospectingEnabled: config?.prospectingEnabled === true,
      contractIssuanceEnabled: config?.contractIssuanceEnabled === true,
      prospectingEnabledUpdatedBy: config?.prospectingEnabledUpdatedBy ?? null,
      prospectingEnabledUpdatedAt: config?.prospectingEnabledUpdatedAt ?? null,
      contractIssuanceEnabledUpdatedBy: config?.contractIssuanceEnabledUpdatedBy ?? null,
      contractIssuanceEnabledUpdatedAt: config?.contractIssuanceEnabledUpdatedAt ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, adminExtractionConfigSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { prospectingEnabled, contractIssuanceEnabled } = parsed.data;

    const db = await getDb();
    const nowIso = new Date().toISOString();
    const by = auth.admin.username;

    const set: Record<string, unknown> = {};
    if (prospectingEnabled !== undefined) {
      set.prospectingEnabled = prospectingEnabled;
      set.prospectingEnabledUpdatedBy = by;
      set.prospectingEnabledUpdatedAt = nowIso;
    }
    if (contractIssuanceEnabled !== undefined) {
      set.contractIssuanceEnabled = contractIssuanceEnabled;
      set.contractIssuanceEnabledUpdatedBy = by;
      set.contractIssuanceEnabledUpdatedAt = nowIso;
    }

    await db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: "default" }, { $set: set }, { upsert: true });

    if (prospectingEnabled !== undefined) {
      await createAdminLog({
        category: "system",
        action: prospectingEnabled ? "prospecting_enabled" : "prospecting_disabled",
        username: by,
        adminUsername: by,
        details: `Resource prospecting ${prospectingEnabled ? "enabled" : "disabled"}.`,
      });
    }
    if (contractIssuanceEnabled !== undefined) {
      await createAdminLog({
        category: "system",
        action: contractIssuanceEnabled
          ? "contract_issuance_enabled"
          : "contract_issuance_disabled",
        username: by,
        adminUsername: by,
        details: `Extraction-contract issuance ${contractIssuanceEnabled ? "enabled" : "disabled"}.`,
      });
    }

    return NextResponse.json({
      success: true,
      prospectingEnabled,
      contractIssuanceEnabled,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
