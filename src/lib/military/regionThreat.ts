import type { ThreatLevel, RegionCode } from "./types";
import { STRATEGIC_REGIONS } from "./regions";
import { blocOf, type BlocLookup } from "./bloc";
import { regionNeighbors } from "./regionTopology";

export type { ThreatLevel };

const WINDOW = 24; // turns a battle stays relevant (linear decay to zero)
const DECL_HEAT = 25;
const BATTLE_HEAT = 35;
const NO_CONTACT_MULT = 0.4;
const MASS_HEAT = 12;
const MASS_BOTH_BLOCS = 6;
const SPILL = 0.35; // fraction of a region's heat that bleeds into each neighbour
const PROX_HOME = 1.4; // conflict in the viewer's home region
const PROX_ADJ = 1.2; // conflict in a region bordering the viewer's home

export interface ThreatInput {
  viewerCountry: string;
  /**
   * The era's bloc roll (`loadMilitaryBlocs`), passed in so this stays pure. It used to
   * be a global read against a static table that answered "west" for every country it
   * did not list, which weighted an eastern nation's activity as the viewer's own.
   */
  blocs: BlocLookup;
  /** The viewer's home strategic region — conflict near it reads hotter. */
  viewerHomeRegion?: RegionCode;
  currentTurn: number;
  /**
   * Which strategic region each live conflict sits in (conflictId → region). The
   * seam that makes a region conflict-capable: a conflict contributes heat to the
   * region named here. Built by the caller from the active conflicts (conflict.region).
   */
  theaterRegion: Record<string, string>;
  declarations: { declarerCountry: string; targetCountry: string; theaterId: string }[];
  reports: {
    declarerCountry: string;
    targetCountry: string;
    /** Every belligerent, when the report carries them. Falls back to the scalars. */
    attackers?: string[];
    defenders?: string[];
    theaterId: string;
    turn: number;
    noContact?: boolean;
  }[];
  committedByCountry: { country: string; committed: Record<string, number> }[];
}

/**
 * Viewer-relative weight: attacking you ≫ enemy-bloc activity > your own bloc.
 *
 * `defenders` matters because a coalition battle names one principal target but can
 * be fought by several nations. An ally that auto-defended is being attacked just as
 * much as the country that was named, and its own threat board must say so.
 */
function involvement(
  blocs: BlocLookup,
  declarer: string,
  target: string,
  viewer: string,
  defenders?: string[]
): number {
  if (target === viewer || defenders?.includes(viewer)) return 2.5;
  const vb = blocOf(blocs, viewer);
  // A non-aligned viewer has no bloc to discount toward: nobody's war is "our" war, so
  // every belligerent reads as foreign rather than sharing the viewer's uncommitted
  // status. Without this a neutral would rate a NATO-vs-Pact clash as domestic news.
  if (vb === "nonAligned") return 1.6;
  if (blocOf(blocs, declarer) !== vb || blocOf(blocs, target) !== vb) return 1.6;
  return 1.0;
}

const LEVELS: ThreatLevel[] = ["Low", "Medium", "Rising", "High", "Severe"];

function band(heat: number): ThreatLevel {
  if (heat >= 75) return "Severe";
  if (heat >= 55) return "High";
  if (heat >= 35) return "Rising";
  if (heat >= 15) return "Medium";
  return "Low";
}

/** The higher of two threat levels. */
function atLeast(level: ThreatLevel, floor: ThreatLevel): ThreatLevel {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(floor) ? level : floor;
}

/**
 * The threat level for every strategic region, from the viewer's perspective —
 * purely conflict-driven (pending offensives + recent battles decaying over
 * WINDOW turns + massed forces), weighted by the viewer's bloc. Regions with no
 * live conflict, or no activity, are Low. Pure + deterministic.
 */
export function computeRegionThreats(input: ThreatInput): Record<string, ThreatLevel> {
  const heat: Record<string, number> = {};
  // Regions with an active offensive or a battle in the window — a live conflict,
  // which floors the region to at least Medium regardless of the weighted heat.
  const conflict = new Set<string>();
  const add = (regionId: string | undefined, v: number) => {
    if (!regionId) return;
    heat[regionId] = (heat[regionId] ?? 0) + v;
  };

  for (const d of input.declarations) {
    const rid = input.theaterRegion[d.theaterId];
    if (rid) conflict.add(rid);
    add(
      rid,
      DECL_HEAT * involvement(input.blocs, d.declarerCountry, d.targetCountry, input.viewerCountry)
    );
  }

  for (const r of input.reports) {
    const recency = Math.max(0, 1 - (input.currentTurn - r.turn) / WINDOW);
    if (recency <= 0) continue;
    const rid = input.theaterRegion[r.theaterId];
    if (rid && !r.noContact) conflict.add(rid); // real fighting; a fizzle is not a live conflict
    const base = BATTLE_HEAT * (r.noContact ? NO_CONTACT_MULT : 1) * recency;
    add(
      rid,
      base *
        involvement(
          input.blocs,
          r.declarerCountry,
          r.targetCountry,
          input.viewerCountry,
          r.defenders
        )
    );
  }

  // Massed forces = tension before shots. Weight up when the enemy bloc is present.
  const vb = blocOf(input.blocs, input.viewerCountry);
  const mass: Record<string, { west: boolean; east: boolean }> = {};
  for (const cs of input.committedByCountry) {
    for (const [tid, amt] of Object.entries(cs.committed)) {
      if (amt <= 0) continue;
      const m = (mass[tid] ??= { west: false, east: false });
      // Non-aligned forces set NEITHER flag. This was an `else`, so every country the
      // old table omitted — and every genuine neutral — was counted as an eastern
      // build-up, which is how a Swedish or Yugoslav deployment raised NATO's threat
      // board. A neutral massing is not an enemy massing.
      const bloc = blocOf(input.blocs, cs.country);
      if (bloc === "west") m.west = true;
      else if (bloc === "east") m.east = true;
    }
  }
  for (const [tid, m] of Object.entries(mass)) {
    // "Enemy" is any bloc that is not the viewer's. This was `vb === "west" ? m.east :
    // m.west`, a binary that put a non-aligned viewer in the else branch — so a neutral
    // read a WESTERN build-up as hostile and an eastern one as harmless, arbitrarily.
    // For a non-aligned viewer both are foreign, which is the whole point of neutrality.
    const enemyMassed = vb === "west" ? m.east : vb === "east" ? m.west : m.west || m.east;
    let v = MASS_HEAT * (enemyMassed ? 1.6 : 1.0);
    if (m.west && m.east) v += MASS_BOTH_BLOCS;
    add(input.theaterRegion[tid], v);
  }

  // Home proximity: scale a region's own conflict heat up when it's near the viewer.
  const home = input.viewerHomeRegion;
  if (home) {
    const adj = new Set(regionNeighbors(home));
    for (const rid of Object.keys(heat)) {
      const m = rid === home ? PROX_HOME : adj.has(rid as RegionCode) ? PROX_ADJ : 1;
      if (m !== 1) heat[rid] *= m;
    }
  }

  // Border spillover: a fraction of each region's heat bleeds into its neighbours,
  // one hop, from the pre-spillover snapshot so it doesn't cascade. Spillover heat
  // does NOT mark a region as having a live conflict (no Medium floor from it).
  const direct = { ...heat };
  for (const reg of STRATEGIC_REGIONS) {
    for (const nb of regionNeighbors(reg.id)) {
      if (direct[nb]) heat[reg.id] = (heat[reg.id] ?? 0) + SPILL * direct[nb];
    }
  }

  const out: Record<string, ThreatLevel> = {};
  for (const reg of STRATEGIC_REGIONS) {
    const level = band(heat[reg.id] ?? 0);
    out[reg.id] = conflict.has(reg.id) ? atLeast(level, "Medium") : level;
  }
  return out;
}
