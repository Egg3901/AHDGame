/**
 * Move every national v2 law in one country exactly one ideological step.
 *
 * This is an observation helper for a disposable local world. It never edits
 * seed data. Preview is the default; pass --apply to persist the synthetic
 * signed bill through the normal v2 enactment and account-reconciliation path.
 *
 *   npx tsx scripts/debug/nudge-reset-law-portfolio.ts --country=US
 *   npx tsx scripts/debug/nudge-reset-law-portfolio.ts --country=US --apply
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import type { Bill, BillChamber, ResetLawProvision } from "@/lib/db/types/legislation";
import type { GameState } from "@/lib/db/types/gameState";
import { getDb } from "@/lib/mongodb";
import { applyResetLawBillEnactment } from "@/lib/resetLegislation/enactBill";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import { loadReviewedLawCatalog } from "@/lib/resetLegislation/loadReviewedCatalog";
import type {
  ResetLawEnactmentReceipt,
  ResetLawProgramDocument,
} from "@/lib/resetLegislation/program";
import { resetLawFamilyById, type LegislativePosition } from "@/lib/resetLegislation/catalog";
import { enactReviewedBill } from "@/lib/resetLegislation/rules/billEnactment";
import type { ResetLawOpeningBoard } from "@/lib/resetLegislation/rules/openingBoard";

const POSITIONS: readonly LegislativePosition[] = [
  "far_left",
  "center_left",
  "center",
  "center_right",
  "far_right",
];

const CHAMBERS: Readonly<Record<ResetCountry, BillChamber>> = {
  US: "house",
  UK: "commons",
  JP: "shugiin",
};

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function countryArgument(): ResetCountry {
  const value = (argument("country") ?? "US").toUpperCase();
  if (value !== "US" && value !== "UK" && value !== "JP") {
    throw new Error("--country must be US, UK, or JP");
  }
  return value;
}

function directionFor(seed: string, familyId: string): -1 | 1 {
  const byte = createHash("sha256").update(`${seed}:${familyId}`).digest()[0]!;
  return byte % 2 === 0 ? -1 : 1;
}

function adjacentChoice(
  current: LegislativePosition,
  preferredDirection: -1 | 1
): LegislativePosition {
  const index = POSITIONS.indexOf(current);
  if (index < 0) throw new Error(`Unknown current law position ${current}`);
  const preferred = index + preferredDirection;
  if (preferred >= 0 && preferred < POSITIONS.length) return POSITIONS[preferred]!;
  return POSITIONS[index - preferredDirection]!;
}

function observationBillId(worldId: string, country: ResetCountry, turn: number, seed: string) {
  const hex = createHash("sha256")
    .update(`reset-law-observation:${worldId}:${country}:${turn}:${seed}`)
    .digest("hex")
    .slice(0, 24);
  return ObjectId.createFromHexString(hex);
}

async function main() {
  const country = countryArgument();
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        resetWorldId: 1,
        currentTurn: 1,
        currentYear: 1,
        startingYear: 1,
      },
    }
  );
  if (!gameState?.resetWorldId) throw new Error("The current world has no v2 reset identity");
  const turn = gameState.currentTurn;
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error("The current turn is unavailable");
  const year = gameState.currentYear ?? gameState.startingYear ?? 1991;
  const seed = argument("seed") ?? `${gameState.resetWorldId}:${country}:${turn}`;
  const billId = observationBillId(gameState.resetWorldId, country, turn, seed);
  if (apply) {
    const receipt = await db
      .collection<ResetLawEnactmentReceipt>("resetLawEnactmentReceipts")
      .findOne({ _id: billId.toHexString(), worldId: gameState.resetWorldId });
    if (receipt) {
      console.log(`Observation portfolio was already applied by bill ${billId.toHexString()}`);
      return;
    }
  }
  const currentPrograms = await db
    .collection<ResetLawProgramDocument>("resetLawPrograms")
    .find({ worldId: gameState.resetWorldId, country, scope: "national" })
    .toArray();
  if (currentPrograms.length > 0) {
    throw new Error(
      `This observation helper requires an untouched national portfolio; found ${currentPrograms.length} enacted replacements`
    );
  }

  const [catalog, openingBoard] = await Promise.all([
    loadReviewedLawCatalog({
      db,
      worldId: gameState.resetWorldId,
      country,
      scope: "national",
      year,
    }),
    db.collection<ResetLawOpeningBoard>("resetLawOpeningBoards").findOne({
      _id: `${country}:national`,
      worldId: gameState.resetWorldId,
    }),
  ]);
  if (!openingBoard) throw new Error("The national opening law board is unavailable");
  const provisions: ResetLawProvision[] = catalog.map((family) => {
    if (family.currentChoice === "leave_to_states") {
      throw new Error(`Opening current law cannot be devolved: ${family.familyId}`);
    }
    const choice = adjacentChoice(family.currentChoice, directionFor(seed, family.familyId));
    const entry = family.options.find((candidate) => candidate.option.choice === choice);
    if (!entry) throw new Error(`Missing adjacent option ${family.familyId}:${choice}`);
    return {
      type: "reset_law",
      familyId: family.familyId,
      scope: "national",
      choice,
      reviewedOption: entry.option,
      titleSnapshot: entry.title,
      descriptionSnapshot: entry.description,
      currentLawSnapshot: family.currentLaw,
      currentLawDescriptionSnapshot: family.currentLawDescription,
      currentChoiceSnapshot: family.currentChoice,
      currentAnnualAllocationSnapshot: entry.currentAnnualAllocation,
      annualAllocationDeltaSnapshot: entry.annualAllocationDelta,
      overseeingSeatIdSnapshot: family.overseeingSeatId,
      overseeingAgencyIdSnapshot: family.overseeingAgencyId,
      primaryMetricEffectsSnapshot: entry.primaryMetricEffects,
      balanceBasis: entry.balanceBasis,
    };
  });

  const left = provisions.filter(
    (provision) =>
      POSITIONS.indexOf(provision.choice as LegislativePosition) <
      POSITIONS.indexOf(provision.currentChoiceSnapshot as LegislativePosition)
  ).length;
  const right = provisions.length - left;
  const enactmentPreview = enactReviewedBill({
    provisions: provisions.map((provision) => {
      const family = resetLawFamilyById(provision.familyId);
      const reference = openingBoard.references[provision.familyId];
      if (!family || !reference) {
        throw new Error(`Missing enactment input for ${provision.familyId}`);
      }
      return {
        family,
        reference,
        option: provision.reviewedOption,
        openingChoice: provision.currentChoiceSnapshot,
        openingFundingAccountId: provision.reviewedOption.fundingAccountId,
      };
    }),
    existingPrograms: currentPrograms,
    year,
    turn,
  });
  const annualAllocationDelta = enactmentPreview.annualAllocationDelta;
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "preview",
        worldId: gameState.resetWorldId,
        country,
        turn,
        year,
        seed,
        laws: provisions.length,
        leftMoves: left,
        rightMoves: right,
        annualAllocationDelta,
        changes: provisions.map((provision) => ({
          familyId: provision.familyId,
          from: provision.currentChoiceSnapshot,
          to: provision.choice,
          title: provision.titleSnapshot,
        })),
      },
      null,
      2
    )
  );
  if (!apply) return;

  const now = new Date();
  const bill: Bill = {
    _id: billId,
    title: "Temporary law portfolio observation",
    summary:
      "Administrative observation bill moving every current national law one adjacent policy level.",
    originChamber: CHAMBERS[country],
    currentChamber: CHAMBERS[country],
    sponsorId: null,
    sponsorName: "Local observation",
    adminProposed: true,
    status: "proposed",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "admin",
    countryId: country,
    provisions,
    proposedAt: now,
    proposedTurn: turn,
    createdAt: now,
    updatedAt: now,
  };
  await db
    .collection<Bill>("bills")
    .updateOne({ _id: billId }, { $setOnInsert: bill }, { upsert: true });
  const result = await applyResetLawBillEnactment(db, bill, turn);
  await db.collection<Bill>("bills").updateOne(
    { _id: billId },
    {
      $set: {
        status: "signed",
        presidentAction: "signed",
        enactedAt: now,
        updatedAt: new Date(),
      },
    }
  );
  console.log(
    `Applied ${result.programs} adjacent law changes through bill ${billId.toHexString()}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
