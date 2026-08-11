import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { accountId } from "@/lib/ledger/accounts";
import type { BalanceSnapshot } from "@/lib/ledger/types";

export const BALANCE_SNAPSHOTS_COLLECTION = "balanceSnapshots";

/**
 * Snapshot the authoritative money-balance fields into a per-turn account→₳ map.
 *
 * This is the reference the stock-vs-flow reconciler check diffs against: an
 * account that moved between two snapshots with no matching ledger legs is an
 * uninstrumented write (the Phase 3 coverage queue); legs that move an account
 * whose real balance didn't are the t841 wrong-currency class.
 *
 * Balances are stored in ₳ (anchor) units — local balance / FX rate — to match
 * the ledger legs' `anchorAmount`. Missing rate ⇒ treated 1:1 (mirrors
 * financialTxLog/emit.ts's amountToAnchor fallback). See plan §2.
 *
 * Scope (Phase 1-2 "derivable subset"): the four financialTxLog subject kinds —
 * character personal + savings wallets, corporation liquidCapital, party
 * treasury, government treasuryBalance. Fund/org cash legs are Phase 3.
 */

async function loadAnchorRates(db: Db): Promise<Map<string, number>> {
  const rates = await db
    .collection<{ currencyCode: string; rate: number }>("exchangeRates")
    .find({}, { projection: { currencyCode: 1, rate: 1 } })
    .toArray();
  return new Map(rates.map((r) => [r.currencyCode, r.rate]));
}

function toAnchor(local: number, currency: string, rates: Map<string, number>): number {
  const rate = rates.get(currency);
  if (!rate || rate <= 0) return local;
  return local / rate;
}

function add(balances: Record<string, number>, account: string, anchor: number): void {
  if (!Number.isFinite(anchor) || anchor === 0) return;
  balances[account] = (balances[account] ?? 0) + anchor;
}

export async function collectBalances(db: Db): Promise<Record<string, number>> {
  const rates = await loadAnchorRates(db);
  const balances: Record<string, number> = {};

  // --- Characters: personal + savings wallets --------------------------------
  const characters = db.collection<{
    _id: ObjectId;
    cashOnHand?: number;
    currencyBalances?: {
      personal?: Partial<Record<CurrencyCode, number>>;
      savings?: Partial<Record<CurrencyCode, number>>;
    };
  }>("characters");
  const charCursor = characters.find(
    {},
    { projection: { cashOnHand: 1, "currencyBalances.personal": 1, "currencyBalances.savings": 1 } }
  );
  for await (const c of charCursor) {
    const id = c._id.toString();
    const personal = c.currencyBalances?.personal;
    if (personal) {
      for (const [cur, amt] of Object.entries(personal)) {
        if (typeof amt === "number") {
          add(balances, accountId("character", id, cur as CurrencyCode), toAnchor(amt, cur, rates));
        }
      }
    } else if (typeof c.cashOnHand === "number") {
      // Pre-forex character: cashOnHand is home currency; anchor 1:1 (USD-ish).
      add(balances, accountId("character", id, "USD"), c.cashOnHand);
    }
    const savings = c.currencyBalances?.savings;
    if (savings) {
      for (const [cur, amt] of Object.entries(savings)) {
        if (typeof amt === "number") {
          add(
            balances,
            accountId("character_savings", id, cur as CurrencyCode),
            toAnchor(amt, cur, rates)
          );
        }
      }
    }
  }

  // --- Corporations: liquidCapital -------------------------------------------
  const corps = db.collection<{
    _id: ObjectId;
    liquidCapital?: number;
    liquidCurrencyCode?: CurrencyCode;
  }>("corporations");
  const corpCursor = corps.find({}, { projection: { liquidCapital: 1, liquidCurrencyCode: 1 } });
  for await (const corp of corpCursor) {
    if (typeof corp.liquidCapital !== "number") continue;
    const cur = corp.liquidCurrencyCode ?? "USD";
    add(
      balances,
      accountId("corporation", corp._id.toString(), cur),
      toAnchor(corp.liquidCapital, cur, rates)
    );
  }

  // --- Parties: treasury (home currency of the party's country) --------------
  // Collection is `politicalParties` (there is no `parties` collection) — the
  // party `subjectId` on financialTxLog rows is the politicalParties `_id`, so
  // this is the balance the party primary legs reconcile against.
  const parties = db.collection<{ _id: ObjectId; treasury?: number; countryId?: string }>(
    "politicalParties"
  );
  const partyCursor = parties.find({}, { projection: { treasury: 1, countryId: 1 } });
  for await (const p of partyCursor) {
    if (typeof p.treasury !== "number") continue;
    const cur = countryCurrency(p.countryId);
    add(balances, accountId("party", p._id.toString(), cur), toAnchor(p.treasury, cur, rates));
  }

  // --- Governments: federalBudget treasuryBalance ----------------------------
  const budgets = db.collection<{
    countryId?: string;
    treasuryBalance?: number;
    currencyCode?: CurrencyCode;
  }>("federalBudget");
  const budgetCursor = budgets.find(
    {},
    { projection: { countryId: 1, treasuryBalance: 1, currencyCode: 1 } }
  );
  for await (const b of budgetCursor) {
    if (typeof b.treasuryBalance !== "number" || !b.countryId) continue;
    const cur = b.currencyCode ?? countryCurrency(b.countryId);
    add(
      balances,
      accountId("government", b.countryId, cur),
      toAnchor(b.treasuryBalance, cur, rates)
    );
  }

  return balances;
}

function countryCurrency(countryId?: string): CurrencyCode {
  if (countryId && countryId in COUNTRY_CONFIGS) {
    return COUNTRY_CONFIGS[countryId as keyof typeof COUNTRY_CONFIGS].currencyCode;
  }
  return "USD";
}

/**
 * Write the per-turn balance snapshot. Fire-and-forget; never throws (the
 * shadow ledger must not fail turn processing).
 */
export async function writeBalanceSnapshot(
  db: Db,
  turn: number,
  opts: { rebaselined?: boolean } = {}
): Promise<number> {
  try {
    const balances = await collectBalances(db);
    const doc: BalanceSnapshot = {
      _id: new ObjectId(),
      turn,
      createdAt: new Date(),
      balances,
      ...(opts.rebaselined ? { rebaselined: true } : {}),
    };
    // Idempotent per turn — re-running a turn replaces its snapshot.
    await db
      .collection<BalanceSnapshot>(BALANCE_SNAPSHOTS_COLLECTION)
      .replaceOne({ turn }, doc, { upsert: true });
    return Object.keys(balances).length;
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "writeBalanceSnapshot", turn } });
    return 0;
  }
}

export async function loadBalanceSnapshot(db: Db, turn: number): Promise<BalanceSnapshot | null> {
  return db.collection<BalanceSnapshot>(BALANCE_SNAPSHOTS_COLLECTION).findOne({ turn });
}
