/**
 * POST /api/admin/setup
 *
 * One-shot idempotent setup route that ensures every collection the app
 * needs at runtime is populated. Safe to call repeatedly - each step
 * skips work that has already been done.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { initializeGameState } from "@/lib/turnSystem";
import { parseJsonBody } from "@/lib/api/validate";
import { ZOD_COUNTRY_ENUM } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types";

// Individual CountryId values or "all" (every active country).
// "both" is accepted for backward compatibility but treated as "all".
const setupSchema = z.object({
  scope: z.union([z.enum(ZOD_COUNTRY_ENUM), z.enum(["all", "both"])]).optional(),
});

import {
  seedStates,
  seedPolicies,
  seedDemographics,
  seedGameConfig,
  seedParties,
  seedStatePartyOrg,
  seedRegionMetrics,
  seedLegislationTypes,
  seedAchievements,
  seedStatePolicies,
  seedBudgets,
  seedUkBudgets,
  seedJpBudgets,
  seedSeats,
  seedPartyBudgets,
  seedUnownedSectors,
  seedStateSectorSpecializations,
  seedIndexes,
  seedCountyMapData,
  seedJPRegions,
  seedJPParties,
  seedJPDemographics,
  seedJPStatePartyOrg,
  seedJPStateMetrics,
  seedJPBaselines,
  seedJPGovernmentFormation,
  removeLegacyJPCeremonialIdentity,
} from "@/lib/admin/seed";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const [
      usStatesCount,
      ukRegionsCount,
      policiesCount,
      gameConfig,
      gameState,
      officialsCount,
      electionsCount,
      partiesCount,
      demographicsCount,
      seatsCount,
      partyBudgetCount,
      unownedSectorCount,
    ] = await Promise.all([
      db.collection("states").countDocuments({ countryId: "US" }),
      db.collection("states").countDocuments({ countryId: "UK" }),
      db.collection("policies").countDocuments(),
      db.collection<{ _id: string }>("gameConfig").findOne({ _id: "default" }),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      db.collection("electedOfficials").countDocuments(),
      db.collection("elections").countDocuments(),
      db.collection("politicalParties").countDocuments(),
      db.collection("stateDemographics").countDocuments(),
      db.collection("seats").countDocuments(),
      db.collection("partyBudget").countDocuments(),
      db.collection("unownedSectors").countDocuments(),
    ]);

    const checks = {
      usStates: usStatesCount > 0,
      ukRegions: ukRegionsCount > 0,
      policies: policiesCount > 0,
      gameConfig: !!gameConfig,
      gameState: !!gameState,
      parties: partiesCount > 0,
      demographics: demographicsCount > 0,
      seats: seatsCount > 0,
      partyBudgets: partyBudgetCount > 0,
      unownedSectors: unownedSectorCount > 0,
      electedOfficials: officialsCount > 0,
      elections: electionsCount > 0,
    };

    return NextResponse.json({
      ready: Object.values(checks).every(Boolean),
      checks,
      gameState: gameState
        ? {
            currentTurn: gameState.currentTurn,
            isActive: gameState.isActive,
            corporationActionsPaused: gameState.corporationActionsPaused ?? false,
            playerTransfersPaused: gameState.playerTransfersPaused ?? false,
          }
        : null,
      counts: {
        usStates: usStatesCount,
        ukRegions: ukRegionsCount,
        policies: policiesCount,
        officials: officialsCount,
        elections: electionsCount,
        parties: partiesCount,
        demographics: demographicsCount,
        seats: seatsCount,
        partyBudgets: partyBudgetCount,
        unownedSectors: unownedSectorCount,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, setupSchema);
    const body = parsed.success ? parsed.data : {};
    const scope: string = body.scope ?? "US";
    // "both" is legacy — treat as "all"
    const seedAll = scope === "all" || scope === "both";

    const db = await getDb();
    // The era preset of the world being reseeded. Every seeder below takes an
    // optional `preset` that silently DEFAULTS TO "2019-default", so omitting it
    // wrote 2019 policy catalogues, budgets and sector weights into whatever era
    // the world actually is — latent state corruption that only shows up later
    // as anachronistic content. Read it once and thread it everywhere.
    const gsPreset = await db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    const preset = gsPreset?.preset ?? DEFAULT_SEED_PRESET;
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    log("=== Step 1: Seeding reference and runtime data ===");

    if (scope === "US" || seedAll) {
      await seedStates(db, false, log, preset);
      await seedPolicies(db, false, log);
      await seedDemographics(db, false, log);
      await seedGameConfig(db, false, log);
      await seedParties(db, log);
      await seedStatePartyOrg(db, log, preset);
      await seedRegionMetrics(db, false, log, preset);
      await seedLegislationTypes(db, false, log, preset);
      await seedAchievements(db, false, log);
      await seedStatePolicies(db, false, log, preset);
      await seedBudgets(db, false, log, preset);
      await seedSeats(db, false, log, preset);
      await seedPartyBudgets(db, false, log);
      await seedUnownedSectors(db, log, 1, preset);
    }

    if (scope === "UK" || seedAll) {
      const {
        seedUKRegions,
        seedUKParties,
        seedUKDemographics,
        seedUKStatePartyOrg,
        seedUKStateMetrics,
        seedUKBaselines,
        seedUKElections,
        removeLegacyUKCeremonialIdentity,
      } = await import("@/lib/admin/seed/seedUK");

      await seedUKRegions(db, false, log, preset);
      await seedUKParties(db, log);
      await seedUKDemographics(db, false, log, preset);
      await seedUKStatePartyOrg(db, false, log);
      await seedUKStateMetrics(db, false, log);
      await seedUKBaselines(db, false, log, preset);
      await removeLegacyUKCeremonialIdentity(db, log);
      await seedUkBudgets(db, false, log, preset);
      await seedSeats(db, false, log, preset);
      await seedPartyBudgets(db, false, log);
      await seedUnownedSectors(db, log, 1, preset);
      await seedUKElections(log);
    }

    if (scope === "JP" || seedAll) {
      await seedJPRegions(db, false, log, preset);
      await seedJPParties(db, log);
      await seedJPDemographics(db, false, log, preset);
      await seedJPStatePartyOrg(db, false, log);
      await seedJPStateMetrics(db, false, log, preset);
      await seedJPBaselines(db, false, log, preset);
      await seedJPGovernmentFormation(db, log);
      await removeLegacyJPCeremonialIdentity(db, log);
      await seedJpBudgets(db, false, log, preset);
      await seedSeats(db, false, log, preset);
      await seedPartyBudgets(db, false, log);
      await seedUnownedSectors(db, log, 1, preset);
    }

    await seedStateSectorSpecializations(db, false, log);

    if (scope === "US" || seedAll) {
      await seedCountyMapData(log);
    }

    log("=== Step 2: Initializing game state ===");
    const gameState = await initializeGameState();
    log(
      gameState.currentTurn === 1
        ? "Created fresh game state (turn 1, paused)"
        : `Game state already exists (turn ${gameState.currentTurn})`
    );

    log("=== Step 3: Checking elected officials ===");
    const officialsCount = await db.collection("electedOfficials").countDocuments();

    if (officialsCount === 0) {
      log("No officials found - initializing default vacant-world officials");
      const { initializeOfficials } = await import("@/lib/admin/bootstrap/initializeOfficials");
      const officialResult = await initializeOfficials(db);
      log(officialResult.message);
    } else {
      log(`Officials already initialized (${officialsCount} records)`);
    }

    log("=== Step 4: Ensuring database indexes ===");
    await seedIndexes(db, log);

    return NextResponse.json({
      success: true,
      message: `Setup completed (${logs.length} operations)`,
      scope,
      logs,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
