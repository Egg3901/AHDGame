import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types/gameState";
import { loadDemocraticCompetition } from "@/lib/governanceStyle/loadCompetition";
import type { GovernanceStyleScore } from "@/lib/governanceStyle/score";
import { resetLawFamilies, type LegislativePosition } from "@/lib/resetLegislation/catalog";
import type { ResetLawOpeningBoard } from "@/lib/resetLegislation/rules/openingBoard";
import { openingChoice1991 } from "@/lib/resetLegislation/rules/reviewCatalog";
import type { LawChoice } from "@/lib/resetLegislation/rules/eligibility";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";
import {
  scoreResetGovernanceStyle,
  type ResetMetricConditionScores,
} from "./rules/governanceStyle";

export interface ResetGovernanceProgramChoice {
  familyId: string;
  choice: LawChoice;
}

function isLegislativePosition(choice: LawChoice): choice is LegislativePosition {
  return choice !== "leave_to_states";
}

/** Database shell for the portable v2 National Spirit score. */
export async function readResetGovernanceStyle(input: {
  db: Db;
  worldId: string;
  countryId: ResetCountry;
  scope: "national" | "regional";
  regionId?: string;
  conditionScores: ResetMetricConditionScores;
  programs: readonly ResetGovernanceProgramChoice[];
}): Promise<GovernanceStyleScore | null> {
  const boardId = `${input.countryId}:${input.regionId ?? "national"}`;
  const [gameState, openingBoard] = await Promise.all([
    input.db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1, presidentialTenureByCountry: 1 } }),
    input.db
      .collection<ResetLawOpeningBoard>("resetLawOpeningBoards")
      .findOne({ _id: boardId, worldId: input.worldId }, { projection: { references: 1 } }),
  ]);
  if (!openingBoard) return null;

  const activeChoices = new Map(
    input.programs.map((program) => [program.familyId, program.choice])
  );
  const positions: LegislativePosition[] = [];
  for (const family of resetLawFamilies) {
    if (!family.availability[input.scope].includes(input.countryId)) continue;
    const activeChoice = activeChoices.get(family.id);
    if (activeChoice !== undefined) {
      // Federalism is a jurisdiction choice, not a point on the left-right rail.
      if (isLegislativePosition(activeChoice)) positions.push(activeChoice);
      continue;
    }
    const reference = openingBoard.references[family.id];
    if (reference) positions.push(openingChoice1991(reference));
  }

  const competition = await loadDemocraticCompetition(
    input.db,
    input.countryId as CountryId,
    gameState?.preset,
    gameState
  );
  return scoreResetGovernanceStyle({
    conditionScores: input.conditionScores,
    legislativePositions: positions,
    competition,
  });
}
