// POST /api/corporations/[id]/bank/lending-profile — set the household lending stance.
// Auth: requireAuth, CEO of the bank's corporation
// Errors: 400, 401, 403, 404, 429
//
// The stance selects which credit bands the bank ORIGINATES into from the next
// banking turn. It never reprices, recalls, or re-rates a tranche already on the
// book: bands that fall outside the new stance simply stop being topped up and
// run off at the ordinary flow cap. There is deliberately no cooldown — the
// stance only reaches the book through new lending, so flipping it back and
// forth costs turns of foregone origination rather than gaining anything.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { isLendingCharter } from "@/lib/banking/charterKinds";
import {
  LENDING_PROFILE_IDS,
  bandsForProfile,
  demandShareForProfile,
  getLendingProfile,
  type CreditBandId,
} from "@/lib/banking/creditBands";
import { MAX_NPC_FLOW_PER_TURN_FRACTION } from "@/lib/banking/rules/loans";
import type { Corporation } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const schema = z.object({ profile: z.enum(LENDING_PROFILE_IDS) });

function joinBands(ids: readonly CreditBandId[]): string {
  if (ids.length === 1) return ids[0];
  return `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

/**
 * Player-readable account of what a stance flip does and when. Names the
 * bands that start building and the ones that start running off, and states
 * the pace honestly: both directions move at the household flow cap, so a
 * large mix shift takes dozens of turns, not one.
 */
export function describeProfileChange(args: {
  newlyOpened: CreditBandId[];
  enteringRunoff: CreditBandId[];
  flowPacePercent: number;
}): string {
  const pace =
    `New lending builds at up to ${args.flowPacePercent}% of target per turn, ` +
    `and closed bands run off at the same pace, so large mix shifts take dozens of turns. ` +
    `Loans already on the book keep their rate and rating.`;
  const opened =
    args.newlyOpened.length > 0 ? `${joinBands(args.newlyOpened)} starts building. ` : "";
  const runoff =
    args.enteringRunoff.length > 0
      ? `${joinBands(args.enteringRunoff)} stops being topped up and runs off gradually. `
      : "";
  if (!opened && !runoff) {
    return `Stance saved. The open bands are unchanged, so the book keeps building where it was. ${pace}`;
  }
  return `Stance saved. ${opened}${runoff}${pace}`;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`bank-lending-profile:${auth.user.userId}`, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!isLendingCharter(corporation.bankCharter)) {
      return NextResponse.json(
        { error: "Only an active retail or universal charter originates household loans." },
        { status: 400 }
      );
    }

    const profile = parsed.data.profile;
    const previous = getLendingProfile(corporation.bankCharter?.lendingProfile).id;
    const updated = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id, "bankCharter.status": "active" },
        { $set: { "bankCharter.lendingProfile": profile, updatedAt: new Date() } }
      );
    if (updated.matchedCount !== 1) {
      return NextResponse.json({ error: "Failed to set the lending profile." }, { status: 400 });
    }

    // What this flip changes, in bands rather than adjectives: bands the new
    // stance opens start building from the next banking turn, bands it closes
    // stop being topped up and run off gradually. Compared against the previous
    // stance so the reply can name the movers, not just the new floor.
    const before = new Set(bandsForProfile(previous).map((b) => b.id));
    const after = bandsForProfile(profile).map((b) => b.id);
    const newlyOpened = after.filter((id) => !before.has(id));
    const enteringRunoff = [...before].filter((id): id is CreditBandId => !after.includes(id));
    const flowPacePercent = MAX_NPC_FLOW_PER_TURN_FRACTION * 100;

    return NextResponse.json({
      success: true,
      lendingProfile: profile,
      floorBand: getLendingProfile(profile).floorBand,
      demandShare: demandShareForProfile(profile),
      openBands: after,
      newlyOpened,
      enteringRunoff,
      flowCapFraction: MAX_NPC_FLOW_PER_TURN_FRACTION,
      message: describeProfileChange({ newlyOpened, enteringRunoff, flowPacePercent }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
