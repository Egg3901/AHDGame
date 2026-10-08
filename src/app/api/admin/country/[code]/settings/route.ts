/**
 * GET  /api/admin/country/[code]/settings — read country settings + live stats
 * PATCH /api/admin/country/[code]/settings — update enabledForPlayers, status, and/or economyPreview
 * Auth: requireAdmin()
 * Errors: 400 invalid country code | 400 invalid body | 403 not admin
 *         | 409 player-open blocked by readiness contract
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getCountryAccess, getCountryAccessFromDb, type CountryAccess } from "@/lib/countryAccess";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { GameState, CountryGameState } from "@/lib/db/types/gameState";
import {
  assertCanEnableCountryEconomyPreview,
  assessCountryReadiness,
  EconomyPreviewBlockedError,
  PlayerOpenBlockedError,
  readinessBlockersForScope,
  resolvePresetIdFromGameState,
  type CountryReadinessReport,
  type FailedCapability,
} from "@/lib/world/countryReadinessContract";
import { isShippingPreset, tierFor } from "@/lib/world/eraRoster";
import {
  countryBackgroundModeForEraTier,
  countryRequirementLevelForEraTier,
  type CountryRequirementLevel,
} from "@/lib/world/countryRequirementLevel";
import { enterCountryForPlayers, exitCountryForPlayers } from "@/lib/world/playerHandoff";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const settingsSchema = z
  .object({
    enabledForPlayers: z.boolean().optional(),
    status: z.enum(["active", "beta", "coming-soon"]).optional(),
    economyPreview: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enabledForPlayers === true && data.economyPreview === true) {
      ctx.addIssue({
        code: "custom",
        message: "A country cannot be player enabled and economy preview at the same time",
        path: ["economyPreview"],
      });
    }
  })
  .refine(
    (data) =>
      data.enabledForPlayers !== undefined ||
      data.status !== undefined ||
      data.economyPreview !== undefined,
    { message: "At least one field required" }
  );

interface ReadinessProfileRow {
  level: CountryRequirementLevel;
  label: "Background" | "Economy Preview" | "Player Enabled";
  status: "ready" | "not-ready";
  blockers: FailedCapability[];
}

function unavailableWorldBlocker(countryId: CountryId, presetId: string): FailedCapability {
  return {
    capabilityId: "fullAutonomousTier",
    label: "World entity classification",
    evidence: `${countryId} is not an autonomous world entity in ${presetId}.`,
  };
}

function buildReadinessProfiles(input: {
  countryId: CountryId;
  presetId: string;
  activeLevel: CountryRequirementLevel;
  report: CountryReadinessReport | null;
}): {
  presetId: string;
  source: "reset-preset";
  activeLevel: CountryRequirementLevel;
  presetLevel: CountryRequirementLevel;
  backgroundMode: "npp" | "latent" | "absent" | null;
  contentStatus: "complete" | "gaps" | "not-assessed";
  contentGaps: FailedCapability[];
  profiles: ReadinessProfileRow[];
} {
  const tier = isShippingPreset(input.presetId) ? tierFor(input.presetId, input.countryId) : null;
  const backgroundMode = tier ? countryBackgroundModeForEraTier(tier) : null;
  const missingWorld = unavailableWorldBlocker(input.countryId, input.presetId);
  const autonomousBlockers = input.report
    ? readinessBlockersForScope(input.report, "autonomous")
    : [missingWorld];
  const playerBlockers = input.report
    ? readinessBlockersForScope(input.report, "player")
    : [missingWorld];

  return {
    presetId: input.presetId,
    source: "reset-preset",
    activeLevel: input.activeLevel,
    presetLevel: tier ? countryRequirementLevelForEraTier(tier) : input.activeLevel,
    backgroundMode,
    contentStatus: input.report?.contentStatus ?? "not-assessed",
    contentGaps: input.report?.flavorGaps ?? [],
    profiles: [
      {
        level: "background",
        label: "Background",
        status: backgroundMode !== "absent" && !input.report ? "not-ready" : "ready",
        blockers: backgroundMode !== "absent" && !input.report ? [missingWorld] : [],
      },
      {
        level: "economy-preview",
        label: "Economy Preview",
        status: input.report?.autonomous === "ready" ? "ready" : "not-ready",
        blockers: autonomousBlockers,
      },
      {
        level: "player-enabled",
        label: "Player Enabled",
        status: input.report?.player === "ready" ? "ready" : "not-ready",
        blockers: playerBlockers,
      },
    ],
  };
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const db = await getDb();

    const [access, gameState, activePlayers, activeNpps, politicalParties] = await Promise.all([
      getCountryAccess(countryId),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      db.collection("characters").countDocuments({ countryId }),
      db.collection("npps").countDocuments({ countryId }),
      db.collection("politicalParties").countDocuments({ countryId }),
    ]);

    const presetId = resolvePresetIdFromGameState(gameState);
    // A country the era roster marks `absent` is not a world entity in this
    // preset, so the readiness contract refuses to assess it rather than
    // fabricating a verdict. Answer the admin explicitly instead of 500ing:
    // "East Germany does not exist in a 2019 world" is the useful response.
    const absentFromEra = isShippingPreset(presetId) && tierFor(presetId, countryId) === "absent";
    let readiness: CountryReadinessReport | null = null;
    if (!absentFromEra) {
      try {
        readiness = assessCountryReadiness(countryId, presetId);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/^World entity .+ is not classified for preset .+; refusing fallback\.$/.test(
            error.message
          )
        ) {
          throw error;
        }
        // The readiness profile below turns a missing manifest entry into an
        // explicit blocker instead of making the whole admin card fail.
      }
    }
    const readinessProfiles = buildReadinessProfiles({
      countryId,
      presetId,
      activeLevel: access.requirementLevel,
      report: readiness,
    });

    return NextResponse.json({
      enabledForPlayers: access.enabledForPlayers,
      status: access.status,
      economyPreview: access.economyPreview,
      absentFromEra,
      readinessProfiles,
      readiness: readiness
        ? {
            presetId: readiness.presetId,
            requirementLevel: readiness.requirementLevel,
            requirementStatus: readiness.requirementStatus,
            requirementBlockers: readiness.requirementBlockers,
            backgroundMode: readiness.backgroundMode,
            contentStatus: readiness.contentStatus,
            archetypes: readiness.archetypes,
            autonomous: readiness.autonomous,
            player: readiness.player,
            hardBlockers: readiness.hardBlockers,
            flavorGaps: readiness.flavorGaps,
          }
        : null,
      stats: {
        currentTurn: gameState?.currentTurn ?? null,
        currentYear: gameState?.currentYear ?? null,
        activePlayers,
        activeNpps,
        politicalParties,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const parsed = await parseJsonBody(request, settingsSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const { enabledForPlayers, status, economyPreview } = parsed.data;

    const db = await getDb();
    const now = new Date();
    let currentAccess: CountryAccess | null = null;
    const readCurrentAccess = async (): Promise<CountryAccess> => {
      currentAccess ??= await getCountryAccessFromDb(db, countryId);
      return currentAccess;
    };

    if (economyPreview === true) {
      if (enabledForPlayers !== false && (await readCurrentAccess()).enabledForPlayers) {
        return errorResponse(
          409,
          `Cannot enable economy preview for ${countryId} while it is enabled for players. Disable player access in the same request first.`
        );
      }
      const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      const presetId = resolvePresetIdFromGameState(gameState);
      if (isShippingPreset(presetId) && tierFor(presetId, countryId) === "absent") {
        return errorResponse(
          409,
          `Cannot enable economy preview for ${countryId} under ${presetId}: the country is absent from this era.`
        );
      }
      try {
        assertCanEnableCountryEconomyPreview(countryId, presetId);
      } catch (err) {
        if (err instanceof EconomyPreviewBlockedError) {
          return errorResponse(409, err.message, {
            extra: {
              readiness: {
                presetId: err.report.presetId,
                autonomous: err.report.autonomous,
                player: err.report.player,
                hardBlockers: err.report.hardBlockers,
                flavorGaps: err.report.flavorGaps,
              },
            },
          });
        }
        throw err;
      }
    }

    // Mid-world player handoff (#3725): open/close go through the handoff
    // module so readiness is gated, live state is preserved, and exit vacates
    // claimable player offices without an instant NPP replacement.
    if (enabledForPlayers === true) {
      try {
        await enterCountryForPlayers(db, countryId, {
          now,
          status,
        });
      } catch (err) {
        if (err instanceof PlayerOpenBlockedError) {
          return errorResponse(409, err.message, {
            extra: {
              readiness: {
                presetId: err.report.presetId,
                archetypes: err.report.archetypes,
                autonomous: err.report.autonomous,
                player: err.report.player,
                hardBlockers: err.report.hardBlockers,
                flavorGaps: err.report.flavorGaps,
              },
            },
          });
        }
        throw err;
      }
      // enterCountryForPlayers writes the mutually-exclusive access state,
      // including clearing any stale economy-preview flag.
      return NextResponse.json({ success: true });
    }

    if (enabledForPlayers === false) {
      await exitCountryForPlayers(db, countryId, { now });
      const extra: Record<string, unknown> = { updatedAt: now };
      if (status !== undefined) extra.status = status;
      if (economyPreview !== undefined) extra.economyPreview = economyPreview;
      if (status !== undefined || economyPreview !== undefined) {
        await db
          .collection<CountryGameState>("countryGameStates")
          .updateOne({ _id: countryId }, { $set: extra }, { upsert: true });
      }
      return NextResponse.json({ success: true });
    }

    const updateFields: Record<string, unknown> = { updatedAt: now };
    if (status !== undefined) {
      updateFields.status = status;
      // `status: active` is a display/lifecycle setting, not an authorization
      // bypass. Persist the currently resolved access value so legacy fallback
      // logic cannot turn a status-only upsert into player access.
      updateFields.enabledForPlayers = (await readCurrentAccess()).enabledForPlayers;
    }
    if (economyPreview !== undefined) updateFields.economyPreview = economyPreview;

    await db
      .collection<CountryGameState>("countryGameStates")
      .updateOne({ _id: countryId }, { $set: updateFields }, { upsert: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
