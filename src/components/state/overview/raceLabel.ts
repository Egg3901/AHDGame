/**
 * Shared race-label formatter for the State Overview Watchlist + Contested
 * Primaries cards. Keeps both surfaces consistent and avoids surfacing raw
 * seat ids like `"US-house-AZ"` when no meaningful district number is set.
 */

interface RaceLabelInput {
  electionType: string;
  /** Numeric district label only; missing for single-seat races. */
  district?: string;
  /** US senate-only class (1 / 2 / 3). */
  senateClass?: number;
}

export function raceLabel(race: RaceLabelInput): string {
  if (race.electionType === "house") {
    return race.district ? `House (${race.district})` : "House";
  }
  if (race.electionType === "senate") {
    return race.senateClass != null ? `Senate (Class ${toRoman(race.senateClass)})` : "Senate";
  }
  if (race.electionType === "presidential") return "Presidential";
  if (race.electionType === "governor") return "Governor";
  if (race.electionType === "stateSenate") {
    return race.district ? `State Senate (${race.district})` : "State Senate";
  }
  if (race.electionType === "stateExec") return "State Executive";
  if (race.electionType === "commons") return "Commons";
  if (race.electionType === "regionalCouncil") return "Regional Council";
  if (race.electionType === "shugiin") return "Shūgiin";
  if (race.electionType === "sangiin") return "Sangiin";
  if (race.electionType === "bundestag") return "Bundestag";
  if (race.electionType === "npcDelegate") return "NPC Delegate";
  if (race.electionType === "peoplesCongress") return "People's Congress";
  return race.district ? `${race.electionType} (${race.district})` : race.electionType;
}

function toRoman(n: number): string {
  if (n === 1) return "I";
  if (n === 2) return "II";
  if (n === 3) return "III";
  return String(n);
}
