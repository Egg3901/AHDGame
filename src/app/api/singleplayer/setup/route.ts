import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resetAndBootstrapGameWorld } from "@/lib/admin/resetAndBootstrapGameWorld";
import { isKnownPreset } from "@/lib/seeds/presetSelector";
import { ensureSingleplayerUser, setSingleplayerConfig } from "@/lib/singleplayerServer";
import type { NppAutonomyLevel, SingleplayerDifficulty, SingleplayerMode } from "@/lib/db/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const bodySchema = z.object({
  preset: z.string().min(1),
  mode: z.enum(["normal", "head-of-state", "worldsim"] satisfies [
    SingleplayerMode,
    ...SingleplayerMode[],
  ]),
  difficulty: z
    .enum(["easy", "normal", "hard"] satisfies [
      SingleplayerDifficulty,
      ...SingleplayerDifficulty[],
    ])
    .default("normal"),
  autonomyLevel: z
    .enum(["off", "v0", "v1", "v2", "v3", "v4"] satisfies [NppAutonomyLevel, ...NppAutonomyLevel[]])
    .default("v4"),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
});

/** Create a fresh local world and persist its setup mode before play begins. */
export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;

  try {
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { preset, mode, difficulty, autonomyLevel, featureFlags, displayName } = parsed.data;
    if (!isKnownPreset(preset)) {
      return NextResponse.json({ error: `Unknown preset "${preset}"` }, { status: 400 });
    }

    const db = await getDb();
    await ensureSingleplayerUser(db, displayName);
    const logs: string[] = [];
    const { reset } = await resetAndBootstrapGameWorld({
      db,
      preset,
      deleteProfiles: true,
      log: (line) => logs.push(line),
    });
    const config = await setSingleplayerConfig(db, {
      mode,
      difficulty,
      nppAutonomyLevel: autonomyLevel,
      featureFlags,
      permanentHeadOfState: mode === "head-of-state",
    });
    await ensureSingleplayerUser(db, displayName);

    return NextResponse.json({ ok: true, preset, mode, config, reset, logs });
  } catch (error) {
    return handleRouteError(error);
  }
}
