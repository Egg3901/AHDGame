import type { ObjectId } from "mongodb";
import type { BillWhip, PlayerWhipMode, WhipIssuerRole } from "@/lib/db/types";
import { resolveWhipIssuerRoleKey } from "./issuerRole";

export type PlayerWhipIssuerRole = WhipIssuerRole;

export interface PlayerWhipSummaryEntry {
  direction: string;
  attemptNumber: number;
  createdAt: Date;
  issuerRole?: PlayerWhipIssuerRole;
  mode: PlayerWhipMode;
  candidacyId?: string;
}

interface PartyLeadershipIds {
  chairId?: ObjectId | null;
  viceChairId?: ObjectId | null;
}

export function summarizePlayerWhips(
  whips: BillWhip[],
  party: PartyLeadershipIds
): PlayerWhipSummaryEntry[] {
  return whips.map((whip) => ({
    direction: whip.direction,
    attemptNumber: whip.attemptNumber,
    createdAt: whip.createdAt,
    issuerRole: resolveWhipIssuerRoleKey(whip, party),
    mode: whip.mode ?? "hard",
    candidacyId: whip.candidacyId?.toString(),
  }));
}
