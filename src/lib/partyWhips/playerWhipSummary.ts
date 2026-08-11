import type { ObjectId } from "mongodb";
import type { BillWhip, PlayerWhipMode, WhipIssuerRole } from "@/lib/db/types";

export type PlayerWhipIssuerRole = WhipIssuerRole;

export interface PlayerWhipSummaryEntry {
  direction: string;
  attemptNumber: number;
  createdAt: Date;
  issuerRole: PlayerWhipIssuerRole;
  mode: PlayerWhipMode;
  candidacyId?: string;
}

interface PartyLeadershipIds {
  chairId?: ObjectId | null;
  viceChairId?: ObjectId | null;
}

function resolveIssuerRole(
  whip: Pick<BillWhip, "issuedByRole" | "issuedByCharacterId">,
  party: PartyLeadershipIds
): PlayerWhipIssuerRole {
  if (whip.issuedByRole) {
    return whip.issuedByRole;
  }
  if (whip.issuedByCharacterId && party.chairId?.equals(whip.issuedByCharacterId)) {
    return "chair";
  }
  if (whip.issuedByCharacterId && party.viceChairId?.equals(whip.issuedByCharacterId)) {
    return "viceChair";
  }
  return "admin";
}

export function summarizePlayerWhips(
  whips: BillWhip[],
  party: PartyLeadershipIds
): PlayerWhipSummaryEntry[] {
  return whips.map((whip) => ({
    direction: whip.direction,
    attemptNumber: whip.attemptNumber,
    createdAt: whip.createdAt,
    issuerRole: resolveIssuerRole(whip, party),
    mode: whip.mode ?? "hard",
    candidacyId: whip.candidacyId?.toString(),
  }));
}
