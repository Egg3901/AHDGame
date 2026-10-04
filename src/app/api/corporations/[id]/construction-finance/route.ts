/** CEO loan quotes for a paid sector build; no lender reads while disabled. */
import { NextResponse } from "next/server";
import type { CentralBank, Corporation } from "@/lib/db/types";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getDb } from "@/lib/mongodb";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { LOAN_ORIGINATION_FEE_FRACTION } from "@/lib/banking/rules/loanFees";
import { effectiveBankRatesFromPrime } from "@/lib/banking/rules/rates";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCountryIdForCurrency, type CurrencyCode } from "@/lib/constants/currencies";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";

const noStore = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const policy = await loadBankingPolicy(db);
    if (!policy.constructionFinance)
      return NextResponse.json({ enabled: false }, { headers: noStore });
    const { id } = await params;
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;
    const currency = resolveCorpLiquidCurrencyCode(corporation) as CurrencyCode | undefined;
    if (!currency)
      return NextResponse.json(
        { error: "The corporation's liquid currency is unavailable" },
        { status: 409, headers: noStore }
      );
    const centralBank = await db
      .collection<CentralBank>("centralBanks")
      .findOne(
        { _id: getBankId(getCountryIdForCurrency(currency)) },
        { projection: { primeRate: 1 } }
      );
    if (typeof centralBank?.primeRate !== "number" || !Number.isFinite(centralBank.primeRate))
      return NextResponse.json(
        { error: "The currency's loan rate is unavailable" },
        { status: 409, headers: noStore }
      );
    const banks = await db
      .collection<Corporation>("corporations")
      .find(
        {
          _id: { $ne: corporation._id },
          "bankCharter.currency": currency,
          "bankCharter.status": "active",
          bankCharterTransfer: { $exists: false },
          bankConstructionFunding: { $exists: false },
        },
        {
          projection: {
            name: 1,
            "bankCharter.type": 1,
            "bankCharter.depositOffset": 1,
            "bankCharter.lendingOffset": 1,
            "bankCharter.requireApproval": 1,
            "bankCharter.currency": 1,
          },
        }
      )
      .sort({ _id: 1 })
      .limit(100)
      .toArray();
    return NextResponse.json(
      {
        enabled: true,
        currency,
        originationFeeRate: LOAN_ORIGINATION_FEE_FRACTION,
        collateralLimitRate: 0.75,
        lenders: banks.flatMap((bank) => {
          const charter = bank.bankCharter;
          if (
            !charter ||
            !["retail", "investment", "universal"].includes(charter.type) ||
            !Number.isFinite(charter.lendingOffset)
          )
            return [];
          return [
            {
              id: String(bank._id),
              name: bank.name,
              ratePercent: effectiveBankRatesFromPrime(charter, centralBank.primeRate)
                .lendingRatePercent,
              approvalRequired: charter.requireApproval === true,
            },
          ];
        }),
      },
      { headers: noStore }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
