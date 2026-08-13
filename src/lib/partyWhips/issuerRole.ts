import type { ObjectId } from "mongodb";
import type { BillWhip, WhipIssuerRole } from "@/lib/db/types";

export const WHIP_ISSUER_ROLE_LABELS: Record<WhipIssuerRole, string> = {
  chair: "Chair",
  viceChair: "Vice Chair",
  admin: "Admin",
  speaker: "Speaker",
  majorityLeader: "Majority Leader",
  minorityLeader: "Minority Leader",
  majorityWhip: "Majority Whip",
  minorityWhip: "Minority Whip",
};

export interface WhipLeadershipIds {
  chairId?: ObjectId | null;
  viceChairId?: ObjectId | null;
}

/** Stamp the issuer role when a whip is written. Chair/VC beat the admin override. */
export function inferWhipIssuerRole(
  isChair: boolean | null | undefined,
  isViceChair: boolean | null | undefined
): WhipIssuerRole {
  if (isChair) return "chair";
  if (isViceChair) return "viceChair";
  return "admin";
}

export function whipIssuerRoleLabel(
  role: WhipIssuerRole | string | null | undefined
): string | undefined {
  if (!role) return undefined;
  return WHIP_ISSUER_ROLE_LABELS[role as WhipIssuerRole];
}

export function resolveWhipIssuerRoleKey(
  whip: Pick<BillWhip, "issuedByRole" | "issuedByCharacterId">,
  leadership: WhipLeadershipIds
): WhipIssuerRole | undefined {
  if (whip.issuedByRole) return whip.issuedByRole;
  const issuerId = whip.issuedByCharacterId;
  if (!issuerId) return undefined;
  if (leadership.chairId?.equals(issuerId)) return "chair";
  if (leadership.viceChairId?.equals(issuerId)) return "viceChair";
  return undefined;
}

/**
 * Display label for a whip's issuer. Uses the stamped role when present,
 * otherwise infers Chair/Vice Chair from the leadership ids of the org that
 * issued the whip (national party, state party, or caucus). Does not invent
 * "Admin" for unmatched issuers — that label is reserved for stamped admin
 * overrides.
 */
export function resolveWhipIssuerRole(
  whip: Pick<BillWhip, "issuedByRole" | "issuedByCharacterId">,
  leadership: WhipLeadershipIds
): string | undefined {
  return whipIssuerRoleLabel(resolveWhipIssuerRoleKey(whip, leadership));
}
