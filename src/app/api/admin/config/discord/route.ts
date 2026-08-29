import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { getCountryWebhookDescriptors } from "@/lib/discord/countryWebhooks";
import { deploymentServiceSlug } from "@/lib/deploymentIdentity";
import type { GameConfig } from "@/lib/db/types";

/** Top-level (non country-scoped) webhooks, keyed by their gameConfig field. */
const GENERAL_FIELDS = {
  game: "discordGameWebhookUrl",
  news: "discordNewsWebhookUrl",
  suggestions: "discordSuggestionsWebhookUrl",
  changelog: "discordChangelogWebhookUrl",
} as const;

type GeneralKey = keyof typeof GENERAL_FIELDS;

const urlOrBlank = z.string().url().or(z.literal(""));

const schema = z.object({
  general: z
    .object({
      game: urlOrBlank.optional(),
      news: urlOrBlank.optional(),
      suggestions: urlOrBlank.optional(),
      changelog: urlOrBlank.optional(),
    })
    .optional(),
  countryWebhooks: z.record(z.string(), urlOrBlank).optional(),
  /**
   * Take ownership of these webhooks for the deployment serving this request,
   * when another one currently holds it. Required because the URLs travel with
   * a database restore: without an explicit claim, an admin saving the Discord
   * page of a restored world would silently hand it the live channels (#1208).
   */
  claimWebhooks: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const { general, countryWebhooks, claimWebhooks } = parsed.data;

    // Split into $set (non-empty) and $unset (empty string = clear) operations.
    // MongoDB's BSON serializer strips undefined values from $set, so we must
    // use $unset explicitly to clear a field.
    const $set: Record<string, string> = {};
    const $unset: Record<string, 1> = {};

    for (const key of Object.keys(GENERAL_FIELDS) as GeneralKey[]) {
      const value = general?.[key];
      if (value === undefined) continue;
      if (value) $set[GENERAL_FIELDS[key]] = value;
      else $unset[GENERAL_FIELDS[key]] = 1;
    }

    if (countryWebhooks && Object.keys(countryWebhooks).length > 0) {
      // Only player-enabled countries may be configured. A disabled country's
      // stored URL is retained in the map but is not editable, so re-enabling
      // the country restores it untouched.
      const enabled = new Set(
        (await getCountryWebhookDescriptors(db)).map((d) => d.countryId as string)
      );
      for (const [countryId, value] of Object.entries(countryWebhooks)) {
        if (!enabled.has(countryId)) {
          return NextResponse.json(
            { error: `Country ${countryId} is not enabled for players` },
            { status: 400 }
          );
        }
        if (value) $set[`discordCountryGameWebhookUrls.${countryId}`] = value;
        else $unset[`discordCountryGameWebhookUrls.${countryId}`] = 1;
      }
    }

    // #1208: record which deployment owns these webhooks. The URLs live in the
    // database, so a restore into a sandbox/staging/local world inherits them;
    // `discordWebhooks` refuses to send unless the running deployment matches
    // this stamp. Only stamp when a url is being SET — clearing one should not
    // hand ownership to whoever happened to clear it.
    if (Object.keys($set).length > 0) {
      const self = deploymentServiceSlug();
      const current = await db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { discordWebhookOwnerService: 1 } });
      const owner = current?.discordWebhookOwnerService;
      // Saving from a deployment that does not own these webhooks must not take
      // ownership by accident — that is exactly how a restored world would start
      // posting into the players' channels again. Renaming the real service is
      // the legitimate case, and it says so with `claimWebhooks`.
      if (owner && owner !== self && claimWebhooks !== true) {
        return NextResponse.json(
          {
            error:
              `These webhooks belong to the "${owner}" deployment and this is "${self}". ` +
              `Re-send with claimWebhooks: true to move them here.`,
          },
          { status: 409 }
        );
      }
      $set.discordWebhookOwnerService = self;
    }

    const update: Record<string, unknown> = {};
    if (Object.keys($set).length > 0) update.$set = $set;
    if (Object.keys($unset).length > 0) update.$unset = $unset;

    if (Object.keys(update).length > 0) {
      await db
        .collection<GameConfig>("gameConfig")
        .updateOne({ _id: "default" }, update, { upsert: false });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          discordGameWebhookUrl: 1,
          discordNewsWebhookUrl: 1,
          discordChangelogWebhookUrl: 1,
          discordSuggestionsWebhookUrl: 1,
        },
      }
    );

    return NextResponse.json({
      general: {
        game: config?.discordGameWebhookUrl ?? "",
        news: config?.discordNewsWebhookUrl ?? "",
        suggestions: config?.discordSuggestionsWebhookUrl ?? "",
        changelog: config?.discordChangelogWebhookUrl ?? "",
      },
      countries: await getCountryWebhookDescriptors(db),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
