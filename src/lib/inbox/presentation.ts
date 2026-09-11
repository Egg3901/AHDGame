import type { NotificationType } from "@/lib/db/types/notifications";
import { ACTION_TYPES } from "./priority";

export type InboxUrgency = "urgent" | "decision" | "social" | "update";

/**
 * Short labels keep the rail scannable without throwing away the notification
 * title. The fallback is deliberately humanised so newly added notification
 * types still have a useful label before this table is updated.
 */
const TYPE_LABELS: Partial<Record<NotificationType, string>> = {
  crisis: "Crisis alert",
  player_attack: "Reputation attack",
  player_support: "Campaign support",
  treaty_defence_invoked: "Treaty called",
  bill_vote_open: "Vote open",
  party_whip_issued: "Whip issued",
  bill_passed_chamber: "Bill advanced",
  bill_failed_chamber: "Bill failed",
  bill_enrolled: "Bill enrolled",
  bill_signed: "Bill signed",
  bill_vetoed: "Bill vetoed",
  primary_win: "Primary result",
  primary_loss: "Primary result",
  general_win: "Election result",
  general_loss: "Election result",
  election_opened: "Election open",
  leadership_election_opened: "Leadership election",
  national_leadership_election_opened: "National election",
  committee_election_opened: "Committee election",
  caucus_chair_election_opened: "Caucus election",
  leadership_elected: "Leadership result",
  leadership_lost: "Leadership result",
  national_leadership_elected: "National result",
  national_leadership_lost: "National result",
  committee_elected: "Committee result",
  committee_lost: "Committee result",
  wire_received: "Wire received",
  corp_bond_due_soon: "Maturity warning",
  corp_credit_rating_change: "Credit update",
  corp_nationalization_risk: "Nationalization risk",
  corp_hostile_takeover_available: "Takeover opportunity",
  corp_privatization_offered: "Privatization offer",
  corp_vote_opened: "Corporate vote",
  corp_vote_reminder: "Vote reminder",
  rd_breakthrough: "R&D breakthrough",
  prospect_succeeded: "Survey result",
  prospect_failed: "Survey result",
  contract_offered: "Contract offer",
  defence_contract_offered: "Defence contract",
  union_leader_offer: "Union offer",
  bargaining_ratification_open: "Ratification vote",
  new_post: "Party activity",
  coalition_invite_received: "Coalition invite",
  coalition_join_request: "Coalition request",
  player_event: "Decision event",
  player_event_resolved: "Decision resolved",
  world_event_offered: "World event",
  world_event_resolved: "World event result",
  extraction_capacity_bound: "Capacity warning",
  corp_supply_agreement_damages: "Contract shortfall",
  bank_supervision_breach: "Banking breach",
  bank_supervision_cleared: "Banking cleared",
  welcome: "Welcome",
  system: "System update",
};

function humanizeType(type: NotificationType): string {
  return type
    .replace(/^(corp|national|caucus|committee)_/, "$1 ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function notificationLabel(type: NotificationType): string {
  return TYPE_LABELS[type] ?? humanizeType(type);
}

const URGENT_TYPES: ReadonlySet<NotificationType> = new Set([
  "crisis",
  "player_attack",
  "corp_nationalization_risk",
  "corp_hostile_takeover_available",
  "corp_nationalization_notice",
  "impeachment_convicted",
  "treaty_defence_invoked",
  "union_busting_attempted",
  "bargaining_dispute_lapsed",
  "overtime_ban_defunded",
  "bank_supervision_breach",
]);

const SOCIAL_TYPES: ReadonlySet<NotificationType> = new Set([
  "player_support",
  "new_post",
  "party_join_request",
  "party_join_accepted",
  "party_join_declined",
  "party_kicked",
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
]);

export function notificationUrgency(type: NotificationType, action: boolean): InboxUrgency {
  if (URGENT_TYPES.has(type)) return "urgent";
  if (SOCIAL_TYPES.has(type)) return "social";
  if (action || ACTION_TYPES.has(type)) return "decision";
  return "update";
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString();
  return null;
}

function addMeta(meta: [string, string][], label: string, value: unknown): void {
  const display = displayValue(value);
  if (!display || meta.some(([existing]) => existing === label)) return;
  meta.push([label, display]);
}

/**
 * Pull only player-readable context from free-form notification metadata.
 * Internal ids stay in the source link and never leak into the detail pane.
 */
export function notificationMeta(
  metadata: Record<string, unknown> | undefined,
  turn?: string
): [string, string][] | undefined {
  if (!metadata) return turn ? [["Turn", turn]] : undefined;

  const meta: [string, string][] = [];
  addMeta(meta, "From", metadata.senderName ?? metadata.attackerName);
  addMeta(meta, "Company", metadata.corporationName);
  addMeta(meta, "State", metadata.stateId);
  addMeta(meta, "Country", metadata.countryId);
  addMeta(meta, "Resource", metadata.resource ?? metadata.commodity);

  if (metadata.amount !== undefined && metadata.currency !== undefined) {
    const amount = displayValue(metadata.amount);
    const currency = displayValue(metadata.currency);
    if (amount && currency) addMeta(meta, "Amount", `${currency} ${amount}`);
  }

  if (metadata.priorRating !== undefined || metadata.newRating !== undefined) {
    const prior = displayValue(metadata.priorRating) ?? "n/a";
    const next = displayValue(metadata.newRating) ?? "n/a";
    addMeta(meta, "Rating", `${prior} → ${next}`);
  }

  if (metadata.turnsRemaining !== undefined) {
    const turns = displayValue(metadata.turnsRemaining);
    if (turns) addMeta(meta, "Time left", `${turns} turns`);
  }

  if (metadata.boostPercent !== undefined) {
    const boost = displayValue(metadata.boostPercent);
    if (boost) addMeta(meta, "Impact", `+${boost}%`);
  }

  addMeta(meta, "Position", metadata.position);
  addMeta(meta, "Chamber", metadata.chamber);
  addMeta(meta, "Turn", turn ?? metadata.turn);

  return meta.length > 0 ? meta.slice(0, 4) : undefined;
}
