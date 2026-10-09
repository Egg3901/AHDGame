/** Transactional persistence shell for a server-authored v2 law bill. */
import type { Db, ObjectId } from "mongodb";
import type { Bill, ResetLawProvision } from "@/lib/db/types/legislation";
import type { StateBill } from "@/lib/db/types/stateBill";
import type { GameState } from "@/lib/db/types/gameState";
import type { FederalBudget } from "@/lib/db/types/budget";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { RESET_V2_COUNTRIES, resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import type { ResetCountry } from "./fundingOwner";
import { resetLawFamilyById } from "./catalog";
import type { ResetLawOpeningBoard } from "./rules/openingBoard";
import { enactReviewedBill } from "./rules/billEnactment";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import type { ResetLawEnactmentReceipt, ResetLawProgramDocument } from "./program";

function resetLawProvisions(bill: Pick<Bill | StateBill, "provisions">): ResetLawProvision[] {
  return (bill.provisions ?? []).filter(
    (provision): provision is ResetLawProvision => provision.type === "reset_law"
  );
}

export async function applyResetLawBillEnactment(
  db: Db,
  bill: Pick<Bill | StateBill, "_id" | "countryId" | "provisions"> & { stateId?: string },
  turn: number
): Promise<{ applied: boolean; programs: number }> {
  const frozen = resetLawProvisions(bill);
  if (frozen.length === 0) return { applied: false, programs: 0 };
  if (frozen.some((provision) => provision.scope === "regional")) {
    return applyRegionalResetLawBillEnactment(db, bill, frozen, turn);
  }
  const country = bill.countryId;
  if (!country || !(RESET_V2_COUNTRIES as readonly string[]).includes(country)) {
    throw new Error("A v2 law bill needs a supported country");
  }
  const resetCountry = country as ResetCountry;
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("Invalid v2 enactment turn");
  const receiptId = bill._id.toString();
  return runRequiredTransaction(async (session) => {
    const existingReceipt = await db
      .collection<ResetLawEnactmentReceipt>("resetLawEnactmentReceipts")
      .findOne({ _id: receiptId }, { session });
    if (existingReceipt) return { applied: false, programs: existingReceipt.programIds.length };
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        session,
        projection: {
          resetWorldId: 1,
          currentYear: 1,
          startingYear: 1,
          metricsSystemVersion: 1,
          legislationSystemVersion: 1,
          resetVersionSeeds: 1,
        },
      }
    );
    if (
      !gameState?.resetWorldId ||
      resetSystemVersionsForCountry(gameState, RESET_V2_READY, country).legislation !== "v2"
    ) {
      throw new Error("Legislation v2 is not enabled for this enacted bill");
    }
    if (frozen.some((provision) => provision.scope !== "national" || provision.regionId)) {
      throw new Error("National enactment received a regional v2 provision");
    }
    const worldId = gameState.resetWorldId;
    const [board, existingPrograms, accounts] = await Promise.all([
      db
        .collection<ResetLawOpeningBoard>("resetLawOpeningBoards")
        .findOne({ _id: `${country}:national`, worldId }, { session }),
      db
        .collection<ResetLawProgramDocument>("resetLawPrograms")
        .find({ worldId, country: resetCountry, scope: "national" }, { session })
        .toArray(),
      db
        .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
        .find({ worldId, countryId: resetCountry }, { session })
        .toArray(),
    ]);
    if (!board) throw new Error("The v2 current-law board is unavailable at enactment");
    const existingByFamily = new Map(
      existingPrograms.map((program) => [program.familyId, program])
    );
    const reviewed = frozen.map((provision) => {
      const family = resetLawFamilyById(provision.familyId);
      const reference = board.references[provision.familyId];
      if (
        !family ||
        !reference ||
        provision.reviewedOption.familyId !== provision.familyId ||
        provision.reviewedOption.country !== country ||
        provision.reviewedOption.scope !== "national" ||
        provision.reviewedOption.choice !== provision.choice
      ) {
        throw new Error(`Invalid frozen v2 provision ${provision.familyId}`);
      }
      return {
        family,
        reference,
        option: provision.reviewedOption,
        openingChoice: provision.currentChoiceSnapshot,
        openingFundingAccountId: provision.reviewedOption.fundingAccountId,
      };
    });
    const enactment = enactReviewedBill({
      provisions: reviewed,
      existingPrograms,
      year: gameState.currentYear ?? gameState.startingYear ?? 1991,
      turn,
    });
    const accountById = new Map(accounts.map((account) => [account._id, account]));
    const deltas = new Map<string, Map<string, number>>();
    const addDelta = (accountId: string, familyId: string, amount: number) => {
      const byFamily = deltas.get(accountId) ?? new Map<string, number>();
      byFamily.set(familyId, (byFamily.get(familyId) ?? 0) + amount);
      deltas.set(accountId, byFamily);
    };
    for (const [index, transition] of enactment.transitions.entries()) {
      const provision = frozen[index]!;
      const current = existingByFamily.get(provision.familyId);
      if (current) {
        addDelta(current.fundingAccountId, provision.familyId, -current.annualAgencyAllocation);
      } else {
        const newlySuperseded = new Set(provision.reviewedOption.supersedesSourceIds);
        const openingReduction = board.references[provision.familyId]!.sourceComponents.reduce(
          (sum, source) =>
            sum +
            (newlySuperseded.has(source.sourceId) &&
            source.fiscalRole === "single-booked-owner" &&
            source.fiscalOwner === provision.familyId
              ? source.annualBooked
              : 0),
          0
        );
        addDelta(provision.reviewedOption.fundingAccountId, provision.familyId, -openingReduction);
      }
      addDelta(
        provision.reviewedOption.fundingAccountId,
        provision.familyId,
        provision.reviewedOption.annualAllocation
      );
      const program: ResetLawProgramDocument = {
        _id: `${worldId}:${country}:national:${provision.familyId}`,
        worldId,
        enactedByBillId: bill._id as ObjectId,
        ...transition.program,
        titleSnapshot: provision.titleSnapshot,
        descriptionSnapshot: provision.descriptionSnapshot,
        balanceBasis: provision.balanceBasis,
        primaryMetricEffects: provision.primaryMetricEffectsSnapshot,
      };
      await db
        .collection<ResetLawProgramDocument>("resetLawPrograms")
        .replaceOne({ _id: program._id, worldId }, program, { upsert: true, session });
    }
    let defenseAnnualDelta = 0;
    for (const [accountId, familyDeltas] of deltas) {
      const account = accountById.get(accountId);
      if (!account) throw new Error(`Missing v2 funding account ${accountId}`);
      const nextFamilies = { ...account.familyAnnualDemand };
      let accountDelta = 0;
      for (const [familyId, delta] of familyDeltas) {
        const next = (nextFamilies[familyId] ?? 0) + delta;
        if (!Number.isSafeInteger(next) || next < 0) {
          throw new Error(`Invalid v2 family authority ${accountId}:${familyId}`);
        }
        nextFamilies[familyId] = next;
        accountDelta += delta;
      }
      const nextAuthority = account.annualAuthority + accountDelta;
      const nextGross = account.grossAnnualClaim + accountDelta;
      if (
        !Number.isSafeInteger(nextAuthority) ||
        nextAuthority < 0 ||
        !Number.isSafeInteger(nextGross) ||
        nextGross < 0 ||
        Object.values(nextFamilies).reduce((sum, amount) => sum + amount, 0) !== nextAuthority
      ) {
        throw new Error(`V2 department authority does not reconcile ${accountId}`);
      }
      const written = await db
        .collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts")
        .updateOne(
          {
            _id: accountId,
            worldId,
            annualAuthority: account.annualAuthority,
            familyAnnualDemand: account.familyAnnualDemand,
          },
          {
            $set: {
              annualAuthority: nextAuthority,
              grossAnnualClaim: nextGross,
              familyAnnualDemand: nextFamilies,
              programAllocationPercents: {
                ...account.programAllocationPercents,
                ...Object.fromEntries([...familyDeltas.keys()].map((familyId) => [familyId, 100])),
              },
            },
          },
          { session }
        );
      if (written.matchedCount !== 1)
        throw new Error("V2 department authority changed concurrently");
      if (account.externallySettled && familyDeltas.has("L48")) defenseAnnualDelta += accountDelta;
    }
    if (enactment.annualAllocationDelta !== 0 || defenseAnnualDelta !== 0) {
      const spendingIncrement: Record<string, number> = {
        "spending.total": enactment.annualAllocationDelta,
      };
      if (defenseAnnualDelta !== 0) {
        spendingIncrement["spending.byCategory.defense"] = defenseAnnualDelta;
      }
      const written = await db.collection<FederalBudget>("federalBudget").updateOne(
        { countryId: country },
        {
          $inc: spendingIncrement,
        },
        { session }
      );
      if (written.matchedCount !== 1) throw new Error("V2 national budget is unavailable");
    }
    const programIds = frozen.map(
      (provision) => `${worldId}:${country}:national:${provision.familyId}`
    );
    await db.collection<ResetLawEnactmentReceipt>("resetLawEnactmentReceipts").insertOne(
      {
        _id: receiptId,
        worldId,
        countryId: country,
        turn,
        programIds,
        annualAllocationDelta: enactment.annualAllocationDelta,
        transitionClaim: enactment.transitionClaim,
      },
      { session }
    );
    return { applied: true, programs: programIds.length };
  });
}

async function applyRegionalResetLawBillEnactment(
  db: Db,
  bill: Pick<Bill | StateBill, "_id" | "countryId"> & { stateId?: string },
  frozen: readonly ResetLawProvision[],
  turn: number
): Promise<{ applied: boolean; programs: number }> {
  const country = bill.countryId;
  const regionId = bill.stateId?.toUpperCase();
  if (!country || !(RESET_V2_COUNTRIES as readonly string[]).includes(country) || !regionId) {
    throw new Error("A regional v2 law bill needs a supported jurisdiction");
  }
  if (
    frozen.some((provision) => provision.scope !== "regional" || provision.regionId !== regionId)
  ) {
    throw new Error("Regional enactment received a cross-jurisdiction v2 provision");
  }
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("Invalid v2 enactment turn");
  const resetCountry = country as ResetCountry;
  const receiptId = bill._id.toString();
  return runRequiredTransaction(async (session) => {
    const receipts = db.collection<ResetLawEnactmentReceipt>("resetLawEnactmentReceipts");
    const existingReceipt = await receipts.findOne({ _id: receiptId }, { session });
    if (existingReceipt) return { applied: false, programs: existingReceipt.programIds.length };
    const gameState = await db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        session,
        projection: {
          resetWorldId: 1,
          currentYear: 1,
          startingYear: 1,
          metricsSystemVersion: 1,
          legislationSystemVersion: 1,
          resetVersionSeeds: 1,
        },
      }
    );
    if (
      !gameState?.resetWorldId ||
      resetSystemVersionsForCountry(gameState, RESET_V2_READY, country).legislation !== "v2"
    ) {
      throw new Error("Legislation v2 is not enabled for this enacted bill");
    }
    const worldId = gameState.resetWorldId;
    const [board, existingPrograms] = await Promise.all([
      db
        .collection<ResetLawOpeningBoard>("resetLawOpeningBoards")
        .findOne({ _id: `${country}:${regionId}`, worldId }, { session }),
      db
        .collection<ResetLawProgramDocument>("resetLawPrograms")
        .find({ worldId, country: resetCountry, scope: "regional", regionId }, { session })
        .toArray(),
    ]);
    if (!board) throw new Error("The regional v2 current-law board is unavailable at enactment");
    const reviewed = frozen.map((provision) => {
      const family = resetLawFamilyById(provision.familyId);
      const reference = board.references[provision.familyId];
      if (
        !family ||
        !reference ||
        provision.reviewedOption.familyId !== provision.familyId ||
        provision.reviewedOption.country !== country ||
        provision.reviewedOption.scope !== "regional" ||
        provision.reviewedOption.choice !== provision.choice ||
        provision.reviewedOption.fundingAccountId !== "regional_budget"
      ) {
        throw new Error(`Invalid frozen regional v2 provision ${provision.familyId}`);
      }
      return {
        family,
        reference,
        option: provision.reviewedOption,
        openingChoice: provision.currentChoiceSnapshot,
        openingFundingAccountId: "regional_budget",
      };
    });
    const enactment = enactReviewedBill({
      provisions: reviewed,
      existingPrograms,
      year: gameState.currentYear ?? gameState.startingYear ?? 1991,
      turn,
    });
    const programIds: string[] = [];
    for (const [index, transition] of enactment.transitions.entries()) {
      const provision = frozen[index]!;
      const program: ResetLawProgramDocument = {
        _id: `${worldId}:${country}:${regionId}:${provision.familyId}`,
        worldId,
        regionId,
        enactedByBillId: bill._id as ObjectId,
        ...transition.program,
        titleSnapshot: provision.titleSnapshot,
        descriptionSnapshot: provision.descriptionSnapshot,
        balanceBasis: provision.balanceBasis,
        primaryMetricEffects: provision.primaryMetricEffectsSnapshot,
      };
      await db
        .collection<ResetLawProgramDocument>("resetLawPrograms")
        .replaceOne({ _id: program._id, worldId }, program, { upsert: true, session });
      programIds.push(program._id);
    }
    await receipts.insertOne(
      {
        _id: receiptId,
        worldId,
        countryId: country,
        turn,
        programIds,
        annualAllocationDelta: enactment.annualAllocationDelta,
        transitionClaim: enactment.transitionClaim,
      },
      { session }
    );
    return { applied: true, programs: programIds.length };
  });
}
