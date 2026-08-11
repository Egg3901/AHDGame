import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { ALL_CRISIS_TEMPLATES, getTemplateDuration } from "@/lib/crises/templates";
import type { Crisis } from "@/lib/db/types/crisis";
import { isCrisisInteractionEnabled } from "@/lib/crises/featureFlag";
import { getGameState } from "@/lib/gameState";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { createCrisisInteraction } from "@/lib/crises/interactionEngine";
import { getAutoCrisisCatalog } from "@/lib/crises/autoCrisisSpawn";
import { loadCooldownMap } from "@/lib/crises/autoCrisisCooldown";
import { floorCrisisDuration } from "@/lib/crises/crisisDuration";
import { resolveCrisisLocationName, interpolateLocation } from "@/lib/crises/crisisLocation";
import { ObjectId } from "mongodb";

/** Mirrors {@link CrisisEffect}; nullable fields default to null to match the stored shape. */
const crisisEffectSchema = z.object({
  effectType: z.enum(["flat", "tick", "decay"]),
  targetType: z.enum(["metric", "approval", "profitMargin", "inflation", "gdpLoss", "stat"]),
  statKey: z.string().optional(),
  metricCategory: z.string().nullable().default(null),
  metricField: z.string().nullable().default(null),
  sectorType: z.string().nullable().default(null),
  strategyId: z.string().nullable().default(null),
  value: z.number(),
  label: z.string(),
});

/** Mode 1: template-based creation — `templateKey` present selects this branch. */
const templateCreateSchema = z.object({
  templateKey: z.string().min(1),
  countryIds: z.array(z.string()).optional(),
  regionIds: z.array(z.string()).optional(),
  durationTurns: z.number().int().nullish(),
});

/** Mode 2: form-based creation (from CrisesManager). */
const formCreateSchema = z.object({
  name: z.string().min(1, "Missing required fields: name, description, scope"),
  description: z.string().min(1, "Missing required fields: name, description, scope"),
  scope: z.enum(["global", "country", "region"]),
  countryIds: z.array(z.string()).optional(),
  regionIds: z.array(z.string()).optional(),
  durationTurns: z.number().int().nullish(),
  wireMessageOnStart: z.string().optional(),
  wireMessageOnEnd: z.string().nullish(),
  effects: z.array(crisisEffectSchema).optional(),
});

const createSchema = z.union([templateCreateSchema, formCreateSchema]);

/**
 * GET /api/admin/crises
 * List all crises (new endpoint for admin panel).
 * Auth: requireAdmin
 */
export async function GET() {
  try {
    const adminResult = await requireAdmin();
    if (!adminResult.ok) return adminResult.response;

    const db = await getDb();
    const crises = await db.collection<Crisis>("crises").find({}).sort({ createdAt: -1 }).toArray();
    // Surface the feature flag so the admin client can gate the template UI
    // without importing the server-only DB helper into the browser bundle.
    const interactionEnabled = await isCrisisInteractionEnabled();
    // Surface the game's starting year so the admin client labels start dates
    // against the active preset's calendar (e.g. 1991-default) rather than the
    // 2019 fallback baked into turnToLarpDate.
    const gameState = await getGameState(db);
    const startingYear = gameState?.startingYear ?? STARTING_YEAR;
    // Surface the auto-disaster master flag so the admin client can render its
    // On/Off toggle with the correct current state.
    const autoDisastersEnabled = gameState?.autoDisastersEnabled === true;
    const autoCrisisPaused = gameState?.autoCrisisPaused === true;

    // Auto-crisis catalog + live cooldown status for the Auto Crisis admin tab.
    const currentTurn = gameState?.currentTurn ?? 1;
    const autoTemplates = getAutoCrisisCatalog();
    const cooldownByTemplate = new Map(autoTemplates.map((t) => [t.key, t.cooldownTurns]));
    const cooldownMap = await loadCooldownMap(db);
    const autoCooldowns = Array.from(cooldownMap.values())
      .map((row) => {
        const cd = cooldownByTemplate.get(row.templateKey) ?? 0;
        return {
          templateKey: row.templateKey,
          scopeKey: row.scopeKey,
          lastSpawnTurn: row.lastSpawnTurn,
          remaining: Math.max(0, cd - (currentTurn - row.lastSpawnTurn)),
        };
      })
      .sort((a, b) => b.remaining - a.remaining);

    return NextResponse.json({
      crises,
      interactionEnabled,
      autoDisastersEnabled,
      autoCrisisPaused,
      startingYear,
      currentTurn,
      autoTemplates,
      autoCooldowns,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/admin/crises — create crisis
 * Supports two modes:
 *   1. Template-based: { templateKey, countryIds?, regionIds?, durationTurns? }
 *   2. Form-based: { name, description, scope, countryIds, regionIds, durationTurns,
 *                    wireMessageOnStart, wireMessageOnEnd, effects }
 */
export async function POST(req: Request) {
  try {
    const adminResult = await requireAdmin();
    if (!adminResult.ok) {
      return adminResult.response;
    }
    const admin = adminResult.admin;

    const parsed = await parseJsonBody(req, createSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;
    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);

    let crisis: Omit<Crisis, "_id">;

    if ("templateKey" in body) {
      // Template-based creation — only available when crisis interactions are enabled
      const enabled = await isCrisisInteractionEnabled();
      if (!enabled) {
        return NextResponse.json(
          { error: "Crisis interaction templates are not enabled" },
          { status: 403 }
        );
      }

      const template = ALL_CRISIS_TEMPLATES[body.templateKey];
      if (!template) {
        return NextResponse.json({ error: "Unknown template" }, { status: 400 });
      }

      crisis = {
        ...template,
        countryIds: template.scope === "global" ? [] : (body.countryIds ?? template.countryIds),
        regionIds: template.scope === "region" ? (body.regionIds ?? template.regionIds) : [],
        durationTurns: body.durationTurns ?? getTemplateDuration(template, template.scope),
        status: "active",
        createdBy: new ObjectId(admin.userId),
        createdAt: new Date(),
        resolvedAt: null,
        startTurn: currentTurn,
        endTurn: null,
      };
    } else {
      // Form-based creation (from CrisesManager)
      const {
        name,
        description,
        scope,
        countryIds,
        regionIds,
        durationTurns,
        wireMessageOnStart,
        wireMessageOnEnd,
        effects,
      } = body;

      crisis = {
        name,
        description,
        scope,
        countryIds: scope === "global" ? [] : (countryIds ?? []),
        regionIds: scope === "region" ? (regionIds ?? []) : [],
        durationTurns: durationTurns ?? null,
        status: "active",
        createdBy: new ObjectId(admin.userId),
        createdAt: new Date(),
        resolvedAt: null,
        startTurn: currentTurn,
        endTurn: null,
        wireMessageOnStart: wireMessageOnStart || name,
        wireMessageOnEnd: wireMessageOnEnd || null,
        effects: effects ?? [],
      } as Omit<Crisis, "_id">;
    }

    // Floor to the minimum crisis lifetime and bake the real affected-place name
    // into flavor/wire text (no-op when the text has no `{location}` token).
    crisis.durationTurns = floorCrisisDuration(crisis.durationTurns);
    const locationName = await resolveCrisisLocationName(db, crisis);
    crisis.description = interpolateLocation(crisis.description, locationName);
    crisis.wireMessageOnStart = interpolateLocation(crisis.wireMessageOnStart, locationName);
    if (crisis.wireMessageOnEnd) {
      crisis.wireMessageOnEnd = interpolateLocation(crisis.wireMessageOnEnd, locationName);
    }

    const result = await db.collection<Crisis>("crises").insertOne(crisis as Crisis);
    const insertedCrisis: Crisis = { ...(crisis as Crisis), _id: result.insertedId };

    // Create the interaction document immediately rather than waiting for the
    // turn processor's `turn === startTurn` branch (which is skipped once the
    // turn advances past the creation turn). Only when the feature is enabled.
    if (insertedCrisis.interactionDefinition && (await isCrisisInteractionEnabled())) {
      await createCrisisInteraction(db, insertedCrisis);
    }

    return NextResponse.json({
      success: true,
      crisisId: result.insertedId.toString(),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

async function getCurrentTurn(
  db: ReturnType<typeof getDb> extends Promise<infer T> ? T : never
): Promise<number> {
  // MUST filter on `_id: "current"`. The `gameState` collection is not
  // guaranteed to hold exactly one doc (a `debt_ceiling_crisis` squatter was
  // found live), so an unfiltered read can pick the wrong document and fall
  // back to turn 1 — dating every admin-created crisis to the start of time.
  const gameState = await getGameState(db);
  return gameState?.currentTurn ?? 1;
}
