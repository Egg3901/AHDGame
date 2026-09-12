import type { Db } from "mongodb";
import {
  HOUSE_SEATS,
  TOTAL_JP_SHUGIIN_SEATS,
  TOTAL_JP_SANGIIN_SEATS,
  TOTAL_DE_BUNDESTAG_SEATS,
} from "@/lib/constants";
import { getTotalUkCommonsSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import type { CountryId } from "@/lib/constants/countries";
import { ELECTION_TYPE_SHORT_LABEL, officeKeyForElectionType } from "@/lib/utils/electionLabels";
import {
  sendCountryGameEventMultiple,
  DISCORD_COLORS,
  type DiscordEmbed,
} from "@/lib/discordWebhooks";
import { generateParliamentChartSVG, getChamberComposition } from "@/lib/charts/parliamentChart";
import { generateDiscordEventCard } from "@/lib/discord/eventCard";

export type ElectionNewsOutcome = {
  electionType: string;
  state: string;
  countryId: string;
  winnerName: string;
  winnerParty: string;
  isPlayer: boolean;
};

/**
 * Send batched election results to Discord, grouped by election type.
 * National chamber results are rendered as one branded image card. Party
 * winners are summarized instead of posting a separate wall-of-text embed.
 */
export async function sendBatchedElectionResults(
  db: Db,
  outcomes: ElectionNewsOutcome[],
  now: Date
): Promise<void> {
  // Nothing to send (e.g. every resolved race was a walkover with no news
  // outcome) — bail before building an empty $or, which Mongo rejects.
  if (outcomes.length === 0) return;

  // Look up party names by sequentialId + countryId
  const uniquePartyKeys = new Set(outcomes.map((o) => `${o.countryId}:${o.winnerParty}`));
  const partyLookups = Array.from(uniquePartyKeys).map((key) => {
    const [countryId, sequentialId] = key.split(":");
    return { countryId, sequentialId: parseInt(sequentialId, 10) };
  });

  const parties = await db
    .collection<{ sequentialId: number; countryId: string; name: string }>("politicalParties")
    .find({
      $or: partyLookups.map((p) => ({
        countryId: p.countryId,
        sequentialId: p.sequentialId,
      })),
    })
    .toArray();

  const partyNameMap = new Map<string, string>();
  for (const p of parties) {
    partyNameMap.set(`${p.countryId}:${p.sequentialId}`, p.name);
  }

  // Helper to resolve party name
  const getPartyName = (countryId: string, partyId: string): string => {
    const key = `${countryId}:${partyId}`;
    return partyNameMap.get(key) ?? partyId;
  };

  // Group outcomes by countryId + election type. Grouping by electionType
  // alone let same-typed outcomes from different countries (resolved in the
  // same turn) merge into one embed routed to only the first country's
  // webhook — the other country's results silently posted into the wrong
  // channel. Space-separated since electionType itself contains underscores
  // (e.g. "snap_commons").
  const grouped = new Map<string, ElectionNewsOutcome[]>();
  for (const outcome of outcomes) {
    const key = `${outcome.countryId} ${outcome.electionType}`;
    const existing = grouped.get(key) ?? [];
    existing.push(outcome);
    grouped.set(key, existing);
  }

  // Seat totals for chart-eligible national chambers (no regionalCouncil or
  // landtag — sub-national, charted per Land would be noisy). snap_* variants
  // use the same chamber totals as their regular counterparts since a snap
  // election fills the same chamber. Commons is era-sized (625 in 1953).
  const ukCommonsTotal = getTotalUkCommonsSeats(await getGameStatePreset(db));
  const chartSeatTotals: Record<string, number> = {
    house: HOUSE_SEATS ? Object.values(HOUSE_SEATS).reduce((a, b) => a + b, 0) : 435,
    senate: 100,
    commons: ukCommonsTotal,
    snap_commons: ukCommonsTotal,
    shugiin: TOTAL_JP_SHUGIIN_SEATS,
    snap_shugiin: TOTAL_JP_SHUGIIN_SEATS,
    sangiin: TOTAL_JP_SANGIIN_SEATS,
    bundestag: TOTAL_DE_BUNDESTAG_SEATS,
    snap_bundestag: TOTAL_DE_BUNDESTAG_SEATS,
  };

  // Map election types to country IDs for chart queries
  const chartCountryMap: Record<string, string> = {
    house: "US",
    senate: "US",
    commons: "UK",
    snap_commons: "UK",
    shugiin: "JP",
    snap_shugiin: "JP",
    sangiin: "JP",
    bundestag: "DE",
    snap_bundestag: "DE",
  };

  for (const typeOutcomes of grouped.values()) {
    const electionType = typeOutcomes[0].electionType;
    const label = ELECTION_TYPE_SHORT_LABEL[electionType] ?? electionType;
    // Generate chart data for national chambers. The chart and result summary
    // are combined into one branded card instead of separate Discord embeds.
    let chartSvg: string | undefined;
    const chartTotal = chartSeatTotals[electionType];
    if (chartTotal) {
      const chartCountry = (chartCountryMap[electionType] ?? "US") as CountryId;
      const chartOfficeKey = officeKeyForElectionType(electionType, chartCountry);
      const composition = await getChamberComposition(db, chartOfficeKey, chartCountry);
      chartSvg = generateParliamentChartSVG(composition.seats, chartTotal, {
        width: 1000,
        showLabels: false,
      });
    }

    // Group outcomes by party
    const byParty = new Map<string, ElectionNewsOutcome[]>();
    for (const outcome of typeOutcomes) {
      const existing = byParty.get(outcome.winnerParty) ?? [];
      existing.push(outcome);
      byParty.set(outcome.winnerParty, existing);
    }

    // Sort parties by seat count (descending)
    const sortedParties = [...byParty.entries()].sort((a, b) => b[1].length - a[1].length);

    const partySummary = sortedParties.slice(0, 4).map(([partyId, partyOutcomes]) => {
      const countryId = partyOutcomes[0]?.countryId ?? "US";
      const playerSeats = partyOutcomes.filter((outcome) => outcome.isPlayer).length;
      const playerSuffix = playerSeats
        ? ` · ${playerSeats} player${playerSeats === 1 ? "" : "s"}`
        : "";
      return `${getPartyName(countryId, partyId)} · ${partyOutcomes.length} seat${partyOutcomes.length === 1 ? "" : "s"}${playerSuffix}`;
    });
    if (sortedParties.length > 4) {
      partySummary.push(`Plus ${sortedParties.length - 4} other parties`);
    }

    const countryId = typeOutcomes[0]?.countryId ?? "US";
    const cardUrl = await generateDiscordEventCard(
      {
        eyebrow: `${countryId} · Election night`,
        title: `${label} results`,
        summary: `${typeOutcomes.length} seat${typeOutcomes.length === 1 ? "" : "s"} decided`,
        detailLines: partySummary,
        tone: "election",
        chartSvg,
      },
      `election-${countryId.toLowerCase()}-${electionType}`
    );

    const embed: DiscordEmbed = {
      title: `Election results: ${label}`,
      description: cardUrl
        ? `${typeOutcomes.length} seat${typeOutcomes.length === 1 ? "" : "s"} decided.`
        : partySummary.join("\n"),
      color: DISCORD_COLORS.electionResult,
      image: cardUrl ? { url: cardUrl } : undefined,
      footer: {
        text: "A House Divided",
      },
      timestamp: now.toISOString(),
    };

    // Route to the country's webhook (falls back to the global game webhook).
    await sendCountryGameEventMultiple(countryId, [embed]);
  }
}
