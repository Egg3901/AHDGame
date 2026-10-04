/**
 * Bulgaria's formed government may introduce a constitution draft regardless
 * of its expected vote. Adoption remains a separate 267-vote decision;
 * player deputies retain their votes and an existing draft is never replaced.
 */
import { bg1991InitiativeSupport } from "./constitutionalInitiative1991";

export function canBg1991NpcGovernmentIntroduce(input: {
  formed: boolean;
  playerPrimeMinister: boolean;
  npcPrimeMinister: boolean;
  leaderParty?: string;
  capacity: number;
  mandates: { actor: string; seats: number; human: boolean }[];
}): boolean {
  if (
    !input.formed ||
    input.playerPrimeMinister ||
    !input.npcPrimeMinister ||
    !input.leaderParty ||
    input.capacity !== 400 ||
    !input.mandates.some((row) => row.seats > 0)
  )
    return false;
  // Amended1971 Article143(1) permits government introduction. Its
  // Article143(3) threshold governs adoption, not executive sponsorship.
  // https://www.parliament.bg/bg/19
  try {
    bg1991InitiativeSupport(input.mandates, [], input.capacity);
    return true;
  } catch {
    return false;
  }
}
