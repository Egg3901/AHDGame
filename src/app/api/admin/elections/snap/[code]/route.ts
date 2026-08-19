/**
 * POST /api/admin/elections/snap/[code] — Admin-forced snap election.
 *
 * Works for any parliamentary country where `supportsSnapElections(config)`
 * returns true — by default the parliamentary monarchies (UK, JP) and
 * parliamentary republics (DE, IE); presidential and one-party systems are
 * skipped. Bypasses the per-appointment limit and cooldown.
 * Delegates to the shared triggerSnapElection helper so the effect matches
 * the player-triggered path: bills fail, regular lower-chamber elections
 * are cancelled, fresh snap_${lowerChamberKey} races spawn, and the
 * government resets to pending with the 96-turn vacancy clock.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { triggerSnapElection, SnapElectionError } from "@/lib/turn/snapElection";
import { getGameTime } from "@/lib/time/gameTime";

// POST /api/admin/elections/snap/[code] — Admin-forced snap election (UK, JP, DE).
// Auth: requireAdmin
// Errors: 400, 403
export async function POST(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }

    const db = await getDb();
    try {
      // Anchor spawned-election timestamps to the game clock so primary/general
      // phase boundaries land on the same clock readers compare against.
      const gameTime = await getGameTime();
      const result = await triggerSnapElection(db, countryId, gameTime.effectiveNow, {
        reason: "admin",
        bypassLimits: true,
        actorName: "Admin",
      });
      return NextResponse.json({
        success: true,
        message: `Admin snap triggered for ${countryId}. ${result.electionsSpawned} elections spawned.`,
        ...result,
      });
    } catch (err) {
      if (err instanceof SnapElectionError) {
        return NextResponse.json(badRequest(err.message).toJson(), { status: 400 });
      }
      throw err;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
