// POST /api/admin/corporations/spawn-npp-all
// Admin-only: batch spawn NPP corporations across every country the active
// preset's access tier calls for. Player-enabled countries get 1 corp/sector,
// econ-preview market democracies get 2/sector; planned economies and
// unconfigured/latent regions are skipped. Idempotent per country.
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { batchSpawnNppCorporations } from "@/lib/admin/spawnNppCorporation";
import { nppCorpSpawnPlan } from "@/lib/admin/seed/seedNppCorporations";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const preset = await getGameStatePresetOrDefault(db);
    const plan = nppCorpSpawnPlan(preset, getStartingYearForPreset(preset));

    const results: Array<{
      countryId: string;
      spawned: number;
      perSectorCount: number;
      errors: string[];
    }> = [];

    for (const { countryId, perSectorCount } of plan) {
      // Idempotent: skip countries that already have NPP corps.
      const existingCount = await db
        .collection("corporations")
        .countDocuments({ ceoType: "npp", countryId });
      if (existingCount > 0) {
        results.push({
          countryId,
          spawned: 0,
          perSectorCount,
          errors: [`Already has ${existingCount} NPP corps — skipping`],
        });
        continue;
      }

      try {
        const spawned = await batchSpawnNppCorporations(db, countryId, {
          perSectorCount,
        });
        results.push({ countryId, spawned: spawned.length, perSectorCount, errors: [] });
      } catch (err) {
        results.push({
          countryId,
          spawned: 0,
          perSectorCount,
          errors: [err instanceof Error ? err.message : String(err)],
        });
      }
    }

    const totalSpawned = results.reduce((sum, r) => sum + r.spawned, 0);

    return NextResponse.json({ success: true, preset, totalSpawned, results }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
