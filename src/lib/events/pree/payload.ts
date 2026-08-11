import type { ElectionCandidate } from "@/lib/db/types/election";
import type { Corporation } from "@/lib/db/types/corporation";
import type { EventOfferContext } from "@/lib/events/substrate/types";
import { seededRoll } from "@/lib/events/substrate/rng";

const STAFFER_NAMES = [
  "Jordan Reeves",
  "Casey Morgan",
  "Riley Shaw",
  "Avery Brooks",
  "Quinn Delgado",
];

const DONOR_LABELS = [
  "Meridian Development LLC",
  "Coastal PAC Holdings",
  "Summit Ridge Partners",
  "Northgate Industries",
];

export async function buildElectionPayload(ctx: EventOfferContext) {
  const candidacy = await ctx.db.collection<ElectionCandidate>("electionCandidates").findOne({
    characterId: ctx.character._id,
    status: "active",
  });
  if (!candidacy) {
    return {};
  }
  return {
    electionId: candidacy.electionId,
    candidateId: candidacy._id,
  };
}

export function pickStafferName(characterId: string, turn: number): string {
  const idx =
    seededRoll(characterId, turn, "pree.stafferScandal", "staffer") % STAFFER_NAMES.length;
  return STAFFER_NAMES[idx]!;
}

export function pickDonorLabel(characterId: string, turn: number): string {
  const idx = seededRoll(characterId, turn, "pree.corruptDonor", "donor") % DONOR_LABELS.length;
  return DONOR_LABELS[idx]!;
}

export function pickDonorAmountAnchor(characterId: string, turn: number): number {
  const roll = seededRoll(characterId, turn, "pree.corruptDonor", "amount");
  return 25_000 + (roll % 8) * 10_000;
}

export async function buildCeoCorpPayload(ctx: EventOfferContext) {
  const corp = await ctx.db.collection<Corporation>("corporations").findOne({
    ceoId: ctx.character._id,
  });
  if (!corp) {
    return {};
  }
  return {
    corporationId: corp._id,
    corpName: corp.name,
    memoSummary: "Allegations of accounting irregularities and retaliation against whistleblowers.",
  };
}
