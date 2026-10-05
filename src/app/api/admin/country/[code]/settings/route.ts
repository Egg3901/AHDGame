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
import { getCountryAccess } from "@/lib/countryAccess";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { GameState, CountryGameState } from "@/lib/db/types/gameState";
import {
  assessCountryReadiness,
  PlayerOpenBlockedError,
  resolvePresetIdFromGameState,
} from "@/lib/world/countryReadinessContract";
import { isShippingPreset, tierFor } from "@/lib/world/eraRoster";
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
  .refine(
    (data) =>
      data.enabledForPlayers !== undefined ||
      data.status !== undefined ||
      data.economyPreview !== undefined,
    { message: "At least one field required" }
  );

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
    const readiness = absentFromEra ? null : assessCountryReadiness(countryId, presetId);

    return NextResponse.json({
      enabledForPlayers: access.enabledForPlayers,
      status: access.status,
      economyPreview: access.economyPreview,
      absentFromEra,
      readiness: readiness
        ? {
            presetId: readiness.presetId,
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
      // enterCountryForPlayers already wrote enabledForPlayers (+ status when
      // provided). Apply economyPreview alone if also present.
      if (economyPreview !== undefined) {
        await db
          .collection<CountryGameState>("countryGameStates")
          .updateOne(
            { _id: countryId },
            { $set: { economyPreview, updatedAt: now } },
            { upsert: true }
          );
      }
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
    if (status !== undefined) updateFields.status = status;
    if (economyPreview !== undefined) updateFields.economyPreview = economyPreview;

    await db
      .collection<CountryGameState>("countryGameStates")
      .updateOne({ _id: countryId }, { $set: updateFields }, { upsert: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
