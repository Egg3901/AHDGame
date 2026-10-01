/**
 * Server-side "how the chamber voted" chart SVG generator.
 * One stacked bar per chamber — ayes green, nays red, abstentions slate —
 * with a muted remainder for seats that never voted. Rendered into the chart
 * slot of Discord event cards (bill enacted/vetoed, confirmations, confidence
 * motions) for every country's legislature, national and regional.
 */
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { BillVoteSnapshot } from "@/lib/db/types/voteSnapshot";
import { bundledChartFontCss } from "@/lib/charts/chartFont";

export interface ChamberVoteSplit {
  /** Chamber display label, e.g. "House", "Senate", "Commons", "Landtag". */
  label: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  /**
   * Total chamber seats. When it exceeds the votes cast, the difference
   * renders as a muted "not voting" segment so the bar still reads as the
   * whole chamber.
   */
  seats?: number;
}

const COLORS = {
  for: "#4ade80",
  against: "#ef4444",
  abstain: "#94a3b8",
  idle: "#23233a",
  label: "#e2e8f0",
  muted: "#8b8b9e",
} as const;

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ENTITIES[character]);
}

/**
 * Render the vote-split chart. Returns "" when no chamber recorded a vote —
 * callers treat that as "no chart" rather than drawing an empty panel.
 */
export function generateVoteSplitChartSvg(
  chambers: readonly ChamberVoteSplit[],
  options: { width?: number; bgColor?: string } = {}
): string {
  const { width = 694, bgColor = "#111827" } = options;
  const rows = chambers.filter(
    (chamber) => chamber.votesFor + chamber.votesAgainst + chamber.votesAbstain > 0
  );
  if (rows.length === 0) return "";

  const padX = 26;
  const barWidth = width - padX * 2;
  const barHeight = 30;
  const rowAdvance = 96;
  const height = 22 + rows.length * rowAdvance - 30 + 10;

  const rowsSvg = rows
    .map((chamber, index) => {
      const headerY = 22 + index * rowAdvance + 14;
      const barY = headerY + 14;
      const cast = chamber.votesFor + chamber.votesAgainst + chamber.votesAbstain;
      const denominator = Math.max(chamber.seats ?? 0, cast);
      const notVoting = Math.max(0, denominator - cast);

      const tallyParts = [
        `<tspan fill="${COLORS.for}">${chamber.votesFor}</tspan><tspan> ${escapeXml(chamber.votesFor === 1 ? "aye" : "ayes")}</tspan>`,
        `<tspan> · </tspan><tspan fill="${COLORS.against}">${chamber.votesAgainst}</tspan><tspan> ${escapeXml(chamber.votesAgainst === 1 ? "nay" : "nays")}</tspan>`,
        `<tspan> · </tspan><tspan fill="${COLORS.abstain}">${chamber.votesAbstain}</tspan><tspan> abstain</tspan>`,
      ];
      if (notVoting > 0) {
        tallyParts.push(`<tspan fill="${COLORS.muted}"> · ${notVoting} not voting</tspan>`);
      }

      const segments: [number, string][] = [
        [chamber.votesFor, COLORS.for],
        [chamber.votesAgainst, COLORS.against],
        [chamber.votesAbstain, COLORS.abstain],
      ];
      let cursor = padX;
      const barsSvg = segments
        .map(([count, color]) => {
          const w = (count / denominator) * barWidth;
          const rect =
            w > 0
              ? `<rect x="${cursor}" y="${barY}" width="${w}" height="${barHeight}" fill="${color}"/>`
              : "";
          cursor += w;
          return rect;
        })
        .join("");

      const separator =
        index < rows.length - 1
          ? `<line x1="${padX}" y1="${barY + barHeight + 16}" x2="${width - padX}" y2="${barY + barHeight + 16}" stroke="#26263a"/>`
          : "";

      return `<text x="${padX}" y="${headerY}" class="chLabel">${escapeXml(chamber.label.toUpperCase())}</text>
    <text x="${width - padX}" y="${headerY}" text-anchor="end" class="tally" xml:space="preserve">${tallyParts.join("")}</text>
    <rect x="${padX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${barHeight / 2}" fill="${COLORS.idle}"/>
    <clipPath id="vsb${index}"><rect x="${padX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${barHeight / 2}"/></clipPath>
    <g clip-path="url(#vsb${index})">${barsSvg}</g>
    ${separator}`;
    })
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>
    ${bundledChartFontCss()}
    text { font-family: AHDGeist, Geist, "DejaVu Sans", sans-serif; }
    .chLabel { fill: ${COLORS.label}; font-size: 19px; font-weight: 800; letter-spacing: 1.6px; }
    .tally { fill: ${COLORS.muted}; font-size: 19px; font-weight: 600; }
  </style>
  <rect width="${width}" height="${height}" fill="${bgColor}"/>
  ${rowsSvg}
</svg>`;
}

type ChamberVoteMap = Record<string, "for" | "against" | "abstain">;

interface VoteTally {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
}

/** Fields the vote-split chart reads off a Bill / StateBill-shaped document. */
export interface BillVoteChartSource {
  originChamber?: string;
  currentChamber?: string;
  presidentAction?: "signed" | "vetoed" | "unsigned_law" | "override";
  voteSnapshot?: BillVoteSnapshot;
  otherChamberVoteSnapshot?: BillVoteSnapshot;
  overrideVoteSnapshot?: BillVoteSnapshot;
  overrideDisplaySnapshot?: {
    house: { for: number; against: number; seats: number };
    senate: { for: number; against: number; seats: number };
  };
  votes?: ChamberVoteMap;
  votesFor?: number;
  votesAgainst?: number;
  votesAbstain?: number;
  otherChamberVotes?: ChamberVoteMap;
  otherChamberVotesFor?: number;
  otherChamberVotesAgainst?: number;
  otherChamberVotesAbstain?: number;
}

function tallyFromMap(votes: ChamberVoteMap | undefined): VoteTally | undefined {
  if (!votes) return undefined;
  const tally = { votesFor: 0, votesAgainst: 0, votesAbstain: 0 };
  for (const vote of Object.values(votes)) {
    if (vote === "for") tally.votesFor++;
    else if (vote === "against") tally.votesAgainst++;
    else if (vote === "abstain") tally.votesAbstain++;
  }
  return tally;
}

/**
 * Prefer the frozen phase-close snapshot (immune to later re-scoping), then the
 * seat-weighted counters, then a raw count of the vote map.
 */
function resolveTally(
  snapshot: BillVoteSnapshot | undefined,
  counters: { for?: number; against?: number; abstain?: number },
  votes: ChamberVoteMap | undefined
): VoteTally | undefined {
  if (snapshot) {
    return {
      votesFor: snapshot.totals.for,
      votesAgainst: snapshot.totals.against,
      votesAbstain: snapshot.totals.abstain,
    };
  }
  const { for: vFor, against: vAgainst, abstain: vAbstain } = counters;
  if (vFor != null || vAgainst != null || vAbstain != null) {
    return { votesFor: vFor ?? 0, votesAgainst: vAgainst ?? 0, votesAbstain: vAbstain ?? 0 };
  }
  const fromMap = tallyFromMap(votes);
  if (!fromMap) return undefined;
  return fromMap;
}

function hasVotes(tally: VoteTally | undefined): tally is VoteTally {
  return Boolean(tally && tally.votesFor + tally.votesAgainst + tally.votesAbstain > 0);
}

/**
 * Map a resolved bill's stored tallies to per-chamber splits, labelled from the
 * country's legislature config so the same code serves every country channel
 * (House+Senate, Shūgiin+Sangiin, Commons, Bundestag, NPC, regional chambers).
 * Returns undefined when nothing was recorded — callers then omit the chart.
 */
export function billChamberVoteSplits(
  bill: BillVoteChartSource,
  countryId: string,
  scope: "national" | "regional"
): ChamberVoteSplit[] | undefined {
  // US veto-override enactments: the per-chamber override display is already
  // frozen on the bill (#0982) in the exact shape this chart needs.
  if (bill.presidentAction === "override" && bill.overrideDisplaySnapshot) {
    const { house, senate } = bill.overrideDisplaySnapshot;
    const splits: ChamberVoteSplit[] = [
      {
        label: "House",
        votesFor: house.for,
        votesAgainst: house.against,
        votesAbstain: 0,
        seats: house.seats,
      },
      {
        label: "Senate",
        votesFor: senate.for,
        votesAgainst: senate.against,
        votesAbstain: 0,
        seats: senate.seats,
      },
    ];
    return splits.some((split) => split.votesFor + split.votesAgainst > 0) ? splits : undefined;
  }

  const originTally = resolveTally(
    bill.voteSnapshot,
    { for: bill.votesFor, against: bill.votesAgainst, abstain: bill.votesAbstain },
    bill.votes
  );
  const otherTally = resolveTally(
    bill.otherChamberVoteSnapshot,
    {
      for: bill.otherChamberVotesFor,
      against: bill.otherChamberVotesAgainst,
      abstain: bill.otherChamberVotesAbstain,
    },
    bill.otherChamberVotes
  );
  if (!hasVotes(originTally) && !hasVotes(otherTally)) return undefined;

  const config = getCountryConfig(countryId as CountryId);
  const legislature = config?.legislature;

  if (scope === "regional" || !legislature) {
    const label = config?.subNationalChamber?.shortName ?? "Legislature";
    // Regional bills vote in a single chamber; both fields may exist on shared
    // documents but only `votes` is ever populated on a regional bill.
    const tally = hasVotes(originTally) ? originTally : otherTally;
    return tally ? [{ label, ...tally }] : undefined;
  }

  const chambers = [legislature.lowerChamber, legislature.upperChamber].filter(
    (chamber): chamber is NonNullable<typeof chamber> => Boolean(chamber)
  );
  const originKey = bill.originChamber;
  const otherKey =
    bill.currentChamber && bill.currentChamber !== originKey
      ? bill.currentChamber
      : chambers.find((chamber) => chamber.key !== originKey)?.key;

  const splits: ChamberVoteSplit[] = [];
  let originPlaced = false;
  for (const chamber of chambers) {
    let tally: VoteTally | undefined;
    if (chamber.key === originKey || (!originKey && !originPlaced)) {
      tally = originTally;
      originPlaced = true;
    } else if (chamber.key === otherKey) {
      tally = otherTally;
    }
    if (hasVotes(tally)) {
      splits.push({ label: chamber.shortName, seats: chamber.seats, ...tally });
    }
  }
  // Origin chamber key matched nothing configured ("joint", or a renamed
  // chamber) — still show the recorded tally under the legislature's name.
  if (!originPlaced && hasVotes(originTally)) {
    splits.push({ label: legislature.name, ...originTally });
  }
  return splits.length ? splits : undefined;
}
