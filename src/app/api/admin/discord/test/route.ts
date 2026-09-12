import { NextResponse } from "next/server";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import {
  sendCountryGameEventMultiple,
  sendDiscordWebhook,
  DISCORD_COLORS,
  type DiscordEmbed,
} from "@/lib/discordWebhooks";
import { getCountryWebhookDescriptors } from "@/lib/discord/countryWebhooks";
import { getDb } from "@/lib/mongodb";
import { z } from "zod";
import type { Character, GameConfig, NPP } from "@/lib/db/types";

/**
 * Either a general integration webhook, or any player-enabled country's game
 * webhook. Countries are not enumerated here — they come from the shared
 * descriptor, so a newly-enabled country is testable with no code change.
 */
const schema = z.union([
  z.object({ countryId: z.string().min(2), showcase: z.literal(true) }),
  z.object({ target: z.enum(["game", "news", "suggestions"]) }),
  z.object({ countryId: z.string().min(2) }),
]);

function showcaseEmbeds(avatarUrl?: string): DiscordEmbed[] {
  const portrait = avatarUrl ? { thumbnail: { url: avatarUrl } } : {};
  return [
    {
      title: "[TEST PREVIEW] Presidential Winner",
      description: "**Eleanor Hart** has won the presidency with 312 electoral votes.",
      color: DISCORD_COLORS.electionResult,
      fields: [{ name: "Result", value: "312 EV · 51.8% popular vote" }],
      ...portrait,
    },
    {
      title: "[TEST PREVIEW] Prime Minister Appointed",
      description: "**Eleanor Hart** has been appointed Prime Minister.",
      color: DISCORD_COLORS.govFormed,
      ...portrait,
    },
    {
      title: "[TEST PREVIEW] Prime Minister Resigned",
      description: "**Eleanor Hart** has resigned as Prime Minister.",
      color: DISCORD_COLORS.govCollapsed,
      ...portrait,
    },
    {
      title: "[TEST PREVIEW] Central Bank Appointment",
      description: "**Eleanor Hart** has been confirmed as central bank chair.",
      color: DISCORD_COLORS.leadership,
      ...portrait,
    },
    {
      title: "[TEST PREVIEW] Central Bank Resignation",
      description: "**Eleanor Hart** has resigned as central bank chair.",
      color: DISCORD_COLORS.govCollapsed,
      ...portrait,
    },
    {
      title: "[TEST PREVIEW] Supreme Court Nomination",
      description: "**Eleanor Hart** has been nominated to the Supreme Court.",
      color: DISCORD_COLORS.scotusRuling,
      fields: [{ name: "Status", value: "Awaiting confirmation" }],
      ...portrait,
    },
    {
      title: "[TEST PREVIEW] Bill Enacted",
      description: "**Education and Opportunity Act** has been signed into law.",
      color: DISCORD_COLORS.billEnacted,
      fields: [{ name: "Policy", value: "Education" }],
    },
  ];
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });

    if ("showcase" in parsed.data) {
      const requestedCountryId = parsed.data.countryId.toUpperCase();
      const descriptor = (await getCountryWebhookDescriptors(db)).find(
        (candidate) => candidate.countryId === requestedCountryId
      );
      if (!descriptor?.url && !config?.discordGameWebhookUrl) {
        return NextResponse.json(
          { error: `No ${requestedCountryId} game-events webhook is configured` },
          { status: 400 }
        );
      }
      const [character, npp] = await Promise.all([
        db
          .collection<Character>("characters")
          .findOne(
            { countryId: requestedCountryId, avatarUrl: { $type: "string" } },
            { projection: { avatarUrl: 1 } }
          ),
        db
          .collection<NPP>("npps")
          .findOne(
            { countryId: requestedCountryId, avatarUrl: { $type: "string" } },
            { projection: { avatarUrl: 1 } }
          ),
      ]);
      await sendCountryGameEventMultiple(
        requestedCountryId,
        showcaseEmbeds(character?.avatarUrl ?? npp?.avatarUrl)
      );
      return NextResponse.json({ success: true, cards: 7, portrait: true });
    }

    let url: string | undefined;
    let label: string;
    let kind: "game" | "news" | "suggestions" | "country";

    if ("countryId" in parsed.data) {
      // Bind before the callback — the `in` narrowing does not survive into the
      // arrow function's closure over `parsed.data`.
      const requestedCountryId = parsed.data.countryId;
      const descriptor = (await getCountryWebhookDescriptors(db)).find(
        (d) => d.countryId === requestedCountryId
      );
      if (!descriptor) {
        return NextResponse.json(
          { error: `Country ${requestedCountryId} is not enabled for players` },
          { status: 400 }
        );
      }
      url = descriptor.url || config?.discordGameWebhookUrl;
      label = `${descriptor.name} Game Events`;
      kind = "country";
    } else if (parsed.data.target === "news") {
      url = config?.discordNewsWebhookUrl;
      label = "News";
      kind = "news";
    } else if (parsed.data.target === "suggestions") {
      url = config?.discordSuggestionsWebhookUrl;
      label = "Suggestions";
      kind = "suggestions";
    } else {
      url = config?.discordGameWebhookUrl;
      label = "Game Events";
      kind = "game";
    }

    if (!url) {
      return NextResponse.json({ error: `No ${label} webhook URL configured` }, { status: 400 });
    }

    const description =
      kind === "news"
        ? "This is a test of the news webhook. Player news posts will appear here."
        : kind === "suggestions"
          ? "This is a test of the suggestions webhook. New player suggestion forum posts will appear here."
          : `This is a test of the ${label.toLowerCase()} webhook. Election results, bill passages, and government changes will appear here.`;
    const color =
      kind === "news"
        ? DISCORD_COLORS.newsPost
        : kind === "suggestions"
          ? DISCORD_COLORS.suggestion
          : DISCORD_COLORS.electionResult;

    await sendDiscordWebhook(url, {
      title: `A House Divided — Test ${label}`,
      description,
      color,
      fields: [{ name: "Status", value: "Webhook configured correctly", inline: true }],
      footer: { text: "A House Divided" },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
