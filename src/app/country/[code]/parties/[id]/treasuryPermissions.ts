/**
 * National party treasury permission flags, derived from the viewer's
 * party roles. Single source of truth for what the Treasury tab shows
 * and lets each role edit — keep in sync with the API route guards
 * (`/treasury/*`, `/treasury-plan`, `/tax-rate`, `/ps-investment`,
 * `/gotv`, `/suppression`).
 */

export interface TreasuryRoleFlags {
  isAdmin: boolean;
  isChair: boolean;
  isViceChair: boolean;
  isTreasurer: boolean;
  /**
   * True when no Treasurer is currently seated. When vacant, the Chair /
   * Vice-Chair act as Treasurer (mirrors the API route guards) — most
   * importantly they can edit the Treasury Plan, which is otherwise
   * Treasurer-only and would be permanently locked.
   */
  isTreasurerSeatVacant: boolean;
}

export interface TreasuryPermissions {
  /** Coarse "manage treasury" — gates Send/Transfer + the manage card shell. */
  canManageTreasury: boolean;
  /**
   * Treasury Plan editable by treasurer + admin only. Visible to all
   * `canManageTreasury` — chair/VC see the plan card read-only.
   */
  canManageTreasuryPlan: boolean;
  /**
   * Tax slider — editable by chair/VC/admin only. Treasurer sees the
   * current value read-only.
   */
  canManageTax: boolean;
  /**
   * GOTV / Suppression / PS Investment budget blocks. The treasurer is
   * included — the matching API routes authorize them, and they need the
   * PS block's "Total this turn" readout to plan treasury spend.
   */
  canManageBudgets: boolean;
}

export function resolveTreasuryPermissions({
  isAdmin,
  isChair,
  isViceChair,
  isTreasurer,
  isTreasurerSeatVacant,
}: TreasuryRoleFlags): TreasuryPermissions {
  return {
    canManageTreasury: isAdmin || isChair || isViceChair || isTreasurer,
    canManageTreasuryPlan:
      isAdmin || isTreasurer || (isTreasurerSeatVacant && (isChair || isViceChair)),
    canManageTax: isAdmin || isChair || isViceChair,
    canManageBudgets: isAdmin || isChair || isViceChair || isTreasurer,
  };
}
