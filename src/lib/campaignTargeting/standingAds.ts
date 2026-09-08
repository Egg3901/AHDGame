/**
 * Standing targeted ads follow a character into every candidacy. The read-side
 * overlay retains previously purchased candidate flights without database copies.
 * applyStandingAds only changes loaded documents, never persistent candidacies.
 */
import type { Character, ElectionCandidate } from "@/lib/db/types";
import { combinedAds } from "./rules";

export function applyStandingAds(
  candidates: ElectionCandidate[],
  characters: Map<string, Character>
): void {
  for (const candidate of candidates) {
    if (candidate.isNPP) continue;
    const ads = characters.get(candidate.characterId.toString())?.targetedAds;
    if (ads?.length) candidate.targetedAds = combinedAds(candidate.targetedAds, ads);
  }
}
