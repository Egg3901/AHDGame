import type { ObjectId } from "mongodb";

export const NOTIFICATION_TYPES = [
  "welcome",
  "primary_win",
  "primary_loss",
  "general_win",
  "general_loss",
  "impeachment_filed",
  "impeachment_convicted",
  "player_attack",
  "player_support",
  "system",
  "leadership_elected",
  "leadership_lost",
  "leadership_appointed",
  /** Named Commanding General of a military command by the defence seat. */
  "command_appointed",
  /** A mutual-defence treaty took this country into a war it did not declare. */
  "treaty_defence_invoked",
  "leadership_removed",
  "leadership_candidacy",
  "leadership_election_opened",
  "national_leadership_elected",
  "national_leadership_lost",
  "national_leadership_appointed",
  "national_leadership_removed",
  "national_leadership_candidacy",
  "national_leadership_election_opened",
  "committee_election_opened",
  "committee_elected",
  "committee_lost",
  "committee_removed",
  "committee_candidacy",
  "bill_vote_open",
  "bill_passed_chamber",
  "crisis",
  "bill_failed_chamber",
  "bill_enrolled",
  "bill_signed",
  "bill_vetoed",
  "feedback_status_changed",
  "new_feedback",
  "new_player_suggestion",
  "player_suggestion_status_changed",
  "player_suggestion_new_comment",
  "player_suggestion_merged",
  "new_post",
  "turn_advance",
  "resource_income",
  "election_opened",
  "ceo_vote_offer",
  "ceo_resigned",
  "ceo_elected",
  "corp_sector_sold",
  "corp_sector_attacked",
  "corp_nationalization_notice",
  "corp_nationalization_cancelled",
  "corp_nationalization_risk",
  "corp_privatization_offered",
  "corp_privatization_resolved",
  "corp_credit_rating_change",
  "corp_bond_due_soon",
  "corp_bond_repaid",
  "corp_bond_auto_refinanced",
  "corp_bond_auto_restructured",
  "corp_inactive_ceo_share_release_warning",
  "wire_received",
  "coalition_invite_received",
  "coalition_invite_accepted",
  "coalition_invite_declined",
  "coalition_join_request",
  "coalition_join_accepted",
  "coalition_join_declined",
  "coalition_kicked",
  "coalition_disband_vote_started",
  "coalition_disbanded",
  "coalition_chair_transferred",
  "share_listing_offer_received",
  "share_offer_accepted",
  "share_offer_expired",
  "corp_hostile_takeover_available",
  "party_whip_issued",
  "party_kicked",
  "party_join_request",
  "party_join_accepted",
  "party_join_declined",
  "caucus_chair_election_opened",
  "caucus_chair_elected",
  "caucus_chair_lost",
  "caucus_chair_removed",
  "rd_breakthrough",
  "wiki_submission_pending",
  "wiki_submission_approved",
  "wiki_submission_rejected",
  "supporter_request_pending",
  "supporter_request_approved",
  "supporter_request_rejected",
  "corp_vote_opened",
  "corp_vote_reminder",
  "corp_vote_passed",
  "corp_vote_failed",
  "corp_vote_cancelled",
  "charter_invited",
  "charter_replacement_needed",
  "charter_ratified",
  "share_invite_received",
  "share_invite_cancelled",
  "share_invite_declined",
  "share_invite_accepted",
  "player_event",
  "player_event_resolved",
  "extraction_capacity_bound",
  "union_leader_offer",
  /** An employer attempted to bust the union organizing one of its sectors. */
  "union_busting_attempted",
  /** A bargaining dispute ran its full course and lapsed unresolved. */
  "bargaining_dispute_lapsed",
  /** An overtime ban ended because the union treasury could not cover its upkeep. */
  "overtime_ban_defunded",
  /** Organizers are voting on a settlement the union president moved to accept. */
  "bargaining_ratification_open",
  /** A settlement ratification vote closed, whichever way it went. */
  "bargaining_ratification_closed",
  "world_event_offered",
  "world_event_resolved",
  // Resource prospecting + extraction contracts
  "prospect_succeeded",
  "prospect_failed",
  "contract_offered",
  "contract_royalty_missed",
  "contract_defaulted",
  "contract_expired",
  // Merger review (C3)
  "merger_review_opened",
  "merger_review_decided",
  "merger_remedy_overdue",
  "transfer_pricing_assessed",
  /** A supply agreement charged its supplier shortfall damages this turn. */
  "corp_supply_agreement_damages",
  "bank_supervision_breach",
  "bank_supervision_cleared",
  // Defence procurement: a government offering one of this corp's plants an order.
  "defence_contract_offered",
  "defence_contract_cancelled",
  // Ask (ask.lakesidegames.net): quality credits and watch alerts pushed by
  // the Ask service through /api/webhooks/ask-notification.
  "ask_refund",
  "ask_correction",
  "ask_watch",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  _id: ObjectId;
  userId: ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  metadata?: Record<string, unknown>;
  /** Set when the player archives a notification from the inbox. */
  archivedAt?: Date;
  /** Set when the player snoozes a single notification; hidden until this time. */
  snoozedUntil?: Date;
  createdAt: Date;
}

export interface NotificationSnoozedEntry {
  type: NotificationType;
  until: Date;
}

export interface NotificationPreferences {
  mutedTypes?: NotificationType[];
  snoozedTypes?: NotificationSnoozedEntry[];
}
