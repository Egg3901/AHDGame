/**
 * Read-only aggregate audit of autonomous institutional bond participation.
 *
 * This intentionally prints no holder ids, names, connection strings, or
 * player-level rows. It is safe to point at MONGODB_URI_LIVE.
 */
import * as dotenv from "dotenv";
import { MongoClient, type Document } from "mongodb";
import * as path from "path";

dotenv.config({ path: ".env.local" });
if (!process.env.MONGODB_URI_LIVE) {
  dotenv.config({ path: path.resolve(process.cwd(), "../../..", ".env.local") });
}

type Holder = {
  units?: number;
  corporationId?: unknown;
  fundId?: unknown;
  nppId?: unknown;
  characterId?: unknown;
  imperialCharacterId?: unknown;
};

type BondRow = Document & {
  issuerType?: string;
  countryId?: string;
  currencyCode?: string;
  totalIssued?: number;
  faceValue?: number;
  publicFloat?: number;
  centralBankHoldings?: number;
  requestedUnits?: number;
  unsoldUnits?: number;
  maturityTurn?: number;
  holders?: Holder[];
};

type PoolRow = Document & {
  cashLocal?: number;
  targetCashLocal?: number;
};

type BudgetRow = Document & {
  countryId?: string;
  treasuryBalance?: number;
  gdp?: number;
  debt?: { principal?: number };
};

const FOCUS_COUNTRIES = ["US", "UK", "JP"] as const;

function nonnegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function maturityHhi(faceByTurn: ReadonlyMap<number, number>): number {
  const total = [...faceByTurn.values()].reduce((sum, face) => sum + face, 0);
  if (total <= 0) return 0;
  return (
    [...faceByTurn.values()].reduce((sum, face) => {
      const share = face / total;
      return sum + share * share;
    }, 0) * 10_000
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE is not set");

  const directUri = uri.includes("directConnection")
    ? uri
    : `${uri}${uri.includes("?") ? "&" : "?"}directConnection=true`;
  const client = new MongoClient(directUri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  try {
    const db = client.db();
    const [
      config,
      gameState,
      bonds,
      nppCorpIds,
      funds,
      nppTreasuryTx,
      pools,
      budgets,
      maturedUnpaid,
      supersededWithHolders,
    ] = await Promise.all([
      db.collection("gameConfig").findOne(
        { _id: "default" },
        {
          projection: {
            indexFundBondLiquidityEnabled: 1,
            domesticSovereignBondCoverageEnabled: 1,
            indexFundsMode: 1,
          },
        }
      ),
      db
        .collection("gameState")
        .findOne(
          { _id: "current" },
          { projection: { currentTurn: 1, nppCorpStrategyEnabled: 1, nppAutonomyLevel: 1 } }
        ),
      db
        .collection<BondRow>("bonds")
        .find(
          { issuerType: "sovereign", matured: { $ne: true }, defaulted: { $ne: true } },
          {
            projection: {
              countryId: 1,
              currencyCode: 1,
              totalIssued: 1,
              faceValue: 1,
              publicFloat: 1,
              centralBankHoldings: 1,
              requestedUnits: 1,
              unsoldUnits: 1,
              maturityTurn: 1,
              holders: 1,
            },
          }
        )
        .toArray(),
      db.collection("corporations").distinct("_id", { ceoType: "npp", suspended: { $ne: true } }),
      db
        .collection("indexFunds")
        .find({}, { projection: { kind: 1, status: 1, cashAnchor: 1 } })
        .toArray(),
      db.collection("financialTxLog").countDocuments({
        type: "bond_purchase",
        "meta.nppTreasury": true,
      }),
      db
        .collection<PoolRow>("bondMarketPools")
        .find({}, { projection: { cashLocal: 1, targetCashLocal: 1 } })
        .toArray(),
      db
        .collection<BudgetRow>("federalBudget")
        .find(
          { countryId: { $in: [...FOCUS_COUNTRIES] } },
          { projection: { countryId: 1, treasuryBalance: 1, gdp: 1, "debt.principal": 1 } }
        )
        .toArray(),
      db.collection<BondRow>("bonds").countDocuments({
        matured: true,
        "holders.0": { $exists: true },
        redeemedAtTurn: { $exists: false },
        defaultCure: { $exists: false },
      }),
      db.collection<BondRow>("bonds").countDocuments({
        matured: true,
        "holders.0": { $exists: true },
        defaultCure: { $exists: true },
      }),
    ]);

    const nppCorpIdSet = new Set(nppCorpIds.map(String));
    const totals = {
      outstandingUnits: 0,
      poolUnits: 0,
      nppCorpUnits: 0,
      otherCorpUnits: 0,
      fundUnits: 0,
      nppUnits: 0,
      characterUnits: 0,
    };
    let issuesWithNppCorp = 0;
    let issuesWithFund = 0;
    let issuesWithAnyRealHolder = 0;
    let unitInvariantViolations = 0;
    let primaryAccountingViolations = 0;

    for (const bond of bonds) {
      const face = bond.faceValue || 1_000;
      const outstanding = Math.max(0, Math.floor((bond.totalIssued ?? 0) / face));
      totals.outstandingUnits += outstanding;
      totals.poolUnits += Math.max(0, bond.publicFloat ?? 0);
      let hasNppCorp = false;
      let hasFund = false;
      let hasRealHolder = false;
      for (const holder of bond.holders ?? []) {
        const units = Math.max(0, holder.units ?? 0);
        if (units <= 0) continue;
        hasRealHolder = true;
        if (holder.fundId) {
          totals.fundUnits += units;
          hasFund = true;
        } else if (holder.nppId) {
          totals.nppUnits += units;
        } else if (holder.corporationId) {
          if (nppCorpIdSet.has(String(holder.corporationId))) {
            totals.nppCorpUnits += units;
            hasNppCorp = true;
          } else {
            totals.otherCorpUnits += units;
          }
        } else if (holder.characterId || holder.imperialCharacterId) {
          totals.characterUnits += units;
        }
      }
      if (hasNppCorp) issuesWithNppCorp++;
      if (hasFund) issuesWithFund++;
      if (hasRealHolder) issuesWithAnyRealHolder++;
      const held = (bond.holders ?? []).reduce((sum, holder) => sum + nonnegative(holder.units), 0);
      if (
        Math.abs(
          nonnegative(bond.publicFloat) + nonnegative(bond.centralBankHoldings) + held - outstanding
        ) > 1
      )
        unitInvariantViolations++;
      if (
        typeof bond.requestedUnits === "number" &&
        Math.abs(outstanding + nonnegative(bond.unsoldUnits) - bond.requestedUnits) > 1
      )
        primaryAccountingViolations++;
    }

    const pct = (units: number) =>
      totals.outstandingUnits > 0
        ? `${((units / totals.outstandingUnits) * 100).toFixed(3)}%`
        : "0.000%";
    const bondFunds = funds.filter((fund) => fund.kind === "bond");
    const currentTurn = nonnegative(gameState?.currentTurn);
    const poolByCurrency = new Map(pools.map((pool) => [String(pool._id), pool]));
    const budgetByCountry = new Map(
      budgets.filter((budget) => budget.countryId).map((budget) => [budget.countryId!, budget])
    );
    const countryAudit = FOCUS_COUNTRIES.map((countryId) => {
      const countryBonds = bonds.filter((bond) => bond.countryId === countryId);
      const currency = countryBonds.find((bond) => bond.currencyCode)?.currencyCode ?? null;
      const pool = currency ? poolByCurrency.get(currency) : undefined;
      const budget = budgetByCountry.get(countryId);
      const faceByTurn = new Map<number, number>();
      let outstandingFace = 0;
      let poolFace = 0;
      let centralBankFace = 0;
      let namedHolderFace = 0;
      let unsoldFace = 0;
      let requestedFace = 0;
      for (const bond of countryBonds) {
        const faceValue = nonnegative(bond.faceValue) || 1_000;
        const issuedFace = nonnegative(bond.totalIssued);
        outstandingFace += issuedFace;
        poolFace += nonnegative(bond.publicFloat) * faceValue;
        centralBankFace += nonnegative(bond.centralBankHoldings) * faceValue;
        namedHolderFace += (bond.holders ?? []).reduce(
          (sum, holder) => sum + nonnegative(holder.units) * faceValue,
          0
        );
        unsoldFace += nonnegative(bond.unsoldUnits) * faceValue;
        requestedFace += nonnegative(bond.requestedUnits) * faceValue;
        if (typeof bond.maturityTurn === "number" && bond.maturityTurn >= currentTurn) {
          faceByTurn.set(bond.maturityTurn, (faceByTurn.get(bond.maturityTurn) ?? 0) + issuedFace);
        }
      }
      const maturityRows = [...faceByTurn.entries()].sort(([a], [b]) => a - b);
      const faceDueThrough = (turns: number) =>
        maturityRows
          .filter(([turn]) => turn <= currentTurn + turns)
          .reduce((sum, [, face]) => sum + face, 0);
      const nextMaturity = maturityRows[0] ?? null;
      const peakMaturity = maturityRows.reduce<[number, number] | null>(
        (peak, row) => (!peak || row[1] > peak[1] ? row : peak),
        null
      );
      const next12Face = faceDueThrough(12);
      const poolCash = nonnegative(pool?.cashLocal);
      const treasuryCash = Math.max(0, Number(budget?.treasuryBalance ?? 0));
      return {
        countryId,
        currency,
        activeIssues: countryBonds.length,
        outstandingFace,
        debtPrincipal: nonnegative(budget?.debt?.principal),
        outstandingToRecordedPrincipal: ratio(
          outstandingFace,
          nonnegative(budget?.debt?.principal)
        ),
        holderShares: {
          pool: ratio(poolFace, outstandingFace),
          namedHolders: ratio(namedHolderFace, outstandingFace),
          centralBank: ratio(centralBankFace, outstandingFace),
        },
        primaryPlacement: {
          requestedFace,
          unsoldFace,
          cumulativeFillRatio: ratio(outstandingFace, requestedFace),
        },
        maturitySchedule: {
          next: nextMaturity ? { turn: nextMaturity[0], face: nextMaturity[1] } : null,
          faceDueNext12Turns: next12Face,
          faceDueNext48Turns: faceDueThrough(48),
          faceDueNext240Turns: faceDueThrough(240),
          peak: peakMaturity ? { turn: peakMaturity[0], face: peakMaturity[1] } : null,
          hhi: maturityHhi(faceByTurn),
        },
        liquiditySnapshot: {
          spendableTreasuryCash: treasuryCash,
          treasuryCashToNext12Maturities: ratio(treasuryCash, next12Face),
          poolCash,
          poolTarget: nonnegative(pool?.targetCashLocal),
          poolCashToTarget: ratio(poolCash, nonnegative(pool?.targetCashLocal)),
          poolCashToNext12Maturities: ratio(poolCash, next12Face),
        },
      };
    });

    console.log(
      JSON.stringify(
        {
          gates: {
            indexFundsMode: config?.indexFundsMode ?? null,
            indexFundBondLiquidityEnabled: config?.indexFundBondLiquidityEnabled ?? false,
            domesticSovereignBondCoverageEnabled:
              config?.domesticSovereignBondCoverageEnabled ?? false,
            nppCorpStrategyEnabled: gameState?.nppCorpStrategyEnabled ?? true,
            nppAutonomyLevel: gameState?.nppAutonomyLevel ?? null,
          },
          currentTurn: gameState?.currentTurn ?? null,
          sovereignIssues: bonds.length,
          issuesWithAnyRealHolder,
          issuesWithNppCorp,
          issuesWithFund,
          invariants: {
            unitInvariantViolations,
            primaryAccountingViolations,
            maturedUnpaidWithHolders: maturedUnpaid,
            supersededDocsWithHolders: supersededWithHolders,
            negativePoolCashRows: pools.filter((pool) => Number(pool.cashLocal ?? 0) < 0).length,
          },
          unitShares: {
            pool: pct(totals.poolUnits),
            nppCorporations: pct(totals.nppCorpUnits),
            otherCorporations: pct(totals.otherCorpUnits),
            indexFunds: pct(totals.fundUnits),
            individualNpps: pct(totals.nppUnits),
            characters: pct(totals.characterUnits),
          },
          nppCorporatePurchaseReceipts: nppTreasuryTx,
          indexFunds: {
            total: funds.length,
            bondFunds: bondFunds.length,
            activeBondFunds: bondFunds.filter((fund) => fund.status === "active").length,
            bondFundsWithCash: bondFunds.filter((fund) => Number(fund.cashAnchor ?? 0) > 0).length,
          },
          focusCountries: countryAudit,
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

void main();
