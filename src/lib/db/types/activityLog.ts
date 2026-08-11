import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";

// ─── Action types logged in turn summaries ────────────────────────────────────

export interface ActivityAction {
  type:
    | "fundraise"
    | "campaign"
    | "advertise"
    | "buildDonorBase"
    | "poll"
    | "pollLarge"
    | "convertCash"
    | "buyStock"
    | "sellStock";
  apCost: number;
  targetId?: ObjectId;
  targetName?: string;
  targetType?: "self" | "state" | "party" | "character" | "company" | "campaign";
  result?: {
    fundsChange?: number;
    influenceChange?: number;
    favorabilityChange?: number;
    infamyChange?: number;
  };
}

// ─── Activity log document variants ──────────────────────────────────────────

export interface ActivityLogTurnSummary {
  _id: ObjectId;
  type: "turn_summary";
  timestamp: Date;
  userId: ObjectId;
  characterId: ObjectId;
  characterName: string;
  username: string;
  countryId: CountryId;
  turnNumber: number;
  apSpent: number;
  apTotal: number;
  actions: ActivityAction[];
}

export interface ActivityLogFundEvent {
  _id: ObjectId;
  type: "fund_event";
  timestamp: Date;
  userId: ObjectId;
  characterId: ObjectId;
  characterName: string;
  username: string;
  countryId: CountryId;
  fundEventType:
    | "party_transfer"
    | "party_donation"
    | "campaign_donation"
    | "caucus_transfer"
    | "convertCash"
    | "grant";
  amount: number;
  /**
   * ISO 4217 code for the `amount` field — the actor's home currency (post-
   * cf-inconsistency-fix Phase 6 for treasury and Phase 5 for character
   * campaign balances). Omitted on pre-2026-05-18 rows, which are denominated
   * in anchor units (₳) and intentionally NOT backfilled: a blind backfill
   * from `countryId` would mis-label them. UI consumers fall back to ₳ when
   * this field is missing.
   */
  currencyCode?: CurrencyCode;
  fromId: ObjectId;
  fromName: string;
  fromType: "character" | "party" | "campaign" | "caucus";
  toId: ObjectId;
  toName: string;
  toType: "character" | "party" | "campaign" | "caucus";
}

export interface ActivityLogAuth {
  _id: ObjectId;
  type: "login" | "logout";
  timestamp: Date;
  userId: ObjectId;
  username: string;
  ipAddress?: string;
  userAgent?: string;
  fingerprint?: string;
  trackingId?: string;
}

export interface ActivityLogProfileEvent {
  _id: ObjectId;
  type:
    | "party_change"
    | "character_deleted"
    | "character_recreated"
    | "profile_update"
    | "discord_profile_update";
  timestamp: Date;
  userId: ObjectId;
  username: string;
  characterId?: ObjectId;
  characterName?: string;
  countryId?: CountryId;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface ActivityLogGameAction {
  _id: ObjectId;
  type: "game_action";
  timestamp: Date;
  userId: ObjectId;
  characterId: ObjectId;
  characterName?: string;
  username?: string;
  countryId?: CountryId;
  actionType: string;
  actionCost: number;
  turn: number;
  targetId?: ObjectId;
  targetName?: string;
  targetType?: "self" | "state" | "party" | "character" | "company" | "campaign";
  result: {
    success: boolean;
    fundsChange?: number;
    politicalInfluenceChange?: number;
    message: string;
  };
  summary: string;
  details?: Record<string, unknown>;
}

export type ActivityLog =
  | ActivityLogTurnSummary
  | ActivityLogFundEvent
  | ActivityLogAuth
  | ActivityLogProfileEvent
  | ActivityLogGameAction;

// ─── Suspicious characters ────────────────────────────────────────────────────

export interface SuspiciousFlag {
  type: string;
  severity: "low" | "medium" | "high";
  /** Human-readable summary, e.g. "Logged in from 6 IPs in 7 days" */
  detail: string;
  detectedAt: Date;
  evidence: Record<string, unknown>;
}

export interface SuppressedFlag {
  type: string;
  suppressedUntil: Date;
}

export interface SuspiciousCharacter {
  /** _id equals characterId for clean upsert keying */
  _id: ObjectId;
  characterId: ObjectId;
  characterName: string;
  userId: ObjectId;
  username: string;
  countryId: CountryId;
  flags: SuspiciousFlag[];
  flagCount: number;
  highestSeverity: "low" | "medium" | "high";
  lastUpdated: Date;
  dismissed: boolean;
  dismissedAt?: Date;
  dismissedByAdminId?: ObjectId;
  dismissNote?: string;
  /** Flags suppressed for 30 days after a dismiss action */
  suppressedFlags?: SuppressedFlag[];
  /**
   * Set when this record was moved to the resolved pool because the account was
   * banned (not by a moderator's permanent dismiss). Unbanning reverts only
   * these records to the active pool so future flags surface normally.
   */
  resolvedByBan?: boolean;
  /**
   * Pool membership. "active" = being actively monitored (default when flags
   * exist). "resolved" = permanently archived — the character is no longer
   * evaluated by the detection engine and is hidden from the main list but
   * still available via the "Resolved" filter.
   */
  pool: "active" | "resolved";
}
