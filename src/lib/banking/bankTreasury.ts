import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { Bond, BondHolder } from "@/lib/db/types/bond";
import type {
  BankCharter,
  BankTreasuryHolderSnapshot,
  BankTreasuryTradeReceipt,
} from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types/corporation";
import type { BankingPolicySnapshot } from "@/lib/banking/rules/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import {
  computeBankTreasuryCashFloor,
  computeBankTreasuryDueInterest,
  computeBankTreasuryFundingRatePercent,
  planBankTreasurySweep,
  bankTreasuryHolderUnits,
  allocateBankTreasuryHolderLots,
  bankTreasuryAllocatedCostBasis,
  quoteBankTreasuryBond,
  BANK_TREASURY_MAX_REMAINING_TURNS,
  type BankTreasurySweepCandidate,
} from "@/lib/banking/rules/bankTreasury";
import {
  bondPoolCurrency,
  loadBondPoolsByCurrency,
  type BondPoolQuoteSnapshot,
  type LoadedBondQuote,
  loadBondQuote,
} from "@/lib/bonds/marketPool";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { getBankId } from "@/lib/centralBank/helpers";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { InterbankLoan } from "@/lib/db/types/bank";
import { ensureFund } from "@/lib/banking/insurance";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import { settleAtomicDocumentTransition } from "@/lib/banking/atomicDocumentSettlement";
import { quoteSovereignPrimaryBankPurchase } from "./rules/sovereignPrimary";
import { sovereignPrimaryTransition } from "@/lib/bonds/rules/sovereignPrimary";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import {
  loadPrimaryAccounting,
  primaryFinancingRate,
  primaryDocumentId,
} from "@/lib/bonds/sovereignPrimarySettlement";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";

export const BANK_TREASURY_TRADES_COLLECTION = "bankTreasuryTrades";

type BankState = Pick<Corporation, "_id" | "name" | "bankCharter" | "bankTreasuryEscrows">;

export interface BankTreasuryPosition {
  bondId: string;
  issuer: string;
  countryId: string;
  currency: CurrencyCode;
  units: number;
  maturityTurn: number;
  remainingTurns: number;
  couponRate: number;
  bidPerUnitLocal: number;
  askPerUnitLocal: number;
  annualizedContractYieldPercent?: number;
  executablePoolDepthUnits: number;
  publicFloatUnits?: number;
  markedValueLocal: number;
  eligibleToBuy: boolean;
}

export interface BankTreasuryOverview {
  currency: CurrencyCode;
  cashReserves: number;
  cashFloor: ReturnType<typeof computeBankTreasuryCashFloor>;
  spendableCash: number;
  markValueLocal: number;
  autoSweep: boolean;
  fundingRatePercent: number;
  positions: BankTreasuryPosition[];
  /** Present only for explicitly enabled investment-bank primary subscriptions. */
  primaryOffers?: Array<BankTreasuryPosition & { unsoldUnits: number }>;
}

export type BankTreasuryTradeResult =
  | {
      status: "completed";
      tradeId: string;
      side: "buy" | "sell";
      units: number;
      amountLocal: number;
    }
  | {
      status: "pending";
      tradeId: string;
      side: "buy" | "sell";
      units: number;
      amountLocal: number;
      error?: string;
    }
  | {
      status: "rejected";
      tradeId: string;
      side: "buy" | "sell";
      units: number;
      amountLocal: number;
      error: string;
    };

function roundLocal(amount: number, currency: CurrencyCode): number {
  return roundSavingsAmount(amount, currency);
}

function holderLotInputs(holders: readonly BondHolder[]) {
  return holders.map((holder) => ({
    bankId: holder.bankId?.toHexString(),
    charteredTurn: holder.charteredTurn,
    lotId: holder.bankTreasuryLotId,
    tradeId: holder.bankTreasuryTradeId,
    units: holder.units,
    avgCostPerUnit: holder.avgCostPerUnit,
  }));
}

const HOLDER_OBJECT_ID_FIELDS = [
  "characterId",
  "imperialCharacterId",
  "corporationId",
  "fundId",
  "nppId",
  "bankId",
] as const;

function freezeHolderSnapshot(holders: readonly BondHolder[]): BankTreasuryHolderSnapshot[] {
  return holders.map((holder) => {
    const frozen = { ...holder } as Record<string, unknown>;
    for (const field of HOLDER_OBJECT_ID_FIELDS) {
      const id = holder[field];
      if (id instanceof ObjectId) frozen[field] = id.toHexString();
    }
    return frozen as BankTreasuryHolderSnapshot;
  });
}

function thawHolderSnapshot(
  snapshot: BankTreasuryTradeReceipt["holderSnapshot"],
  fallback: readonly BondHolder[]
): BondHolder[] {
  if (!snapshot) return [...fallback];
  return snapshot.map((holder) => {
    const thawed = { ...holder } as Record<string, unknown>;
    for (const field of HOLDER_OBJECT_ID_FIELDS) {
      const id = holder[field];
      if (typeof id === "string" && /^[0-9a-f]{24}$/i.test(id)) thawed[field] = new ObjectId(id);
    }
    return thawed as unknown as BondHolder;
  });
}

function activeHolderUnits(
  holders: readonly BondHolder[],
  bankId: ObjectId,
  charteredTurn: number
): number {
  return bankTreasuryHolderUnits(holderLotInputs(holders), bankId.toHexString(), charteredTurn);
}

function poolSnapshot(pool: BondPoolQuoteSnapshot | undefined): BondPoolQuoteSnapshot {
  return pool ?? { cashLocal: 0, targetCashLocal: 0 };
}

async function bankCashFloor(
  db: Db,
  charter: BankCharter,
  playerDepositsAreLiabilities: boolean,
  bankId: ObjectId
): Promise<ReturnType<typeof computeBankTreasuryCashFloor> & { fundingRatePercent: number }> {
  const countryId = getCountryIdForCurrency(charter.currency);
  const centralBankId = getBankId(countryId);
  const [reserveRatio, centralBank, interbankLoans] = await Promise.all([
    getReserveRequirement(db, charter.currency),
    db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: centralBankId }, { projection: { primeRate: 1, inflationHistory: 1 } }),
    db
      .collection<InterbankLoan>("interbankLoans")
      .find({
        borrowerCorporationId: bankId,
        currency: charter.currency,
        status: "current",
      })
      .project<Pick<InterbankLoan, "outstanding" | "ratePercent">>({
        outstanding: 1,
        ratePercent: 1,
      })
      .toArray(),
  ]);
  const prime =
    typeof centralBank?.primeRate === "number" && Number.isFinite(centralBank.primeRate)
      ? centralBank.primeRate
      : 0;
  const inflation = centralBank?.inflationHistory?.at(-1)?.rate ?? 0;
  const cashBacked =
    Math.max(0, charter.npcDeposits ?? 0) +
    (playerDepositsAreLiabilities ? Math.max(0, charter.playerDeposits ?? 0) : 0);
  // Origination fees are real cash only after a new loan's receipt settles.
  // They are not forecast against this floor, and past fees are not recurring.
  const dueInterestInput = {
    currency: charter.currency,
    primeRate: prime,
    inflationRate: inflation,
    depositOffset: charter.depositOffset,
    npcDeposits: charter.npcDeposits ?? 0,
    totalDeposits:
      charter.totalDeposits ?? (charter.npcDeposits ?? 0) + (charter.playerDeposits ?? 0),
    playerDeposits: charter.playerDeposits ?? 0,
    playerDepositsAreLiabilities,
    discountWindowDebt: charter.discountWindowDebt ?? 0,
    cbMarginDebt: charter.cbMarginDebt ?? 0,
    interbankLoans: interbankLoans.map((loan) => ({
      outstanding: loan.outstanding ?? 0,
      ratePercent: loan.ratePercent,
    })),
  };
  return {
    ...computeBankTreasuryCashFloor({
      cashBackedDeposits: cashBacked,
      npcDeposits: charter.npcDeposits ?? 0,
      reserveRatio,
      nextTurnDueInterest: computeBankTreasuryDueInterest(dueInterestInput),
    }),
    fundingRatePercent: computeBankTreasuryFundingRatePercent(dueInterestInput),
  };
}

/** Load only same-currency sovereign bills and pool cash while the feature is enabled. */
export async function getBankTreasuryOverview(
  db: Db,
  bankId: ObjectId,
  policy: BankingPolicySnapshot,
  turn: number
): Promise<BankTreasuryOverview | null> {
  if (!policy.bankTreasury) return null;
  const bank = await db
    .collection<BankState>("corporations")
    .findOne(
      { _id: bankId, "bankCharter.status": "active" },
      { projection: { bankCharter: 1, name: 1 } }
    );
  const charter = bank?.bankCharter;
  if (!charter) return null;
  const currency = charter.currency;
  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      matured: { $ne: true },
      defaulted: { $ne: true },
      $and: [
        { $or: [{ currencyCode: currency }, { currencyCode: { $exists: false } }] },
        {
          $or: [
            { publicFloat: { $gt: 0 } },
            ...(policy.sovereignPrimary ? [{ unsoldUnits: { $gt: 0 } }] : []),
            { holders: { $elemMatch: { bankId, charteredTurn: charter.charteredTurn } } },
          ],
        },
      ],
    })
    .toArray();
  const pools = await loadBondPoolsByCurrency(db);
  const cashFloor = await bankCashFloor(
    db,
    charter,
    savingsReadsAuthoritative(policy, currency),
    bankId
  );
  const cashReserves = Math.max(0, charter.cashReserves ?? 0);
  const positions: BankTreasuryPosition[] = [];
  const primaryOffers: NonNullable<BankTreasuryOverview["primaryOffers"]> = [];
  for (const bond of bonds) {
    const bondCurrency = bondPoolCurrency(bond);
    if (bondCurrency !== currency) continue;
    const pool = poolSnapshot(pools.get(currency));
    const quote: LoadedBondQuote = await loadBondQuote(db, bond, {
      pools: new Map([[currency, pool]]),
    });
    const pure = quoteBankTreasuryBond({
      bond,
      currency,
      currentTurn: turn,
      poolCashLocal: quote.poolCashLocal,
      poolTargetCashLocal: quote.targetCashLocal,
      appetite: quote.appetite,
    });
    const units = activeHolderUnits(bond.holders ?? [], bankId, charter.charteredTurn);
    const position: BankTreasuryPosition = {
      bondId: bond._id.toHexString(),
      issuer: bond.issuerName ?? bond.countryId ?? "Sovereign",
      countryId: String(bond.countryId ?? ""),
      currency,
      units,
      maturityTurn: bond.maturityTurn,
      remainingTurns: pure.remainingTurns,
      couponRate: bond.couponRate,
      bidPerUnitLocal: quote.bidPerUnit,
      askPerUnitLocal: quote.askPerUnit,
      annualizedContractYieldPercent: pure.annualizedContractYieldPercent,
      executablePoolDepthUnits: quote.depthUnitsAtBid,
      publicFloatUnits: pure.publicFloatUnits,
      markedValueLocal: roundLocal(units * quote.bidPerUnit, currency),
      eligibleToBuy: pure.eligible,
    };
    if ((bond.publicFloat ?? 0) > 0 || units > 0) positions.push(position);
    if (
      policy.sovereignPrimary &&
      (bond.unsoldUnits ?? 0) > 0 &&
      ["investment", "universal"].includes(charter.type) &&
      bond.maturityTurn > turn &&
      bond.currencyCode === currency &&
      !bond.sovereignMaturityClaim
    )
      primaryOffers.push({ ...position, unsoldUnits: bond.unsoldUnits! });
  }
  positions.sort((a, b) => a.remainingTurns - b.remainingTurns || a.bondId.localeCompare(b.bondId));
  return {
    currency,
    cashReserves,
    cashFloor,
    spendableCash: Math.max(0, cashReserves - cashFloor.floorLocal),
    markValueLocal: roundLocal(
      positions.reduce((sum, row) => sum + row.markedValueLocal, 0),
      currency
    ),
    autoSweep: charter.sovereignTreasuryAutoSweep === true,
    fundingRatePercent: cashFloor.fundingRatePercent,
    positions,
    ...(policy.sovereignPrimary ? { primaryOffers } : {}),
  };
}

async function loadQuoteForTrade(
  db: Db,
  bond: Bond,
  currency: CurrencyCode,
  turn: number
): Promise<{
  quote: LoadedBondQuote;
  eligible: boolean;
  annualizedContractYieldPercent: number;
}> {
  const pools = await loadBondPoolsByCurrency(db);
  const snapshot = poolSnapshot(pools.get(currency));
  const quote = await loadBondQuote(db, bond, { pools: new Map([[currency, snapshot]]) });
  const pure = quoteBankTreasuryBond({
    bond,
    currency,
    currentTurn: turn,
    poolCashLocal: quote.poolCashLocal,
    poolTargetCashLocal: quote.targetCashLocal,
    appetite: quote.appetite,
  });
  return {
    quote,
    eligible: pure.eligible,
    annualizedContractYieldPercent: pure.annualizedContractYieldPercent,
  };
}

function reserveTransition(receipt: BankTreasuryTradeReceipt, bond: Bond): BankingTransition {
  const key = `bank-treasury:${receipt._id}:reserve`;
  const position: BondHolder = {
    bankId: receipt.bankId,
    charteredTurn: receipt.charteredTurn,
    units: receipt.units,
    avgCostPerUnit: receipt.pricePerUnitLocal,
    bankTreasuryTradeId: receipt._id,
    ...(receipt.side === "buy" ? { bankTreasuryLotId: receipt._id } : {}),
  };
  const reserveProjection =
    receipt.side === "buy"
      ? {
          collection: "bonds",
          filter: {
            _id: oid(receipt.bondId.toHexString()),
            issuerType: "sovereign",
            ...(bond.currencyCode
              ? { currencyCode: receipt.currency }
              : { currencyCode: { $exists: false }, countryId: bond.countryId }),
            maturityTurn: {
              $gt: receipt.turn,
              ...(receipt.primary
                ? {}
                : { $lte: receipt.turn + BANK_TREASURY_MAX_REMAINING_TURNS }),
            },
            matured: { $ne: true },
            defaulted: { $ne: true },
            sovereignMaturityClaim: { $exists: false },
            [receipt.primary ? "unsoldUnits" : "publicFloat"]: { $gte: receipt.units },
          },
          update: {
            $inc: { [receipt.primary ? "unsoldUnits" : "publicFloat"]: -receipt.units },
            $push: { holders: position },
            $set: { updatedAt: receipt.createdAt },
          },
          note: "Reserve sovereign float units for the bank purchase before cash moves",
        }
      : (() => {
          const holderSnapshot = thawHolderSnapshot(receipt.holderSnapshot, bond.holders ?? []);
          const allocations = new Map(
            (receipt.allocations ?? []).map((allocation) => [allocation.lotId, allocation.units])
          );
          const availableByLot = new Map(
            holderSnapshot
              .filter(
                (holder) =>
                  holder.bankId?.equals(receipt.bankId) &&
                  holder.charteredTurn === receipt.charteredTurn &&
                  !holder.bankTreasuryTradeId &&
                  typeof holder.bankTreasuryLotId === "string"
              )
              .map((holder) => [holder.bankTreasuryLotId!, holder.units])
          );
          const completeAllocation = [...allocations].every(
            ([lotId, units]) => (availableByLot.get(lotId) ?? 0) >= units
          );
          if (!completeAllocation)
            throw new Error("Frozen treasury sale allocation exceeds its holder snapshot");
          const reservedHolders = holderSnapshot.map((holder) => {
            const lotId = holder.bankTreasuryLotId;
            const allocation =
              holder.bankId?.equals(receipt.bankId) &&
              holder.charteredTurn === receipt.charteredTurn &&
              lotId &&
              !holder.bankTreasuryTradeId
                ? (allocations.get(lotId) ?? 0)
                : 0;
            return allocation > 0 ? { ...holder, units: holder.units - allocation } : holder;
          });
          for (const allocation of receipt.allocations ?? []) {
            reservedHolders.push({
              ...position,
              bankTreasuryLotId: allocation.lotId,
              units: allocation.units,
            });
          }
          return {
            collection: "bonds",
            // The whole observed holder array is the reservation guard. One
            // sale either reserves every source lot or none of them, so a
            // concurrent sale cannot strand a partially reserved receipt.
            filter: { _id: oid(receipt.bondId.toHexString()) },
            update: {
              $set: { holders: reservedHolders, updatedAt: receipt.createdAt },
            },
            note: `Reserve all ${receipt.units} bank units across ${receipt.allocations?.length ?? 0} lots atomically`,
          };
        })();
  return {
    key,
    kind: "bank_treasury_trade_reservation",
    turn: receipt.turn,
    currency: receipt.currency,
    legs: [],
    projections: Array.isArray(reserveProjection) ? reserveProjection : [reserveProjection],
    event: {
      kind: "monetary.executed",
      command: `bank.treasury.${receipt.side}.reserve`,
      subjectType: "bank",
      subjectId: receipt.bankId.toHexString(),
      amount: receipt.amountLocal,
      meta: { bondId: bond._id.toHexString(), units: receipt.units },
    },
  };
}

function settledInventoryProjections(
  receipt: BankTreasuryTradeReceipt
): BankingTransition["projections"] {
  if (receipt.side === "buy") {
    return [
      {
        collection: "bonds",
        filter: { _id: oid(receipt.bondId.toHexString()) },
        // Two writes: MongoDB refuses one update that both pulls from and
        // pushes to `holders`, so the reservation leaves first and the
        // settled lot follows under its own receipt.
        update: {
          $pull: { holders: { bankTreasuryTradeId: receipt._id } },
          ...(receipt.primary
            ? { $inc: { totalIssued: receipt.units * BOND_UNIT_FACE_VALUE } }
            : {}),
          $set: { updatedAt: receipt.updatedAt },
        },
        note: "Activate the reserved bank bond units after cash settles",
      },
      {
        collection: "bonds",
        filter: { _id: oid(receipt.bondId.toHexString()) },
        update: {
          $push: {
            holders: {
              bankId: receipt.bankId,
              charteredTurn: receipt.charteredTurn,
              bankTreasuryLotId: receipt._id,
              units: receipt.units,
              avgCostPerUnit: receipt.pricePerUnitLocal,
            },
          },
        },
        note: "Add the settled bank bond lot",
      },
    ];
  }
  return [
    {
      collection: "bonds",
      filter: { _id: oid(receipt.bondId.toHexString()) },
      update: {
        $inc: { publicFloat: receipt.units },
        $pull: { holders: { bankTreasuryTradeId: receipt._id } },
      },
      note: "Return sold bank units to public float after cash settles",
    },
    {
      collection: "bonds",
      filter: { _id: oid(receipt.bondId.toHexString()) },
      update: {
        $pull: {
          holders: {
            bankId: receipt.bankId,
            charteredTurn: receipt.charteredTurn,
            units: 0,
          },
        },
        $set: { updatedAt: receipt.updatedAt },
      },
      note: "Remove an empty bank treasury holder lot after sale",
    },
  ];
}

function releaseReservationTransition(receipt: BankTreasuryTradeReceipt): BankingTransition {
  const projections: BankingTransition["projections"] =
    receipt.side === "buy"
      ? [
          {
            collection: "bonds",
            filter: {
              _id: oid(receipt.bondId.toHexString()),
              holders: { $elemMatch: { bankTreasuryTradeId: receipt._id } },
            },
            update: {
              $inc: { [receipt.primary ? "unsoldUnits" : "publicFloat"]: receipt.units },
              $pull: { holders: { bankTreasuryTradeId: receipt._id } },
              $set: { updatedAt: new Date() },
            },
            note: "Release an unpurchased sovereign float reservation",
          },
        ]
      : [
          ...(receipt.allocations ?? []).map((allocation) => ({
            collection: "bonds",
            filter: {
              _id: oid(receipt.bondId.toHexString()),
              holders: {
                $elemMatch: {
                  bankId: receipt.bankId,
                  charteredTurn: receipt.charteredTurn,
                  bankTreasuryLotId: allocation.lotId,
                  bankTreasuryTradeId: { $exists: false },
                },
              },
            },
            update: { $inc: { "holders.$.units": allocation.units } },
            note: `Restore ${allocation.units} units to bank lot ${allocation.lotId}`,
          })),
          {
            collection: "bonds",
            filter: {
              _id: oid(receipt.bondId.toHexString()),
              holders: { $elemMatch: { bankTreasuryTradeId: receipt._id } },
            },
            update: { $pull: { holders: { bankTreasuryTradeId: receipt._id } } },
            note: "Remove sale reservation after every source lot is restored",
          },
          {
            collection: "bonds",
            filter: { _id: oid(receipt.bondId.toHexString()) },
            update: {
              $pull: {
                holders: { bankId: receipt.bankId, charteredTurn: receipt.charteredTurn, units: 0 },
              },
              $set: { updatedAt: new Date() },
            },
            note: "Remove empty bank treasury lots after a refused sale",
          },
        ];
  return {
    key: `bank-treasury:${receipt._id}:release`,
    kind: "bank_treasury_trade_release",
    turn: receipt.turn,
    currency: receipt.currency,
    legs: [],
    projections,
    event: {
      kind: "monetary.executed",
      command: `bank.treasury.${receipt.side}.release`,
      subjectType: "bank",
      subjectId: receipt.bankId.toHexString(),
      amount: receipt.amountLocal,
      meta: { bondId: receipt.bondId.toHexString(), units: receipt.units },
    },
  };
}

function cashTransition(
  receipt: BankTreasuryTradeReceipt,
  bond: Bond,
  floorLocal: number
): BankingTransition {
  if (receipt.primary) {
    const primary = receipt.primary;
    const transition = sovereignPrimaryTransition({
      key: `bank-treasury:${receipt._id}:cash`,
      turn: receipt.turn,
      currency: receipt.currency,
      budgetId: primary.budgetId,
      poolCash: receipt.amountLocal,
      monetaryCash: 0,
      face: receipt.units * BOND_UNIT_FACE_VALUE,
      annualCoupon: primary.annualCoupon,
      treasuryCashLedgerEnabled: true,
    });
    transition.legs[0] = {
      kind: "debit",
      amount: receipt.amountLocal,
      collection: "corporations",
      filter: {
        _id: oid(receipt.bankId.toHexString()),
        "bankCharter.currency": receipt.currency,
        "bankCharter.charteredTurn": receipt.charteredTurn,
        "bankCharter.status": "active",
        "bankCharter.type": { $in: ["investment", "universal"] },
        ...primary.balanceGuard,
        "bankCharter.cashReserves": {
          $eq: primary.cashReservesAtQuote,
          $gte: floorLocal + receipt.amountLocal,
        },
        bankPrimaryFunding: { $exists: false },
        bankUnderwritingFunding: { $exists: false },
        bankConstructionFunding: { $exists: false },
        bankCharterTransfer: { $exists: false },
      },
      path: "bankCharter.cashReserves",
      set: { bankPrimaryFunding: { tradeId: receipt._id, charteredTurn: receipt.charteredTurn } },
      note: "Investment bank funds original sovereign primary units above its cash floor",
    };
    transition.projections = [
      ...settledInventoryProjections(receipt),
      ...transition.projections.filter((p) => p.collection !== BOND_MARKET_POOLS_COLLECTION),
      {
        collection: "corporations",
        filter: {
          _id: oid(receipt.bankId.toHexString()),
          "bankPrimaryFunding.tradeId": receipt._id,
          "bankCharter.charteredTurn": receipt.charteredTurn,
        },
        update: {
          $inc: {
            "bankCharter.sovereignTreasuryMarkValue": receipt.units * primary.markPerUnitLocal,
          },
        },
        note: "Recognize only funded original-epoch sovereign holdings at executable bid",
      },
      {
        collection: "financialTxLog",
        insert: {
          _id: primaryDocumentId(`${transition.key}:receipt`),
          type: "gov_bond_issuance",
          turn: receipt.turn,
          createdAt: receipt.createdAt,
          subjectType: "government",
          countryId: primary.countryId,
          subjectName: `${primary.countryId} Government`,
          amount: receipt.amountLocal,
          currencyCode: receipt.currency,
          anchorAmount: receipt.amountLocal / primary.localPerAnchor,
          meta: {
            settlementKey: transition.key,
            ledgerOwnedBySettlement: true,
            bankId: receipt.bankId.toHexString(),
            charteredTurn: receipt.charteredTurn,
            bondId: receipt.bondId.toHexString(),
            units: receipt.units,
          },
          flagged: false,
        },
        note: "Publish the actual bank-funded primary issuer receipt",
      },
      ...(primary.ledgerShadow
        ? [
            {
              collection: "ledgerEntries",
              insert: {
                _id: primaryDocumentId(`${transition.key}:ledger`),
                turn: primary.ledgerTurn,
                createdAt: receipt.createdAt,
                txType: "gov_bond_issuance",
                balanced: true,
                emitSite: "banking/bankTreasury:sovereignPrimary",
                legs: [
                  {
                    account: `bank:${receipt.bankId}:${receipt.currency}`,
                    amount: -receipt.amountLocal,
                    currencyCode: receipt.currency,
                    anchorAmount: -receipt.amountLocal / primary.localPerAnchor,
                    role: "primary",
                  },
                  {
                    account: `government_cash:${primary.countryId}:${receipt.currency}`,
                    amount: receipt.amountLocal,
                    currencyCode: receipt.currency,
                    anchorAmount: receipt.amountLocal / primary.localPerAnchor,
                    role: "primary",
                  },
                ],
              },
              note: "Witness primary cash transfer without a mint or pool counterparty",
            },
          ]
        : []),
      {
        collection: BANK_TREASURY_TRADES_COLLECTION,
        filter: { _id: receipt._id },
        update: { $set: { status: "completed", updatedAt: receipt.updatedAt } },
        note: "Acknowledge primary issue after every funded cash and debt projection",
      },
      {
        collection: "corporations",
        filter: {
          _id: oid(receipt.bankId.toHexString()),
          "bankPrimaryFunding.tradeId": receipt._id,
        },
        update: { $unset: { bankPrimaryFunding: "" } },
        note: "Release original bank epoch only after the funded primary issue is acknowledged",
      },
    ];
    transition.event = {
      kind: "sovereign.primary_placed",
      command: "bank.sovereign.primary.subscribe",
      subjectType: "bank",
      subjectId: receipt.bankId.toHexString(),
      amount: receipt.amountLocal,
      meta: { bondId: receipt.bondId.toHexString(), units: receipt.units },
    };
    return transition;
  }
  const pool = {
    collection: BOND_MARKET_POOLS_COLLECTION,
    filter: { _id: receipt.currency },
    path: "cashLocal",
  };
  const bank = {
    collection: "corporations",
    filter: {
      _id: oid(receipt.bankId.toHexString()),
      "bankCharter.currency": receipt.currency,
      "bankCharter.charteredTurn": receipt.charteredTurn,
      "bankCharter.status": receipt.resolutionSale ? "failed" : "active",
    },
  };
  const escrowPath = `bankTreasuryEscrows.${receipt._id}.amountLocal`;
  const legs =
    receipt.side === "buy"
      ? [
          {
            kind: "debit" as const,
            amount: receipt.amountLocal,
            ...bank,
            path: "bankCharter.cashReserves",
            filter: {
              ...bank.filter,
              "bankCharter.cashReserves": { $gte: floorLocal + receipt.amountLocal },
            },
            note: "Pay for sovereign bill units from bank vault cash above the floor",
          },
          {
            kind: "credit" as const,
            amount: receipt.amountLocal,
            ...pool,
            note: "Credit the funded bond market pool for purchased units",
          },
        ]
      : [
          {
            kind: "debit" as const,
            amount: receipt.amountLocal,
            ...pool,
            filter: { _id: receipt.currency, cashLocal: { $gte: receipt.amountLocal } },
            note: "Pay bank sale proceeds from actual bond pool cash",
          },
          {
            kind: "credit" as const,
            amount: receipt.amountLocal,
            collection: "corporations",
            filter: { _id: oid(receipt.bankId.toHexString()) },
            path: escrowPath,
            note: "Hold funded sale proceeds until the bank epoch or insurer receives them",
            set: {
              [`bankTreasuryEscrows.${receipt._id}.bankId`]: receipt.bankId.toHexString(),
              [`bankTreasuryEscrows.${receipt._id}.charteredTurn`]: receipt.charteredTurn,
              [`bankTreasuryEscrows.${receipt._id}.currencyCode`]: receipt.currency,
              [`bankTreasuryEscrows.${receipt._id}.tradeId`]: receipt._id,
            },
          },
        ];
  const projections: BankingTransition["projections"] = [
    ...settledInventoryProjections({ ...receipt, updatedAt: new Date() }),
    {
      collection: BOND_MARKET_POOLS_COLLECTION,
      filter: { _id: receipt.currency },
      update: {
        $inc: {
          [`lifetime.${receipt.side === "buy" ? "purchasesIn" : "salesOut"}`]: receipt.amountLocal,
        },
        $set: { updatedAt: new Date() },
      },
      note: "Record the settled bank treasury flow in bond pool lifetime totals",
    },
  ];
  return {
    key: `bank-treasury:${receipt._id}:cash`,
    kind: `bank_treasury_${receipt.side}`,
    turn: receipt.turn,
    currency: receipt.currency,
    legs,
    projections,
    event: {
      kind: "monetary.executed",
      command: `bank.treasury.${receipt.side}`,
      subjectType: "bank",
      subjectId: receipt.bankId.toHexString(),
      amount: receipt.amountLocal,
      meta: {
        bondId: bond._id.toHexString(),
        units: receipt.units,
        pricePerUnitLocal: receipt.pricePerUnitLocal,
      },
    },
  };
}

async function ensurePoolExists(db: Db, currency: CurrencyCode, now: Date): Promise<void> {
  await db
    .collection<{ _id: CurrencyCode } & Record<string, unknown>>(BOND_MARKET_POOLS_COLLECTION)
    .updateOne(
      { _id: currency },
      {
        $setOnInsert: {
          cashLocal: 0,
          targetCashLocal: 0,
          lifetime: {},
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
}

async function finishTransition(db: Db, transition: BankingTransition): Promise<SettlementResult> {
  let result = await settleTransition(db, transition);
  if (result.status === "partial" || (result.status === "replayed" && result.error)) {
    result = await resumeSettlement(db, transition.key);
  }
  return result;
}

async function paySaleEscrow(db: Db, receipt: BankTreasuryTradeReceipt): Promise<SettlementResult> {
  const corporations = db.collection<BankState>("corporations");
  const bank = await corporations.findOne(
    { _id: receipt.bankId },
    { projection: { bankCharter: 1, bankTreasuryEscrows: 1 } }
  );
  const charter = bank?.bankCharter;
  const escrowPath = `bankTreasuryEscrows.${receipt._id}.amountLocal`;
  const matchingEpoch =
    charter?.currency === receipt.currency && charter.charteredTurn === receipt.charteredTurn;
  const estateOpen = charter?.status === "failed" && charter.depositorsResolvedTurn == null;
  if (matchingEpoch && (charter?.status === "active" || estateOpen)) {
    const realizedGain = Number.isFinite(receipt.costBasisLocal)
      ? receipt.amountLocal - receipt.costBasisLocal!
      : 0;
    const transition: BankingTransition = {
      key: `bank-treasury:${receipt._id}:vault`,
      kind: "bank_treasury_sale_to_vault",
      turn: receipt.turn,
      currency: receipt.currency,
      legs: [
        {
          kind: "debit",
          amount: receipt.amountLocal,
          collection: "corporations",
          filter: { _id: oid(receipt.bankId.toHexString()) },
          path: escrowPath,
          note: "Release funded bank bond sale escrow",
        },
        {
          kind: "credit",
          amount: receipt.amountLocal,
          collection: "corporations",
          filter: { _id: oid(receipt.bankId.toHexString()) },
          path: "bankCharter.cashReserves",
          note: "Credit proceeds to the matching bank epoch or its open failure estate",
        },
      ],
      projections: [
        {
          collection: "corporations",
          filter: { _id: oid(receipt.bankId.toHexString()) },
          update: {
            $inc: {
              [escrowPath]: -receipt.amountLocal,
              "bankCharter.cashReserves": receipt.amountLocal,
              ...(realizedGain !== 0
                ? { "bankCharter.treasuryRealizedGainPaidLifetime": realizedGain }
                : {}),
            },
          },
          note: "Atomically release sale cash from escrow to the matching bank estate",
        },
      ],
      event: {
        kind: "monetary.executed",
        command: "bank.treasury.sell.vault",
        subjectType: "bank",
        subjectId: receipt.bankId.toHexString(),
        amount: receipt.amountLocal,
      },
    };
    const settled = await settleAtomicDocumentTransition(db, transition, {
      identity: { _id: oid(receipt.bankId.toHexString()) },
      guard: {
        [escrowPath]: { $gte: receipt.amountLocal },
        "bankCharter.currency": receipt.currency,
        "bankCharter.charteredTurn": receipt.charteredTurn,
        "bankCharter.status": charter?.status,
      },
    });
    if (settled.status === "partial" || (settled.status === "replayed" && settled.error)) {
      return resumeSettlement(db, transition.key);
    }
    if (settled.status === "applied" || (settled.status === "replayed" && !settled.error))
      return settled;
    const current = await corporations.findOne(
      { _id: receipt.bankId },
      { projection: { bankCharter: 1 } }
    );
    if (
      current?.bankCharter?.currency === receipt.currency &&
      current.bankCharter.charteredTurn === receipt.charteredTurn &&
      (current.bankCharter.status === "active" ||
        (current.bankCharter.status === "failed" &&
          current.bankCharter.depositorsResolvedTurn == null))
    )
      return settled;
  }
  await ensureFund(db, receipt.currency);
  const insurance: BankingTransition = {
    key: `bank-treasury:${receipt._id}:insurance`,
    kind: "bank_treasury_sale_to_insurance",
    turn: receipt.turn,
    currency: receipt.currency,
    legs: [
      {
        kind: "debit",
        amount: receipt.amountLocal,
        collection: "corporations",
        filter: {
          _id: oid(receipt.bankId.toHexString()),
          [escrowPath]: { $gte: receipt.amountLocal },
        },
        path: escrowPath,
        note: "Release closed-epoch bank treasury proceeds from escrow",
      },
      {
        kind: "credit",
        amount: receipt.amountLocal,
        collection: "depositInsuranceFunds",
        filter: { _id: receipt.currency },
        path: "balance",
        note: "Route closed-epoch bank treasury proceeds to deposit insurance",
      },
    ],
    projections: [],
    event: {
      kind: "monetary.executed",
      command: "bank.treasury.sell.insurance",
      subjectType: "bank",
      subjectId: receipt.bankId.toHexString(),
      amount: receipt.amountLocal,
    },
  };
  return finishTransition(db, insurance);
}

async function markBankTreasury(
  db: Db,
  bankId: ObjectId,
  charter: BankCharter,
  turn: number
): Promise<number> {
  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      matured: { $ne: true },
      defaulted: { $ne: true },
      holders: {
        $elemMatch: {
          bankId,
          charteredTurn: charter.charteredTurn,
          bankTreasuryTradeId: { $exists: false },
          units: { $gt: 0 },
        },
      },
    })
    .toArray();
  const pools = await loadBondPoolsByCurrency(db);
  let mark = 0;
  for (const bond of bonds) {
    if (bondPoolCurrency(bond) !== charter.currency) continue;
    const quote = await loadBondQuote(db, bond, {
      pools: new Map([[charter.currency, poolSnapshot(pools.get(charter.currency))]]),
    });
    mark += activeHolderUnits(bond.holders ?? [], bankId, charter.charteredTurn) * quote.bidPerUnit;
  }
  mark = roundLocal(mark, charter.currency);
  await db.collection<Corporation>("corporations").updateOne(
    {
      _id: bankId,
      "bankCharter.currency": charter.currency,
      "bankCharter.charteredTurn": charter.charteredTurn,
    },
    {
      $set: {
        "bankCharter.sovereignTreasuryMarkValue": mark,
        "bankCharter.lastTreasuryMarkTurn": turn,
        updatedAt: new Date(),
      },
    }
  );
  return mark;
}

async function updateReceipt(
  db: Db,
  receipt: BankTreasuryTradeReceipt,
  status: BankTreasuryTradeReceipt["status"],
  error?: string
): Promise<void> {
  await db
    .collection<BankTreasuryTradeReceipt>(BANK_TREASURY_TRADES_COLLECTION)
    .updateOne(
      { _id: receipt._id, status: "open" },
      { $set: { status, updatedAt: new Date(), ...(error ? { error } : {}) } }
    );
}

async function runReceipt(
  db: Db,
  receipt: BankTreasuryTradeReceipt,
  policy: BankingPolicySnapshot
): Promise<BankTreasuryTradeResult> {
  if (!policy.bankTreasury)
    return {
      status: "rejected",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
      error: "Bank treasury bills are disabled",
    };
  const bankId = receipt.bankId;
  const [bank, bond] = await Promise.all([
    db
      .collection<BankState>("corporations")
      .findOne({ _id: bankId }, { projection: { bankCharter: 1 } }),
    db.collection<Bond>("bonds").findOne({ _id: receipt.bondId }),
  ]);
  if (!bond)
    return {
      status: "rejected",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
      error: "Sovereign bill no longer exists",
    };
  const charter = bank?.bankCharter;
  const exactActive =
    charter?.status === "active" &&
    charter.currency === receipt.currency &&
    charter.charteredTurn === receipt.charteredTurn;
  const sameOpenEstate =
    charter?.status === "failed" &&
    charter.currency === receipt.currency &&
    charter.charteredTurn === receipt.charteredTurn &&
    charter.depositorsResolvedTurn == null;
  if (!exactActive && (receipt.side === "buy" || !sameOpenEstate || !receipt.resolutionSale)) {
    const reserveRecord = await db
      .collection<{ _id: string; status?: string }>("bankMoneyMoves")
      .findOne({ _id: `bank-treasury:${receipt._id}:reserve` }, { projection: { status: 1 } });
    const cashRecord = await db
      .collection<{ _id: string; status?: string }>("bankMoneyMoves")
      .findOne({ _id: `bank-treasury:${receipt._id}:cash` }, { projection: { status: 1 } });
    if (reserveRecord && !cashRecord) {
      // A reservation may have landed before its journal acknowledgement.
      // Finish that original outcome before returning its unfunded inventory.
      const originalReserve = await resumeSettlement(db, reserveRecord._id);
      if (originalReserve.error || originalReserve.status === "partial")
        return {
          status: "pending",
          tradeId: receipt._id,
          side: receipt.side,
          units: receipt.units,
          amountLocal: receipt.amountLocal,
          error: originalReserve.error,
        };
      if (["applied", "replayed"].includes(originalReserve.status)) {
        const release = await finishTransition(db, releaseReservationTransition(receipt));
        if (release.error || !["applied", "replayed"].includes(release.status))
          return {
            status: "pending",
            tradeId: receipt._id,
            side: receipt.side,
            units: receipt.units,
            amountLocal: receipt.amountLocal,
            error: release.error,
          };
      }
    } else if (cashRecord?.status === "partial") {
      const resumed = await resumeSettlement(db, cashRecord._id);
      if (resumed.status === "partial" || (resumed.status === "replayed" && resumed.error)) {
        return {
          status: "pending",
          tradeId: receipt._id,
          side: receipt.side,
          units: receipt.units,
          amountLocal: receipt.amountLocal,
          error: resumed.error,
        };
      }
      if (resumed.status === "applied" || (resumed.status === "replayed" && !resumed.error)) {
        if (receipt.side === "sell") {
          const paid = await paySaleEscrow(db, receipt);
          if (paid.status === "partial" || (paid.status === "replayed" && paid.error)) {
            return {
              status: "pending",
              tradeId: receipt._id,
              side: receipt.side,
              units: receipt.units,
              amountLocal: receipt.amountLocal,
              error: paid.error,
            };
          }
        }
        await updateReceipt(db, receipt, "completed");
        return {
          status: "completed",
          tradeId: receipt._id,
          side: receipt.side,
          units: receipt.units,
          amountLocal: receipt.amountLocal,
        };
      }
      await finishTransition(db, releaseReservationTransition(receipt));
    } else if (cashRecord?.status === "applied") {
      if (receipt.side === "sell") {
        const paid = await paySaleEscrow(db, receipt);
        if (paid.status !== "applied" && !(paid.status === "replayed" && !paid.error)) {
          return {
            status: "pending",
            tradeId: receipt._id,
            side: receipt.side,
            units: receipt.units,
            amountLocal: receipt.amountLocal,
            error: paid.error,
          };
        }
      }
      await updateReceipt(db, receipt, "completed");
      return {
        status: "completed",
        tradeId: receipt._id,
        side: receipt.side,
        units: receipt.units,
        amountLocal: receipt.amountLocal,
      };
    }
    const error = "Bank charter epoch ended before the trade settled";
    await updateReceipt(db, receipt, "rejected", error);
    return {
      status: "rejected",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
      error,
    };
  }

  const reserve = reserveTransition(receipt, bond);
  const reserved =
    receipt.side === "sell"
      ? await settleAtomicDocumentTransition(db, reserve, {
          identity: { _id: oid(receipt.bondId.toHexString()) },
          guard: {
            holders: thawHolderSnapshot(receipt.holderSnapshot, bond.holders ?? []),
            sovereignMaturityClaim: { $exists: false },
          },
          nonCashMode: "bank_treasury_inventory",
        })
      : await finishTransition(db, reserve);
  if (reserved.status === "rejected") {
    await updateReceipt(db, receipt, "rejected", reserved.error);
    return {
      status: "rejected",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
      error: reserved.error ?? "Bond reservation was refused",
    };
  }
  if (reserved.status === "partial" || (reserved.status === "replayed" && reserved.error)) {
    return {
      status: "pending",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
      error: reserved.error,
    };
  }

  if (!receipt.primary) await ensurePoolExists(db, receipt.currency, receipt.createdAt);
  const overviewFloor = exactActive
    ? await bankCashFloor(db, charter!, savingsReadsAuthoritative(policy, receipt.currency), bankId)
    : { floorLocal: 0, requiredReserves: 0, withdrawalBufferLocal: 0, nextTurnDueInterest: 0 };
  const transition = cashTransition(receipt, bond, overviewFloor.floorLocal);
  const moved = await finishTransition(db, transition);
  if (moved.status === "rejected") {
    const released = await finishTransition(db, releaseReservationTransition(receipt));
    if (released.status === "applied" || (released.status === "replayed" && !released.error)) {
      await updateReceipt(db, receipt, "rejected", moved.error);
      return {
        status: "rejected",
        tradeId: receipt._id,
        side: receipt.side,
        units: receipt.units,
        amountLocal: receipt.amountLocal,
        error: moved.error ?? "Trade cash leg was refused",
      };
    }
    return {
      status: "pending",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
      error: released.error ?? moved.error,
    };
  }
  if (moved.status === "partial" || (moved.status === "replayed" && moved.error)) {
    return {
      status: "pending",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
      error: moved.error,
    };
  }

  if (receipt.side === "sell") {
    const paid = await paySaleEscrow(db, receipt);
    if (paid.status !== "applied" && !(paid.status === "replayed" && !paid.error)) {
      return {
        status: "pending",
        tradeId: receipt._id,
        side: receipt.side,
        units: receipt.units,
        amountLocal: receipt.amountLocal,
        error: paid.error,
      };
    }
  }
  const current = await db
    .collection<BankState>("corporations")
    .findOne({ _id: bankId }, { projection: { bankCharter: 1 } });
  if (current?.bankCharter) await markBankTreasury(db, bankId, current.bankCharter, receipt.turn);
  await updateReceipt(db, receipt, "completed");
  return {
    status: "completed",
    tradeId: receipt._id,
    side: receipt.side,
    units: receipt.units,
    amountLocal: receipt.amountLocal,
  };
}

function terminalTradeResult(receipt: BankTreasuryTradeReceipt): BankTreasuryTradeResult | null {
  if (receipt.status === "open") return null;
  if (receipt.status === "completed") {
    return {
      status: "completed",
      tradeId: receipt._id,
      side: receipt.side,
      units: receipt.units,
      amountLocal: receipt.amountLocal,
    };
  }
  return {
    status: "rejected",
    tradeId: receipt._id,
    side: receipt.side,
    units: receipt.units,
    amountLocal: receipt.amountLocal,
    error: receipt.error ?? "The frozen treasury trade was rejected",
  };
}

/** Execute one frozen manual or automatic trade through durable inventory and cash receipts. */
export async function tradeBankTreasuryBill(
  db: Db,
  input: {
    bankId: ObjectId;
    bondId: ObjectId;
    side: "buy" | "sell";
    units: number;
    turn: number;
    policy: BankingPolicySnapshot;
    tradeId?: string;
    allowFailedEstate?: boolean;
    primary?: boolean;
    maxCostLocal?: number;
    automaticSweep?: boolean;
  }
): Promise<BankTreasuryTradeResult> {
  if (!input.policy.bankTreasury || (input.primary && !input.policy.sovereignPrimary))
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "disabled",
      side: input.side,
      units: 0,
      amountLocal: 0,
      error: "Bank treasury bills are disabled",
    };
  const units = Math.floor(input.units);
  if (!Number.isSafeInteger(units) || units <= 0)
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "invalid",
      side: input.side,
      units: 0,
      amountLocal: 0,
      error: "Units must be a positive whole number",
    };
  const tradeId = input.tradeId ?? new ObjectId().toHexString();
  const prior = await db
    .collection<BankTreasuryTradeReceipt>(BANK_TREASURY_TRADES_COLLECTION)
    .findOne({ _id: tradeId });
  if (prior) {
    if (
      prior.bankId.toString() !== input.bankId.toString() ||
      prior.bondId.toString() !== input.bondId.toString() ||
      prior.side !== input.side ||
      prior.requestedUnits !== units ||
      Boolean(prior.primary) !== Boolean(input.primary) ||
      (prior.primary && prior.primary.maxCostLocal !== input.maxCostLocal)
    )
      throw new Error("Treasury trade key is already bound to a different frozen intent");
    const terminal = terminalTradeResult(prior);
    if (terminal && prior.primary && prior.status === "completed") {
      const finished = await resumeSettlement(db, `bank-treasury:${prior._id}:cash`);
      if (finished.error || !["applied", "replayed"].includes(finished.status))
        return { ...terminal, status: "pending", error: finished.error };
    }
    if (terminal) return terminal;
    return runReceipt(db, prior, input.policy);
  }
  const [bank, bond] = await Promise.all([
    db
      .collection<BankState>("corporations")
      .findOne({ _id: input.bankId }, { projection: { bankCharter: 1 } }),
    db.collection<Bond>("bonds").findOne({ _id: input.bondId }),
  ]);
  const charter = bank?.bankCharter;
  const exactFailedEstate =
    input.allowFailedEstate === true &&
    input.side === "sell" &&
    charter?.status === "failed" &&
    charter.depositorsResolvedTurn == null;
  if (!charter || !bond || (charter.status !== "active" && !exactFailedEstate))
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "missing",
      side: input.side,
      units,
      amountLocal: 0,
      error: "Active bank or open failed estate and sovereign bill are required",
    };
  if (input.automaticSweep && charter.sovereignTreasuryAutoSweep !== true)
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "automatic-sweep-disabled",
      side: input.side,
      units: 0,
      amountLocal: 0,
      error: "Automatic bill buying is no longer enabled for this bank",
    };
  if (
    bond.issuerType !== "sovereign" ||
    bond.defaulted ||
    bond.matured ||
    bondPoolCurrency(bond) !== charter.currency
  ) {
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "ineligible",
      side: input.side,
      units,
      amountLocal: 0,
      error: "Only live same-currency sovereign bills are eligible",
    };
  }
  const quoteState = await loadQuoteForTrade(db, bond, charter.currency, input.turn);
  if (input.side === "buy" && !input.primary && !quoteState.eligible)
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "ineligible",
      side: input.side,
      units,
      amountLocal: 0,
      error: "Bill is outside the 48-turn maturity window or has no float",
    };
  const pricePerUnitLocal =
    input.side === "buy" ? quoteState.quote.askPerUnit : quoteState.quote.bidPerUnit;
  if (!(pricePerUnitLocal > 0))
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "no-quote",
      side: input.side,
      units,
      amountLocal: 0,
      error: "No executable market quote is available",
    };
  let fillUnits = units;
  if (input.side === "buy") {
    const floor = await bankCashFloor(
      db,
      charter,
      savingsReadsAuthoritative(input.policy, charter.currency),
      input.bankId
    );
    if (
      input.automaticSweep &&
      (!Number.isFinite(quoteState.annualizedContractYieldPercent) ||
        !Number.isFinite(floor.fundingRatePercent) ||
        quoteState.annualizedContractYieldPercent <= floor.fundingRatePercent)
    )
      return {
        status: "rejected",
        tradeId: input.tradeId ?? "negative-carry",
        side: input.side,
        units: 0,
        amountLocal: 0,
        error: "The current bill quote does not cover the bank's funded liability rate",
      };
    const available = Math.max(0, (charter.cashReserves ?? 0) - floor.floorLocal);
    fillUnits = Math.min(
      fillUnits,
      input.primary ? (bond.unsoldUnits ?? 0) : (bond.publicFloat ?? 0),
      Math.floor(available / pricePerUnitLocal)
    );
  } else {
    const availableLots = activeHolderUnits(
      bond.holders ?? [],
      input.bankId,
      charter.charteredTurn
    );
    fillUnits = Math.min(fillUnits, availableLots, quoteState.quote.depthUnitsAtBid);
  }
  if (fillUnits <= 0)
    return {
      status: "rejected",
      tradeId: input.tradeId ?? "no-depth",
      side: input.side,
      units: 0,
      amountLocal: 0,
      error:
        input.side === "buy"
          ? "No cash is available above the bank treasury floor"
          : "The pool cannot fund a sale of this size",
    };
  let amountLocal = roundLocal(fillUnits * pricePerUnitLocal, charter.currency);
  const allocations =
    input.side === "sell"
      ? allocateBankTreasuryHolderLots(
          holderLotInputs(bond.holders ?? []),
          input.bankId.toHexString(),
          charter.charteredTurn,
          fillUnits
        )
      : undefined;
  if (
    input.side === "sell" &&
    allocations?.reduce((sum, allocation) => sum + allocation.units, 0) !== fillUnits
  ) {
    return {
      status: "rejected",
      tradeId,
      side: input.side,
      units: 0,
      amountLocal: 0,
      error: "Held lots changed before sale reservation",
    };
  }
  const costBasisLocal =
    input.side === "sell" && allocations
      ? bankTreasuryAllocatedCostBasis(
          holderLotInputs(bond.holders ?? []),
          allocations,
          charter.currency
        )
      : null;
  let primary: BankTreasuryTradeReceipt["primary"];
  if (input.primary) {
    if (input.side !== "buy") throw new Error("Primary offers can only be subscribed");
    const floor = await bankCashFloor(
      db,
      charter,
      savingsReadsAuthoritative(input.policy, charter.currency),
      input.bankId
    );
    const planned = quoteSovereignPrimaryBankPurchase({
      charter,
      bond,
      turn: input.turn,
      requestedUnits: units,
      askPerUnit: pricePerUnitLocal,
      bidPerUnit: quoteState.quote.bidPerUnit,
      maxCostLocal: input.maxCostLocal ?? 0,
      floorLocal: floor.floorLocal,
      playerDepositsAreLiabilities: savingsReadsAuthoritative(input.policy, charter.currency),
    });
    if (!planned.ok)
      return {
        status: "rejected",
        tradeId,
        side: input.side,
        units: 0,
        amountLocal: 0,
        error: planned.error,
      };
    fillUnits = planned.units;
    amountLocal = roundLocal(planned.cost, charter.currency);
    const budgetId = getNationalBudgetId(bond.countryId!);
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: budgetId }, { projection: { currencyCode: 1 } });
    if (!budget || budget.currencyCode !== charter.currency)
      return {
        status: "rejected",
        tradeId,
        side: input.side,
        units: 0,
        amountLocal: 0,
        error: "The issuer has no matching funded Treasury cash account",
      };
    const accounting = await loadPrimaryAccounting(db);
    const localPerAnchor = primaryFinancingRate(accounting, bond.countryId!, charter.currency);
    if (!localPerAnchor || !Number.isFinite(localPerAnchor) || localPerAnchor <= 0)
      throw new Error("Missing sovereign primary cash valuation");
    primary = {
      countryId: bond.countryId!,
      budgetId,
      annualCoupon: planned.annualCoupon,
      markPerUnitLocal: quoteState.quote.bidPerUnit,
      maxCostLocal: input.maxCostLocal!,
      localPerAnchor,
      ledgerShadow: accounting.ledgerShadow,
      ledgerTurn: accounting.ledgerTurn ?? input.turn,
      cashReservesAtQuote: charter.cashReserves!,
      balanceGuard: Object.fromEntries(
        [
          "npcDeposits",
          "playerDeposits",
          "totalDeposits",
          "totalLoans",
          "propBookMarkValue",
          "sovereignTreasuryMarkValue",
          "discountWindowDebt",
          "discountWindowArrears",
          "cbMarginDebt",
          "cbMarginArrears",
          "interbankDebt",
          "capitalStanding",
          "depositOffset",
        ].map((field) => {
          const value = charter[field as keyof BankCharter];
          return [`bankCharter.${field}`, value === undefined ? { $exists: false } : value];
        })
      ),
    };
  }
  const now = new Date();
  const receipt: BankTreasuryTradeReceipt = {
    _id: tradeId,
    bankId: input.bankId,
    charteredTurn: charter.charteredTurn,
    bondId: input.bondId,
    currency: charter.currency,
    side: input.side,
    requestedUnits: units,
    units: fillUnits,
    ...(primary ? { primary } : {}),
    ...(allocations ? { allocations } : {}),
    ...(costBasisLocal !== null ? { costBasisLocal } : {}),
    ...(allocations ? { holderSnapshot: freezeHolderSnapshot(bond.holders ?? []) } : {}),
    pricePerUnitLocal,
    amountLocal,
    turn: input.turn,
    status: "open",
    ...(exactFailedEstate ? { resolutionSale: true as const } : {}),
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db
      .collection<BankTreasuryTradeReceipt>(BANK_TREASURY_TRADES_COLLECTION)
      .insertOne(receipt);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== 11000) throw error;
    const saved = await db
      .collection<BankTreasuryTradeReceipt>(BANK_TREASURY_TRADES_COLLECTION)
      .findOne({ _id: tradeId });
    if (
      !saved ||
      saved.bankId.toString() !== input.bankId.toString() ||
      saved.bondId.toString() !== input.bondId.toString() ||
      saved.side !== input.side ||
      saved.requestedUnits !== units ||
      Boolean(saved.primary) !== Boolean(input.primary) ||
      (saved.primary && saved.primary.maxCostLocal !== input.maxCostLocal) ||
      saved.charteredTurn !== charter.charteredTurn
    ) {
      throw new Error("Treasury trade key is already bound to a different frozen intent");
    }
    const terminal = terminalTradeResult(saved);
    if (terminal) return terminal;
    return runReceipt(db, saved, input.policy);
  }
  return runReceipt(db, receipt, input.policy);
}

/** Resume open receipts before any new automatic sweep orders. */
export async function recoverBankTreasuryTrades(
  db: Db,
  policy: BankingPolicySnapshot,
  limit = 100
): Promise<{ completed: number; pending: number; rejected: number }> {
  if (!policy.bankTreasury) return { completed: 0, pending: 0, rejected: 0 };
  const receipts = await db
    .collection<BankTreasuryTradeReceipt>(BANK_TREASURY_TRADES_COLLECTION)
    .find({ status: "open" })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit)
    .toArray();
  const summary = { completed: 0, pending: 0, rejected: 0 };
  for (const receipt of receipts) {
    const result = await runReceipt(db, receipt, policy);
    summary[result.status] += 1;
  }
  return summary;
}

/** Sell actual pool depth before a failed estate's cash waterfall closes. */
export async function liquidateFailedBankTreasury(
  db: Db,
  bankId: ObjectId,
  policy: BankingPolicySnapshot,
  turn: number
): Promise<{ soldUnits: number; proceedsLocal: number; pending: boolean; error?: string }> {
  if (!policy.bankTreasury) return { soldUnits: 0, proceedsLocal: 0, pending: false };
  const recovery = await recoverBankTreasuryTrades(db, policy);
  if (recovery.pending > 0) {
    return {
      soldUnits: 0,
      proceedsLocal: 0,
      pending: true,
      error: "A prior treasury trade is still settling",
    };
  }
  const bank = await db.collection<BankState>("corporations").findOne(
    {
      _id: bankId,
      "bankCharter.status": "failed",
      $or: [
        { "bankCharter.depositorsResolvedTurn": null },
        { "bankCharter.depositorsResolvedTurn": { $exists: false } },
      ],
    },
    { projection: { bankCharter: 1 } }
  );
  const charter = bank?.bankCharter;
  if (!charter) return { soldUnits: 0, proceedsLocal: 0, pending: false };
  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      matured: { $ne: true },
      defaulted: { $ne: true },
      holders: {
        $elemMatch: {
          bankId,
          charteredTurn: charter.charteredTurn,
          bankTreasuryTradeId: { $exists: false },
          units: { $gt: 0 },
        },
      },
    })
    .sort({ maturityTurn: 1, _id: 1 })
    .toArray();
  let soldUnits = 0;
  let proceedsLocal = 0;
  for (const initial of bonds) {
    while (true) {
      const bond = await db.collection<Bond>("bonds").findOne({ _id: initial._id });
      if (!bond || bond.matured || bond.defaulted) break;
      const lots = activeHolderUnits(bond.holders ?? [], bankId, charter.charteredTurn);
      if (lots <= 0) break;
      const quoteState = await loadQuoteForTrade(db, bond, charter.currency, turn);
      const units = Math.min(lots, quoteState.quote.depthUnitsAtBid);
      if (units <= 0) break;
      const receiptSequence = await db
        .collection<BankTreasuryTradeReceipt>(BANK_TREASURY_TRADES_COLLECTION)
        .countDocuments({
          bankId,
          charteredTurn: charter.charteredTurn,
          bondId: bond._id,
          turn,
          resolutionSale: true,
        });
      const result = await tradeBankTreasuryBill(db, {
        bankId,
        bondId: bond._id,
        side: "sell",
        units,
        turn,
        policy,
        tradeId: `estate-sale-${bankId.toHexString()}-${charter.charteredTurn}-${turn}-${bond._id.toHexString()}-${receiptSequence}`,
        allowFailedEstate: true,
      });
      if (result.status === "pending") {
        return {
          soldUnits,
          proceedsLocal,
          pending: true,
          error: result.error ?? "Estate treasury sale is still settling",
        };
      }
      if (result.status === "rejected")
        return { soldUnits, proceedsLocal, pending: false, error: result.error };
      soldUnits += result.units;
      proceedsLocal = roundLocal(proceedsLocal + result.amountLocal, charter.currency);
    }
  }
  return { soldUnits, proceedsLocal, pending: false };
}

/** Recompute the charter-epoch mark; its source remains the actual bond holders and pool bids. */
export async function refreshBankTreasuryMark(
  db: Db,
  bankId: ObjectId,
  policy: BankingPolicySnapshot,
  turn: number
): Promise<number> {
  if (!policy.bankTreasury) return 0;
  const bank = await db
    .collection<BankState>("corporations")
    .findOne(
      { _id: bankId, "bankCharter.status": { $in: ["active", "failed"] } },
      { projection: { bankCharter: 1 } }
    );
  if (!bank?.bankCharter) return 0;
  return markBankTreasury(db, bankId, bank.bankCharter, turn);
}

/** Automatic cash sweep. Trade IDs are stable across a turn replay. */
export async function sweepBankTreasury(
  db: Db,
  bankId: ObjectId,
  policy: BankingPolicySnapshot,
  turn: number
): Promise<{ trades: number; completed: number; pending: number }> {
  if (!policy.bankTreasury) return { trades: 0, completed: 0, pending: 0 };
  const overview = await getBankTreasuryOverview(db, bankId, policy, turn);
  if (!overview?.autoSweep || overview.spendableCash <= 0)
    return { trades: 0, completed: 0, pending: 0 };
  const bank = await db
    .collection<BankState>("corporations")
    .findOne({ _id: bankId, "bankCharter.status": "active" }, { projection: { bankCharter: 1 } });
  if (!bank?.bankCharter || bank.bankCharter.lastTreasurySweepTurn === turn)
    return { trades: 0, completed: 0, pending: 0 };
  const plannedTrades = planBankTreasurySweep(
    overview.positions.map((position): BankTreasurySweepCandidate => ({
      bondId: position.bondId,
      remainingTurns: position.remainingTurns,
      publicFloatUnits: position.publicFloatUnits ?? 0,
      askPerUnitLocal: position.askPerUnitLocal,
      annualizedContractYieldPercent:
        position.annualizedContractYieldPercent ?? Number.NEGATIVE_INFINITY,
      eligible: position.eligibleToBuy,
    })),
    overview.cashReserves,
    overview.cashFloor.floorLocal,
    overview.fundingRatePercent
  );
  let trades = 0;
  let completed = 0;
  let pending = 0;
  for (const planned of plannedTrades) {
    const current = await db
      .collection<BankState>("corporations")
      .findOne({ _id: bankId }, { projection: { bankCharter: 1 } });
    const charter = current?.bankCharter;
    if (!charter || charter.status !== "active") break;
    const freshFloor = await bankCashFloor(
      db,
      charter,
      savingsReadsAuthoritative(policy, charter.currency),
      bankId
    );
    if ((charter.cashReserves ?? 0) <= freshFloor.floorLocal) break;
    const tradeId = `sweep-${bankId.toHexString()}-${charter.charteredTurn}-${turn}-${planned.bondId}`;
    const result = await tradeBankTreasuryBill(db, {
      bankId,
      bondId: new ObjectId(planned.bondId),
      side: "buy",
      units: planned.units,
      turn,
      policy,
      tradeId,
      automaticSweep: true,
    });
    trades += 1;
    if (result.status === "completed") completed += 1;
    if (result.status === "pending") pending += 1;
    if (result.status === "rejected") break;
  }
  await db.collection<Corporation>("corporations").updateOne(
    {
      _id: bankId,
      "bankCharter.status": "active",
      "bankCharter.charteredTurn": bank.bankCharter.charteredTurn,
      "bankCharter.lastTreasurySweepTurn": { $ne: turn },
    },
    { $set: { "bankCharter.lastTreasurySweepTurn": turn, updatedAt: new Date() } }
  );
  return { trades, completed, pending };
}

/** Force marks and open trades to be advanced from the banking turn only when enabled. */
export async function processBankTreasuryTurn(
  db: Db,
  turn: number,
  policy: BankingPolicySnapshot
): Promise<{
  banksMarked: number;
  tradesCompleted: number;
  tradesPending: number;
  sweepsCompleted: number;
}> {
  if (!policy.bankTreasury)
    return { banksMarked: 0, tradesCompleted: 0, tradesPending: 0, sweepsCompleted: 0 };
  const recovered = await recoverBankTreasuryTrades(db, policy);
  if (recovered.pending > 0)
    throw new Error("Bank treasury has a trade receipt that remains partial after recovery");
  const banks = await db
    .collection<BankState>("corporations")
    .find({ "bankCharter.status": "active" })
    .project({ _id: 1, bankCharter: 1 })
    .toArray();
  let tradesCompleted = 0;
  let tradesPending = 0;
  let sweepsCompleted = 0;
  for (const bank of banks) {
    if (!bank.bankCharter) continue;
    await refreshBankTreasuryMark(db, bank._id, policy, turn);
    if (bank.bankCharter.sovereignTreasuryAutoSweep) {
      const sweep = await sweepBankTreasury(db, bank._id, policy, turn);
      tradesCompleted += sweep.completed;
      tradesPending += sweep.pending;
      sweepsCompleted += sweep.completed;
    }
  }
  if (tradesPending > 0)
    throw new Error("Bank treasury automatic sweep remains partial after recovery");
  return { banksMarked: banks.length, tradesCompleted, tradesPending, sweepsCompleted };
}
