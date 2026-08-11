import type { Db } from "mongodb";
import {
  HOUSE_SEATS,
  TOTAL_UK_COMMONS_SEATS,
  TOTAL_JP_SHUGIIN_SEATS,
  TOTAL_JP_SANGIIN_SEATS,
  TOTAL_DE_BUNDESTAG_SEATS,
} from "@/lib/constants";
import type { CountryId } from "@/lib/constants/countries";
import { ELECTION_TYPE_SHORT_LABEL, officeKeyForElectionType } from "@/lib/utils/electionLabels";
import {
  sendCountryGameEventMultiple,
  DISCORD_COLORS,
  type DiscordEmbed,
} from "@/lib/discordWebhooks";
import { generateAndSaveChamberChart } from "@/lib/charts/parliamentChart";

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
 * Includes seating charts for House and Senate elections.
 * Results are organized by party in 2-column layout.
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
  // election fills the same chamber.
  const chartSeatTotals: Record<string, number> = {
    house: HOUSE_SEATS ? Object.values(HOUSE_SEATS).reduce((a, b) => a + b, 0) : 435,
    senate: 100,
    commons: TOTAL_UK_COMMONS_SEATS,
    snap_commons: TOTAL_UK_COMMONS_SEATS,
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
    const embeds: DiscordEmbed[] = [];

    // Generate chart for national chambers (first embed with just chart).
    // Chart queries electedOfficials by officeType — snap_* winners are stored
    // under the regular key, so normalize before querying.
    let chartUrl: string | null = null;
    const chartTotal = chartSeatTotals[electionType];
    if (chartTotal) {
      const chartCountry = (chartCountryMap[electionType] ?? "US") as CountryId;
      const chartOfficeKey = officeKeyForElectionType(electionType, chartCountry);
      chartUrl = await generateAndSaveChamberChart(db, chartOfficeKey, chartTotal, chartCountry);
    }

    // First embed: title and chart
    if (chartUrl) {
      embeds.push({
        title: `Election Results — ${label}`,
        color: DISCORD_COLORS.electionResult,
        image: { url: chartUrl },
        timestamp: now.toISOString(),
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

    // Build inline fields for party columns (2 per row)
    // Discord shows inline fields side-by-side, up to 3 per row
    const fields: { name: string; value: string; inline: boolean }[] = [];

    for (const [partyId, partyOutcomes] of sortedParties) {
      // Sort outcomes by state within each party
      const sorted = [...partyOutcomes].sort((a, b) => a.state.localeCompare(b.state));

      // Resolve party name from first outcome's countryId
      const countryId = partyOutcomes[0]?.countryId ?? "US";
      const partyName = getPartyName(countryId, partyId);

      // Format: "STATE — Winner Name" with star for players
      const lines = sorted.map((o) => {
        const playerMark = o.isPlayer ? " :star:" : "";
        return `${o.state} — ${o.winnerName}${playerMark}`;
      });

      // Discord field value max is 1024 chars
      let value = lines.join("\n");
      if (value.length > 1000) {
        const truncated = [];
        let len = 0;
        for (const line of lines) {
          if (len + line.length + 1 > 950) {
            truncated.push(`... +${lines.length - truncated.length} more`);
            break;
          }
          truncated.push(line);
          len += line.length + 1;
        }
        value = truncated.join("\n");
      }

      fields.push({
        name: `${partyName} (${partyOutcomes.length})`,
        value: value || "—",
        inline: true,
      });

      // Add empty spacer field after every 2 party fields to force 2-column layout
      // (Discord fills up to 3 inline fields per row; spacer prevents 3rd column)
      if (fields.length % 3 === 2) {
        fields.push({ name: "\u200B", value: "\u200B", inline: true });
      }
    }

    // Second embed: party columns
    embeds.push({
      title: chartUrl ? undefined : `Election Results — ${label}`,
      color: DISCORD_COLORS.electionResult,
      fields,
      footer: {
        text: `${typeOutcomes.length} seat${typeOutcomes.length === 1 ? "" : "s"} decided`,
      },
      timestamp: now.toISOString(),
    });

    // Route to the country's webhook (falls back to the global game webhook).
    const countryId = typeOutcomes[0]?.countryId ?? "US";
    await sendCountryGameEventMultiple(countryId, embeds);
  }
}
