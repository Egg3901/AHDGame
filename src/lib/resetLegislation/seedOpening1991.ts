/** Persistence shell for the 1991 current-law crosswalk. Not an enactment menu. */
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { StateBudget } from "@/lib/db/types/budget";
import type { ResetSystemSeedReceipt } from "@/lib/resetVersions/rules";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { RESET_V2_OPENING_COUNTRIES } from "@/lib/resetVersions/rules";
import { buildOpeningLawBoards1991 } from "./openingBoards1991";
import { resetLawOpeningBoardPayload, type ResetLawOpeningBoard } from "./rules/openingBoard";
import { buildOpeningRegionalBoards1991 } from "@/lib/resetFinance/openingRegionalBoards1991";
import {
  regionalOpeningBoardPayload,
  type ResetRegionalOpeningBoard,
} from "@/lib/resetFinance/rules/regionalOpeningBoard";
import type { ResetOpeningCountry } from "@/lib/resetFinance/opening1991";

export async function seedOpeningLawBoards1991(
  db: Db,
  worldId: string,
  sourceTurn: number,
  countries: readonly ResetOpeningCountry[] = RESET_V2_OPENING_COUNTRIES
): Promise<ResetSystemSeedReceipt> {
  const expected = buildOpeningLawBoards1991(worldId, sourceTurn).filter((board) =>
    countries.includes(board.countryId as ResetOpeningCountry)
  );
  const expectedRegional = buildOpeningRegionalBoards1991(worldId, sourceTurn).filter((board) =>
    countries.includes(board.countryId as ResetOpeningCountry)
  );
  const seededRegions = await db
    .collection<State>("states")
    .find({ countryId: { $in: [...countries] } }, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const actualIds = seededRegions.map((region) => `${region.countryId}:${region._id}`).sort();
  const expectedIds = expected
    .filter((board) => board.scope === "regional")
    .map((board) => board._id)
    .sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error("The seeded 1991 regions do not match the v2 current-law crosswalk");
  }
  if (
    JSON.stringify(actualIds) !== JSON.stringify(expectedRegional.map((board) => board._id).sort())
  ) {
    throw new Error("The seeded 1991 regions do not match v2 regional fiscal claims");
  }
  const ukBudgetRows = countries.includes("UK")
    ? await db
        .collection<StateBudget>("stateBudgets")
        .find(
          { countryId: "UK" },
          {
            projection: {
              stateId: 1,
              countryId: 1,
              "revenue.propertyTax": 1,
              "revenue.domesticCorporateTax": 1,
              "revenue.foreignCorporateTax": 1,
            },
          }
        )
        .toArray()
    : [];
  const expectedUk = expected.filter((board) => board.ukTerritorialTax);
  const actualUkByRegion = new Map(ukBudgetRows.map((budget) => [budget.stateId, budget]));
  if (ukBudgetRows.length !== expectedUk.length || actualUkByRegion.size !== expectedUk.length) {
    throw new Error("The seeded UK 1991 regional tax proxy does not match its budget roster");
  }
  for (const board of expectedUk) {
    const budget = actualUkByRegion.get(board.regionId!);
    const revenue = budget?.revenue;
    const actualProxy =
      (revenue?.propertyTax ?? Number.NaN) +
      (revenue?.domesticCorporateTax ?? Number.NaN) +
      (revenue?.foreignCorporateTax ?? Number.NaN);
    if (
      budget?.countryId !== board.countryId ||
      !Number.isFinite(actualProxy) ||
      Math.abs(actualProxy - board.ukTerritorialTax!.sourceOwnRevenueProxy) > 0.01
    ) {
      throw new Error(`The seeded UK 1991 regional tax proxy differs for ${board.regionId}`);
    }
  }
  const collection = db.collection<ResetLawOpeningBoard>("resetLawOpeningBoards");
  await collection.bulkWrite(
    expected.map((board) => ({
      replaceOne: { filter: { _id: board._id }, replacement: board, upsert: true },
    })),
    { ordered: true }
  );
  const persisted = await collection
    .find(
      { countryId: { $in: [...countries] } },
      {
        projection: {
          _id: 1,
          worldId: 1,
          countryId: 1,
          scope: 1,
          regionId: 1,
          sourceTurn: 1,
          ukTerritorialTax: 1,
          references: 1,
        },
      }
    )
    .toArray();
  const expectedPayload = resetLawOpeningBoardPayload(expected);
  if (
    persisted.length !== expected.length ||
    resetLawOpeningBoardPayload(persisted) !== expectedPayload
  ) {
    throw new Error("The persisted 1991 v2 current-law crosswalk failed readback verification");
  }
  const regionalCollection = db.collection<ResetRegionalOpeningBoard>("resetRegionalOpeningBoards");
  await regionalCollection.bulkWrite(
    expectedRegional.map((board) => ({
      replaceOne: { filter: { _id: board._id }, replacement: board, upsert: true },
    })),
    { ordered: true }
  );
  const persistedRegional = await regionalCollection
    .find({ countryId: { $in: [...countries] } })
    .toArray();
  const regionalPayload = regionalOpeningBoardPayload(expectedRegional);
  if (
    persistedRegional.length !== expectedRegional.length ||
    regionalOpeningBoardPayload(persistedRegional) !== regionalPayload
  ) {
    throw new Error("The persisted 1991 v2 regional fiscal opening failed readback verification");
  }
  return {
    worldId,
    revision: RESET_V2_SEED_REVISION.legislation,
    sourceTurn,
    completedAt: new Date().toISOString(),
    verificationHash: createHash("sha256")
      .update(expectedPayload)
      .update("\n")
      .update(regionalPayload)
      .digest("hex"),
    countries: [...countries],
  };
}
