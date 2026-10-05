/**
 * V2 sovereign cash and Cabinet delivery. Actual bond payouts are reconciled
 * before a department receives authority; durable receipts make retries safe.
 */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { BondTurnResult } from "@/lib/turn/bondTurn";
import { includedAuthorityPerTurn } from "@/lib/governmentFinance/rules/appropriation";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry, type ResetSystem } from "@/lib/resetVersions/rules";
import { settleResetCashTurn } from "./rules/cashTurn";
import { buildResetAuthorityClaims } from "./rules/authorityClaims";
import type { ResetNationalTreasurySnapshot } from "./rules/treasurySnapshot";
import type {
  ResetDepartmentAccountSnapshot,
  ResetDepartmentContinuitySnapshot,
} from "./rules/liveDepartmentAccount";
import { settleLiveDepartmentTurn } from "./rules/liveDepartmentTurn";
import type { ResetLawProgramDocument } from "@/lib/resetLegislation/program";
import {
  activeDepartmentProgramFamilyIds,
  activeDepartmentProgramFundingControl,
} from "@/lib/resetCabinet/rules/programRoster";

export async function settleResetTreasuryCashTurn(input: {
  db: Db;
  gameState: GameState;
  turn: number;
  bondFlows: BondTurnResult;
  ready?: Record<ResetSystem, boolean>;
}) {
  const { db, gameState, turn, bondFlows } = input;
  const countries = (["US", "UK", "JP"] as const).filter(
    (country) =>
      resetSystemVersionsForCountry(gameState, input.ready ?? RESET_V2_READY, country).cabinet ===
      "v2"
  );
  if (!countries.length) return { countries: 0, accounts: 0, advanced: 0, replayed: 0 };
  if (!gameState.resetWorldId || turn !== gameState.currentTurn + 1) {
    throw new Error("V2 cash settlement needs the next turn and current world");
  }
  const worldId = gameState.resetWorldId;
  const filter = { worldId, countryId: { $in: countries } };
  const treasuryCollection =
    db.collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries");
  const accountCollection =
    db.collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts");
  const [treasuries, accounts, continuity, budgets, currentPrograms] = await Promise.all([
    treasuryCollection.find(filter).toArray(),
    accountCollection.find(filter).toArray(),
    db
      .collection<ResetDepartmentContinuitySnapshot>("resetDepartmentContinuity")
      .find(filter)
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find(
        { countryId: { $in: countries } },
        {
          projection: { countryId: 1, "revenue.total": 1, "debt.ceiling": 1 },
        }
      )
      .toArray(),
    db
      .collection<ResetLawProgramDocument>("resetLawPrograms")
      .find(
        { worldId, country: { $in: countries }, scope: "national" },
        {
          projection: {
            country: 1,
            scope: 1,
            familyId: 1,
            choice: 1,
            fundingAccountId: 1,
          },
        }
      )
      .toArray(),
  ]);
  const planned = countries.map((country) => {
    const books = treasuries.filter((row) => row.countryId === country && row._id === country);
    const reserves = continuity.filter((row) => row.countryId === country && row._id === country);
    const sources = budgets.filter((row) => row.countryId === country);
    const roster = accounts.filter((account) => account.countryId === country);
    if (
      books.length !== 1 ||
      reserves.length !== 1 ||
      sources.length !== 1 ||
      !roster.length ||
      new Set(roster.map((account) => account._id)).size !== roster.length
    ) {
      throw new Error(`Incomplete v2 cash roster for ${country}`);
    }
    const opening = books[0]!;
    const reserve = reserves[0]!;
    const budget = sources[0]!;
    if (
      !opening.departmentAccountIds?.length ||
      opening.departmentAccountIds.some((id) => !roster.some((account) => account._id === id))
    )
      throw new Error(`Missing seeded v2 department account for ${country}`);
    if (
      opening.worldId !== worldId ||
      reserve.worldId !== worldId ||
      reserve.sourceTurn !== opening.sourceTurn
    )
      throw new Error("V2 cash book identity does not match its world opening");
    if (opening.settledThroughTurn !== turn - 1 && opening.settledThroughTurn !== turn) {
      throw new Error("V2 cash receipt skipped a turn");
    }
    const claims = buildResetAuthorityClaims(roster, reserve, turn);
    const flow = (values: Record<string, number> | undefined): number => {
      if (!values) throw new Error("V2 cash needs actual bond flow capture");
      return values[country] ?? 0;
    };
    const next =
      opening.settledThroughTurn === turn
        ? opening
        : settleResetCashTurn({
            treasury: { ...opening, debtCeiling: budget.debt.ceiling },
            turn,
            claims,
            flows: {
              revenue: includedAuthorityPerTurn(Math.round(budget.revenue.total), turn),
              annualInterestRate: 0,
              periodsPerYear: 48,
              bondProceeds: flow(bondFlows.sovereignCashProceedsByCountry),
              bondFaceIssued: flow(bondFlows.sovereignDebtFaceIssuedByCountry),
              bondMaturityCashPaid: flow(bondFlows.sovereignMaturityCashPaidByCountry),
              bondFaceRetired: flow(bondFlows.sovereignDebtFaceRetiredByCountry),
              bondCouponCashPaid: flow(bondFlows.sovereignCouponPaidByCountry),
            },
          });
    if (!next.lastPaidByClaim) throw new Error("V2 cash replay is missing its payment receipt");
    const deliveries = roster
      .filter((account) => !account.externallySettled)
      .map((account) => {
        if (account._id !== `${country}:${account.departmentId}`)
          throw new Error("Invalid account identity");
        const authorityPaid = next.lastPaidByClaim![account._id];
        if (authorityPaid === undefined) throw new Error("V2 cash receipt omitted a department");
        const fundingControls = Object.fromEntries(
          Object.keys(account.familyAnnualDemand).map((familyId) => [
            familyId,
            activeDepartmentProgramFundingControl(account, familyId, currentPrograms),
          ])
        );
        const activeFamilyIds = activeDepartmentProgramFamilyIds(account, currentPrograms);
        const result = settleLiveDepartmentTurn({
          account,
          turn,
          authorityPaid,
          fundingControls,
          activeFamilyIds,
        });
        if ((result.next.unpaidAuthority ?? 0) !== next.claimArrears?.[account._id])
          throw new Error("Department unpaid authority does not reconcile to treasury");
        return { account, result };
      });
    return { opening, next, deliveries };
  });
  // Freeze cash payments first. If account persistence fails part way through,
  // the next attempt consumes the same receipt, not a new revenue or bond flow.
  const advancing = planned.filter(({ opening }) => opening.settledThroughTurn !== turn);
  if (advancing.length) {
    const write = await treasuryCollection.bulkWrite(
      advancing.map(({ opening, next }) => ({
        updateOne: {
          filter: { _id: opening._id, worldId, settledThroughTurn: turn - 1 },
          update: { $set: next },
        },
      })),
      { ordered: true }
    );
    if (write.matchedCount !== advancing.length)
      throw new Error("V2 treasury lost its compare-and-swap");
  }
  const deliveries = planned.flatMap((plan) => plan.deliveries);
  const pending = deliveries.filter(({ account }) => account.accruedThroughTurn !== turn);
  if (pending.length) {
    const write = await accountCollection.bulkWrite(
      pending.map(({ account, result }) => ({
        updateOne: {
          filter: {
            _id: account._id,
            worldId,
            accruedThroughTurn: turn - 1,
            programAllocationPercents: account.programAllocationPercents,
          },
          update: {
            $set: {
              accruedThroughTurn: turn,
              lastAuthorityPaid: result.next.lastAuthorityPaid,
              unpaidAuthority: result.next.unpaidAuthority,
              balance: result.next.balance,
              encumbered: result.next.encumbered,
              arrears: result.next.arrears,
              lastProgramDelivery: result.next.lastProgramDelivery,
            },
          },
        },
      })),
      { ordered: true }
    );
    if (write.matchedCount !== pending.length)
      throw new Error("V2 delivery lost its compare-and-swap");
  }
  return {
    countries: countries.length,
    accounts: deliveries.length,
    advanced: pending.length,
    replayed: deliveries.length - pending.length,
  };
}
