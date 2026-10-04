/**
 * Counts for the world crises board. Pure: no DB, no clock.
 *
 * The header and the per-tab "resolved" toggle used to count different sets
 * (every resolved crisis in the world vs. the current tab's crises), so the page
 * showed numbers like 653 and 8 side by side with the same "historical" label.
 * Both now come from here and are labelled by what they actually count.
 */
export type CrisisBoardScope = "global" | "country" | "region";

export interface CrisisBoardRow {
  status: string;
  scope: string;
  countryIds: readonly string[];
}

export interface CrisisBoardCounts {
  /** Active crises across every scope. */
  activeAllScopes: number;
  /** Resolved crises across every scope (the header figure). */
  resolvedAllScopes: number;
  /** Active crises the current tab can list. */
  activeInScope: number;
  /** Resolved crises the current tab can list (the toggle figure). */
  resolvedInScope: number;
}

/**
 * Whether a crisis is listable on a tab. National and regional tabs group by
 * registered country, so a crisis whose countries are all outside this world
 * never renders there and must not be counted there either.
 */
export function crisisListedInScope(
  crisis: CrisisBoardRow,
  scope: CrisisBoardScope,
  registered: readonly string[]
): boolean {
  if (crisis.scope !== scope) return false;
  if (scope === "global") return true;
  return crisis.countryIds.some((id) => registered.includes(id));
}

export function crisisBoardCounts(
  crises: readonly CrisisBoardRow[],
  scope: CrisisBoardScope | null,
  registered: readonly string[]
): CrisisBoardCounts {
  let activeAllScopes = 0;
  let resolvedAllScopes = 0;
  let activeInScope = 0;
  let resolvedInScope = 0;
  for (const c of crises) {
    const listed = scope != null && crisisListedInScope(c, scope, registered);
    if (c.status === "active") {
      activeAllScopes++;
      if (listed) activeInScope++;
    } else if (c.status === "resolved") {
      resolvedAllScopes++;
      if (listed) resolvedInScope++;
    }
  }
  return { activeAllScopes, resolvedAllScopes, activeInScope, resolvedInScope };
}
