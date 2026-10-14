import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";

/**
 * The first-days panel: three goals a new character can act on immediately,
 * in a world that is already running.
 *
 * Political influence only rises through the Campaign action (per-turn
 * processing only decays it), and launch players campaigned because the
 * founding races forced them to. A player who joins later gets no such push,
 * so this panel gives it: campaign a few times, join a party, and enter a race
 * that is still open in the home region.
 */

/** How long a new character sees the panel, unless every goal is done first. */
export const FIRST_DAYS_HOURS = 72;
/** One Campaign is worth about 1 influence; three gets a player off zero for good. */
export const FIRST_DAYS_CAMPAIGN_GOAL = 3;
/** Races listed; the soonest-closing first. */
const MAX_RACES = 3;

export interface FirstDaysRace {
  id: string;
  label: string;
  /** Hours until entry closes (primary end), rounded down; null when unknown. */
  closesInHours: number | null;
  candidates: number;
}

export interface FirstDaysData {
  influence: number;
  campaigns: number;
  campaignGoal: number;
  joinedParty: boolean;
  enteredRace: boolean;
  races: FirstDaysRace[];
  /** Chose "skip" at the tutorial welcome: offer the short core tour. */
  skippedTutorial: boolean;
}

type FirstDaysCharacter = Pick<
  Character,
  | "_id"
  | "countryId"
  | "homeState"
  | "party"
  | "politicalInfluence"
  | "createdAt"
  | "currentOffice"
  | "tutorial"
>;

export function isInFirstDays(
  character: Pick<Character, "createdAt">,
  now: number = Date.now()
): boolean {
  const created = character.createdAt instanceof Date ? character.createdAt.getTime() : NaN;
  return Number.isFinite(created) && now - created <= FIRST_DAYS_HOURS * 3_600_000;
}

export function firstDaysComplete(data: FirstDaysData): boolean {
  return data.campaigns >= data.campaignGoal && data.joinedParty && data.enteredRace;
}

interface ElectionRow {
  _id: ObjectId;
  electionType: string;
  countryId?: string;
  state?: string;
  status?: string;
  primaryEndTime?: Date | string;
}

/**
 * Load the panel for a character, or null when it should not show (past the
 * first days, or every goal already done).
 */
export async function loadFirstDays(
  db: Db,
  character: FirstDaysCharacter,
  now: Date = new Date()
): Promise<FirstDaysData | null> {
  if (!isInFirstDays(character, now.getTime())) return null;

  const [campaigns, candidacies, elections] = await Promise.all([
    db
      .collection("actionLogs")
      .countDocuments(
        { characterId: character._id, actionType: "campaign" },
        { limit: FIRST_DAYS_CAMPAIGN_GOAL }
      ),
    db
      .collection("electionCandidates")
      .countDocuments({ characterId: character._id }, { limit: 1 }),
    db
      .collection<ElectionRow>("elections")
      .find(
        {
          countryId: character.countryId,
          state: character.homeState,
          status: { $in: ["upcoming", "active"] },
        },
        { projection: { electionType: 1, countryId: 1, primaryEndTime: 1 } }
      )
      .limit(20)
      .toArray(),
  ]);

  // Same rule the entry route applies: entry closes when the primary ends.
  const open = elections
    .map((e) => {
      const end = e.primaryEndTime ? new Date(e.primaryEndTime).getTime() : NaN;
      return { e, end };
    })
    .filter(({ end }) => Number.isNaN(end) || end > now.getTime())
    .sort((a, b) => (a.end || Infinity) - (b.end || Infinity))
    .slice(0, MAX_RACES);

  const races: FirstDaysRace[] = await Promise.all(
    open.map(async ({ e, end }) => ({
      id: e._id.toString(),
      label: formatElectionTypeLabel(e.electionType, character.countryId as CountryId),
      closesInHours: Number.isNaN(end) ? null : Math.floor((end - now.getTime()) / 3_600_000),
      candidates: await db.collection("electionCandidates").countDocuments({ electionId: e._id }),
    }))
  );

  const data: FirstDaysData = {
    influence: character.politicalInfluence ?? 0,
    campaigns,
    campaignGoal: FIRST_DAYS_CAMPAIGN_GOAL,
    joinedParty: Boolean(character.party) && character.party !== "independent",
    enteredRace: candidacies > 0 || character.currentOffice != null,
    races,
    skippedTutorial: character.tutorial?.experience === "skip",
  };
  return firstDaysComplete(data) ? null : data;
}
