/**
 * Pure, client-safe definitions for sector-wide taking scope. Kept free of any
 * server-only imports (e.g. mongodb) so client components — the bill proposal
 * editor — can import the labels without pulling Node modules into the browser
 * bundle. The engine in `nationalizeSectorWide.ts` re-exports these.
 */

/** Which pools a sector-wide taking sweeps. */
export type SectorScope = "all" | "corporations" | "unowned" | "npp_unowned";

/** Human-friendly labels for each sweep scope (SSOT for editor + bill view). */
export const SECTOR_SCOPE_LABELS: Record<SectorScope, string> = {
  all: "All holders + unowned market",
  corporations: "Corporations only",
  unowned: "Unowned market only",
  // #89: sweep NPP-run corporations and the unowned market, but leave
  // player-run (ceoType "character") corporations untouched.
  npp_unowned: "NPP-run corps + unowned market (keeps player corps)",
};
