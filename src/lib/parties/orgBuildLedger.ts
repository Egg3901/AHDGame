/**
 * Org-building cash leaves a party or state-party treasury and buys
 * organization, not cash anyone holds. Each landed charge is witnessed as a
 * named sink on the paying account, valued like the balance snapshot.
 */
import * as Sentry from "@sentry/nextjs";
import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import { snapshotPartyCurrency, snapshotStatePartyCurrency } from "@/lib/ledger/balanceSnapshot";
import { emitLedgerEntries } from "@/lib/ledger/emit";

export interface OrgBuildLedgerContext {
  rates: ReadonlyMap<string, number>;
}

/** `context: undefined` loads one for this charge; `null` means shadow accounting is off. */
export interface OrgBuildLedgerOptions {
  context?: OrgBuildLedgerContext | null;
}

/** One configuration read, plus one rates read when shadow accounting is on. */
export async function loadOrgBuildLedgerContext(db: Db): Promise<OrgBuildLedgerContext | null> {
  try {
    const config = await db
      .collection<{ _id: string; ledgerShadow?: boolean }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } });
    if (config?.ledgerShadow !== true) return null;
    const rates = await db
      .collection<{ currencyCode: string; rate: number }>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray();
    return { rates: new Map(rates.map((row) => [row.currencyCode, row.rate])) };
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "loadOrgBuildLedgerContext" } });
    return null;
  }
}

/** Called only with the amount the treasury debit actually took. */
export async function witnessOrgBuildCharge(
  db: Db,
  options: OrgBuildLedgerOptions | undefined,
  input: {
    scope: "state" | "national";
    /** `statePartyOrg._id` for state scope; the `politicalParties._id` otherwise. */
    accountRef: string;
    countryId: string;
    charged: number;
    turn: number;
    now: Date;
  }
): Promise<void> {
  if (!Number.isFinite(input.charged) || input.charged <= 0) return;
  try {
    const context =
      options?.context === undefined ? await loadOrgBuildLedgerContext(db) : options.context;
    if (!context) return;
    const currency: CurrencyCode =
      input.scope === "state"
        ? snapshotStatePartyCurrency(input.countryId)
        : snapshotPartyCurrency(input.countryId);
    const rate = context.rates.get(currency);
    // Same missing-rate fallback as the snapshot's party valuation.
    const anchorAmount = -input.charged / (rate && rate > 0 ? rate : 1);
    await emitLedgerEntries(db, [
      {
        turn: input.turn,
        createdAt: input.now,
        txType: "party_org_building",
        emitSite: "parties/chargeOrgBuildFunds",
        legs: [
          {
            account: accountId(
              input.scope === "state" ? "state_party" : "party",
              input.accountRef,
              currency
            ),
            amount: -input.charged,
            currencyCode: currency,
            anchorAmount,
            role: "primary",
          },
          {
            account: mintSinkAccount(anchorAmount, "organization_building", currency),
            amount: input.charged,
            currencyCode: currency,
            anchorAmount: -anchorAmount,
            role: "contra",
          },
        ],
      },
    ]);
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "witnessOrgBuildCharge" } });
  }
}
