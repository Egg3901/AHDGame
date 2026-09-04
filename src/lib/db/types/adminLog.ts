import type { ObjectId } from "mongodb";

export type AdminLogCategory = "account" | "election" | "system";

export type AdminLogAction =
  | "freight_settlement_activated"
  | "freight_settlement_shadowed"
  | "account_created"
  | "account_deleted_self"
  | "account_deleted_admin"
  | "account_banned"
  | "account_unbanned"
  | "password_reset"
  | "discord_reset"
  | "official_appointed"
  | "official_removed"
  | "game_reset"
  | "game_full_reset"
  | "demographics_updated"
  | "demographics_defaults_overwritten"
  | "party_org_updated"
  | "resources_granted"
  | "tax_rate_changed"
  | "funds_transferred"
  | "leadership_appointed"
  | "leadership_removed"
  | "leadership_election_cancelled"
  | "bill_force_signed"
  | "bill_force_vetoed"
  | "central_bank_chair_appointed"
  | "central_bank_chair_vacated"
  | "central_bank_chair_selection_triggered"
  | "central_bank_prime_rate_adjusted_admin"
  | "central_bank_chair_controls_locked"
  | "cb_fx_reserve_seed"
  // Legacy binary actions — kept for historical `adminLogs` docs written
  // before the tri-state maintenance mode (off/partial/full) shipped.
  | "maintenance_enabled"
  | "maintenance_disabled"
  // Tri-state actions, same "X_set"/"X_disabled" split as labour_system_*.
  | "maintenance_mode_set"
  | "maintenance_mode_disabled"
  | "poll_banner_set"
  | "poll_banner_disabled"
  | "test_mode_enabled"
  | "test_mode_disabled"
  | "admin_registration_enabled"
  | "admin_registration_disabled"
  | "first_joiner_party_chair_enabled"
  | "first_joiner_party_chair_disabled"
  | "patreon_status_set"
  | "moderator_assigned"
  | "moderator_removed"
  | "line_of_credit_enabled"
  | "line_of_credit_disabled"
  | "savings_rollout_widened"
  | "savings_rollout_narrowed"
  | "index_funds_enabled"
  | "index_funds_disabled"
  | "labour_system_set"
  | "labour_system_disabled"
  | "prospecting_enabled"
  | "prospecting_disabled"
  | "contract_issuance_enabled"
  | "contract_issuance_disabled"
  | "market_system_set"
  | "market_system_disabled"
  | "market_system_auto_reverted"
  | "minimum_wage_set"
  | "regional_conditions_overview_enabled"
  | "regional_conditions_overview_disabled"
  | "index_fund_active"
  | "index_fund_paused"
  | "index_fund_delisted"
  | "index_fund_capital_injected"
  | "index_fund_capital_injected_bulk"
  | "index_fund_deployable_cash_bulk"
  | "public_review_mode_enabled"
  | "public_review_mode_disabled"
  | "public_viewing_enabled"
  | "public_viewing_disabled"
  | "referral_contest_started"
  | "referral_contest_reset"
  | "registration_enabled"
  | "registration_disabled"
  | "ip_collision_check_enabled"
  | "ip_collision_check_disabled"
  | "turn_system_started"
  | "turn_system_stopped"
  | "turn_lock_reset"
  | "corporation_actions_paused"
  | "corporation_actions_resumed"
  | "ip_ban_added"
  | "ip_allowance_added"
  | "ip_rule_deleted"
  | "ip_rule_edited"
  | "ip_rule_allowed"
  | "ip_rule_revoked"
  | "cgnat_soft_allow"
  | "alt_scoring_config_updated";

export interface AdminLog {
  _id: ObjectId;
  category: AdminLogCategory;
  action: AdminLogAction;
  username: string;
  characterName?: string;
  adminUsername?: string;
  details?: string;
  createdAt: Date;
  /**
   * Reset-run outcome. Present only on `game_reset` / `game_full_reset` rows.
   *
   * The row is INSERTED at the START of a reset with `status: "running"` and
   * updated when the run ends. That ordering is the point: it used to be
   * written in finalize, so a reset that died in teardown left no trace at all
   * while leaving the world sealed and half-built.
   *
   * Structured rather than stuffed into `details` so it stays queryable.
   */
  resetRun?: {
    runId: string;
    status: "running" | "succeeded" | "partial" | "failed";
    preset: string;
    mode: string;
    phaseReached?: string;
    failures?: { phase: string; name: string; error: string }[];
    startedAt: Date;
    finishedAt?: Date;
    durationMs?: number;
    /** Last 200 log lines — the tail is what describes the failure. */
    logTail?: string[];
  };
}
