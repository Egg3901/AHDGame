import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { handleRouteError } from "@/lib/api/errors";
import type { GameState } from "@/lib/db/types";
import { MAX_WORLD_SIM_TURNS } from "@/lib/singleplayerWorld";
import { getSingleplayerConfig } from "@/lib/singleplayerServer";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import {
  getCountryConfig,
  COUNTRY_CONFIGS,
  getCountryDisplayName,
} from "@/lib/constants/countries";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export const dynamic = "force-dynamic";

/**
 * Return the authored world controls the setup screen can display.
 *
 * Both axes are reported from persisted state, never invented here:
 *   - `autonomyLevel` (game state) — WHICH activities autonomous politicians may
 *     perform.
 *   - `difficulty` (singleplayerConfig) — HOW COMPETENTLY they perform them, plus
 *     the NPP resource tuning in `singleplayerDifficulty/rules/index.ts`. Local
 *     worlds only; a hosted world has no singleplayerConfig and reports the
 *     `normal` default, which is the shipped behavior.
 */
export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  try {
    const db = await getDb();
    const [state, singleplayerConfig, enabledIds] = await Promise.all([
      db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            currentTurn: 1,
            currentYear: 1,
            preset: 1,
            nppAutonomyLevel: 1,
            nppAutonomyEnabled: 1,
            forexEnabled: 1,
            rpgStatsEnabled: 1,
            onboardingChecklistEnabled: 1,
            playerRandomEventsEnabled: 1,
            autoSectorSeedEnabled: 1,
            extractionAutoStrategyEnabled: 1,
            nppEntryViabilityMode: 1,
            nppCorpStrategyEnabled: 1,
            redistrictingEnabled: 1,
            sectorTechTreesEnabled: 1,
            subsidiaryCorporationsEnabled: 1,
            embargoTradeExposureEnabled: 1,
            liveElectionResultsEnabled: 1,
            legislationDemographicEffectsV2Enabled: 1,
            seasonRecapEnabled: 1,
            intOrgAlignmentEnabled: 1,
            settlementCrisisEnabled: 1,
            eurozoneEnabled: 1,
          },
        }
      ),
      getSingleplayerConfig(db),
      getEnabledCountryIds(),
    ]);
    const enabled = new Set(enabledIds.map((id) => id.toUpperCase()));
    const seededByCountry = new Map(
      getWorldEntityPresetManifest(state?.preset ?? DEFAULT_SEED_PRESET)
        .entries.filter((entry) => entry.countryId)
        .map((entry) => [entry.countryId!, entry] as const)
    );
    const seededNations = [...seededByCountry.keys()].map((countryId) => {
      const config = getCountryConfig(countryId, state?.preset);
      return {
        id: countryId.toLowerCase(),
        name: getCountryDisplayName(countryId, state?.preset),
        governmentType: config.governmentType,
        headOfStateTitle: config.headOfStateTitle ?? null,
      };
    });
    const playableNations = Object.values(COUNTRY_CONFIGS)
      .filter((country) => enabled.has(country.id))
      .map((country) => ({
        id: country.id.toLowerCase(),
        name: getCountryDisplayName(country.id, state?.preset),
        governmentType: country.governmentType,
        headOfStateTitle: country.headOfStateTitle ?? null,
      }));

    return NextResponse.json(
      {
        maxTurns: MAX_WORLD_SIM_TURNS,
        mode: singleplayerConfig?.mode ?? null,
        difficulty: singleplayerConfig?.difficulty ?? "normal",
        autonomyLevel:
          singleplayerConfig?.nppAutonomyLevel ??
          state?.nppAutonomyLevel ??
          (state?.nppAutonomyEnabled ? "v0" : "off"),
        permanentHeadOfState: singleplayerConfig?.permanentHeadOfState === true,
        playableNations,
        // The spectator view needs the complete preset-scoped seeded roster,
        // including nations that are not currently enabled as player starts.
        nations: seededNations,
        turn: state?.currentTurn ?? null,
        year: state?.currentYear ?? null,
        preset: state?.preset ?? null,
        nppAutonomyLevel: state?.nppAutonomyLevel ?? (state?.nppAutonomyEnabled ? "v0" : "off"),
        featureFlags: {
          forexEnabled: state?.forexEnabled === true,
          rpgStatsEnabled: state?.rpgStatsEnabled === true,
          onboardingChecklistEnabled: state?.onboardingChecklistEnabled === true,
          playerRandomEventsEnabled: state?.playerRandomEventsEnabled === true,
          autoSectorSeedEnabled: state?.autoSectorSeedEnabled === true,
          extractionAutoStrategyEnabled: state?.extractionAutoStrategyEnabled === true,
          nppEntryViabilityMode: state?.nppEntryViabilityMode ?? "observe",
          nppCorpStrategyEnabled: state?.nppCorpStrategyEnabled !== false,
          redistrictingEnabled: state?.redistrictingEnabled === true,
          sectorTechTreesEnabled: state?.sectorTechTreesEnabled === true,
          subsidiaryCorporationsEnabled: state?.subsidiaryCorporationsEnabled === true,
          embargoTradeExposureEnabled: state?.embargoTradeExposureEnabled === true,
          liveElectionResultsEnabled: state?.liveElectionResultsEnabled === true,
          legislationDemographicEffectsV2Enabled:
            state?.legislationDemographicEffectsV2Enabled === true,
          seasonRecapEnabled: state?.seasonRecapEnabled === true,
          intOrgAlignmentEnabled: state?.intOrgAlignmentEnabled === true,
          settlementCrisisEnabled: state?.settlementCrisisEnabled === true,
          eurozoneEnabled: state?.eurozoneEnabled === true,
          ...singleplayerConfig?.featureFlags,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
