import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { emitTx } from "@/lib/financialTxLog/emit";

/**
 * Book an admin capital injection into a fund as an explicit, attributed mint.
 *
 * These routes (`inject-capital`, `inject-capital-all`, `deploy-cash-all`) raise
 * `cashAnchor` with no debit anywhere: the money is created. That is intentional
 * — they exist to repair a fund whose backing has drifted — but until now the
 * only trace was a fund-scoped `capital_injection` row, so a conservation check
 * reading the financial ledger saw fund cash appear from nothing with no
 * counterparty and no actor.
 *
 * The leg is emitted with the government as counterparty and `mint: true` in
 * meta, so the money is attributable and can be filtered out of "player economy"
 * aggregates rather than silently widening them.
 */
export async function emitFundAdminMintLeg(
  db: Db,
  params: {
    fundId: ObjectId;
    fundName: string;
    fundSlug: string;
    /** ₳ created. Always positive. */
    amountAnchor: number;
    currencyCode: CurrencyCode;
    adminName: string;
    turn: number;
    /** Which admin tool created it, e.g. "inject_capital_all". */
    tool: string;
    reason?: string;
  }
): Promise<void> {
  if (!Number.isFinite(params.amountAnchor) || params.amountAnchor <= 0) return;

  await emitTx(db, {
    type: "admin_transfer",
    turn: params.turn,
    createdAt: new Date(),
    subjectType: "corporation",
    subjectId: params.fundId,
    subjectName: params.fundName,
    amount: params.amountAnchor,
    anchorAmount: params.amountAnchor,
    currencyCode: params.currencyCode,
    counterpartyType: "system",
    counterpartyName: "Admin capital injection",
    meta: {
      kind: "index_fund_capital_injection",
      mint: true,
      tool: params.tool,
      fundSlug: params.fundSlug,
      adminName: params.adminName,
      ...(params.reason ? { reason: params.reason } : {}),
    },
  });
}
