import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resetAndBootstrapGameWorld } from "@/lib/admin/resetAndBootstrapGameWorld";
import { isKnownPreset } from "@/lib/seeds/presetSelector";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { ensureSingleplayerUser } from "@/lib/singleplayerServer";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const bodySchema = z.object({
  preset: z.string().min(1).optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
});

/**
 * Starts a fresh world. This is the admin reset with the choices a local
 * player would always make: wipe the previous character so the new game is
 * actually new, keep the account (it is an admin account, which the reset
 * preserves), then make sure the account still exists afterwards.
 *
 * Long-running: a full bootstrap is tens of seconds on a laptop. The
 * /singleplayer screen shows progress off the returned log lines.
 */
export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;

  try {
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;
    const preset = body.preset ?? DEFAULT_SEED_PRESET;
    if (!isKnownPreset(preset)) {
      return NextResponse.json({ error: `Unknown preset "${preset}"` }, { status: 400 });
    }

    const db = await getDb();
    await ensureSingleplayerUser(db, body.displayName);

    const logs: string[] = [];
    const { reset } = await resetAndBootstrapGameWorld({
      db,
      preset,
      deleteProfiles: true,
      log: (line) => logs.push(line),
    });

    await ensureSingleplayerUser(db, body.displayName);

    return NextResponse.json({ ok: true, preset, reset, logs });
  } catch (error) {
    return handleRouteError(error);
  }
}
