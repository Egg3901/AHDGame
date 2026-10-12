import {
  splitLiveDepartmentAccounts,
  splitLiveContinuity,
  splitLiveTreasury,
  reconcileSplitTreasuryClaims,
} from "./rules/liveFinance";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { openingNationalTreasurySnapshots } from "@/lib/resetFinance/rules/treasurySnapshot";
import type { ResetNationalTreasurySnapshot } from "@/lib/resetFinance/rules/treasurySnapshot";
import {
  buildOpeningDepartmentFundingPartition,
  type ResetDepartmentAccountSnapshot,
  type ResetDepartmentContinuitySnapshot,
} from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetDepartmentOpeningBoard } from "@/lib/resetFinance/rules/departmentBoard";
import type { ResetRegionalOpeningBoard } from "@/lib/resetFinance/rules/regionalOpeningBoard";
import type { ResetCabinetActionState } from "@/lib/resetCabinet/rules/actionState";
import { resetLawFamilies } from "@/lib/resetLegislation/catalog";
import { fundingNameForLaw1991, fundingSeatForLaw } from "@/lib/resetLegislation/fundingOwner";
import type { OpeningLawReference } from "@/lib/resetLegislation/openingLaw";
import {
  buildResetLawOpeningBoard,
  type ResetLawOpeningBoard,
} from "@/lib/resetLegislation/rules/openingBoard";
import type { ResetMetricSnapshot } from "@/lib/resetMetrics/rules/snapshot";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import {
  mergeResetReceiptCountries,
  resetSystemVersionsForCountry,
} from "@/lib/resetVersions/rules";
import { groupOpeningDepartmentClaims } from "@/lib/resetFinance/rules/departmentOpening";
import type { SecedingCountryId } from "./subRegions";
import { buildSuccessorMetricRows, buildSuccessorRegionalRows } from "./rules/resetV2Promotion";
import { verifyDemographicsV2Opening } from "@/lib/demographics/v2/verifyOpening";

function rekeyReference(
  reference: OpeningLawReference,
  country: SecedingCountryId,
  scope: "national" | "regional"
): OpeningLawReference {
  return {
    ...reference,
    key: `${country}:${scope}:${reference.familyId}`,
    country,
    scope,
    sourceComponents: reference.sourceComponents.map((component) => ({ ...component })),
  };
}

/** Promote the live UK aggregate's v2 state when Scotland or Wales becomes sovereign. */
export async function promoteResetV2ForIndependence(
  db: Db,
  countryId: SecedingCountryId,
  conversionTurn?: number
): Promise<{ promoted: boolean }> {
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentTurn: 1,
        resetWorldId: 1,
        metricsSystemVersion: 1,
        legislationSystemVersion: 1,
        cabinetSystemVersion: 1,
        demographicsSystemVersion: 1,
        resetVersionSeeds: 1,
      },
    }
  );
  if (!gameState?.resetWorldId) return { promoted: false };
  const versions = resetSystemVersionsForCountry(gameState, RESET_V2_READY, "UK");
  if (!Object.values(versions).some((version) => version === "v2")) {
    return { promoted: false };
  }
  const worldId = gameState.resetWorldId;
  const alreadyPromoted =
    (versions.metrics !== "v2" ||
      gameState.resetVersionSeeds?.metrics?.countries?.includes(countryId) === true) &&
    (versions.legislation !== "v2" ||
      gameState.resetVersionSeeds?.legislation?.countries?.includes(countryId) === true) &&
    (versions.cabinet !== "v2" ||
      gameState.resetVersionSeeds?.cabinet?.countries?.includes(countryId) === true) &&
    (versions.demographics !== "v2" ||
      gameState.resetVersionSeeds?.demographics?.countries?.includes(countryId) === true);
  if (alreadyPromoted) {
    await Promise.all([
      ...(versions.metrics === "v2"
        ? [
            db
              .collection<ResetMetricSnapshot>("resetMetricSnapshots")
              .deleteOne({ _id: `UK:${countryId}`, worldId }),
          ]
        : []),
      ...(versions.legislation === "v2"
        ? [
            db
              .collection<ResetLawOpeningBoard>("resetLawOpeningBoards")
              .deleteOne({ _id: `UK:${countryId}`, worldId }),
            db
              .collection<ResetRegionalOpeningBoard>("resetRegionalOpeningBoards")
              .deleteOne({ _id: `UK:${countryId}`, worldId }),
          ]
        : []),
    ]);
    return { promoted: false };
  }
  const states = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, population: 1, gdp: 1 } })
    .toArray();
  if (states.length === 0) throw new Error(`${countryId} v2 promotion has no sub-regions`);

  const metricCollection = db.collection<ResetMetricSnapshot>("resetMetricSnapshots");
  const aggregateMetric =
    versions.metrics === "v2"
      ? await metricCollection.findOne({ _id: `UK:${countryId}`, worldId })
      : null;
  if (versions.metrics === "v2" && !aggregateMetric) {
    throw new Error(`${countryId} v2 promotion is missing its UK metric source`);
  }
  const sourceRegions = await db
    .collection<State>("states")
    .find({ countryId: "UK" }, { projection: { gdp: 1 } })
    .toArray();
  const successorGdp = states.reduce((sum, state) => sum + state.gdp, 0);
  const nationalWeight =
    successorGdp / (successorGdp + sourceRegions.reduce((sum, state) => sum + state.gdp, 0));
  const regionSeeds = states.map((state) => ({ id: state._id, population: state.population }));
  const demographicsReceipt =
    versions.demographics === "v2"
      ? await verifyDemographicsV2Opening(
          db,
          worldId,
          gameState.currentTurn ?? gameState.resetVersionSeeds?.demographics?.sourceTurn ?? 1,
          [countryId]
        )
      : null;
  if (versions.metrics === "v2") {
    const metricRows: ResetMetricSnapshot[] = buildSuccessorMetricRows({
      countryId,
      aggregate: aggregateMetric!,
      national:
        (await metricCollection.findOne({ _id: "UK:national", worldId })) ??
        (() => {
          throw new Error("Missing UK national metric source");
        })(),
      regions: regionSeeds,
    });
    await metricCollection.bulkWrite(
      metricRows.map((row) => ({
        replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
      })),
      { ordered: true }
    );
  }
  const sourcesToDelete: Array<Promise<unknown>> = [];

  let nationalReferences: OpeningLawReference[] = [];
  if (versions.legislation === "v2") {
    const lawCollection = db.collection<ResetLawOpeningBoard>("resetLawOpeningBoards");
    const aggregateLaw = await lawCollection.findOne({ _id: `UK:${countryId}`, worldId });
    const aggregateFiscal = await db
      .collection<ResetRegionalOpeningBoard>("resetRegionalOpeningBoards")
      .findOne({ _id: `UK:${countryId}`, worldId });
    if (!aggregateLaw || !aggregateFiscal) {
      throw new Error(`${countryId} v2 promotion is missing its UK law or fiscal source`);
    }
    const nationalLaw = await lawCollection.findOne({ _id: "UK:national", worldId });
    if (!nationalLaw) throw new Error("Missing UK national law source");
    nationalReferences = Object.values(nationalLaw.references).map((reference) => ({
      ...rekeyReference(reference, countryId, "national"),
      sourceComponents: reference.sourceComponents.map((component) => ({
        ...component,
        annualBooked: component.annualBooked * nationalWeight,
      })),
    }));
    if (nationalLaw) {
      const keptReferences = Object.values(nationalLaw.references).map((reference) => ({
        ...reference,
        sourceComponents: reference.sourceComponents.map((component) => ({
          ...component,
          annualBooked: component.annualBooked * (1 - nationalWeight),
        })),
      }));
      await lawCollection.replaceOne(
        { _id: nationalLaw._id, worldId },
        buildResetLawOpeningBoard({
          worldId,
          countryId: "UK",
          sourceTurn: nationalLaw.sourceTurn,
          references: keptReferences,
        })
      );
    }
    const regionalReferences = Object.values(aggregateLaw.references).map((reference) =>
      rekeyReference(reference, countryId, "regional")
    );
    const regionalRows = buildSuccessorRegionalRows({
      countryId,
      aggregate: aggregateFiscal,
      regionalReferences,
      regions: regionSeeds,
    });
    const lawRows = [
      buildResetLawOpeningBoard({
        worldId,
        countryId,
        sourceTurn: aggregateLaw.sourceTurn,
        references: nationalReferences,
      }),
      ...regionalRows.map((row) =>
        buildResetLawOpeningBoard({
          worldId,
          countryId,
          regionId: row.fiscal.regionId,
          sourceTurn: aggregateLaw.sourceTurn,
          references: row.references,
        })
      ),
    ];
    await lawCollection.bulkWrite(
      lawRows.map((row) => ({
        replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
      })),
      { ordered: true }
    );

    const fiscalRows: ResetRegionalOpeningBoard[] = regionalRows.map((row) => row.fiscal);
    const fiscalCollection = db.collection<ResetRegionalOpeningBoard>("resetRegionalOpeningBoards");
    await fiscalCollection.bulkWrite(
      fiscalRows.map((row) => ({
        replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
      })),
      { ordered: true }
    );

    sourcesToDelete.push(
      lawCollection.deleteOne({ _id: `UK:${countryId}`, worldId }),
      fiscalCollection.deleteOne({ _id: `UK:${countryId}`, worldId })
    );
  }

  if (versions.cabinet === "v2") {
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId }, { projection: { spending: 1, debt: 1 } });
    if (!budget) throw new Error(`${countryId} v2 promotion has no national budget`);
    const sourceTurn = conversionTurn ?? gameState.currentTurn ?? 1;
    const familyAmounts = Object.fromEntries(
      nationalReferences.map((reference) => [
        reference.familyId,
        reference.sourceComponents
          .filter((component) => component.fiscalRole === "single-booked-owner")
          .reduce((sum, component) => sum + component.annualBooked, 0),
      ])
    );
    const operating = Math.round(
      Math.max(
        0,
        budget.spending.total - budget.spending.debtInterest - budget.spending.stateGrants
      )
    );
    const claimed = Object.values(familyAmounts).reduce((sum, amount) => sum + amount, 0);
    const scale = claimed > operating && claimed > 0 ? operating / claimed : 1;
    const claims = resetLawFamilies
      .filter((family) => family.availability.national.includes(countryId))
      .map((family) => ({
        familyId: family.id,
        seatId: fundingSeatForLaw(family, countryId),
        agencyName: fundingNameForLaw1991(family, countryId),
        annualAmount: Math.floor((familyAmounts[family.id] ?? 0) * scale),
      }));
    const owned = claims.reduce((sum, claim) => sum + claim.annualAmount, 0);
    const grouped = groupOpeningDepartmentClaims(operating, claims, operating - owned);
    const departmentBoard: ResetDepartmentOpeningBoard = {
      _id: countryId,
      worldId,
      countryId,
      sourceTurn,
      operating,
      continuityAmount: grouped.continuityAmount,
      accounts: grouped.accounts,
    };
    const partition = buildOpeningDepartmentFundingPartition(
      [departmentBoard],
      DEPARTMENT_DEFINITIONS,
      { [countryId]: 0 },
      { [countryId]: {} }
    );
    const treasury = openingNationalTreasurySnapshots(
      worldId,
      sourceTurn,
      { [countryId]: { debt: budget.debt.principal, debtCeiling: budget.debt.ceiling } },
      partition.accounts
    )[0]!;
    const sourceTreasury = await db
      .collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries")
      .findOne({ _id: "UK", worldId });
    const sourceAccounts = await db
      .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
      .find({ countryId: "UK", worldId })
      .toArray();
    if (!sourceTreasury || !sourceAccounts.length)
      throw new Error("Independence requires the live UK finance books");
    const rump = await db
      .collection<State>("states")
      .find({ countryId: "UK" }, { projection: { gdp: 1 } })
      .toArray();
    const newGdp = states.reduce((sum, state) => sum + state.gdp, 0);
    const weight = newGdp / (newGdp + rump.reduce((sum, state) => sum + state.gdp, 0));
    if (!(weight > 0 && weight < 1)) throw new Error("Invalid live finance split");
    const splitAccounts = splitLiveDepartmentAccounts(
      sourceAccounts,
      partition.accounts,
      DEPARTMENT_DEFINITIONS,
      weight,
      sourceTreasury.settledThroughTurn
    );
    partition.accounts = splitAccounts.moved;
    const splitTreasury = splitLiveTreasury(
      sourceTreasury,
      treasury,
      weight,
      sourceTurn,
      splitAccounts.idMap
    );
    reconcileSplitTreasuryClaims(
      sourceTreasury,
      splitTreasury.kept,
      splitTreasury.moved,
      partition.accounts,
      sourceAccounts
    );
    Object.assign(treasury, splitTreasury.moved);
    const sourceContinuity = await db
      .collection<ResetDepartmentContinuitySnapshot>("resetDepartmentContinuity")
      .findOne({ _id: "UK", worldId });
    if (!sourceContinuity) throw new Error("Independence requires the live UK continuity book");
    const continuitySplit = splitLiveContinuity(sourceContinuity, partition.continuity[0]!, weight);
    partition.continuity[0] = continuitySplit.moved;
    const keptContinuity = continuitySplit.kept;
    await db
      .collection<ResetDepartmentContinuitySnapshot>("resetDepartmentContinuity")
      .replaceOne({ _id: "UK", worldId }, keptContinuity);

    await db.collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts").bulkWrite(
      splitAccounts.kept.map((row) => ({
        replaceOne: { filter: { _id: row._id }, replacement: row },
      }))
    );
    await db
      .collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries")
      .replaceOne({ _id: "UK", worldId }, splitTreasury.kept);

    const actionState: ResetCabinetActionState = {
      _id: countryId,
      worldId,
      countryId,
      sourceTurn,
      actorStates: {},
      active: [],
      history: [],
      updatedTurn: sourceTurn,
    };
    await Promise.all([
      db
        .collection<ResetDepartmentOpeningBoard>("resetDepartmentOpeningBoards")
        .replaceOne({ _id: countryId }, departmentBoard, { upsert: true }),
      db.collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts").bulkWrite(
        partition.accounts.map((row) => ({
          replaceOne: { filter: { _id: row._id }, replacement: row, upsert: true },
        })),
        { ordered: true }
      ),
      db
        .collection<ResetDepartmentContinuitySnapshot>("resetDepartmentContinuity")
        .replaceOne({ _id: countryId }, partition.continuity[0]!, { upsert: true }),
      db
        .collection<ResetNationalTreasurySnapshot>("resetNationalTreasuries")
        .replaceOne({ _id: countryId }, treasury, { upsert: true }),
      db
        .collection<ResetCabinetActionState>("resetCabinetActionStates")
        .replaceOne({ _id: countryId }, actionState, { upsert: true }),
    ]);
  }

  const additions: Record<string, unknown> = {};
  if (versions.metrics === "v2")
    additions["resetVersionSeeds.metrics.countries"] = mergeResetReceiptCountries(
      gameState.resetVersionSeeds?.metrics?.countries,
      [countryId]
    );
  if (versions.legislation === "v2")
    additions["resetVersionSeeds.legislation.countries"] = mergeResetReceiptCountries(
      gameState.resetVersionSeeds?.legislation?.countries,
      [countryId]
    );
  if (versions.cabinet === "v2")
    additions["resetVersionSeeds.cabinet.countries"] = mergeResetReceiptCountries(
      gameState.resetVersionSeeds?.cabinet?.countries,
      [countryId]
    );
  if (versions.demographics === "v2") {
    const existing = gameState.resetVersionSeeds?.demographics;
    if (!existing || !demographicsReceipt) {
      throw new Error(`${countryId} v2 promotion is missing its demographics receipt`);
    }
    additions["resetVersionSeeds.demographics"] = {
      ...existing,
      revision: demographicsReceipt.revision,
      completedAt: demographicsReceipt.completedAt,
      verificationHash: createHash("sha256")
        .update(existing.verificationHash)
        .update("\n")
        .update(demographicsReceipt.verificationHash)
        .digest("hex"),
      countries: mergeResetReceiptCountries(existing.countries, [countryId]),
    };
  }
  await db
    .collection<GameState>("gameState")
    .updateOne({ _id: "current", resetWorldId: worldId }, { $set: additions });
  if (versions.metrics === "v2") {
    sourcesToDelete.push(metricCollection.deleteOne({ _id: `UK:${countryId}`, worldId }));
  }
  await Promise.all(sourcesToDelete);
  return { promoted: true };
}
