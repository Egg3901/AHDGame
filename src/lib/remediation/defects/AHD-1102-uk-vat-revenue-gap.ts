import type { Db } from "mongodb";
import type {
  Defect,
  DetectResult,
  HealPlan,
  HealResult,
  HealContext,
  VerifyResult,
} from "../types";

/**
 * Ticket #1102. The Poon Choi Economic Act passed in the UK and collected
 * nothing.
 *
 * `onBillEnacted` required `legislationType.taxRateChange`, but a tax-slider law
 * stores its move in `taxSlider`, so enactment silently no-opped. The UK's sales
 * tax and tariffs stayed at 0 while the statute book said otherwise. Fixed in
 * code by commit c36e18dda9 (`taxRateChange ?? taxSlider`), which stops new
 * bills dropping their rate but does nothing for the revenue already missed.
 *
 * WHAT THIS CREDITS, AND HOW THE NUMBER WAS DERIVED
 *
 * The credit is an ESTIMATE, and the derivation is written down here rather than
 * buried in a commit message because anyone auditing this heal later deserves to
 * see exactly how a nine-figure number was arrived at.
 *
 *   Window. `enactedLaws` pins the Act at 2026-08-13T23:00:25Z and the code fix
 *   deployed 2026-08-16T17:57Z. One turn is one real hour, so the Act was law
 *   for {@link GAP_TURNS} turns while collecting nothing.
 *
 *   Rate. The first full fiscal-year snapshot AFTER the fix (UK:FY1957) is the
 *   only clean observation of what the Act actually charges: sales tax 5% and
 *   tariffs 2%. Its recorded annual revenue for those two lines is read at heal
 *   time and divided by TURNS_PER_YEAR to get a per-turn figure, then multiplied
 *   by the gap.
 *
 * The estimate is therefore anchored to observed post-fix revenue rather than to
 * a hand-picked constant, but it still assumes the tax base was roughly steady
 * across the window. It was not measured and cannot be: the snapshots are
 * annual, and no per-turn record of the counterfactual exists.
 *
 * The credit lands on `treasuryBalance`. `treasuryTurn` derives debt from that
 * balance (`nationalDebtFromBalance` = `max(0, -treasuryBalance)`), so the debt
 * figure follows on the next turn without this heal writing to `debt` directly
 * and racing the engine for the same field.
 *
 * This heal MINTS MONEY on purpose. It is recreating revenue a country should
 * have collected and did not, so `moneyDelta` is deliberately non-zero and the
 * `money-conserving` guard is deliberately absent.
 */

/** Marker written on the healed budget. Presence is what makes a re-run a no-op. */
const MARKER = "remediation.AHD-1102-uk-vat-revenue-gap";

/**
 * Turns the Act was law while collecting nothing.
 *
 * 2026-08-13T23:00:25Z (enactedLaws.enactedAt for uk.tax.salesTax) to
 * 2026-08-16T17:57Z (deploy of c36e18dda9) is 66h57m. One turn is one real hour.
 */
export const GAP_TURNS = 67;

/** Fiscal-year snapshot used as the clean post-fix rate observation. */
const REFERENCE_SNAPSHOT_ID = "UK:FY1957";

/** Turns in a game year, matching `@/lib/constants/turnTime`. Duplicated to keep the ledger self-contained. */
const TURNS_PER_YEAR = 48;

interface BudgetDoc {
  _id: string;
  countryId?: string;
  treasuryBalance?: number;
  remediation?: Record<string, unknown>;
}

interface SnapshotDoc {
  _id: string;
  budget?: {
    revenue?: { salesTax?: number; tariffs?: number };
    taxRates?: { salesTax?: number; tariffs?: number };
  };
}

async function loadUkBudget(db: Db): Promise<BudgetDoc | null> {
  return db.collection<BudgetDoc>("federalBudget").findOne({ countryId: "UK" });
}

function alreadyHealed(budget: BudgetDoc | null): boolean {
  if (!budget) return false;
  return Boolean(budget.remediation?.["AHD-1102-uk-vat-revenue-gap"]);
}

/**
 * Per-turn revenue the two Poon Choi lines produce at their real rates, read
 * from the post-fix snapshot. Returns 0 when the snapshot is missing or shows
 * zero, which makes the heal a no-op rather than letting it invent a figure.
 */
export function estimateGapCredit(snapshot: SnapshotDoc | null, gapTurns: number): number {
  const salesTaxAnnual = snapshot?.budget?.revenue?.salesTax ?? 0;
  const tariffsAnnual = snapshot?.budget?.revenue?.tariffs ?? 0;
  if (salesTaxAnnual <= 0 && tariffsAnnual <= 0) return 0;
  const perTurn = (salesTaxAnnual + tariffsAnnual) / TURNS_PER_YEAR;
  return Math.round(perTurn * Math.max(0, gapTurns));
}

async function detect(db: Db): Promise<DetectResult> {
  const budget = await loadUkBudget(db);
  if (!budget) {
    return { affected: 0, sample: [], notes: ["no UK federalBudget document"] };
  }
  if (alreadyHealed(budget)) {
    return { affected: 0, sample: [], notes: ["UK budget already carries the AHD-1102 marker"] };
  }
  const snapshot = await db
    .collection<SnapshotDoc>("federalBudgetSnapshots")
    .findOne({ _id: REFERENCE_SNAPSHOT_ID });
  const credit = estimateGapCredit(snapshot, GAP_TURNS);
  if (credit <= 0) {
    return {
      affected: 0,
      sample: [],
      notes: [
        `reference snapshot ${REFERENCE_SNAPSHOT_ID} shows no sales tax or tariff revenue, so there is nothing to extrapolate from`,
      ],
    };
  }
  return {
    affected: 1,
    sample: [{ _id: budget._id, treasuryBalance: budget.treasuryBalance, credit }],
    notes: [
      `UK uncollected sales tax and tariffs across ${GAP_TURNS} turns, estimated from ${REFERENCE_SNAPSHOT_ID}`,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const budget = await loadUkBudget(db);
  const snapshot = await db
    .collection<SnapshotDoc>("federalBudgetSnapshots")
    .findOne({ _id: REFERENCE_SNAPSHOT_ID });
  const credit = budget && !alreadyHealed(budget) ? estimateGapCredit(snapshot, GAP_TURNS) : 0;

  if (!budget || credit <= 0) {
    return {
      affected: 0,
      touched: [],
      moneyDelta: 0,
      summary:
        "AHD-1102: nothing to heal (already credited, or no reference revenue to estimate from)",
    };
  }

  return {
    affected: 1,
    touched: [{ collection: "federalBudget", ids: [String(budget._id)] }],
    moneyDelta: credit,
    summary: `AHD-1102: credit GBP ${credit.toLocaleString("en-US")} to the UK treasury for ${GAP_TURNS} turns of sales tax and tariffs the Poon Choi Act should have collected`,
    notes: [
      `estimate = (${REFERENCE_SNAPSHOT_ID} annual salesTax + tariffs) / ${TURNS_PER_YEAR} x ${GAP_TURNS} turns`,
      "credited to treasuryBalance; treasuryTurn derives debt.principal from it on the next turn",
      "MINTS MONEY deliberately: this recreates revenue that was never collected",
    ],
    payload: { credit, budgetId: String(budget._id) },
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const payload = healPlan.payload as { credit: number; budgetId: string } | undefined;
  if (!payload || payload.credit <= 0) {
    return { documentsScanned: 1, documentsUpdated: 0, notes: ["nothing to credit"] };
  }

  // Guarded on the marker being absent, so two concurrent runs cannot both
  // credit: the second matches nothing.
  const res = await db.collection<BudgetDoc>("federalBudget").updateOne(
    { _id: payload.budgetId, [MARKER]: { $exists: false } },
    {
      $inc: { treasuryBalance: payload.credit },
      $set: {
        [MARKER]: {
          creditedAt: ctx.now,
          amount: payload.credit,
          gapTurns: GAP_TURNS,
          referenceSnapshot: REFERENCE_SNAPSHOT_ID,
          runId: ctx.runId ?? null,
        },
      },
    }
  );

  return {
    documentsScanned: 1,
    documentsUpdated: res.modifiedCount,
    notes:
      res.modifiedCount === 1
        ? [`credited ${payload.credit.toLocaleString("en-US")} to UK treasuryBalance`]
        : ["marker already present, no credit applied"],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const budget = await loadUkBudget(db);
  const healed = alreadyHealed(budget);
  const after = await detect(db);
  return {
    ok: healed && after.affected === 0,
    remaining: after.affected,
    notes: healed
      ? ["UK budget carries the AHD-1102 marker; a re-run is a no-op"]
      : ["UK budget does not carry the AHD-1102 marker"],
  };
}

export const defect: Defect = {
  id: "AHD-1102-uk-vat-revenue-gap",
  title: "UK collected no sales tax or tariffs while the Poon Choi Act was law",
  severity: "P2",
  codeFix: {
    mergedTo: "main",
    requiredCommit: "c36e18dda9c8edb4af735619eb605a75a622326e",
  },
  seedFix: {
    status: "not-needed",
    note: "the gap is runtime revenue never accrued by a live world; no seed emits a treasury balance short of collected tax",
  },
  envs: ["prod"],
  idempotent: true,
  // Deliberate: this recreates revenue that should have been collected, so the
  // money-conserving guard is omitted rather than worked around.
  mintsMoney: true,
  guards: ["turn-lock-free", "max-affected:1"],
  detect,
  plan,
  apply,
  verify,
};
