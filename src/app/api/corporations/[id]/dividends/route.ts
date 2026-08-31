import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { setDividendRateSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { hasOpenPrivatizationVote } from "@/lib/corporations/commands/privatization/openVoteGuard";
import type { Corporation } from "@/lib/db/types";
import { logWireEvent, wireHeadlineDividend } from "@/lib/wireEvent";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { recordAudit } from "@/lib/audit/recordAudit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const DIVIDEND_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * POST /api/corporations/[id]/dividends
 * Set the dividend payout rate (0–100%). CEO only. Limited to once per 24 hours.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, setDividendRateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (await hasOpenPrivatizationVote(db, corporation._id)) {
      return NextResponse.json(
        { error: "Cannot change dividend rate while a privatization vote is open" },
        { status: 400 }
      );
    }

    if (corporation.imfBailoutActive && parsed.data.dividendRate > 0) {
      return NextResponse.json(
        { error: "Dividends are suspended while IMF restructuring is active." },
        { status: 400 }
      );
    }

    // Enforce 24-hour cooldown
    if (corporation.lastDividendChange) {
      const elapsed = Date.now() - new Date(corporation.lastDividendChange).getTime();
      if (elapsed < DIVIDEND_COOLDOWN_MS) {
        const remaining = Math.ceil((DIVIDEND_COOLDOWN_MS - elapsed) / 1000 / 60 / 60);
        return NextResponse.json(
          {
            error: `Dividend rate can only be changed once per 24 hours. Try again in ${remaining}h.`,
          },
          { status: 429 }
        );
      }
    }

    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - DIVIDEND_COOLDOWN_MS);
    const update = await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corporation._id,
        $or: [
          { lastDividendChange: { $exists: false } },
          { lastDividendChange: { $lte: cooldownCutoff } },
        ],
      },
      {
        $set: {
          dividendRate: parsed.data.dividendRate,
          lastDividendChange: now,
          updatedAt: now,
        },
      }
    );
    if (update.matchedCount === 0) {
      return NextResponse.json(
        { error: "Dividend rate was changed by another request. Try again after the cooldown." },
        { status: 429 }
      );
    }

    logWireEvent(
      "dividend_changed",
      wireHeadlineDividend(corporation.name, `${parsed.data.dividendRate}`),
      { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
    );

    recordAudit({
      source: "api",
      action: "corp.dividends",
      category: "corp",
      subject: { type: "corporation", id: corporation._id, name: corporation.name },
      refs: { corporationId: corporation._id },
      delta: [
        {
          field: "dividendRate",
          before: corporation.dividendRate,
          after: parsed.data.dividendRate,
        },
      ],
      outcome: "ok",
    });

    return NextResponse.json({ success: true, dividendRate: parsed.data.dividendRate });
  } catch (error) {
    return handleRouteError(error);
  }
}
