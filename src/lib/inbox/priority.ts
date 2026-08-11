import type { NotificationType } from "@/lib/db/types/notifications";

// Types that mean "the player owes an input/decision this turn".
export const ACTION_TYPES: ReadonlySet<NotificationType> = new Set([
  "bill_vote_open",
  "party_whip_issued",
  "crisis",
  "player_event",
  "ceo_vote_offer",
  "corp_vote_opened",
  "corp_vote_reminder",
  "corp_privatization_offered",
  "corp_nationalization_risk",
  "corp_hostile_takeover_available",
  "coalition_invite_received",
  "coalition_join_request",
  "charter_invited",
  "charter_replacement_needed",
  "share_listing_offer_received",
  "share_invite_received",
  "election_opened",
  "leadership_election_opened",
  "national_leadership_election_opened",
  "committee_election_opened",
  "caucus_chair_election_opened",
]);

export function isActionRequiredType(type: NotificationType): boolean {
  return ACTION_TYPES.has(type);
}

export function isActionRequired(input: {
  kind: "notif" | "mail";
  unread: boolean;
  type?: NotificationType;
}): boolean {
  if (!input.unread) return false;
  if (input.kind === "mail") return true;
  return !!input.type && ACTION_TYPES.has(input.type);
}
