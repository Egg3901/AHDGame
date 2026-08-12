// POST /api/admin/conflicts/cold-war/create
// Create a Cold War Conflict hosted in one or more third-party world entities.
//
// This is the SOLE validation boundary for `hostCountry`/`hostEntities`: widening them
// to WorldEntityId (which is `string`) removed all compile-time checking, and nothing
// else in the game creates a `cold_war` conflict — `declareWar` only builds interstate
// wars between playable countries.
//
// Auth: requireAdmin. Errors: 400, 403, 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";
import type { ConflictSide } from "@/lib/db/types/conflict";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import { createConflict } from "@/lib/military/createConflict";
import { validateColdWarConflict } from "@/lib/military/validateCreateConflict";
import { conflictExists } from "@/lib/db/collections/conflicts";

const sideSchema = z.object({
  label: z.string().min(1).max(80),
  factionEntity: z.string().min(2).max(8),
  backer: z.enum(["west", "east"]),
  tokenStrength: z.number().min(0).max(500).optional(),
});

const bodySchema = z.object({
  name: z.string().min(3).max(120),
  hostCountry: z.string().min(2).max(8),
  hostEntities: z.array(z.string().min(2).max(8)).min(1).max(6),
  sideA: sideSchema,
  sideB: sideSchema,
});

/** A faction side: generated, empty roster, addressed by its entity id. */
function toSide(input: z.infer<typeof sideSchema>): ConflictSide {
  return {
    label: input.label.trim(),
    // `countries: []` is the generated contract. It stays empty for the life of the
    // conflict even after patrons join, which is what keeps peace offers refused.
    countries: [],
    kind: "generated",
    backer: input.backer,
    factionEntity: input.factionEntity.toUpperCase(),
    ...(input.tokenStrength != null ? { tokenStrength: input.tokenStrength } : {}),
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gs = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { conflictsEnabled: 1, currentTurn: 1, preset: 1 } }
      );
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const preset = typeof gs.preset === "string" ? gs.preset : DEFAULT_SEED_PRESET;
    const knownEntityIds = new Set(
      getWorldEntityPresetManifest(preset).entries.map((e) => e.entityId)
    );

    const draft = {
      name: parsed.data.name.trim(),
      hostCountry: parsed.data.hostCountry.toUpperCase(),
      hostEntities: parsed.data.hostEntities.map((h) => h.toUpperCase()),
      sideA: toSide(parsed.data.sideA),
      sideB: toSide(parsed.data.sideB),
    };

    const check = validateColdWarConflict(draft, {
      knownEntityIds,
      isCountryId: (id) => id in COUNTRY_CONFIGS,
    });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const currentTurn = gs.currentTurn ?? 0;
    const id = `cw_${draft.hostCountry}_${currentTurn}`.toLowerCase();
    // The id is derived from host + turn, so creating two proxy wars in the same host on
    // the same turn would collide. `createConflict` inserts unconditionally, so without
    // this the admin gets a duplicate-key 500 instead of a sentence they can act on.
    if (await conflictExists(db, id)) {
      return NextResponse.json(
        { error: "A conflict was already created in that host this turn." },
        { status: 409 }
      );
    }

    const conflict = await createConflict(db, {
      id,
      name: draft.name,
      hostCountry: draft.hostCountry,
      hostEntities: draft.hostEntities,
      type: "cold_war",
      sideA: draft.sideA,
      sideB: draft.sideB,
      // Not "player": no player declared this, and `createdBy` drives the record page's
      // "Undeclared" copy.
      createdBy: "event",
      startTurn: currentTurn,
    });

    return NextResponse.json({
      ok: true,
      conflictId: conflict.conflictId,
      theaterId: conflict._id,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
