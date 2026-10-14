import type { Db, ObjectId } from "mongodb";
import type { User } from "@/lib/db/types";
import type { Suggestion } from "@/lib/db/types/suggestion";
import { getDiscordAvatarUrl, toAbsoluteUploadUrl } from "@/lib/discord";
import { discordSubmitPrimaryLabel } from "@/lib/suggestions/discordSubmitAttribution";
import { loadReporterDisplayMap } from "@/lib/suggestions/reporterDisplay";

/** Name and avatar shown as the author line of a suggestion's Discord post. */
export interface SuggestionReporterIdentity {
  name: string;
  iconUrl?: string;
}

type ReporterSource = Pick<
  Suggestion,
  | "discordSubmitDisplayName"
  | "discordSubmitUsername"
  | "discordSubmitUserId"
  | "discordSubmitAvatarUrl"
> & { userId?: ObjectId | null };

function httpsOnly(url: string | null | undefined): string | undefined {
  return url && url.startsWith("https://") ? url : undefined;
}

/**
 * Linked account: in-game name with the Discord avatar. Game account without
 * Discord: in-game name and in-game avatar. Discord-only submitter: Discord
 * name and avatar.
 */
export async function resolveSuggestionReporterIdentity(
  db: Db,
  source: ReporterSource,
  baseUrl: string
): Promise<SuggestionReporterIdentity | undefined> {
  try {
    if (source.userId) {
      const [display, user] = await Promise.all([
        loadReporterDisplayMap(db, [source.userId]).then((map) =>
          map.get(source.userId!.toString())
        ),
        db
          .collection<User>("users")
          .findOne(
            { _id: source.userId },
            { projection: { username: 1, discordId: 1, discordAvatar: 1 } }
          ),
      ]);
      const name = display?.characterName || user?.username;
      if (name) {
        const iconUrl = user?.discordId
          ? getDiscordAvatarUrl(user.discordId, user.discordAvatar)
          : httpsOnly(toAbsoluteUploadUrl(display?.avatarUrl, baseUrl));
        return { name, iconUrl };
      }
    }
    if (source.discordSubmitUserId) {
      const name = discordSubmitPrimaryLabel(source);
      if (name) {
        return {
          name,
          iconUrl:
            httpsOnly(source.discordSubmitAvatarUrl) ??
            getDiscordAvatarUrl(source.discordSubmitUserId, null),
        };
      }
    }
  } catch (err) {
    console.error("[Suggestions] Reporter identity lookup failed:", err);
  }
  return undefined;
}
