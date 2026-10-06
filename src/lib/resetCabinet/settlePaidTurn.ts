/** Batch persistence shell for paid v2 Cabinet authority. Never debits treasury. */
import type { Db } from "mongodb";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { settleLiveDepartmentTurn } from "@/lib/resetFinance/rules/liveDepartmentTurn";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";

export interface PaidResetCabinetTurnResult {
  accounts: number;
  advanced: number;
  replayed: number;
  authorityPaid: number;
  outlaid: number;
}

export async function settlePaidResetCabinetTurn(input: {
  db: Db;
  worldId: string;
  countryId: ResetCountry;
  turn: number;
  /** The opening account roster plus any law-authorized accounts. */
  expectedAccountIds: readonly string[];
  /** Actual treasury-paid shares, keyed by ordinary account id. */
  paidAuthorityByAccount: Readonly<Record<string, number>>;
}): Promise<PaidResetCabinetTurnResult> {
  const { db, worldId, countryId, turn, expectedAccountIds, paidAuthorityByAccount } = input;
  if (!worldId || !Number.isSafeInteger(turn) || turn < 2 || expectedAccountIds.length === 0) {
    throw new Error("V2 Cabinet turn requires a world, turn, and complete account roster");
  }
  const expected = new Set(expectedAccountIds);
  if (
    expected.size !== expectedAccountIds.length ||
    expectedAccountIds.some((id) => !id.startsWith(`${countryId}:`))
  ) {
    throw new Error("V2 Cabinet turn has an invalid expected account roster");
  }
  const collection = db.collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts");
  const accounts = await collection
    .find(
      { worldId, countryId },
      {
        projection: {
          _id: 1,
          worldId: 1,
          countryId: 1,
          departmentId: 1,
          sourceTurn: 1,
          accruedThroughTurn: 1,
          lastAuthorityPaid: 1,
          unpaidAuthority: 1,
          annualAuthority: 1,
          balance: 1,
          encumbered: 1,
          arrears: 1,
          externallySettled: 1,
          familyAnnualDemand: 1,
          programAllocationPercents: 1,
          lastProgramDelivery: 1,
        },
      }
    )
    .toArray();
  if (
    accounts.length !== expected.size ||
    accounts.some(
      (account) =>
        !expected.has(account._id) ||
        account._id !== `${countryId}:${account.departmentId}` ||
        account.worldId !== worldId ||
        account.countryId !== countryId
    )
  ) {
    throw new Error("V2 Cabinet turn is missing a world-bound account");
  }
  const ordinaryIds = new Set(
    accounts.filter((account) => !account.externallySettled).map((account) => account._id)
  );
  if (
    Object.keys(paidAuthorityByAccount).length !== ordinaryIds.size ||
    Object.keys(paidAuthorityByAccount).some((id) => !ordinaryIds.has(id))
  ) {
    throw new Error("V2 Cabinet turn needs exactly one paid share per ordinary account");
  }
  // Preflight every result before the first write. A partial database failure
  // remains retryable because each account has a world-bound turn CAS.
  const planned = accounts.map((account) => ({
    account,
    result: settleLiveDepartmentTurn({
      account,
      turn,
      authorityPaid: account.externallySettled ? 0 : paidAuthorityByAccount[account._id]!,
    }),
  }));
  const pending = planned.filter(
    ({ account, result }) => !account.externallySettled && !result.settlement?.replayed
  );
  if (pending.length > 0) {
    const write = await collection.bulkWrite(
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
    if (write.matchedCount !== pending.length) {
      throw new Error("V2 Cabinet turn lost its account compare-and-swap");
    }
  }
  return {
    accounts: accounts.length,
    advanced: pending.length,
    replayed: planned.filter(
      ({ account, result }) => !account.externallySettled && result.settlement?.replayed
    ).length,
    authorityPaid: planned.reduce(
      (sum, { result }) => sum + (result.settlement?.authorityAccrued ?? 0),
      0
    ),
    outlaid: planned.reduce((sum, { result }) => sum + (result.settlement?.totalOutlays ?? 0), 0),
  };
}
