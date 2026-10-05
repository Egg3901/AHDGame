/** Persistence shell for v2 Cabinet's reconciled opening claims. */
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { ResetSystemSeedReceipt } from "@/lib/resetVersions/rules";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { openingFiscalBooks1991 } from "./opening1991";
import { openingNamedGrantClaims1991 } from "./openingOwnership1991";
import { buildOpeningDepartmentBoards1991 } from "./openingDepartmentBoards1991";
import {
  departmentOpeningBoardPayload,
  type ResetDepartmentOpeningBoard,
} from "./rules/departmentBoard";
import {
  buildOpeningDepartmentFundingPartition,
  openingDepartmentAccountsPayload,
  openingDepartmentContinuityPayload,
  type ResetDepartmentAccountSnapshot,
  type ResetDepartmentContinuitySnapshot,
} from "./rules/liveDepartmentAccount";
import {
  openingNationalTreasuryPayload,
  openingNationalTreasurySnapshots,
  type ResetNationalTreasurySnapshot,
} from "./rules/treasurySnapshot";
import {
  cabinetActionStatesPayload,
  openingCabinetActionStates,
  type ResetCabinetActionState,
} from "@/lib/resetCabinet/rules/actionState";

export async function seedOpeningDepartmentBoards1991(
  db: Db,
  worldId: string,
  sourceTurn: number
): Promise<ResetSystemSeedReceipt> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { resetWorldId: 1, currentTurn: 1, manuallyEnabledSeats: 1 } }
    );
  if (
    state?.resetWorldId !== worldId ||
    state.currentTurn !== sourceTurn ||
    !state.manuallyEnabledSeats?.includes("secretary_of_education")
  ) {
    throw new Error("The 1991 v2 Cabinet opening lacks its historical US education seat");
  }
  const expected = buildOpeningDepartmentBoards1991(worldId, sourceTurn);
  const fiscal = openingFiscalBooks1991();
  const partition = buildOpeningDepartmentFundingPartition(
    expected,
    DEPARTMENT_DEFINITIONS,
    {
      US: fiscal.US.grants,
      UK: fiscal.UK.grants,
      JP: fiscal.JP.grants,
    },
    openingNamedGrantClaims1991()
  );
  const collection = db.collection<ResetDepartmentOpeningBoard>("resetDepartmentOpeningBoards");
  await collection.bulkWrite(
    expected.map((board) => ({
      replaceOne: { filter: { _id: board._id }, replacement: board, upsert: true },
    })),
    { ordered: true }
  );
  const persisted = await collection.find({}).toArray();
  const expectedPayload = departmentOpeningBoardPayload(expected);
  if (
    persisted.length !== expected.length ||
    departmentOpeningBoardPayload(persisted) !== expectedPayload
  ) {
    throw new Error("The persisted 1991 v2 department opening failed readback verification");
  }
  const accounts = db.collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts");
  await accounts.bulkWrite(
    partition.accounts.map((account) => ({
      replaceOne: { filter: { _id: account._id }, replacement: account, upsert: true },
    })),
    { ordered: true }
  );
  const persistedAccounts = await accounts.find({}).toArray();
  const expectedAccountsPayload = openingDepartmentAccountsPayload(partition.accounts);
  if (
    persistedAccounts.length !== partition.accounts.length ||
    openingDepartmentAccountsPayload(persistedAccounts) !== expectedAccountsPayload
  ) {
    throw new Error("The persisted 1991 v2 spendable accounts failed readback verification");
  }
  const continuity = db.collection<ResetDepartmentContinuitySnapshot>("resetDepartmentContinuity");
  await continuity.bulkWrite(
    partition.continuity.map((row) => ({
      replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
    })),
    { ordered: true }
  );
  const persistedContinuity = await continuity.find({}).toArray();
  const expectedContinuityPayload = openingDepartmentContinuityPayload(partition.continuity);
  if (
    persistedContinuity.length !== partition.continuity.length ||
    openingDepartmentContinuityPayload(persistedContinuity) !== expectedContinuityPayload
  ) {
    throw new Error("The persisted 1991 v2 continuity reserve failed readback verification");
  }
  const openingTreasuries = openingNationalTreasurySnapshots(
    worldId,
    sourceTurn,
    fiscal,
    partition.accounts
  );
  const treasuries = db.collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries");
  await treasuries.bulkWrite(
    openingTreasuries.map((row) => ({
      replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
    })),
    { ordered: true }
  );
  const persistedTreasuries = await treasuries.find({}).toArray();
  const expectedTreasuryPayload = openingNationalTreasuryPayload(openingTreasuries);
  if (
    persistedTreasuries.length !== openingTreasuries.length ||
    openingNationalTreasuryPayload(persistedTreasuries) !== expectedTreasuryPayload
  ) {
    throw new Error("The persisted 1991 v2 national treasury failed readback verification");
  }
  const openingActions = openingCabinetActionStates(worldId, sourceTurn);
  const actionStates = db.collection<ResetCabinetActionState>("resetCabinetActionStates");
  await actionStates.bulkWrite(
    openingActions.map((row) => ({
      replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
    })),
    { ordered: true }
  );
  const persistedActions = await actionStates.find({}).toArray();
  const expectedActionsPayload = cabinetActionStatesPayload(openingActions);
  if (
    persistedActions.length !== openingActions.length ||
    cabinetActionStatesPayload(persistedActions) !== expectedActionsPayload
  ) {
    throw new Error("The persisted 1991 v2 Cabinet action opening failed readback verification");
  }
  return {
    worldId,
    revision: RESET_V2_SEED_REVISION.cabinet,
    sourceTurn,
    completedAt: new Date().toISOString(),
    verificationHash: createHash("sha256")
      .update(expectedPayload)
      .update(expectedAccountsPayload)
      .update(expectedContinuityPayload)
      .update(expectedTreasuryPayload)
      .update(expectedActionsPayload)
      .digest("hex"),
  };
}
