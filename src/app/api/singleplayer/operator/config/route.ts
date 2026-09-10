import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError } from "@/lib/api/errors";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { canOperateSingleplayerWorld } from "@/lib/singleplayerOperator";
import { getSingleplayerConfig, setSingleplayerConfig } from "@/lib/singleplayerServer";

const schema = z
  .object({
    difficulty: z.enum(["easy", "normal", "hard"]).optional(),
    autonomyLevel: z.enum(["off", "v0", "v1", "v2", "v3", "v4", "v5"]).optional(),
  })
  .strict()
  .refine((value) => value.difficulty != null || value.autonomyLevel != null);

export async function PATCH(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  if (!canOperateSingleplayerWorld())
    return NextResponse.json({ error: "Singleplayer operator is unavailable" }, { status: 403 });
  try {
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const db = await getDb();
    const current = await getSingleplayerConfig(db);
    if (!current) return NextResponse.json({ error: "No configured local world" }, { status: 409 });
    const config = await setSingleplayerConfig(db, {
      mode: current.mode,
      difficulty: parsed.data.difficulty ?? current.difficulty,
      nppAutonomyLevel: parsed.data.autonomyLevel ?? current.nppAutonomyLevel,
      permanentHeadOfState: current.permanentHeadOfState,
      featureFlags: current.featureFlags,
    });
    return NextResponse.json({
      difficulty: config.difficulty,
      autonomyLevel: config.nppAutonomyLevel,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
