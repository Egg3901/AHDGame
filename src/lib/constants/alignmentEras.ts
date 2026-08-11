/**
 * Alignment pole configuration. A nation's alignment is a set of shares, one
 * per pole, plus a non-aligned remainder — never a single scalar. WHICH poles
 * exist depends on the live year, not just the era: the Non-Aligned Movement is
 * founded in 1961, so a 1953 world is bipolar and a 1979 world is not.
 *
 * Client-safe: no db imports.
 */
import type { CountryId } from "./countries";
import type { InternationalOrganizationId } from "./internationalOrganizations";

/**
 * The blocs a nation can be pushed TOWARD. Non-alignment is deliberately absent:
 * it is not a pole anyone pushes for, it is the remainder — whatever share of a
 * country neither bloc has managed to persuade. See {@link AlignmentShares}.
 */
export type AlignmentPoleId = "WEST" | "EAST" | "WASHINGTON" | "MOSCOW" | "BEIJING";

/**
 * Semantic design token a pole renders in. NOT a hex value — the app ships 11
 * themes and raw colours break every one of them (docs/DESIGN.md, hard rule 1).
 * The UI maps these to `text-*` / `bg-*` utilities.
 *
 * The blocs use maximally-distinct status hues so they stay separable in every
 * theme. `success` is reserved for the non-aligned remainder, which is not a
 * pole but is rendered alongside them.
 */
export type AlignmentPoleToken = "info" | "error" | "warning" | "success";

export interface AlignmentPole {
  id: AlignmentPoleId;
  label: string;
  shortLabel: string;
  /** Semantic token this pole renders in. See AlignmentPoleToken. */
  accentToken: AlignmentPoleToken;
  /** The country whose plays act for this pole when no channel org survives. */
  leaderCountryId?: CountryId;
}

export interface AlignmentChannel {
  organizationId: InternationalOrganizationId;
  poleId: AlignmentPoleId;
  /** 0–1. Scales every play committed through this org. */
  weight: number;
  /** When false, plays through this channel draw no rival counter-op. */
  /**
   * Whether alignment alone decides membership of this org — true for the blocs
   * a nation joins by picking a side (NATO, the Warsaw Pact, the Non-Aligned
   * Movement), so a non-player nation that clears the join share asks to join and
   * one that falls below the leave share walks out.
   *
   * FALSE (the default) for orgs whose membership answers to something other than
   * Cold War alignment: the Commonwealth is a former-empire association, and the
   * EU has its own accession criteria. Those still carry influence as channels —
   * a play through them still moves a nation's shares — but a Western nation does
   * not apply to the Commonwealth merely for being Western, and never leaves it
   * for ceasing to be.
   */
  alignmentAccession?: boolean;
}

export interface AlignmentEra {
  key: "cold-war" | "post-cold-war";
  fromYear: number;
  toYear: number | null;
  poles: AlignmentPoleId[];
  /**
   * Two-pole eras only: the pole counting POSITIVE on the derived -100..+100
   * axis. Explicit so the sign can never depend on `poles` ordering.
   */
  axisPositivePoleId?: AlignmentPoleId;
  channels: AlignmentChannel[];
  /** Applied once when a running game crosses INTO this era. */
  inherit: Partial<Record<AlignmentPoleId, AlignmentPoleId>>;
}

export const ALIGNMENT_POLES: Record<AlignmentPoleId, AlignmentPole> = {
  WEST: { id: "WEST", label: "West", shortLabel: "W", accentToken: "info", leaderCountryId: "US" },
  EAST: { id: "EAST", label: "East", shortLabel: "E", accentToken: "error", leaderCountryId: "RU" },
  WASHINGTON: {
    id: "WASHINGTON",
    label: "Washington",
    shortLabel: "WSH",
    accentToken: "info",
    leaderCountryId: "US",
  },
  MOSCOW: {
    id: "MOSCOW",
    label: "Moscow",
    shortLabel: "MOS",
    accentToken: "error",
    leaderCountryId: "RU",
  },
  BEIJING: {
    id: "BEIJING",
    label: "Beijing",
    shortLabel: "BEI",
    accentToken: "warning",
    leaderCountryId: "CN",
  },
};

/**
 * NOTE ON SYMMETRY: channels are what let a bloc push a nation, so their weights
 * per pole ARE the balance of the era. The Commonwealth deliberately carries no
 * channel — it is a former-empire association, not an instrument of the Cold War,
 * and stacking it behind NATO gave the West a permanent 1.75-to-1 advantage over
 * the Warsaw Pact that no play could answer.
 */
export const ALIGNMENT_ERAS: AlignmentEra[] = [
  {
    key: "cold-war",
    fromYear: 1945,
    toYear: 1990,
    poles: ["WEST", "EAST"],
    axisPositivePoleId: "WEST",
    channels: [
      {
        organizationId: "NATO",
        poleId: "WEST",
        weight: 1,
        alignmentAccession: true,
      },
      {
        organizationId: "WARSAW_PACT",
        poleId: "EAST",
        weight: 1,
        alignmentAccession: true,
      },
    ],
    inherit: {},
  },
  {
    key: "post-cold-war",
    fromYear: 1991,
    toYear: null,
    poles: ["WASHINGTON", "MOSCOW", "BEIJING"],
    // Four poles — no single axis to project onto.
    channels: [
      {
        organizationId: "NATO",
        poleId: "WASHINGTON",
        weight: 1,
        alignmentAccession: true,
      },
      { organizationId: "EU", poleId: "WASHINGTON", weight: 0.6 },
    ],
    // Moscow and Beijing have no surviving bloc org — the Warsaw Pact dissolves
    // in 1991 — so they act through their leader country instead.
    inherit: { WEST: "WASHINGTON", EAST: "MOSCOW" },
  },
];

/** Era-invariant gates. The join gate is NOT here — it scales with pole count. */
export const ALIGNMENT_GATES = { locked: 85, nonAligned: 20 } as const;

/**
 * Most total shift one nation can absorb in a single turn, in share points out
 * of 100. Overflow is discarded.
 *
 * Five points a turn means swinging a nation from contested to committed takes
 * the better part of ten turns of sustained effort even at full spend — an
 * alliance is won over months, not bought in an afternoon.
 */
export const PER_NATION_TURN_CAP = 5;

/**
 * The same ceiling for a nation with an open crisis. A flashpoint does not hand
 * anybody free ground — it only lifts the brake, so it pays off strictly in
 * proportion to what the blocs actually commit, and a crisis nobody acts on
 * changes nothing at all.
 */
export const CRISIS_TURN_CAP = 7.5;

/**
 * The join gate loosens as poles multiply: a four-way split cannot produce the
 * fifty-point lead a two-pole world can, so a fixed gate would make "Committed"
 * unreachable in the modern starts.
 */
const JOIN_GATE_BY_POLE_COUNT: Record<number, number> = { 2: 50, 3: 40, 4: 35 };

export function joinGateForPoleCount(poleCount: number): number {
  return JOIN_GATE_BY_POLE_COUNT[poleCount] ?? (poleCount < 2 ? 50 : 35);
}

/** The era row for a live game year. Years before the first row clamp to it. */
export function resolveAlignmentEra(year: number): AlignmentEra {
  for (const era of ALIGNMENT_ERAS) {
    if (year >= era.fromYear && (era.toYear == null || year <= era.toYear)) return era;
  }
  return ALIGNMENT_ERAS[0];
}

/**
 * The blocs that exist in a given year. Non-alignment is not among them — it is
 * the remainder left after these, so it needs no entry and no start year.
 */
export function polesForYear(year: number): AlignmentPoleId[] {
  return resolveAlignmentEra(year).poles;
}
