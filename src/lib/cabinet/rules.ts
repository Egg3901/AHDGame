/**
 * Acting cabinet appointments carry full departmental authority: see actingScopeRefusal.
 * ACTING_TENURE_TURNS limits tenure to 24 turns, and ACTING_CHARGES_PER_SEAT
 * limits each President to one acting appointment per cabinet seat per presidency.
 */
export type CabinetLeverScope =
  "stance" | "personnel" | "doctrine" | "procurement" | "treasury" | "assets";

export type ActingScopeMember = { acting?: boolean } | null | undefined;

/** No departmental capability is restricted solely because the holder is acting. */
const BARRED_SCOPES: Partial<Record<CabinetLeverScope, string>> = {};

/** A missing flag denotes a confirmed holder, including legacy appointments. */
export function isActingMember(member: ActingScopeMember): boolean {
  return member?.acting === true;
}

export function isScopeBarredWhenActing(scope: CabinetLeverScope): boolean {
  return scope in BARRED_SCOPES;
}

export function barredScopeMessage(scope: CabinetLeverScope): string | null {
  return BARRED_SCOPES[scope] ?? null;
}

/** Holder authorization, costs and cooldowns are enforced separately by the shell. */
export function actingScopeRefusal(
  member: ActingScopeMember,
  scope: CabinetLeverScope
): string | null {
  if (!isActingMember(member)) return null;
  return barredScopeMessage(scope);
}

/** Shared by briefing responses and office controls. */
export function barredScopesFor(member: ActingScopeMember): CabinetLeverScope[] {
  if (!isActingMember(member)) return [];
  return Object.keys(BARRED_SCOPES) as CabinetLeverScope[];
}

export const ACTING_TENURE_TURNS = 24;

/** The charge ledger enforces this as the absence of a prior charge row. */
export const ACTING_CHARGES_PER_SEAT = 1;
