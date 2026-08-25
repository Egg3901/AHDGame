import type { Db, ObjectId } from "mongodb";
import type { UKBudget, UKBudgetStatus } from "../types/ukBudget";
import { validateBudget } from "@/lib/uk/budget/budgetValidation";
import { applyConfidenceEventToGov } from "@/lib/uk/confidence/confidenceGaugeStore";

/**
 * UK Budget persistence + lifecycle (epic #856, ticket #858).
 * Collection: "ukBudgets" — one document per fiscal year.
 *
 * Lifecycle: draft → tabled → passed | defeated. A defeat fires the
 * `budgetDefeat` confidence event (the biggest single gauge hit) — the key
 * connective piece between the Budget and the confidence gauge.
 */

export function getUKBudgetsCollection(db: Db) {
  return db.collection<UKBudget>("ukBudgets");
}

export async function getBudgetForFiscalYear(db: Db, fiscalYear: number): Promise<UKBudget | null> {
  return getUKBudgetsCollection(db).findOne({ fiscalYear });
}

export interface UpsertBudgetDraftInput {
  fiscalYear: number;
  chancellorCharacterId: ObjectId | null;
  taxRates: Record<string, number>;
  spendingAllocations: Record<string, number>;
  now: Date;
}

export interface BudgetOpResult {
  ok: boolean;
  error?: string;
}

/**
 * Create/update a draft Budget for a fiscal year. Refuses to edit a Budget that
 * has already been tabled or resolved (immutable once before the Commons).
 */
export async function upsertBudgetDraft(
  db: Db,
  input: UpsertBudgetDraftInput
): Promise<BudgetOpResult> {
  const col = getUKBudgetsCollection(db);
  const existing = await col.findOne({ fiscalYear: input.fiscalYear });
  if (existing && existing.status !== "draft") {
    return { ok: false, error: "budget already tabled" };
  }
  await col.updateOne(
    { fiscalYear: input.fiscalYear },
    {
      $set: {
        chancellorCharacterId: input.chancellorCharacterId,
        taxRates: input.taxRates,
        spendingAllocations: input.spendingAllocations,
        updatedAt: input.now,
      },
      $setOnInsert: {
        fiscalYear: input.fiscalYear,
        status: "draft" as UKBudgetStatus,
        createdAt: input.now,
      },
    },
    { upsert: true }
  );
  return { ok: true };
}

/** Table a draft Budget before the Commons. Validates it first. */
export async function tableBudget(db: Db, fiscalYear: number, now: Date): Promise<BudgetOpResult> {
  const col = getUKBudgetsCollection(db);
  const budget = await col.findOne({ fiscalYear });
  if (!budget) return { ok: false, error: "no budget to table" };
  if (budget.status !== "draft") return { ok: false, error: "budget already tabled" };

  const valid = validateBudget(budget);
  if (!valid.ok) return valid;

  await col.updateOne(
    { fiscalYear },
    { $set: { status: "tabled", tabledAt: now, updatedAt: now } }
  );
  return { ok: true };
}

export interface BudgetResolution {
  ok: boolean;
  passed: boolean;
  /** True when the defeat produced a confidence hit. */
  confidenceHit: boolean;
  error?: string;
}

/**
 * Resolve a tabled Budget's confidence vote. Passes when votesFor > votesAgainst;
 * a defeat sets status "defeated" AND fires the budgetDefeat confidence event.
 */
export async function resolveBudgetVote(
  db: Db,
  args: { fiscalYear: number; votesFor: number; votesAgainst: number; now: Date }
): Promise<BudgetResolution> {
  const col = getUKBudgetsCollection(db);
  const budget = await col.findOne({ fiscalYear: args.fiscalYear });
  if (!budget) return { ok: false, passed: false, confidenceHit: false, error: "no budget" };
  if (budget.status !== "tabled") {
    return { ok: false, passed: false, confidenceHit: false, error: "budget not tabled" };
  }

  const passed = args.votesFor > args.votesAgainst;
  await col.updateOne(
    { fiscalYear: args.fiscalYear },
    {
      $set: {
        status: passed ? "passed" : "defeated",
        votesFor: args.votesFor,
        votesAgainst: args.votesAgainst,
        resolvedAt: args.now,
        updatedAt: args.now,
      },
    }
  );

  if (!passed) {
    await applyConfidenceEventToGov(db, { kind: "budgetDefeat" }, args.now);
    return { ok: true, passed: false, confidenceHit: true };
  }
  return { ok: true, passed: true, confidenceHit: false };
}
