/**
 * The Global Conflicts board's view type + its colour helpers.
 *
 * The static flashpoint dataset this file used to carry is gone: the board now
 * renders the live `conflicts` collection, mapped by `conflictView.ts`. `lean` and
 * `x`/`y` are nullable because a dynamic conflict may have no bloc backer and no map
 * anchor — neither of which the original static set could express.
 */

export type Severity = "CRITICAL" | "MAJOR" | "ACTIVE" | "WINDING DOWN";

export type Conflict = {
  id: string;
  /** Public number — the conflict's own page at /world/conflicts/<conflictId>. */
  conflictId: number;
  name: string;
  type: string;
  region: string;
  years: string;
  /** Map position as a percentage of the theater map (0–100); null = no anchor, no pin. */
  x: number | null;
  y: number | null;
  /** 0 = fully West-backed, 100 = fully East-backed; null = neither side is backed. */
  lean: number | null;
  west: string;
  east: string;
  sev: Severity;
  intensity: number;
  status: string;
  deaths: string;
  escalating: boolean;
};

/** Pin/lean color: West blue (≤42), contested gold (<55), East red. */
export function leanColor(l: number): string {
  return l <= 42 ? "#3b82f6" : l < 55 ? "#d4af37" : "#dc2626";
}

export function sevStyle(s: string): { c: string; bg: string; bd: string } {
  if (s === "CRITICAL") return { c: "#ff5a3c", bg: "rgba(255,90,60,.1)", bd: "rgba(255,90,60,.4)" };
  if (s === "MAJOR") return { c: "#ff9d6b", bg: "rgba(255,120,73,.1)", bd: "rgba(255,120,73,.35)" };
  if (s === "ACTIVE") return { c: "#eab308", bg: "rgba(234,179,8,.1)", bd: "rgba(234,179,8,.32)" };
  return { c: "#86d978", bg: "rgba(134,217,120,.08)", bd: "rgba(134,217,120,.3)" };
}
