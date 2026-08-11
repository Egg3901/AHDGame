import type { Character } from "@/lib/db/types/character";
import type { ActionType, GameIteration } from "@/lib/db/types/gameState";
import { deriveHighestOffice } from "@/lib/character/deriveHighestOffice";
import type {
  CharacterRecap,
  RecapAchievementHighlight,
  RecapActionBreakdown,
  RecapRankedStat,
} from "./types";

/** A 1-based position within a ranked field. */
export interface RankPosition {
  rank: number;
  total: number;
}

/**
 * DB-derived per-character inputs. Everything here required a collection read or
 * a cross-field ranking; the character-local stats (career, office, influence,
 * favorability, tenure) are derived from the `Character` inside the assembler.
 */
export interface PerCharacterRecapInput {
  /** Resolved party display name. */
  partyName: string;
  actions: { total: number; byType: RecapActionBreakdown };
  bills: { sponsored: number; passed: number };
  social: { subscribers: number; posts: number; likes: number };
  achievementsCount: number;
  achievementHighlights: RecapAchievementHighlight[];
  /** Local-currency campaign balance. */
  campaignFunds: number;
  /** campaignFunds + cashOnHand + portfolioValue. */
  netWorth: number;
  ranks: {
    npi: RankPosition | null;
    favorability: RankPosition | null;
    netWorth: RankPosition | null;
    campaignFunds: RankPosition | null;
    actions: RankPosition | null;
  };
}

export interface RecapAssemblyContext {
  iteration?: GameIteration;
  /** Outgoing currentTurn — anchors tenure. */
  currentTurn: number;
}

function rankedStat(value: number, pos: RankPosition | null): RecapRankedStat {
  return { value, rank: pos?.rank ?? null, total: pos?.total ?? 0 };
}

/** The most-used action type (signature move), or null if the player never acted. */
function topActionType(byType: RecapActionBreakdown): ActionType | null {
  let top: ActionType | null = null;
  let best = 0;
  for (const [type, count] of Object.entries(byType) as [ActionType, number][]) {
    if (count > best) {
      best = count;
      top = type;
    }
  }
  return top;
}

function countElections(character: Character): { entered: number; won: number; lost: number } {
  let won = 0;
  let lost = 0;
  for (const event of character.careerHistory ?? []) {
    if (event.type === "elected") won++;
    else if (event.type === "lost_election") lost++;
  }
  return { entered: won + lost, won, lost };
}

/**
 * Pure assembler: turns a Character + its precomputed DB aggregates into the
 * frozen CharacterRecap payload. No I/O — unit-testable in isolation. Ranked
 * stats whose value is non-positive are nulled (skipped slides); influence and
 * favorability are always present. `social` collapses to null when the player
 * never touched the wire.
 */
export function buildCharacterRecap(
  character: Character,
  input: PerCharacterRecapInput,
  ctx: RecapAssemblyContext
): CharacterRecap {
  const tenureTurns =
    character.createdTurn != null ? Math.max(0, ctx.currentTurn - character.createdTurn) : 0;

  const nationalInfluence = character.nationalInfluence ?? 0;
  const favorability = character.favorability ?? 50;
  const social =
    input.social.subscribers > 0 || input.social.posts > 0 || input.social.likes > 0
      ? input.social
      : null;

  return {
    schemaVersion: 1,
    characterId: character._id.toString(),
    name: character.name,
    party: input.partyName,
    countryId: character.countryId,
    iteration: ctx.iteration ?? null,
    tenureTurns,
    highestOffice: deriveHighestOffice(character) ?? null,
    actions: {
      total: input.actions.total,
      byType: input.actions.byType,
      topType: topActionType(input.actions.byType),
      rank: input.actions.total > 0 ? rankedStat(input.actions.total, input.ranks.actions) : null,
    },
    influence: {
      politicalInfluence: character.politicalInfluence ?? 0,
      nationalInfluence,
      npi: rankedStat(nationalInfluence, input.ranks.npi),
    },
    favorability: rankedStat(favorability, input.ranks.favorability),
    infamy: character.infamy ?? 0,
    netWorth: input.netWorth > 0 ? rankedStat(input.netWorth, input.ranks.netWorth) : null,
    campaignFunds:
      input.campaignFunds > 0 ? rankedStat(input.campaignFunds, input.ranks.campaignFunds) : null,
    elections: countElections(character),
    bills: input.bills,
    social,
    achievements: { count: input.achievementsCount, highlights: input.achievementHighlights },
  };
}
