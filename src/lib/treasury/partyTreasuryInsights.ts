import type { Db } from "mongodb";
import type {
  AdminLog,
  PartyBudget,
  State,
  StatePartyOrg,
  TreasuryTransaction,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { regionPartyUrl } from "@/lib/urls";
import { ORG_DECAY_RATE } from "@/lib/turn/partyOrg/constants";

export interface TreasuryStateFundingMetric {
  stateId: string;
  stateName: string;
  treasury: number;
  organization: number;
  growthPerTurn: number;
  recentTransferAmount: number;
  recentTransferCount: number;
  href: string;
}

export interface TreasuryOverrideHistoryEntry {
  id: string;
  actorLabel: string;
  details: string;
  amount: number | null;
  createdAt: string;
}

export interface NationalTreasuryInsights {
  recentTransferRecipients: TreasuryStateFundingMetric[];
  lowestTreasuryStates: TreasuryStateFundingMetric[];
  growthLeaders: TreasuryStateFundingMetric[];
  overrideHistory: TreasuryOverrideHistoryEntry[];
}

export interface StateTreasuryInsights {
  overrideHistory: TreasuryOverrideHistoryEntry[];
}

function roundToTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function calculateGrowthPerTurn(
  statePartyOrg: StatePartyOrg,
  _budget: Pick<PartyBudget, "orgBuildingPercent"> | null
): number {
  // Org growth is now PS-spend at request time, not a passive treasury
  // rate. Insights show the passive decay baseline only.
  return (statePartyOrg.organization ?? 0) > 0 ? roundToTenths(-ORG_DECAY_RATE) : 0;
}

function buildOverrideEntries(logs: AdminLog[]): TreasuryOverrideHistoryEntry[] {
  return logs.map((log) => {
    const amountMatch = log.details?.match(/\$([\d,]+)/);
    return {
      id: log._id.toString(),
      actorLabel: log.characterName ?? log.adminUsername ?? log.username,
      details: log.details ?? "Emergency override recorded",
      amount: amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null,
      createdAt: log.createdAt.toISOString(),
    };
  });
}

export async function buildNationalTreasuryInsights(
  db: Db,
  countryId: CountryId,
  partyId: string,
  partyName: string
): Promise<NationalTreasuryInsights> {
  const [statePartyOrgs, budgets, states, transferRows, overrideLogs] = await Promise.all([
    db.collection<StatePartyOrg>("statePartyOrg").find({ countryId, partyId }).toArray(),
    db
      .collection<PartyBudget>("partyBudget")
      .find({ countryId, partyId, scope: "state" })
      .toArray(),
    db.collection<State>("states").find({ countryId }).toArray(),
    db
      .collection<TreasuryTransaction>("treasuryTransactions")
      .find({
        countryId,
        partyId,
        holderType: "state_party",
        direction: "credit",
        category: "transfers",
      })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray(),
    db
      .collection<AdminLog>("adminLogs")
      .find({
        action: "funds_transferred",
        details: {
          $regex: `${escapeRegExp(partyName)}.*Emergency override|Emergency override.*${escapeRegExp(partyName)}`,
          $options: "i",
        },
      })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray(),
  ]);

  const stateById = new Map(states.map((state) => [state._id, state]));
  const budgetByStateId = new Map(
    budgets
      .filter((budget): budget is PartyBudget & { stateId: string } => "stateId" in budget)
      .map((budget) => [budget.stateId, budget])
  );
  const transferByHolderId = new Map<string, { amount: number; count: number }>();
  for (const row of transferRows) {
    const current = transferByHolderId.get(row.holderId) ?? { amount: 0, count: 0 };
    current.amount += row.amount;
    current.count += 1;
    transferByHolderId.set(row.holderId, current);
  }

  const metrics: TreasuryStateFundingMetric[] = statePartyOrgs.map((statePartyOrg) => {
    const state = stateById.get(statePartyOrg.stateId) ?? null;
    const growthPerTurn = calculateGrowthPerTurn(
      statePartyOrg,
      budgetByStateId.get(statePartyOrg.stateId) ?? null
    );
    const organization = roundToTenths(statePartyOrg.organization ?? 0);
    const recentTransfers = transferByHolderId.get(statePartyOrg._id) ?? { amount: 0, count: 0 };

    return {
      stateId: statePartyOrg.stateId,
      stateName: state?.name ?? statePartyOrg.stateId,
      treasury: Math.round(statePartyOrg.treasury ?? 0),
      organization,
      growthPerTurn,
      recentTransferAmount: Math.round(recentTransfers.amount),
      recentTransferCount: recentTransfers.count,
      href: regionPartyUrl(countryId, statePartyOrg.stateId, partyId),
    };
  });

  return {
    recentTransferRecipients: [...metrics]
      .filter((metric) => metric.recentTransferAmount > 0)
      .sort(
        (a, b) =>
          b.recentTransferAmount - a.recentTransferAmount ||
          b.recentTransferCount - a.recentTransferCount
      )
      .slice(0, 5),
    lowestTreasuryStates: [...metrics]
      .sort((a, b) => a.treasury - b.treasury || a.organization - b.organization)
      .slice(0, 5),
    growthLeaders: [...metrics]
      .sort((a, b) => b.growthPerTurn - a.growthPerTurn || a.treasury - b.treasury)
      .slice(0, 5),
    overrideHistory: buildOverrideEntries(overrideLogs),
  };
}

export async function buildStateTreasuryInsights(
  db: Db,
  partyName: string,
  stateName: string
): Promise<StateTreasuryInsights> {
  const overrideLogs = await db
    .collection<AdminLog>("adminLogs")
    .find({
      action: "funds_transferred",
      details: {
        $regex: `${escapeRegExp(stateName)} ${escapeRegExp(partyName)}.*Emergency override|Emergency override.*${escapeRegExp(stateName)} ${escapeRegExp(partyName)}`,
        $options: "i",
      },
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  return {
    overrideHistory: buildOverrideEntries(overrideLogs),
  };
}
