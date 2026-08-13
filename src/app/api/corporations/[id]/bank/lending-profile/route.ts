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
  demandShareForProfile,
  getLendingProfile,
} from "@/lib/banking/creditBands";
import type { Corporation } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const schema = z.object({ profile: z.enum(LENDING_PROFILE_IDS) });

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
    const updated = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id, "bankCharter.status": "active" },
        { $set: { "bankCharter.lendingProfile": profile, updatedAt: new Date() } }
      );
    if (updated.matchedCount !== 1) {
      return NextResponse.json({ error: "Failed to set the lending profile." }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      lendingProfile: profile,
      floorBand: getLendingProfile(profile).floorBand,
      demandShare: demandShareForProfile(profile),
      message:
        "Stance saved. It applies to new household lending from the next banking turn; loans already on the book keep their rate and rating.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
