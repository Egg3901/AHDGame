/**
 * View-model builder for the "Blend" election-detail display — the broadcast
 * chrome / editorial count treatment of a non-presidential race on
 * `/elections/[id]`.
 *
 * Pure function over the tally and candidate list the detail page already
 * loads. No DB, no React, no fetch, so the seat arithmetic and the generated
 * copy can be unit-tested against hand-rolled fixtures.
 *
 * Same discipline as the region cards: every figure resolves from live state,
 * and anything that cannot be sourced honestly (a quota for a method that has
 * none, a turnout with no electorate) is omitted rather than invented.
 */

import { getElectionMethod, isMultiSeatMethod } from "@/lib/elections/electionMethod";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";
import type { CountryId } from "@/lib/constants/countries";
import {
  describeElectorate,
  fmtShort,
  type RegionElectorate,
} from "@/lib/elections/blendRegionViewModel";

export interface BlendDetailFact {
  key: string;
  value: string;
  /** Denominator or qualifier shown under the value, e.g. "of est. 2.5M eligible". */
  sub?: string;
  /** Hex or CSS colour for the value. Omitted uses the default foreground. */
  color?: string;
}

export interface BlendSeatBlock {
  color: string;
  title: string;
}

export interface BlendSeatRow {
  id: string;
  cells: BlendSeatBlock[];
  /** Invisible spacers so every block is the same width across rows. */
  pad: number;
}

export interface BlendSeatRun {
  partyAbbr: string;
  color: string;
  seats: number;
  widthPct: number;
  /** Abbreviation plus count when the run is wide enough to letter, else the bare count. */
  label: string;
}

export interface BlendBenchSeat {
  xPct: number;
  yPct: number;
  size: number;
  color: string;
  opacity: number;
  title: string;
}

export interface BlendBench {
  gov: BlendBenchSeat[];
  opp: BlendBenchSeat[];
  govLabel: string;
  oppLabel: string;
  govCount: string;
  oppCount: string;
  majorityNote: string;
}

export interface BlendMathEntry {
  key: string;
  value: string;
  color?: string;
}

export interface BlendDetailTallyRow {
  candidateId: string;
  name: string;
  isYou: boolean;
  isNPP: boolean;
  partyAbbr: string;
  partyName: string;
  color: string;
  votes: number;
  votesStr: string;
  pct: number;
  pctStr: string;
  /** Seats won/projected. Null when the race awards no per-candidate seats. */
  seats: number | null;
  seatsCell: string;
  seatWord: string;
  isWinner: boolean;
  /** Plain-language account of how this candidate's seats were arrived at. */
  mathNote: string;
  math: BlendMathEntry[];
}

export interface BlendClockRow {
  label: string;
  value: string;
  color?: string;
}

export interface BlendDetailModel {
  phaseLabel: string;
  /** Reporting state for the chrome bar: "Counting", "Count closed", "Polls not open". */
  reporting: string;
  headline: string;
  standfirst: string;
  facts: BlendDetailFact[];

  /** True for a multi-seat race, where an allocation panel makes sense. */
  isSeatRace: boolean;
  allocLabel: string;
  hemiNote: string;
  blockRows: BlendSeatRow[];
  blockRuns: BlendSeatRun[];
  blocksSingleRow: boolean;
  blockNote: string;
  /** Block height in px, scaled down as the chamber grows. */
  blockHeight: number;

  /** Westminster opposing benches instead of blocks. */
  isBench: boolean;
  bench: BlendBench | null;

  tallyTitle: string;
  tallyMeta: string;
  rows: BlendDetailTallyRow[];
  showSeatCol: boolean;
}

export interface BlendDetailCandidate {
  id: string;
  characterName: string;
  party: string;
  partyName: string;
  partyColor: string;
  isYou: boolean;
  isNPP: boolean;
}

export interface BlendDetailInput {
  candidates: BlendDetailCandidate[];
  totalVotes: Record<string, number>;
  seatsEstimate: Record<string, number> | null;
  totalSeats: number | null;
  electionType: string;
  countryId: CountryId;
  isEnded: boolean;
  regionName: string;
  /** Party abbreviation lookup, same contract as the region cards. */
  partyAbbr: (partyId: string) => string;
  /**
   * Region electorate for the turnout fact, with the basis it was measured on.
   * Omitted drops the fact rather than dividing by a stand-in.
   */
  electorate?: RegionElectorate;
  /** Turn snapshot count, for the tally meta line. */
  turnCount?: number;
}

const GOLD = "var(--gold)";

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Whether this race allocates seats at all. The engine's type list wins
 * (RU/UKR/BLR/BAL soviets are "fptp" by config yet seat whole delegations);
 * the configured method decides the remaining single-type races.
 */
function isMultiSeat(input: BlendDetailInput): boolean {
  if (
    MULTI_SEAT_TYPES.has(input.electionType) ||
    (input.electionType === "senate" && (input.totalSeats ?? 1) > 1)
  ) {
    return true;
  }
  const method = getElectionMethod(input.countryId, input.electionType);
  if (!method) return (input.totalSeats ?? 1) > 1;
  return isMultiSeatMethod(method);
}

/**
 * Hare quota, but only where the game actually allocates on one. Printing a
 * quota against a Sainte-Lague or AMS race would be a fabrication.
 */
export function detailQuota(input: BlendDetailInput): number | null {
  if (getElectionMethod(input.countryId, input.electionType) !== "pr_hareQuota") return null;
  const seats = input.totalSeats ?? 0;
  // Same listed-field denominator as the shares, so the quota the panel quotes
  // is the one the seat arithmetic below actually divides by.
  const votes = input.candidates.reduce((a, c) => a + (input.totalVotes[c.id] ?? 0), 0);
  if (seats <= 0 || votes <= 0) return null;
  return Math.round(votes / seats);
}

interface Row {
  c: BlendDetailCandidate;
  votes: number;
  pct: number;
  seats: number;
}

function sortedRows(input: BlendDetailInput): Row[] {
  // Denominator over the listed field only. From the general phase on the page
  // shows one nominee per party while the tally still holds the primary-losers'
  // votes; summing every key would leave votes in the denominator that appear
  // against no row, and every share would under-report.
  const grand = input.candidates.reduce((a, c) => a + (input.totalVotes[c.id] ?? 0), 0);
  return input.candidates
    .map((c) => ({
      c,
      votes: input.totalVotes[c.id] ?? 0,
      pct: grand > 0 ? ((input.totalVotes[c.id] ?? 0) / grand) * 100 : 0,
      seats: input.seatsEstimate?.[c.id] ?? 0,
    }))
    .sort((a, b) => b.votes - a.votes || b.seats - a.seats);
}

/** Seats aggregated by party. A party abbreviation is only ever printed
 *  against a party total, never one candidate's seat count. */
function byParty(rows: Row[], abbr: (p: string) => string) {
  const acc = new Map<
    string,
    { party: string; abbr: string; color: string; seats: number; pct: number }
  >();
  for (const r of rows) {
    const key = r.c.party;
    const e = acc.get(key) ?? {
      party: key,
      abbr: abbr(key),
      color: r.c.partyColor,
      seats: 0,
      pct: 0,
    };
    e.seats += r.seats;
    e.pct += r.pct;
    acc.set(key, e);
  }
  return [...acc.values()].sort((a, b) => b.seats - a.seats || b.pct - a.pct);
}

/**
 * How many seats each candidate took on a whole quota versus on the largest
 * remainder. Only meaningful for a Hare-quota race; returns null otherwise, and
 * the math panel then simply omits the breakdown.
 */
function quotaSplit(rows: Row[], quota: number | null) {
  if (!quota || quota <= 0) return null;
  const out = new Map<string, { whole: number; remainderSeats: number; remainder: number }>();
  for (const r of rows) {
    const whole = Math.floor(r.votes / quota);
    out.set(r.c.id, {
      whole: Math.min(whole, r.seats),
      remainderSeats: Math.max(0, r.seats - Math.min(whole, r.seats)),
      remainder: r.votes - whole * quota,
    });
  }
  return out;
}

export function buildBlendDetail(input: BlendDetailInput): BlendDetailModel {
  const rows = sortedRows(input);
  const multiSeat = isMultiSeat(input);
  const totalSeats = input.totalSeats ?? 1;
  const grand = rows.reduce((a, r) => a + r.votes, 0);
  const quota = detailQuota(input);
  const split = quotaSplit(rows, quota);
  const agg = byParty(rows, input.partyAbbr);
  const lead = rows[0];
  const runnerUp = rows[1];
  const counted = grand > 0;

  const floorSeats = split ? [...split.values()].reduce((a, s) => a + s.whole, 0) : 0;
  const remSeats = split ? totalSeats - floorSeats : 0;

  // ── headline + standfirst
  const headline = !counted
    ? `No votes counted in ${input.regionName} yet`
    : multiSeat && agg[0]
      ? `${agg[0].abbr} ${input.isEnded ? "takes" : "on course for"} ${agg[0].seats} of ${totalSeats} seats`
      : `${lead?.c.characterName ?? "The field"} ${input.isEnded ? "wins" : "leads"} ${input.regionName}`;

  const standfirst = !counted
    ? "No ballots have been counted in this race."
    : multiSeat
      ? quota
        ? `${totalSeats} seats, apportioned by share. A Hare quota of ${fmtInt(quota)} votes buys one seat; ${remSeats} of the ${totalSeats} were settled on largest remainder.`
        : `${totalSeats} seats, apportioned by share of ${fmtInt(grand)} votes cast.`
      : `A single seat, decided on plurality. ${lead?.c.characterName ?? "The leader"} ${input.isEnded ? "took" : "holds"} ${lead ? lead.pct.toFixed(1) : "0.0"}% against ${runnerUp ? runnerUp.pct.toFixed(1) : "0.0"}% for the nearest rival.`;

  const facts: BlendDetailFact[] = [];
  if (input.electorate && input.electorate.count > 0 && counted) {
    facts.push({
      key: "Turnout",
      value: `${((grand / input.electorate.count) * 100).toFixed(1)}%`,
      sub: `of ${describeElectorate(input.electorate)}`,
    });
  }
  facts.push({ key: "Votes counted", value: fmtShort(grand) });
  if (multiSeat && quota) {
    facts.push({ key: "Quota", value: fmtShort(quota), color: GOLD });
  } else if (!multiSeat && counted) {
    facts.push({
      key: "Margin",
      value: `${Math.abs((lead?.pct ?? 0) - (runnerUp?.pct ?? 0)).toFixed(1)} pts`,
      color: GOLD,
    });
  }
  if (multiSeat && agg[0]) {
    facts.push({
      key: `${agg[0].abbr} seats`,
      value: `${agg[0].seats}/${totalSeats}`,
      color: agg[0].color,
    });
  } else if (lead && counted) {
    facts.push({
      key: input.isEnded ? "Elected" : "Leading",
      value: input.partyAbbr(lead.c.party),
      color: lead.c.partyColor,
    });
  }

  // ── seat allocation, grouped by party so the bar reads as contiguous blocs
  const allBlocks: BlendSeatBlock[] = [];
  let n = 1;
  for (const party of agg) {
    // Match on the party id, not its abbreviation: two parties can share an
    // abbreviation and would otherwise pool their blocks.
    for (const r of rows.filter((x) => x.c.party === party.party)) {
      for (let i = 0; i < r.seats; i++) {
        allBlocks.push({
          color: r.c.partyColor,
          title: `Seat ${n++} · ${input.partyAbbr(r.c.party)} · ${r.c.characterName}`,
        });
      }
    }
  }
  while (allBlocks.length < totalSeats) {
    allBlocks.push({ color: "var(--card-border)", title: `Seat ${n++} · unallocated` });
  }

  // Chunked into balanced rows of at most 25 so a large chamber stays countable.
  const rowCount = Math.max(1, Math.ceil(allBlocks.length / 25));
  const perRow = Math.ceil(allBlocks.length / rowCount);
  const blockRows: BlendSeatRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const cells = allBlocks.slice(i * perRow, (i + 1) * perRow);
    blockRows.push({ id: `r${i}`, cells, pad: perRow - cells.length });
  }

  const blockRuns: BlendSeatRun[] = agg
    .filter((a) => a.seats > 0)
    .map((a) => ({
      partyAbbr: a.abbr,
      color: a.color,
      seats: a.seats,
      widthPct: (a.seats / totalSeats) * 100,
      label: (a.seats / totalSeats) * 100 >= 9 ? `${a.abbr} ${a.seats}` : String(a.seats),
    }));
  const unallocated = totalSeats - blockRuns.reduce((s, r) => s + r.seats, 0);
  if (unallocated > 0) {
    blockRuns.push({
      partyAbbr: "",
      color: "var(--card-border)",
      seats: unallocated,
      widthPct: (unallocated / totalSeats) * 100,
      label: String(unallocated),
    });
  }

  const isBench = input.countryId === "UK";

  // ── per-candidate tally rows, with the arithmetic behind each seat count
  const tallyRows: BlendDetailTallyRow[] = rows.map((r) => {
    const s = split?.get(r.c.id);
    const math: BlendMathEntry[] = [{ key: "Votes", value: fmtInt(r.votes) }];
    if (quota) {
      math.push({ key: "Quota", value: fmtInt(quota), color: GOLD });
      if (s) {
        math.push({ key: "Whole quotas", value: String(s.whole) });
        math.push({ key: "Remainder", value: fmtInt(s.remainder) });
      }
    }
    if (multiSeat) math.push({ key: "Seats", value: String(r.seats) });

    const mathNote = !multiSeat
      ? `${fmtInt(r.votes)} votes, ${r.pct.toFixed(1)}% of the ${fmtInt(grand)} cast. A single seat goes to the plurality, so nothing is apportioned by share here.`
      : quota && s
        ? `${fmtInt(r.votes)} votes buys ${s.whole} whole ${s.whole === 1 ? "quota" : "quotas"} at ${fmtInt(quota)} each, leaving a remainder of ${fmtInt(s.remainder)}${s.remainderSeats > 0 ? `, which took ${s.remainderSeats} further ${s.remainderSeats === 1 ? "seat" : "seats"} on largest remainder` : ""}.`
        : `${fmtInt(r.votes)} votes, ${r.pct.toFixed(1)}% of the ${fmtInt(grand)} cast, for ${r.seats} of ${totalSeats} seats.`;

    const won =
      input.isEnded && (multiSeat ? r.seats > 0 : rows[0]?.c.id === r.c.id && r.votes > 0);

    return {
      candidateId: r.c.id,
      name: r.c.characterName,
      isYou: r.c.isYou,
      isNPP: r.c.isNPP,
      partyAbbr: input.partyAbbr(r.c.party),
      partyName: r.c.partyName,
      color: r.c.partyColor,
      votes: r.votes,
      votesStr: fmtInt(r.votes),
      pct: r.pct,
      pctStr: r.pct.toFixed(1),
      seats: multiSeat ? r.seats : null,
      seatsCell: multiSeat ? String(r.seats) : won ? "WON" : "—",
      seatWord: r.seats === 1 ? "Seat" : "Seats",
      isWinner: won,
      mathNote,
      math,
    };
  });

  return {
    phaseLabel: input.isEnded ? "Completed" : "General Phase",
    reporting: !counted ? "Polls not open" : input.isEnded ? "Count closed" : "Counting",
    headline,
    standfirst,
    facts,
    isSeatRace: multiSeat && counted,
    allocLabel: input.isEnded ? "Final seat allocation" : "Projected seat allocation",
    hemiNote: quota
      ? `${totalSeats} seats · ${floorSeats} on whole quotas, ${remSeats} on remainders`
      : `${totalSeats} seats apportioned by vote share`,
    blockRows,
    blockRuns,
    blocksSingleRow: totalSeats <= 25,
    blockNote:
      totalSeats <= 25
        ? "One block is one seat. Hover a block for who holds it."
        : `One block is one seat, in ${rowCount} rows of ${perRow}. Hover a block for who holds it.`,
    blockHeight: totalSeats <= 25 ? 44 : totalSeats <= 80 ? 26 : 18,
    isBench,
    bench: isBench ? buildBench(rows, totalSeats, agg, input) : null,
    tallyTitle: input.isEnded ? "Final results" : counted ? "Live vote tally" : "No votes cast yet",
    tallyMeta: `${fmtInt(grand)} votes cast${input.turnCount ? ` · ${input.turnCount} turn${input.turnCount === 1 ? "" : "s"}` : ""}`,
    rows: tallyRows,
    showSeatCol: multiSeat,
  };
}

/**
 * Westminster opposing benches: government and opposition face each other
 * across the floor, five benches deep. Parties sit in contiguous blocks,
 * largest first, and the column-major fill makes each block read as a vertical
 * slab rather than snaking across rows.
 */
function buildBench(
  rows: Row[],
  totalSeats: number,
  agg: ReturnType<typeof byParty>,
  input: BlendDetailInput
): BlendBench {
  const ROWS = 5;
  const seatList: (Row | null)[] = [];
  for (const r of rows) for (let i = 0; i < r.seats; i++) seatList.push(r);
  while (seatList.length < totalSeats) seatList.push(null);

  const govParty = agg[0]?.party;

  const blocks = (list: (Row | null)[]) => {
    const g = new Map<string, (Row | null)[]>();
    for (const s of list) {
      const k = s ? s.c.party : "__vacant";
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(s);
    }
    return [...g.entries()]
      .sort(
        (a, b) =>
          Number(a[0] === "__vacant") - Number(b[0] === "__vacant") || b[1].length - a[1].length
      )
      .flatMap(([, v]) => v);
  };

  const gov = blocks(seatList.filter((s) => s && s.c.party === govParty));
  const opp = blocks(seatList.filter((s) => !s || s.c.party !== govParty));
  const cols = Math.max(1, Math.ceil(gov.length / ROWS), Math.ceil(opp.length / ROWS));
  const size = Math.max(4, cols > 30 ? 6 : cols > 22 ? 7 : cols > 15 ? 9 : cols > 9 ? 11 : 13);

  const mk = (list: (Row | null)[], isGov: boolean): BlendBenchSeat[] =>
    list.map((s, i) => {
      const col = Math.floor(i / ROWS);
      const row = i % ROWS;
      return {
        xPct: Number((15 + (col / Math.max(1, cols - 1)) * 79).toFixed(2)),
        // Front bench nearest the floor; back benches step away.
        yPct: Number((isGov ? 40 - row * 7.4 : 58 + row * 7.4).toFixed(2)),
        size,
        color: s ? s.c.partyColor : "var(--card-border)",
        opacity: s ? 1 : 0.55,
        title: s
          ? `${s.c.characterName} · ${input.partyAbbr(s.c.party)}${row === 0 ? " · front bench" : ""}`
          : "Unallocated",
      };
    });

  const govSeats = agg[0]?.seats ?? 0;
  return {
    gov: mk(gov, true),
    opp: mk(opp, false),
    govLabel: `Government · ${agg[0]?.abbr ?? "—"}`,
    oppLabel: `Opposition · ${
      agg
        .slice(1)
        .filter((a) => a.seats > 0)
        .map((a) => a.abbr)
        .join(" · ") || "—"
    }`,
    govCount: String(gov.length),
    oppCount: String(opp.length),
    majorityNote:
      govSeats > totalSeats / 2
        ? `Majority of ${govSeats * 2 - totalSeats}`
        : `No overall majority, ${Math.ceil(totalSeats / 2 + 0.5) - govSeats} short`,
  };
}

/** The Clock card: the two deadlines that matter, plus turnout. */
export function buildBlendClock(opts: {
  primaryLabel: string;
  primaryValue: string;
  generalValue: string;
  isEnded: boolean;
  inPrimary: boolean;
  turnoutPct: number | null;
  ballots: number;
  electorate?: number;
}): BlendClockRow[] {
  const rows: BlendClockRow[] = [
    {
      label: opts.primaryLabel,
      value: opts.primaryValue,
      color: opts.inPrimary ? "var(--info)" : "var(--muted)",
    },
    {
      label: "General",
      value: opts.generalValue,
      color: opts.isEnded ? "var(--muted)" : "var(--warning)",
    },
  ];
  // Turnout only when there is a denominator to divide by.
  if (opts.turnoutPct !== null) {
    rows.push({ label: "Turnout", value: `${opts.turnoutPct.toFixed(1)}%` });
  }
  return rows;
}
