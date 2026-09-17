import { ObjectId, type ClientSession, type Db, type UpdateFilter } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type { FundShareholderPayoutRow } from "@/lib/bonds/corporateBondDefault";

/**
 * Pay index-fund shareholders their ₳ slice of a wound-down corporation's payout
 * pool, and drop each fund's now-stale holding of that (deleted) corp.
 *
 * Why (#3451): `allocateShareholderPool` counts fund shares in the denominator
 * but, before this, emitted no fund row — so a fund's slice was drained from the
 * payer yet distributed to no one (a conservation leak). This closes it for the
 * two flows that pay out a full shareholder pool and then delete the corp:
 * voluntary dissolution and nationalization's whole-corp payShareholders.
 *
 * Pool payouts are already ₳ and fund cash (`cashAnchor`) is ₳, so there is no
 * FX conversion. The fund credit is the real, conserving move; when the caller
 * passes `ledger`, each credit is additionally booked as a fund-subject tx row
 * (#992 tranche 3) using the same flow-appropriate type the other holder
 * buckets emit, so the shadow ledger sees the fund side as a two-sided
 * transfer instead of an uninstrumented inflow.
 */
export interface FundPayoutLedgerContext {
  turn: number;
  /** Flow-appropriate type, matching the rows emitted for every other holder bucket. */
  txType: "share_buyout_payout" | "corp_dissolution_distribution";
  /** Short marker for what moved the money, e.g. "agreed_acquisition". Omitted when the flow's own rows carry none. */
  kind?: string;
  counterpartyId: ObjectId;
  counterpartyName: string;
}

type FundPayoutTxInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;

export async function payFundShareholderRows(
  db: Db,
  fundRows: FundShareholderPayoutRow[],
  dissolvedCorporationId: ObjectId,
  now: Date,
  options?: { session?: ClientSession; ledger?: FundPayoutLedgerContext }
): Promise<{ totalPaidAnchor: number; txEntries: FundPayoutTxInput[] }> {
  const txEntries: FundPayoutTxInput[] = [];
  const ledger = options?.ledger;
  const byId =
    ledger && fundRows.length > 0
      ? new Map(
          (
            await db
              .collection<IndexFund>("indexFunds")
              .find(
                {
                  _id: {
                    $in: [...new Set(fundRows.map((r) => r.fundId))].map((id) => new ObjectId(id)),
                  },
                },
                { projection: { anchorCurrencyCode: 1, name: 1 } }
              )
              .toArray()
          ).map((f) => [f._id.toString(), f])
        )
      : new Map<string, Pick<IndexFund, "_id" | "anchorCurrencyCode" | "name">>();
  let totalPaidAnchor = 0;
  for (const row of fundRows) {
    if (row.payout <= 0) continue;
    await db.collection<IndexFund>("indexFunds").updateOne(
      { _id: new ObjectId(row.fundId) },
      {
        $inc: { cashAnchor: row.payout },
        $pull: { holdings: { corporationId: dissolvedCorporationId } },
        $set: { updatedAt: now },
      } as unknown as UpdateFilter<IndexFund>,
      options?.session ? { session: options.session } : undefined
    );
    totalPaidAnchor += row.payout;
    // Without ledger context (or a fund doc carrying the account currency)
    // there is no currency to book the leg in, so the credit stays unbooked
    // rather than guessed — same fail-closed rule as the fund-cash mirrors.
    const fund = ledger ? byId.get(row.fundId) : undefined;
    if (!ledger || !fund) continue;
    const currency = fund.anchorCurrencyCode as CurrencyCode;
    txEntries.push({
      type: ledger.txType,
      turn: ledger.turn,
      createdAt: now,
      subjectType: "fund",
      subjectId: new ObjectId(row.fundId),
      subjectName: fund.name ?? row.name,
      amount: row.payout,
      anchorAmount: row.payout,
      currencyCode: currency,
      counterpartyType: "corporation",
      counterpartyId: ledger.counterpartyId,
      counterpartyName: ledger.counterpartyName,
      meta: {
        ...(ledger.kind ? { kind: ledger.kind } : {}),
        side: "fund_shareholder",
        fundId: row.fundId,
        fundCurrency: currency,
        shares: row.shares,
        sharePayAnchor: Math.round(row.payout * 100) / 100,
      },
    });
  }
  return { totalPaidAnchor, txEntries };
}
