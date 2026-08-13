// POST /api/corporations/[id]/bank/upstream — move surplus bank cash to the parent.
// Auth: requireBasicAuth, CEO of the bank's corporation
// Errors: 400, 401, 403, 404, 429
//
// The supervised half of the ring-fence. Injection (`/bank/recapitalize`) is
// capped only by what the corporation has; this direction is capped by the
// bank's surplus over its reserve requirement AND gated on the supervisor
// calling the bank adequate, because it is the only way shareholder money
// leaves the buffer that stands between a failure and a depositor haircut.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { emitTx } from "@/lib/financialTxLog/emit";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { upstreamBankCash } from "@/lib/banking/bankCash";

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

    const rateLimit = checkRateLimit(`bank-upstream:${auth.user.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const corp = resolved.corporation;

    const ceoCheck = requireCeo(corp, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const charter = corp.bankCharter;
    if (!charter || charter.status !== "active") {
      return NextResponse.json(
        { error: "This corporation has no active bank charter." },
        { status: 400 }
      );
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const reserveRatio = await getReserveRequirement(db, charter.currency as CurrencyCode);
    const result = await upstreamBankCash(db, corp._id, parsed.data.amount, reserveRatio);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const now = new Date();
    await emitTx(db, {
      type: "corp_capital_injection",
      turn: await getCurrentTurn(db),
      createdAt: now,
      subjectType: "corporation",
      subjectId: corp._id,
      subjectName: corp.name,
      // Positive: cash arriving in the holding company, the mirror of the
      // negative leg `/bank/recapitalize` writes on the way in.
      amount: result.amount,
      currencyCode: (resolveCorpLiquidCurrencyCode(corp) ?? "USD") as CurrencyCode,
      counterpartyType: "corporation",
      counterpartyId: corp._id,
      counterpartyName: corp.name,
      meta: { kind: "bank_upstream" },
    });

    return NextResponse.json({
      success: true,
      amount: result.amount,
      cashReserves: result.cashReserves,
      liquidCapital: result.liquidCapital,
      message: `${result.amount.toLocaleString()} ${charter.currency} moved to the holding company.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
