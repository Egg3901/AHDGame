import { ObjectId, type ClientSession, type Db } from "mongodb";
import { COUNTRY_CURRENCY_MAP } from "../../src/lib/constants/currencies";
import type {
  Character,
  Corporation,
  ExchangeRate,
  IndexFund,
  NPP,
  ShareOrder,
} from "../../src/lib/db/types";
import type { FinancialTxLogEntry } from "../../src/lib/db/types/financialTxLog";
import type { GameState } from "../../src/lib/db/types/gameState";
import { defaultExpiresAt } from "../../src/lib/financialTxLog/expiresAt";
import { getDb, getMongoClient } from "../../src/lib/mongodb";

// Support ticket #1349: undo the staff-redone Continental Systems Group IPO.
// All current outside holders receive the current market value from admin funds.
const CORPORATION_ID = new ObjectId("6a9ecd1903b0b412ed49383f");
const ISSUE = 2358;

type Settlement = {
  kind: "character" | "corporation" | "fund" | "npp";
  id: ObjectId;
  shares: number;
  amount: number;
  anchorAmount: number;
  currency: string;
  name: string;
};

type Plan = {
  corporation: Corporation;
  ceoShares: number;
  outsideShares: number;
  price: number;
  turn: number;
  orders: ShareOrder[];
  settlements: Settlement[];
  totalLocal: number;
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function plan(db: Db, session?: ClientSession): Promise<Plan> {
  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: CORPORATION_ID }, { session });
  assert(corporation?.name === "Continental Systems Group", "Target corporation changed");
  assert(corporation.isPrivate === false, "Corporation is already private");
  assert(corporation.liquidCurrencyCode === "USD", "Target currency changed");
  assert(corporation.publicFloat === 0, "Public float must be zero");
  assert(!corporation.pendingShareIssuance, "Pending share issuance must be reviewed");
  assert(Number.isFinite(corporation.sharePrice) && corporation.sharePrice > 0, "Invalid price");

  const ceoRows = corporation.shareholders.filter((holder) =>
    holder.characterId?.equals(corporation.ceoId)
  );
  assert(ceoRows.length === 1, "Expected exactly one CEO holding");
  const ceoShares = ceoRows[0].shares;
  const outside = corporation.shareholders.filter((holder) => holder !== ceoRows[0]);
  const outsideShares = outside.reduce((sum, holder) => sum + holder.shares, 0);
  assert(outsideShares > 0, "No outside shares to buy out");
  assert(ceoShares + outsideShares === corporation.totalShares, "Share register does not balance");
  assert(
    outside.every((holder) => Number.isSafeInteger(holder.shares) && holder.shares > 0),
    "Invalid outside holding"
  );

  const orders = await db
    .collection<ShareOrder>("shareOrders")
    .find({ corporationId: CORPORATION_ID, status: "open" }, { session })
    .toArray();
  const [openListings, pendingOffers] = await Promise.all([
    db
      .collection("shareListings")
      .countDocuments({ corporationId: CORPORATION_ID, status: "open" }, { session }),
    db
      .collection("shareOffers")
      .countDocuments({ corporationId: CORPORATION_ID, status: "pending" }, { session }),
  ]);
  assert(openListings === 0 && pendingOffers === 0, "Open private trades require manual review");
  assert(
    orders.every(
      (order) =>
        order.liquidityProvider === true &&
        !!order.placerFundId &&
        !order.sharesDebitedAtCreation &&
        (order.type === "sell" ||
          (order.type === "buy" &&
            Number.isFinite(order.escrowAnchor) &&
            (order.escrowAnchor ?? -1) >= 0))
    ),
    "Unexpected open order requires manual review"
  );

  const [rates, gameState] = await Promise.all([
    db.collection<ExchangeRate>("exchangeRates").find({}, { session }).toArray(),
    db.collection<GameState>("gameState").findOne({ _id: "current" }, { session }),
  ]);
  assert(typeof gameState?.currentTurn === "number", "Current turn unavailable");
  const rateByCurrency = new Map(rates.map((rate) => [rate.currencyCode, rate.rate]));
  const usdRate = rateByCurrency.get("USD");
  assert(usdRate && Number.isFinite(usdRate) && usdRate > 0, "USD exchange rate unavailable");

  const settlements: Settlement[] = [];
  for (const holder of outside) {
    const ids = [holder.characterId, holder.corporationId, holder.fundId, holder.nppId].filter(
      Boolean
    );
    assert(ids.length === 1, "Ambiguous holder identity");
    const anchorAmount = (holder.shares * corporation.sharePrice) / usdRate;
    if (holder.characterId) {
      const character = await db
        .collection<Character>("characters")
        .findOne({ _id: holder.characterId }, { session });
      assert(character, "Character holder missing");
      const currency = COUNTRY_CURRENCY_MAP[character.countryId] ?? "USD";
      const rate = rateByCurrency.get(currency);
      assert(rate && rate > 0, "Character exchange rate unavailable");
      settlements.push({
        kind: "character",
        id: holder.characterId,
        shares: holder.shares,
        amount: money(anchorAmount * rate),
        anchorAmount,
        currency,
        name: character.name,
      });
    } else if (holder.corporationId) {
      const recipient = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: holder.corporationId }, { session });
      assert(recipient, "Corporation holder missing");
      const currency = recipient.liquidCurrencyCode ?? COUNTRY_CURRENCY_MAP[recipient.countryId];
      assert(currency, "Corporation currency unavailable");
      const rate = rateByCurrency.get(currency);
      assert(rate && rate > 0, "Corporation exchange rate unavailable");
      settlements.push({
        kind: "corporation",
        id: holder.corporationId,
        shares: holder.shares,
        amount: money(anchorAmount * rate),
        anchorAmount,
        currency,
        name: recipient.name,
      });
    } else if (holder.fundId) {
      const fund = await db
        .collection<IndexFund>("indexFunds")
        .findOne({ _id: holder.fundId }, { session });
      assert(fund, "Fund holder missing");
      const holding = fund.holdings.filter((row) => row.corporationId.equals(CORPORATION_ID));
      assert(holding.length === 1 && holding[0].shares === holder.shares, "Fund ledger mismatch");
      settlements.push({
        kind: "fund",
        id: holder.fundId,
        shares: holder.shares,
        amount: money(anchorAmount),
        anchorAmount,
        currency: fund.anchorCurrencyCode,
        name: fund.name,
      });
    } else if (holder.nppId) {
      const npp = await db.collection<NPP>("npps").findOne({ _id: holder.nppId }, { session });
      assert(npp, "NPP holder missing");
      const currency = (npp.countryId ? COUNTRY_CURRENCY_MAP[npp.countryId] : undefined) ?? "USD";
      const rate = rateByCurrency.get(currency);
      assert(rate && rate > 0, "NPP exchange rate unavailable");
      settlements.push({
        kind: "npp",
        id: holder.nppId,
        shares: holder.shares,
        amount: money(anchorAmount * rate),
        anchorAmount,
        currency,
        name: npp.name,
      });
    } else {
      throw new Error("Unsupported outside holder");
    }
  }

  return {
    corporation,
    ceoShares,
    outsideShares,
    price: corporation.sharePrice,
    turn: gameState.currentTurn,
    orders,
    settlements,
    totalLocal: money(outsideShares * corporation.sharePrice),
  };
}

async function apply(db: Db, expectedPrice: number): Promise<Plan> {
  const client = await getMongoClient();
  const session = client.startSession();
  let completed: Plan | undefined;
  try {
    await session.withTransaction(async () => {
      const current = await plan(db, session);
      assert(current.price === expectedPrice, "Market price moved; run preview again");
      const now = new Date();
      const txRows: FinancialTxLogEntry[] = [];
      for (const order of current.orders) {
        const cancelled = await db
          .collection<ShareOrder>("shareOrders")
          .updateOne(
            { _id: order._id, status: "open" },
            { $set: { status: "cancelled", updatedAt: now } },
            { session }
          );
        assert(cancelled.modifiedCount === 1, "Order changed during reversal");
        if (order.type === "buy") {
          const fund = await db
            .collection<IndexFund>("indexFunds")
            .findOne({ _id: order.placerFundId }, { session });
          assert(fund, "Order fund missing");
          const refund = await db
            .collection<IndexFund>("indexFunds")
            .updateOne(
              { _id: order.placerFundId },
              { $inc: { cashAnchor: order.escrowAnchor ?? 0 }, $set: { updatedAt: now } },
              { session }
            );
          assert(refund.matchedCount === 1, "Order fund missing");
          txRows.push({
            _id: new ObjectId(),
            type: "stock_order_refund",
            turn: current.turn,
            createdAt: now,
            expiresAt: defaultExpiresAt(now),
            subjectType: "fund",
            subjectId: fund._id,
            subjectName: fund.name,
            amount: order.escrowAnchor ?? 0,
            currencyCode: fund.anchorCurrencyCode,
            anchorAmount: order.escrowAnchor ?? 0,
            counterpartyType: "system",
            counterpartyName: "Order book escrow",
            meta: { issue: ISSUE, orderId: order._id.toString(), reason: "ipo_reversal" },
            flagged: false,
          });
        }
      }

      for (const payout of current.settlements) {
        let modifiedCount = 0;
        if (payout.kind === "character") {
          const update = await db.collection<Character>("characters").updateOne(
            { _id: payout.id },
            {
              $inc: { [`currencyBalances.personal.${payout.currency}`]: payout.amount },
              $set: { updatedAt: now },
            },
            { session }
          );
          modifiedCount = update.modifiedCount;
        } else if (payout.kind === "corporation") {
          const update = await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: payout.id },
              { $inc: { liquidCapital: payout.amount }, $set: { updatedAt: now } },
              { session }
            );
          modifiedCount = update.modifiedCount;
        } else if (payout.kind === "fund") {
          const update = await db.collection<IndexFund>("indexFunds").updateOne(
            {
              _id: payout.id,
              holdings: { $elemMatch: { corporationId: CORPORATION_ID, shares: payout.shares } },
            },
            {
              $inc: { cashAnchor: payout.amount },
              $pull: { holdings: { corporationId: CORPORATION_ID } },
              $set: { updatedAt: now },
            },
            { session }
          );
          modifiedCount = update.modifiedCount;
        } else {
          const update = await db.collection<NPP>("npps").updateOne(
            { _id: payout.id },
            {
              $inc: { [`currencyBalances.personal.${payout.currency}`]: payout.amount },
              $set: { updatedAt: now },
            },
            { session }
          );
          modifiedCount = update.modifiedCount;
        }
        assert(modifiedCount === 1, "Holder changed during reversal");
        txRows.push({
          _id: new ObjectId(),
          type: "admin_transfer",
          turn: current.turn,
          createdAt: now,
          expiresAt: defaultExpiresAt(now),
          subjectType: payout.kind,
          subjectId: payout.id,
          subjectName: payout.name,
          amount: payout.amount,
          currencyCode: payout.currency as FinancialTxLogEntry["currencyCode"],
          anchorAmount: payout.anchorAmount,
          counterpartyType: "system",
          counterpartyName: "Admin funded IPO reversal",
          meta: {
            issue: ISSUE,
            corporationId: CORPORATION_ID.toString(),
            shares: payout.shares,
            pricePerShareUSD: current.price,
          },
          suspectFlags: [
            {
              type: "admin_transfer",
              severity: "high",
              detail: "Admin funded IPO reversal",
              detectedAt: now,
            },
          ],
          flagged: true,
        });
      }

      const ceo = current.corporation.shareholders.find((holder) =>
        holder.characterId?.equals(current.corporation.ceoId)
      );
      assert(ceo, "CEO holding missing");
      const { superShares: _superShares, ...cleanedCeo } = ceo;
      const changed = await db.collection<Corporation>("corporations").updateOne(
        {
          _id: CORPORATION_ID,
          isPrivate: false,
          sharePrice: current.price,
          totalShares: current.corporation.totalShares,
        },
        {
          $set: {
            shareholders: [cleanedCeo],
            totalShares: current.ceoShares,
            publicFloat: 0,
            isPrivate: true,
            lastPrivatizationTurn: current.turn,
            updatedAt: now,
          },
          $unset: {
            privatizationCooldownUntilTurn: "",
            superShareMultiplier: "",
            superSharesAdoptedAtTurn: "",
            pendingShareIssuance: "",
          },
        },
        { session }
      );
      assert(changed.modifiedCount === 1, "Corporation changed during reversal");
      await db.collection<FinancialTxLogEntry>("financialTxLog").insertMany(txRows, { session });
      completed = current;
    });
    assert(completed, "Transaction did not complete");
    return completed;
  } finally {
    await session.endSession();
  }
}

const [action, expectedPriceText] = process.argv.slice(2);
if (action !== "--preview" && action !== "--apply") {
  throw new Error(
    "Usage: tsx scripts/admin/reverse-ipo-admin-funded.ts --preview | --apply <price>"
  );
}

async function main(): Promise<void> {
  try {
    const db = await getDb();
    const result =
      action === "--preview" ? await plan(db) : await apply(db, Number(expectedPriceText));
    console.log(
      JSON.stringify({
        applied: action === "--apply",
        priceUSD: result.price,
        outsideShares: result.outsideShares,
        adminFundedUSD: result.totalLocal,
        holdersPaid: result.settlements.length,
        ordersCancelled: result.orders.length,
        ceoSharesRemaining: result.ceoShares,
      })
    );
  } finally {
    await (await getMongoClient()).close();
  }
}

void main();
