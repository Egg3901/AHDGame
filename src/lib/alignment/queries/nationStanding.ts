/**
 * One nation's alignment standing, projected from its stored row.
 *
 * The Cold War Ledger and the Influence tab both answer "where does this nation
 * stand", and they must never answer it differently — a player sees the same
 * country on both screens. This is that single answer; each caller adds its own
 * context (org chips on the Ledger, prices on the Influence tab) around it.
 *
 * Pure: everything it needs arrives in the context, so it is cheap to test and
 * cannot acquire a database dependency by accident.
 */
import {
  ALIGNMENT_POLES,
  polesForYear,
  type AlignmentEra,
  type AlignmentPoleId,
  type AlignmentPoleToken,
} from "@/lib/constants/alignmentEras";
import { ROSTER_BY_KEY, type AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import { COUNTRY_CONFIGS, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import type { CountryAlignment } from "@/lib/db/types/countryAlignment";
import { roundToShareGrid, type AlignmentShares } from "../normalize";
import { axisFor, leadFor, statusFor, type AlignmentStatus } from "../project";

/** A pole as the UI names and colours it. */
export interface LedgerPole {
  id: AlignmentPoleId;
  label: string;
  shortLabel: string;
  accentToken: AlignmentPoleToken;
}

export interface NationStanding {
  entityId: AlignmentCountryKey;
  name: string;
  /** False for sphere-macro entities the game does not implement as playable. */
  isPlayable: boolean;
  shares: Partial<Record<AlignmentPoleId, number>>;
  nonAligned: number;
  /** Prior turn's shares, for per-pole trends. Null on seed and across a crossing. */
  previousShares: Partial<Record<AlignmentPoleId, number>> | null;
  /** Two-pole worlds only — the design's -100..+100 scalar. Null otherwise. */
  axis: number | null;
  lead: number;
  status: AlignmentStatus;
  topPoleId: AlignmentPoleId | null;
  /**
   * Change in LEAD since the previous turn — not in any single share, so it
   * means the same thing whether the world has two poles or four.
   */
  trend: number | null;
}

export interface NationStandingContext {
  era: AlignmentEra;
  poleIds: readonly AlignmentPoleId[];
  /** Poles this nation belongs to via org membership. Drives loyal-vs-eligible. */
  memberPoleIds: ReadonlySet<AlignmentPoleId>;
  /**
   * The world's reset preset, so a country reads by the name it had then:
   * "West Germany" and "Soviet Union" in the Cold War presets rather than
   * "Germany" and "Russia". Omitted, the base name is used.
   */
  preset?: string;
}

export function projectNationStanding(
  doc: CountryAlignment,
  ctx: NationStandingContext
): NationStanding | null {
  const entityId = doc.entityId;
  // Playable countries get their live config name; sphere-macro entities fall
  // back to the roster, which is where their display name lives.
  const config = COUNTRY_CONFIGS[entityId as CountryId];
  // Era-aware: DE is West Germany and RU is the Soviet Union in a Cold War
  // world, and the rest of the app already says so.
  const name = config
    ? getCountryDisplayName(entityId as CountryId, ctx.preset)
    : ROSTER_BY_KEY[entityId]?.name;
  if (!name) return null; // a row for an entity that is no longer modelled

  const current: AlignmentShares = { shares: doc.shares, nonAligned: doc.nonAligned };
  const lead = leadFor(current);

  // Provisional top pole first, so membership is judged against the pole the
  // country actually leads toward rather than any pole it happens to sit near.
  const provisionalTop = statusFor({
    shares: current,
    poleCount: ctx.poleIds.length,
    isPlayer: false,
    isMember: false,
  }).topPoleId;
  const isMember = provisionalTop != null && ctx.memberPoleIds.has(provisionalTop);
  const { status, topPoleId } = statusFor({
    shares: current,
    poleCount: ctx.poleIds.length,
    isPlayer: false,
    isMember,
  });

  return {
    entityId,
    name,
    isPlayable: config != null,
    shares: doc.shares,
    nonAligned: doc.nonAligned,
    previousShares: doc.previous?.shares ?? null,
    axis: axisFor(current, ctx.era),
    lead,
    status,
    topPoleId,
    trend: doc.previous
      ? roundToShareGrid(
          lead - leadFor({ shares: doc.previous.shares, nonAligned: doc.previous.nonAligned })
        )
      : null,
  };
}

/**
 * The era's display vocabulary: what its poles are called, and what the
 * leftover is called.
 *
 * Derived once because two screens show it. The Cold War Ledger and the
 * Influence tab both draw the same nation, and if they disagreed about whether
 * the remainder is "Non-aligned" or "Uncommitted" — or about a pole's colour —
 * the same country would read differently depending on which page you opened.
 */
export function eraPoleVocabulary(year: number): {
  poles: LedgerPole[];
  remainderLabel: string;
} {
  const poles = polesForYear(year).map((id) => {
    const pole = ALIGNMENT_POLES[id];
    return {
      id: pole.id,
      label: pole.label,
      shortLabel: pole.shortLabel,
      accentToken: pole.accentToken,
    };
  });
  // The remainder IS non-alignment once the movement exists; before 1961 it is
  // merely uncommitted, and calling it non-aligned would name a thing that has
  // not been founded.
  return { poles, remainderLabel: year >= 1961 ? "Non-aligned" : "Uncommitted" };
}
