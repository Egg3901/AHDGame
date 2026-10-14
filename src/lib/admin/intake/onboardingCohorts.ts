import type { Db } from "mongodb";
import { FOUNDING_WINDOW_TURNS } from "@/lib/onboarding/stepStamps";
import { ONBOARDING_STEP_IDS } from "@/lib/onboarding/checklist";

/**
 * First-days outcomes for new characters, split by whether they joined during
 * the founding races or into a running world. Measures the onboarding fix:
 * success is fewer mid-world joiners stuck at zero political influence.
 *
 * "Campaigned within 24h" comes from `actionLogs` (indexed on characterId +
 * actionType), so it is exact for cohorts from before step stamps existed.
 * "No influence growth after 72h" compares current influence with what the
 * character started with, for characters at least 72 hours old. From 1.16 new
 * characters start at 10 (`startingPoliticalInfluence`), and influence only
 * decays on its own, so a character that never campaigned sits at or below its
 * start. Older characters started at 0, so for them this is the original
 * "still at zero" measure and the pre-1.16 baseline (45% of mid-world joiners)
 * stays comparable. `startedWithInfluence` counts the 1.16-onward characters
 * so the two populations can be told apart.
 */
export interface OnboardingCohort {
  characters: number;
  campaignedWithin24h: number;
  /** Characters at least 72 hours old. */
  atLeast72h: number;
  /** Of those, influence not above the starting value (never grew it). */
  noInfluenceGrowthAfter72h: number;
  /** Characters created with starting influence (1.16 onward). */
  startedWithInfluence: number;
  /** First-completion stamps per checklist step (stamps exist from rollout). */
  steps: Record<string, number>;
}

export interface OnboardingCohorts {
  founding: OnboardingCohort;
  midWorld: OnboardingCohort;
}

interface Row {
  createdAt: Date;
  createdTurn?: number;
  politicalInfluence?: number;
  startingPoliticalInfluence?: number;
  stepKeys?: string[];
  firstCampaignAt?: Date | null;
}

const H = 3_600_000;

function emptyCohort(): OnboardingCohort {
  return {
    characters: 0,
    campaignedWithin24h: 0,
    atLeast72h: 0,
    noInfluenceGrowthAfter72h: 0,
    startedWithInfluence: 0,
    steps: Object.fromEntries(ONBOARDING_STEP_IDS.map((id) => [id, 0])),
  };
}

export async function computeOnboardingCohorts(
  db: Db,
  since: Date,
  now: Date = new Date()
): Promise<OnboardingCohorts> {
  const rows = (await db
    .collection("characters")
    .aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        // localField/foreignField so the lookup rides the
        // { characterId, actionType } index on actionLogs.
        $lookup: {
          from: "actionLogs",
          localField: "_id",
          foreignField: "characterId",
          pipeline: [
            { $match: { actionType: "campaign" } },
            { $group: { _id: null, first: { $min: "$createdAt" } } },
          ],
          as: "campaigns",
        },
      },
      {
        $project: {
          createdAt: 1,
          createdTurn: 1,
          politicalInfluence: 1,
          startingPoliticalInfluence: 1,
          stepKeys: {
            $map: {
              input: { $objectToArray: { $ifNull: ["$onboarding.steps", {}] } },
              as: "s",
              in: "$$s.k",
            },
          },
          firstCampaignAt: { $first: "$campaigns.first" },
        },
      },
    ])
    .toArray()) as Row[];

  const result: OnboardingCohorts = { founding: emptyCohort(), midWorld: emptyCohort() };
  for (const row of rows) {
    if (!(row.createdAt instanceof Date)) continue;
    const cohort =
      typeof row.createdTurn === "number" && row.createdTurn > FOUNDING_WINDOW_TURNS
        ? result.midWorld
        : result.founding;
    const created = row.createdAt.getTime();
    cohort.characters++;
    const start = row.startingPoliticalInfluence ?? 0;
    if (start > 0) cohort.startedWithInfluence++;
    if (row.firstCampaignAt instanceof Date && row.firstCampaignAt.getTime() - created <= 24 * H) {
      cohort.campaignedWithin24h++;
    }
    if (now.getTime() - created >= 72 * H) {
      cohort.atLeast72h++;
      if (!((row.politicalInfluence ?? 0) > start)) cohort.noInfluenceGrowthAfter72h++;
    }
    for (const key of row.stepKeys ?? []) {
      if (key in cohort.steps) cohort.steps[key]++;
    }
  }
  return result;
}
