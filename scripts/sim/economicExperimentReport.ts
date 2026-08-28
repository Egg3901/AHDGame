import { MongoClient } from "mongodb";
import type { Bond, CommodityFlow, EconomicVitalSigns, GameState, IndexFund } from "@/lib/db/types";
import type {
  BalanceSnapshot,
  LedgerEntry,
  LedgerReconciliation,
  ReconcileReport,
} from "@/lib/ledger/types";
import { snapshotEconomicVitalSigns } from "@/lib/economy/economicVitalSigns";
import { reconcileLedger } from "@/lib/ledger/reconcile";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function median(values: Array<number | null | undefined>): number | null {
  const sorted = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function metricSummary(values: Array<number | null | undefined>) {
  const observations = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  return { median: median(observations), observations: observations.length };
}

function metricRows(snapshots: EconomicVitalSigns[]) {
  return {
    pooledFillRate: metricSummary(snapshots.map((row) => row.goods.pooledFillRate.value)),
    countryScopedFillRate: metricSummary(
      snapshots.map((row) => row.goods.countryScopedFillRate.value)
    ),
    intentFulfillmentRate: metricSummary(
      snapshots.map((row) => row.trade.intentFulfillmentRate.value)
    ),
    nonlocalFulfillmentShare: metricSummary(
      snapshots.map(
        (row) => (row.trade.interstateShare.value ?? 0) + (row.trade.importShare.value ?? 0)
      )
    ),
    toleranceBoundShareOfUnmet: metricSummary(
      snapshots.map((row) => row.trade.toleranceBoundShareOfUnmet.value)
    ),
    capacityBoundShareOfUnmet: metricSummary(
      snapshots.map((row) => row.trade.capacityBoundShareOfUnmet.value)
    ),
    shortageResponsiveShareOfFulfillment: metricSummary(
      snapshots.map((row) => row.trade.shortageResponsiveShareOfFulfillment.value)
    ),
    throughputFloorShare: metricSummary(
      snapshots.map((row) => row.production.throughputFloorShare.value)
    ),
    physicalSellThrough: metricSummary(
      snapshots.map((row) => row.production.physicalSellThrough.value)
    ),
    labourStaffingRate: metricSummary(
      snapshots.map((row) => row.production.labourStaffingRate.value)
    ),
    chronicLowFillShare: metricSummary(
      snapshots.map((row) => row.production.chronicLowFillShare.value)
    ),
    stockpilingShare: metricSummary(snapshots.map((row) => row.production.stockpilingShare.value)),
    highConcentrationLowFillShare: metricSummary(
      snapshots.map((row) => row.competition.highConcentrationLowFillShare.value)
    ),
    activeTradedListingShare: metricSummary(
      snapshots.map((row) => row.securities.activeTradedListingShare.value)
    ),
    twoSidedListingShare: metricSummary(
      snapshots.map((row) => row.securities.twoSidedListingShare.value)
    ),
    depthToMarketCap: metricSummary(snapshots.map((row) => row.securities.depthToMarketCap.value)),
    noHolderBondShare: metricSummary(
      snapshots.map((row) => row.securities.noHolderBondShare.value)
    ),
    sovereignNoHolderBondShare: metricSummary(
      snapshots.map((row) => row.securities.sovereignNoHolderBondShare?.value)
    ),
    corporateNoHolderBondShare: metricSummary(
      snapshots.map((row) => row.securities.corporateNoHolderBondShare?.value)
    ),
    bondSubscriptionRate: metricSummary(
      snapshots.map((row) => row.securities.bondSubscriptionRate.value)
    ),
    activeModeledBalanceShare48: metricSummary(
      snapshots.map((row) => row.money.activeModeledBalanceShare48.value)
    ),
    dormantModeledBalanceShare48: metricSummary(
      snapshots.map((row) => row.money.dormantModeledBalanceShare48.value)
    ),
    modeledGrossVelocity48: metricSummary(
      snapshots.map((row) => row.money.modeledGrossVelocity48.value)
    ),
  };
}

type MetricRows = ReturnType<typeof metricRows>;

function metricDeltas(control: MetricRows, treatment: MetricRows) {
  return Object.fromEntries(
    Object.entries(treatment).map(([name, value]) => {
      const baseline = control[name as keyof MetricRows].median;
      return [name, baseline == null || value.median == null ? null : value.median - baseline];
    })
  );
}

async function countryFillMedians(
  flows: CommodityFlow[]
): Promise<Record<string, { median: number | null; observations: number }>> {
  const byTurnCountry = new Map<string, { demand: number; cleared: number }>();
  for (const flow of flows) {
    for (const [countryId, row] of Object.entries(flow.byCountry)) {
      const key = `${flow.turn}:${countryId}`;
      const aggregate = byTurnCountry.get(key) ?? { demand: 0, cleared: 0 };
      aggregate.demand += row.demand;
      aggregate.cleared += row.clearedUnitsScoped ?? row.cleared;
      byTurnCountry.set(key, aggregate);
    }
  }
  const byCountry = new Map<string, number[]>();
  for (const [key, row] of byTurnCountry) {
    if (row.demand <= 0) continue;
    const countryId = key.slice(key.indexOf(":") + 1);
    const values = byCountry.get(countryId) ?? [];
    values.push(row.cleared / row.demand);
    byCountry.set(countryId, values);
  }
  return Object.fromEntries(
    [...byCountry.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([countryId, values]) => [countryId, metricSummary(values)])
  );
}

function countryFillGuardrail(
  control: Record<string, { median: number | null }>,
  treatment: Record<string, { median: number | null }>
) {
  return Object.keys(control)
    .flatMap((countryId) => {
      const baseline = control[countryId]?.median;
      const current = treatment[countryId]?.median;
      return baseline == null || current == null
        ? []
        : [{ countryId, delta: current - baseline, control: baseline, treatment: current }];
    })
    .sort((a, b) => a.delta - b.delta);
}

function reconciliationSummary(reconciliation: ReconcileReport | null) {
  return reconciliation
    ? {
        status: reconciliation.status,
        entriesChecked: reconciliation.entriesChecked,
        trialBalance: {
          status: reconciliation.trialBalance.status,
          unbalancedCount: reconciliation.trialBalance.unbalancedCount,
        },
        stockVsFlow: {
          status: reconciliation.stockVsFlow.status,
          divergentCount: reconciliation.stockVsFlow.divergentCount,
        },
        moneySupply: {
          status: reconciliation.moneySupply.status,
          findingCount: reconciliation.moneySupply.findings.length,
        },
        unattributedCount: reconciliation.unattributed.length,
        topUnattributed: reconciliation.unattributed.slice(0, 12),
      }
    : null;
}

async function summarizeDatabase(client: MongoClient, dbName: string, refresh: boolean) {
  const db = client.db(dbName);
  const state = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const terminalTurn = state?.currentTurn ?? 0;
  if (refresh) await snapshotEconomicVitalSigns(db, terminalTurn);
  const startTurn = Math.max(0, terminalTurn - 11);
  const [snapshots, flows, bonds, funds, reconciliation, entries, balanceSnapshots] =
    await Promise.all([
      db
        .collection<EconomicVitalSigns>("economicVitalSigns")
        .find({ turn: { $gte: startTurn, $lte: terminalTurn } })
        .sort({ turn: 1 })
        .toArray(),
      db
        .collection<CommodityFlow>("commodityFlows")
        .find({ turn: { $gte: startTurn, $lte: terminalTurn } })
        .toArray(),
      db.collection<Bond>("bonds").find({ matured: false }).toArray(),
      db.collection<IndexFund>("indexFunds").find({ status: "active" }).toArray(),
      db.collection<LedgerReconciliation>("ledgerReconciliations").findOne({ turn: terminalTurn }),
      db.collection<LedgerEntry>("ledgerEntries").find({ turn: terminalTurn }).toArray(),
      db
        .collection<BalanceSnapshot>("balanceSnapshots")
        .find({ turn: { $in: [terminalTurn - 1, terminalTurn] } })
        .toArray(),
    ]);
  const opening = balanceSnapshots.find((row) => row.turn === terminalTurn - 1);
  const closing = balanceSnapshots.find((row) => row.turn === terminalTurn);
  const recomputedReconciliation = reconcileLedger({
    turn: terminalTurn,
    entries,
    openingBalances: opening?.balances ?? {},
    closingBalances: closing?.balances ?? {},
    skipStockVsFlow: !opening || Boolean(closing?.rebaselined),
  });
  const bondGroups = Object.fromEntries(
    ["sovereign", "corporate"].map((kind) => {
      const rows = bonds.filter((bond) =>
        kind === "sovereign" ? bond.issuerType === "sovereign" : bond.issuerType !== "sovereign"
      );
      const heldUnits = rows.reduce(
        (sum, bond) =>
          sum +
          bond.holders.reduce((holderSum, holder) => holderSum + Math.max(0, holder.units), 0),
        0
      );
      const fundHeldUnits = rows.reduce(
        (sum, bond) =>
          sum +
          bond.holders.reduce(
            (holderSum, holder) => holderSum + (holder.fundId ? Math.max(0, holder.units) : 0),
            0
          ),
        0
      );
      const publicFloatUnits = rows.reduce(
        (sum, bond) => sum + Math.max(0, bond.publicFloat ?? 0),
        0
      );
      return [
        kind,
        {
          activeIssues: rows.length,
          noHolderIssues: rows.filter((bond) => !bond.holders.some((holder) => holder.units > 0))
            .length,
          heldUnits,
          fundHeldUnits,
          publicFloatUnits,
        },
      ];
    })
  );
  return {
    dbName,
    terminalTurn,
    terminalWindow: { startTurn, endTurn: terminalTurn, snapshots: snapshots.length },
    medianTerminal12: metricRows(snapshots),
    endpoint: snapshots.at(-1) ?? null,
    countryFillMedianTerminal12: await countryFillMedians(flows),
    bonds: bondGroups,
    indexFunds: {
      activeFunds: funds.length,
      cashAnchor: funds.reduce((sum, fund) => sum + Math.max(0, fund.cashAnchor ?? 0), 0),
    },
    reconciliation: {
      persisted: reconciliationSummary(reconciliation),
      recomputedWithCandidate: reconciliationSummary(recomputedReconciliation),
    },
  };
}

const uri = process.env.SIM_MONGODB_URI;
const dbNames = argument("dbs")
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!uri || !dbNames || dbNames.length === 0) {
  throw new Error(
    "Usage: SIM_MONGODB_URI=... npx tsx scripts/sim/economicExperimentReport.ts --dbs=<control,treatment> [--refresh]"
  );
}
const refresh = process.argv.includes("--refresh");

async function main(mongoUri: string, selectedDbNames: string[]): Promise<void> {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const arms = [];
    for (const dbName of selectedDbNames) {
      arms.push(await summarizeDatabase(client, dbName, refresh));
    }
    const control = arms[0]!;
    const comparisons = arms.slice(1).map((arm) => ({
      treatment: arm.dbName,
      control: control.dbName,
      metricDeltas: metricDeltas(control.medianTerminal12, arm.medianTerminal12),
      countryFillGuardrail: countryFillGuardrail(
        control.countryFillMedianTerminal12,
        arm.countryFillMedianTerminal12
      ),
    }));
    process.stdout.write(`${JSON.stringify({ arms, comparisons }, null, 2)}\n`);
  } finally {
    await client.close();
  }
}

void main(uri, dbNames).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
