/**
 * POST /api/admin/discord/test-election
 *
 * Sends a test election result embed to the appropriate game events webhook
 * using the most recent election data for the specified type.
 * Auth: requireAdminOrApiKey
 * Error codes: 400 (no webhook), 404 (no elections)
 */
import { NextResponse } from "next/server";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import {
  sendCountryGameEventMultiple,
  DISCORD_COLORS,
  type DiscordEmbed,
} from "@/lib/discordWebhooks";
import { getCountryWebhookDescriptors } from "@/lib/discord/countryWebhooks";
import { getDb } from "@/lib/mongodb";
import { generateAndSaveChamberChart } from "@/lib/charts/parliamentChart";
import { ELECTION_TYPE_SHORT_LABEL } from "@/lib/utils/electionLabels";
import {
  HOUSE_SEATS,
  TOTAL_UK_COMMONS_SEATS,
  TOTAL_JP_SHUGIIN_SEATS,
  TOTAL_JP_SANGIIN_SEATS,
  TOTAL_DE_BUNDESTAG_SEATS,
} from "@/lib/constants";
import { ZOD_COUNTRY_ENUM } from "@/lib/constants/countries";
import { z } from "zod";
import type {
  GameConfig,
  ElectionVoteTally,
  ElectionCandidate,
  Election,
  PoliticalParty,
} from "@/lib/db/types";
import { ObjectId } from "mongodb";

/**
 * `electionType` is intentionally an open string here rather than a hardcoded
 * enum: the authoritative, config-derived list lives in
 * `getBroadcastElectionTypes` and is checked against the resolved country
 * below. A fixed enum would reject newly-added election types (DE's landtag /
 * ministerPresident) and keep accepting retired ones.
 */
const schema = z.object({
  electionType: z.string().min(2),
  countryId: z.enum(ZOD_COUNTRY_ENUM).optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { electionType, countryId: requestCountryId } = parsed.data;
    const db = await getDb();

    // Resolve the country from the shared descriptors rather than a hardcoded
    // type->country table, so a newly-enabled country works with no code change.
    const descriptors = await getCountryWebhookDescriptors(db);

    let descriptor;
    if (requestCountryId) {
      descriptor = descriptors.find((d) => d.countryId === requestCountryId);
      if (!descriptor) {
        return NextResponse.json(
          { error: `Country ${requestCountryId} is not enabled for players` },
          { status: 400 }
        );
      }
    } else {
      // No country supplied — infer it from which countries broadcast this type.
      // Shared keys (regionalCouncil in UK and JP) are genuinely ambiguous, so
      // require the caller to disambiguate rather than guessing.
      const matches = descriptors.filter((d) => d.electionTypes.some((t) => t.id === electionType));
      if (matches.length === 0) {
        return NextResponse.json(
          { error: `No enabled country broadcasts election type "${electionType}"` },
          { status: 400 }
        );
      }
      if (matches.length > 1) {
        return NextResponse.json(
          {
            error: `Election type "${electionType}" is shared by ${matches
              .map((d) => d.countryId)
              .join(", ")} — specify countryId`,
          },
          { status: 400 }
        );
      }
      descriptor = matches[0];
    }

    const inferredCountryId = descriptor.countryId;

    if (!descriptor.electionTypes.some((t) => t.id === electionType)) {
      return NextResponse.json(
        { error: `${inferredCountryId} does not broadcast election type "${electionType}"` },
        { status: 400 }
      );
    }

    // Precondition only — fail fast with a clear 400 rather than building embeds
    // that would post nowhere. The actual URL is resolved inside
    // sendCountryGameEventMultiple, which also applies the enabled-country gate;
    // do NOT post directly from here or that gate is bypassed.
    const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
    const hasDestination = Boolean(descriptor.url || config?.discordGameWebhookUrl);
    if (!hasDestination) {
      return NextResponse.json(
        { error: `No ${inferredCountryId} game webhook URL configured` },
        { status: 400 }
      );
    }

    // Always scope by country. `Election.countryId` is a required field, and
    // shared election types (regionalCouncil in UK and JP) would otherwise
    // cross-contaminate.
    const electionQuery: Record<string, unknown> = {
      electionType,
      status: "resolved",
      countryId: inferredCountryId,
    };

    // Find most recent resolved elections of this type
    const recentElections = await db
      .collection<Election>("elections")
      .find(electionQuery)
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();

    if (recentElections.length === 0) {
      return NextResponse.json(
        { error: `No resolved ${electionType} elections found` },
        { status: 404 }
      );
    }

    // Get the finalized tallies for these elections
    const electionIds = recentElections.map((e) => e._id);
    const tallies = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds }, finalized: true })
      .toArray();

    const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));

    // Resolve party names from politicalParties collection (Bug 2 fix)
    const uniqueCountryIds = [...new Set(recentElections.map((e) => e.countryId ?? "US"))];
    const partyDocs = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: { $in: uniqueCountryIds } })
      .toArray();
    const partyNameMap = new Map<string, string>();
    for (const p of partyDocs) {
      partyNameMap.set(`${p.countryId}:${p.sequentialId}`, p.name);
    }
    const getPartyName = (cId: string, partyId: string): string => {
      return partyNameMap.get(`${cId}:${partyId}`) ?? partyId;
    };

    // Build outcomes from election results
    const outcomes: {
      electionType: string;
      state: string;
      countryId: string;
      winnerName: string;
      winnerParty: string;
      isPlayer: boolean;
    }[] = [];

    for (const election of recentElections) {
      const tally = tallyMap.get(election._id.toString());
      if (!tally) continue;

      const candidateIds = Object.keys(tally.totalVotes);
      if (candidateIds.length === 0) continue;

      const ranked = candidateIds
        .map((id) => ({ id, votes: tally.totalVotes[id] ?? 0 }))
        .sort((a, b) => b.votes - a.votes);

      const winnerId = ranked[0]?.id;
      if (!winnerId) continue;

      const winner = await db
        .collection<ElectionCandidate>("electionCandidates")
        .findOne({ _id: new ObjectId(winnerId) });

      if (winner) {
        const elCountryId = election.countryId ?? "US";
        outcomes.push({
          electionType: election.electionType,
          state: election.state,
          countryId: elCountryId,
          winnerName: winner.characterName,
          winnerParty: getPartyName(elCountryId, winner.party ?? "independent"),
          isPlayer: !winner.isNPP,
        });
      }

      if (outcomes.length >= 20) break;
    }

    if (outcomes.length === 0) {
      return NextResponse.json(
        { error: `No election results found for ${electionType}` },
        { status: 404 }
      );
    }

    // Build the Discord embeds
    const label = ELECTION_TYPE_SHORT_LABEL[electionType] ?? electionType;
    const embeds: DiscordEmbed[] = [];
    const now = new Date();

    // Chart generation for national chambers only (no regionalCouncil)
    const chartSeatTotals: Record<string, number> = {
      house: HOUSE_SEATS ? Object.values(HOUSE_SEATS).reduce((a, b) => a + b, 0) : 435,
      senate: 100,
      commons: TOTAL_UK_COMMONS_SEATS,
      shugiin: TOTAL_JP_SHUGIIN_SEATS,
      sangiin: TOTAL_JP_SANGIIN_SEATS,
      bundestag: TOTAL_DE_BUNDESTAG_SEATS,
    };
    const chartCountryMap: Record<string, string> = {
      house: "US",
      senate: "US",
      commons: "UK",
      shugiin: "JP",
      sangiin: "JP",
      bundestag: "DE",
    };

    let chartUrl: string | null = null;
    const chartTotal = chartSeatTotals[electionType];
    if (chartTotal) {
      const chartCountry = chartCountryMap[electionType] ?? "US";
      chartUrl = await generateAndSaveChamberChart(db, electionType, chartTotal, chartCountry);
    }

    // First embed: title and chart
    if (chartUrl) {
      embeds.push({
        title: `[TEST] Election Results — ${label}`,
        color: DISCORD_COLORS.electionResult,
        image: { url: chartUrl },
        timestamp: now.toISOString(),
      });
    }

    // Group outcomes by party
    const byParty = new Map<string, typeof outcomes>();
    for (const outcome of outcomes) {
      const existing = byParty.get(outcome.winnerParty) ?? [];
      existing.push(outcome);
      byParty.set(outcome.winnerParty, existing);
    }

    const sortedParties = [...byParty.entries()].sort((a, b) => b[1].length - a[1].length);

    const fields: { name: string; value: string; inline: boolean }[] = [];

    for (const [partyName, partyOutcomes] of sortedParties) {
      const sorted = [...partyOutcomes].sort((a, b) => a.state.localeCompare(b.state));
      const lines = sorted.map((o) => {
        const playerMark = o.isPlayer ? " :star:" : "";
        return `${o.state} — ${o.winnerName}${playerMark}`;
      });

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

      if (fields.length % 3 === 2) {
        fields.push({ name: "\u200B", value: "\u200B", inline: true });
      }
    }

    // Second embed: party columns
    embeds.push({
      title: chartUrl ? undefined : `[TEST] Election Results — ${label}`,
      description: "_This is a test using recent election data._",
      color: DISCORD_COLORS.electionResult,
      fields,
      footer: {
        text: `${outcomes.length} result${outcomes.length === 1 ? "" : "s"} shown (test)`,
      },
      timestamp: now.toISOString(),
    });

    // Route to the country's webhook (falls back to the global game webhook).
    await sendCountryGameEventMultiple(inferredCountryId, embeds);

    return NextResponse.json({
      success: true,
      resultsShown: outcomes.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
