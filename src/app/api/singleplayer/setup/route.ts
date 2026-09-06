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
import {
  noteSingleplayerSetupWork,
  setSingleplayerSetupProgress,
} from "@/lib/singleplayer/setupProgress";

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
    .enum(["off", "v0", "v1", "v2", "v3", "v4", "v5"] satisfies [
      NppAutonomyLevel,
      ...NppAutonomyLevel[],
    ])
    // A request that omits the level gets v4, the shipped default. V5 is opt-in
    // until the local-world default moves, so an older client cannot land a
    // world on a tier it has no UI for.
    .default("v4"),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
});

/** Create a fresh local world and persist its setup mode before play begins. */
export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;

  try {
    setSingleplayerSetupProgress({
      active: true,
      phase: "preparing",
      label: "Preparing your world",
      detail: "Checking the selected era and local database",
      progress: 2,
    });
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { preset, mode, difficulty, autonomyLevel, featureFlags, displayName } = parsed.data;
    if (!isKnownPreset(preset)) {
      return NextResponse.json({ error: `Unknown preset "${preset}"` }, { status: 400 });
    }

    const db = await getDb();
    const logs: string[] = [];
    setSingleplayerSetupProgress({
      phase: "clearing",
      label: "Preparing a clean timeline",
      detail: "Clearing incomplete world data",
      progress: 5,
    });
    const { reset } = await resetAndBootstrapGameWorld({
      db,
      preset,
      deleteProfiles: true,
      skipDiagnostic: true,
      recordRunLog: false,
      log: (line) => {
        logs.push(line);
        if (!line.startsWith("[reset]") && !line.startsWith("World sealed")) {
          setSingleplayerSetupProgress({ phase: "building", label: "Building the world" });
        }
        noteSingleplayerSetupWork(line);
      },
    });
    setSingleplayerSetupProgress({
      phase: "finalizing",
      label: "Opening your world",
      detail: "Saving game rules and your local profile",
      progress: 94,
    });
    const config = await setSingleplayerConfig(db, {
      mode,
      difficulty,
      nppAutonomyLevel: autonomyLevel,
      featureFlags,
      permanentHeadOfState: mode === "head-of-state",
    });
    await ensureSingleplayerUser(db, displayName);

    setSingleplayerSetupProgress({
      active: false,
      phase: "complete",
      label: "World ready",
      detail: "Opening the game",
      progress: 100,
    });

    return NextResponse.json({ ok: true, preset, mode, config, reset, logs });
  } catch (error) {
    setSingleplayerSetupProgress({
      active: false,
      phase: "failed",
      label: "World setup stopped",
      detail: error instanceof Error ? error.message : String(error),
    });
    return handleRouteError(error);
  }
}
