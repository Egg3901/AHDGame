// POST /api/corporations/[id]/bank/recapitalize — post additional bank capital (B7).
// Auth: requireBasicAuth, CEO of the bank's corporation
// Errors: 400, 401, 403, 404, 429

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Corporation } from "@/lib/db/types";
import { emitTx } from "@/lib/financialTxLog/emit";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  assessCapital,
  borrowingsFromCharter,
  capitalShortfall,
} from "@/lib/banking/capitalAdequacy";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { injectBankCapital } from "@/lib/banking/bankCash";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const schema = z.object({ amount: z.number().positive() });

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isPrivateBankingEnabled())) {
      return NextResponse.json({ error: "Private banking is not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(`bank-recap:${auth.user.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const corp = resolved.corporation;

    const ceoCheck = requireCeo(corp, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const charter = corp.bankCharter;
    if (!charter || charter.status !== "active")
      return NextResponse.json(
        { error: "This corporation has no active bank charter." },
        { status: 400 }
      );

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const amount = Math.round(parsed.data.amount);

    // Corporation → bank, across the ring-fence, in one atomic write. Capped
    // only by what the corporation has: money going IN behind the depositors
    // needs no permission, which is the whole asymmetry of the boundary.
    const injected = await injectBankCapital(db, corp._id, amount);
    if (!injected.ok) return NextResponse.json({ error: injected.error }, { status: 400 });

    const now = new Date();

    await emitTx(db, {
      type: "corp_capital_injection",
      turn: await getCurrentTurn(db),
      createdAt: now,
      subjectType: "corporation",
      subjectId: corp._id,
      subjectName: corp.name,
      amount: -amount,
      currencyCode: (resolveCorpLiquidCurrencyCode(corp) ?? "USD") as CurrencyCode,
      counterpartyType: "corporation",
      counterpartyId: corp._id,
      counterpartyName: corp.name,
      meta: { kind: "bank_recapitalization" },
    });

    // Unlike before the ring-fence, this genuinely moves the ratio: the cash
    // crosses from the corporation into the bank, so the bank's equity rises by
    // the full amount rather than being shuffled between two names for the same
    // pot.
    const position = assessCapital({
      cashReserves: injected.cashReserves,
      totalLoans: charter.totalLoans ?? 0,
      borrowings: borrowingsFromCharter(charter),
      propBookMarkValue: charter.propBookMarkValue ?? 0,
    });

    return NextResponse.json({
      success: true,
      capitalRatio: Math.round(position.capitalRatio * 10_000) / 10_000,
      standing: position.standing,
      remainingShortfall: capitalShortfall(position),
      // Standing is confirmed by the next supervisory pass; say so rather than
      // implying the breach is already cured on the regulator's books.
      message:
        position.standing === "adequate"
          ? "Capital posted. The bank clears the requirement at the next supervisory review."
          : "Capital posted, but the bank is still short of the requirement.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
