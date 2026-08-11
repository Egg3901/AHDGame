/**
 * POST /api/wiki/my/claim
 *
 * Create a stub wiki page for the current player or their corporation, using
 * a deterministic slug derived from the target entity's ObjectId. If a page
 * with that slug already exists, returns the existing slug (idempotent).
 *
 * Body: { target: "player" | "corporation" }
 * Returns: { slug, created }
 *
 * Auth: requireBasicAuth (+ active character); blocked when wiki is disabled.
 * The "corporation" target additionally requires that the caller is the CEO.
 * Errors: 400, 401, 403, 404, 429
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { checkWikiCreateCooldown, formatCooldownMessage } from "@/lib/wiki/createCooldown";
import { notifyModeratorsOfWikiSubmission } from "@/lib/wiki/reviewNotifications";
import { getGameStamp } from "@/lib/wiki/gameConfig";
import type { WikiPage, Corporation, PoliticalParty } from "@/lib/db/types";
import {
  corporationWikiSlug,
  corporationWikiStarter,
  partyWikiSlug,
  partyWikiStarter,
  playerWikiSlug,
  playerWikiStarter,
} from "@/lib/wiki/playerPages";

const claimSchema = z.object({
  target: z.enum(["player", "corporation", "party"]),
});

export async function POST(request: Request) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { user } = auth;

    const rateLimit = checkRateLimit(user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, claimSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");
    const userObjectId = new ObjectId(user.userId);
    const now = new Date();

    let slug: string;
    let title: string;
    let description: string;
    let content: string;
    let tags: string[];
    let category: "characters" | "corporations" | "player-parties";

    if (parsed.data.target === "player") {
      const character = user.character;
      if (typeof character.sequentialId !== "number") {
        return NextResponse.json(
          { error: "Your character is missing a public ID; contact an admin." },
          { status: 409 }
        );
      }
      slug = playerWikiSlug(character.sequentialId);
      title = `${character.name} (Politician)`;
      description = `Player-maintained biography page for ${character.name}.`;
      content = playerWikiStarter(character.name);
      tags = ["player", "biography"];
      category = "characters";
    } else if (parsed.data.target === "corporation") {
      // Corporation: caller must be the active CEO of the corp.
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId: user.character._id, userId: userObjectId });
      if (!corp) {
        return NextResponse.json(
          { error: "You are not the CEO of any corporation" },
          { status: 403 }
        );
      }
      if (typeof corp.sequentialId !== "number") {
        return NextResponse.json(
          { error: "Your corporation is missing a public ID; contact an admin." },
          { status: 409 }
        );
      }
      slug = corporationWikiSlug(corp.sequentialId);
      title = `${corp.name} (Corporation)`;
      description = `Company page for ${corp.name}.`;
      content = corporationWikiStarter(corp.name);
      tags = ["corporation", "company"];
      category = "corporations";
    } else {
      // Party: caller must currently be chair/vice-chair/treasurer of a party.
      const party = await db.collection<PoliticalParty>("politicalParties").findOne({
        $or: [
          { chairId: user.character._id },
          { viceChairId: user.character._id },
          { treasurerId: user.character._id },
        ],
      });
      if (!party) {
        return NextResponse.json(
          { error: "Only a party's chair, vice-chair, or treasurer can claim its page." },
          { status: 403 }
        );
      }
      slug = partyWikiSlug(party.countryId, party.sequentialId);
      title = `${party.name} (Party)`;
      description = `Party-maintained page for ${party.name}.`;
      content = partyWikiStarter(party.name);
      tags = ["party", "politics"];
      category = "player-parties";
    }

    const existing = await wikiPages.findOne({ slug });
    if (existing) {
      return NextResponse.json({ slug, created: false });
    }

    // Respect the 12 h cooldown on brand-new pages (mods bypass).
    const isMod = user.isAdmin === true || user.role === "moderator";
    const cooldown = await checkWikiCreateCooldown(db, userObjectId, { bypass: isMod });
    if (!cooldown.ok) {
      return NextResponse.json(
        { error: formatCooldownMessage(cooldown), retryAfterMs: cooldown.remainingMs },
        { status: 429 }
      );
    }

    const stub: Omit<WikiPage, "_id"> = {
      slug,
      title,
      description,
      content,
      category,
      status: "pending_review",
      submittedBy: userObjectId,
      tags,
      isAutoGenerated: false,
      ...getGameStamp(),
      createdAt: now,
      updatedAt: now,
      editHistory: [{ userId: userObjectId, timestamp: now, action: "created" }],
    };
    await wikiPages.insertOne(stub as unknown as WikiPage);

    notifyModeratorsOfWikiSubmission({
      slug,
      title,
      submitterName: user.character.name,
    }).catch((err) => console.error("[wiki] claim notify failed:", err));

    return NextResponse.json({ slug, created: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
