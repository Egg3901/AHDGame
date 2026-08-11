import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import type {
  FederalBudget,
  FederalBudgetSnapshot,
  FederalSpending,
  EnactedLaw,
} from "@/lib/db/types/budget";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { normalizeFederalSpending } from "@/lib/budget/spending";
import { resolveMongoDbName } from "@/lib/mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const CN_BUDGET_ID = "CN";
const FY1991_SNAPSHOT_ID = "CN:FY1991";
const FY1992_SNAPSHOT_ID = "CN:FY1992";

function requireMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set in .env.local");
  }
  return uri;
}

function getSeedCnBudget(): ReturnType<typeof getInitialNationalBudgetsForPreset>[number] {
  const seededBudget = getInitialNationalBudgetsForPreset("1991-default").find(
    (budget) => budget.countryId === "CN"
  );
  if (!seededBudget) throw new Error("1991 CN seed budget not found");
  return seededBudget;
}

function requireBaselineByCategory(
  budget: ReturnType<typeof getInitialNationalBudgetsForPreset>[number]
): Record<string, number> {
  if (!budget.baselineSpendingByCategory) {
    throw new Error("1991 CN seed budget is missing baselineSpendingByCategory");
  }
  return budget.baselineSpendingByCategory;
}

function requireBaselineStateGrants(
  budget: ReturnType<typeof getInitialNationalBudgetsForPreset>[number]
): number {
  if (budget.baselineStateGrants === undefined) {
    throw new Error("1991 CN seed budget is missing baselineStateGrants");
  }
  return budget.baselineStateGrants;
}

function currentDebtInterest(budget: Pick<FederalBudget, "debt">): number {
  return (budget.debt?.principal ?? 0) * (budget.debt?.interestRate ?? 0);
}

function buildBaselineSpending(
  byCategory: Record<string, number>,
  stateGrants: number,
  debtInterest: number
): FederalSpending {
  return normalizeFederalSpending({
    byCategory,
    stateGrants,
    debtInterest,
    total: 0,
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = requireMongoUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();

  try {
    const db = client.db(resolveMongoDbName(process.env as Record<string, string | undefined>));
    const federalBudgets = db.collection<FederalBudget>("federalBudget");
    const snapshots = db.collection<FederalBudgetSnapshot>("federalBudgetSnapshots");
    const enactedLaws = db.collection<EnactedLaw>("enactedLaws");

    const [liveBudget, fy1991Snapshot, fy1992Snapshot, cnLaws] = await Promise.all([
      federalBudgets.findOne({ _id: CN_BUDGET_ID }),
      snapshots.findOne({ _id: FY1991_SNAPSHOT_ID }),
      snapshots.findOne({ _id: FY1992_SNAPSHOT_ID }),
      enactedLaws
        .find({ countryId: "CN", scope: "national", repealedAt: { $exists: false } })
        .toArray(),
    ]);

    if (!liveBudget) throw new Error("Live CN federal budget not found");
    if (!fy1991Snapshot) throw new Error("CN FY1991 snapshot not found");
    if (!fy1992Snapshot) throw new Error("CN FY1992 snapshot not found");

    const nonTaxOrCostedLaws = cnLaws.filter(
      (law) =>
        law.budgetCategory !== "tax" ||
        (law.budgetCost ?? 0) !== 0 ||
        law.gdpPerCapitaMultiplier !== undefined ||
        law.annualCostPerCapita !== undefined ||
        law.annualCostUsd !== undefined
    );
    if (nonTaxOrCostedLaws.length > 0) {
      throw new Error(
        `Refusing repair: CN enacted laws are no longer tax-only baseline rows (${nonTaxOrCostedLaws.length} found)`
      );
    }

    const seededBudget = getSeedCnBudget();
    const baselineByCategory = requireBaselineByCategory(seededBudget);
    const baselineStateGrants = requireBaselineStateGrants(seededBudget);
    const liveSpending = buildBaselineSpending(
      baselineByCategory,
      baselineStateGrants,
      currentDebtInterest(liveBudget)
    );
    const fy1992SnapshotSpending = buildBaselineSpending(
      baselineByCategory,
      baselineStateGrants,
      fy1992Snapshot.budget.spending?.debtInterest ?? seededBudget.spending.debtInterest
    );

    const liveUpdate = {
      baselineSpendingByCategory: baselineByCategory,
      baselineStateGrants,
      spending: liveSpending,
      surplus: (liveBudget.revenue?.total ?? 0) - liveSpending.total,
      updatedAt: new Date(),
    } satisfies Partial<FederalBudget>;

    const fy1991Budget = {
      ...fy1991Snapshot.budget,
      revenue: seededBudget.revenue,
      taxRates: seededBudget.taxRates,
      taxBases: seededBudget.taxBases,
      spending: seededBudget.spending,
      debt: seededBudget.debt,
      economicFactors: seededBudget.economicFactors,
      surplus: seededBudget.surplus,
      gdp: seededBudget.gdp,
      debtToGdpRatio: seededBudget.debtToGdpRatio,
      creditRating: seededBudget.creditRating,
      currencyCode: seededBudget.currencyCode,
    };

    const fy1992Budget = {
      ...fy1992Snapshot.budget,
      spending: fy1992SnapshotSpending,
      surplus: (fy1992Snapshot.budget.revenue?.total ?? 0) - fy1992SnapshotSpending.total,
    };

    const summary = {
      mode: apply ? "apply" : "dry-run",
      liveBudget: {
        before: {
          revenueTotal: liveBudget.revenue?.total ?? 0,
          spendingTotal: liveBudget.spending?.total ?? 0,
          debtInterest: liveBudget.spending?.debtInterest ?? 0,
          surplus: liveBudget.surplus ?? 0,
          baselineStateGrants: liveBudget.baselineStateGrants ?? null,
        },
        after: {
          revenueTotal: liveBudget.revenue?.total ?? 0,
          spendingTotal: liveUpdate.spending.total,
          debtInterest: liveUpdate.spending.debtInterest,
          surplus: liveUpdate.surplus,
          baselineStateGrants: liveUpdate.baselineStateGrants,
        },
      },
      snapshots: {
        fy1991: {
          beforeSpendingTotal: fy1991Snapshot.budget.spending?.total ?? 0,
          afterSpendingTotal: fy1991Budget.spending.total,
          beforeSurplus: fy1991Snapshot.budget.surplus ?? 0,
          afterSurplus: fy1991Budget.surplus,
        },
        fy1992: {
          beforeSpendingTotal: fy1992Snapshot.budget.spending?.total ?? 0,
          afterSpendingTotal: fy1992Budget.spending.total,
          beforeSurplus: fy1992Snapshot.budget.surplus ?? 0,
          afterSurplus: fy1992Budget.surplus,
        },
      },
      guardrail: {
        cnNationalLawCount: cnLaws.length,
        nonTaxOrCostedLawCount: nonTaxOrCostedLaws.length,
      },
    };

    if (!apply) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    await federalBudgets.updateOne({ _id: CN_BUDGET_ID }, { $set: liveUpdate });
    await snapshots.updateOne({ _id: FY1991_SNAPSHOT_ID }, { $set: { budget: fy1991Budget } });
    await snapshots.updateOne({ _id: FY1992_SNAPSHOT_ID }, { $set: { budget: fy1992Budget } });

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
