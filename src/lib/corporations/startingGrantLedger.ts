/**
 * A spawned corporation's starting treasury is a system grant with no in-world
 * payer. It is witnessed once, as a named mint on the corporation's cash
 * account, after the insert that creates it lands.
 */
import * as Sentry from "@sentry/nextjs";
import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import { ledgerTurnFromClock } from "@/lib/ledger/ledgerTurn";

export async function witnessCorporationStartingGrant(
  db: Db,
  input: {
    corporationId: ObjectId;
    /** Exactly the `liquidCapital` inserted, in `currencyCode`. */
    amountLocal: number;
    currencyCode: CurrencyCode;
    /** Processing turn when the spawn runs inside a turn; else the turn the clock is accumulating. */
    turn?: number;
    now: Date;
  }
): Promise<void> {
  if (!Number.isFinite(input.amountLocal) || input.amountLocal <= 0) return;
  try {
    const config = await db
      .collection<{ _id: string; ledgerShadow?: boolean }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } });
    if (config?.ledgerShadow !== true) return;
    const [state, quote] = await Promise.all([
      input.turn === undefined
        ? db
            .collection<{ _id: string; currentTurn: number }>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } })
        : Promise.resolve(null),
      db
        .collection<{ currencyCode: string; rate: number }>("exchangeRates")
        .findOne({ currencyCode: input.currencyCode }, { projection: { rate: 1 } }),
    ]);
    const turn =
      input.turn ??
      (state?.currentTurn === undefined ? undefined : ledgerTurnFromClock(state.currentTurn));
    if (turn === undefined || !Number.isInteger(turn)) {
      throw new Error("Corporation starting grant witness requires a turn");
    }
    // Same valuation and missing-rate fallback as the snapshot's corporation account.
    const rate = quote?.rate;
    const anchorAmount = rate && rate > 0 ? input.amountLocal / rate : input.amountLocal;
    await emitLedgerEntries(db, [
      {
        turn,
        createdAt: input.now,
        txType: "corp_starting_grant",
        emitSite: "admin/spawnNppCorporation",
        legs: [
          {
            account: accountId("corporation", input.corporationId.toString(), input.currencyCode),
            amount: input.amountLocal,
            currencyCode: input.currencyCode,
            anchorAmount,
            role: "primary",
          },
          {
            account: mintSinkAccount(
              anchorAmount,
              "corporation_starting_grant",
              input.currencyCode
            ),
            amount: -input.amountLocal,
            currencyCode: input.currencyCode,
            anchorAmount: -anchorAmount,
            role: "contra",
          },
        ],
      },
    ]);
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "witnessCorporationStartingGrant" } });
  }
}
