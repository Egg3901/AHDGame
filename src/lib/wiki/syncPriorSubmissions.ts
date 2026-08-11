import type { Db, ObjectId } from "mongodb";
import { ObjectId as ObjectIdCtor } from "mongodb";
import type { Character, Corporation, PoliticalParty, WikiPage } from "@/lib/db/types";
import { corporationWikiSlug, partyWikiSlug, playerWikiSlug } from "./playerPages";

const OBJECT_ID_HEX_RE = /^[a-f0-9]{24}$/;
const PLAYER_LEGACY_RE = /^player-([a-f0-9]{24})$/;
const CORP_LEGACY_RE = /^corp-([a-f0-9]{24})$/;
const PARTY_LEGACY_RE = /^party-profile-([a-f0-9]{24})$/;

export interface SyncPriorRenamed {
  oldSlug: string;
  newSlug: string;
  kind: "player" | "corporation" | "party";
}

export interface SyncPriorSkipped {
  oldSlug: string;
  reason: string;
}

export interface SyncPriorSubmissionsResult {
  renamed: SyncPriorRenamed[];
  skipped: SyncPriorSkipped[];
}

/**
 * Find every wiki page whose slug embeds an ObjectId (legacy
 * `player-{hex}`, `corp-{hex}`, `party-profile-{hex}`) and rename it to use
 * the entity's public sequentialId. Skips pages whose target entity no
 * longer exists, lacks a sequentialId, or whose new slug is already taken.
 */
export async function syncPriorWikiSubmissions(
  db: Db,
  moderatorId: ObjectId
): Promise<SyncPriorSubmissionsResult> {
  const wikiPages = db.collection<WikiPage>("wikiPages");
  const renamed: SyncPriorRenamed[] = [];
  const skipped: SyncPriorSkipped[] = [];
  const now = new Date();

  const legacyPages = await wikiPages
    .find({
      $or: [
        { slug: { $regex: /^player-[a-f0-9]{24}$/ } },
        { slug: { $regex: /^corp-[a-f0-9]{24}$/ } },
        { slug: { $regex: /^party-profile-[a-f0-9]{24}$/ } },
      ],
    })
    .toArray();

  for (const page of legacyPages) {
    const playerMatch = page.slug.match(PLAYER_LEGACY_RE);
    const corpMatch = page.slug.match(CORP_LEGACY_RE);
    const partyMatch = page.slug.match(PARTY_LEGACY_RE);

    let kind: SyncPriorRenamed["kind"];
    let entityHex: string;
    if (playerMatch) {
      kind = "player";
      entityHex = playerMatch[1];
    } else if (corpMatch) {
      kind = "corporation";
      entityHex = corpMatch[1];
    } else if (partyMatch) {
      kind = "party";
      entityHex = partyMatch[1];
    } else {
      continue;
    }

    if (!OBJECT_ID_HEX_RE.test(entityHex)) {
      skipped.push({ oldSlug: page.slug, reason: "Embedded ID is not a valid ObjectId" });
      continue;
    }
    const entityId = new ObjectIdCtor(entityHex);

    let newSlug: string | null = null;
    if (kind === "player") {
      const character = await db
        .collection<Character>("characters")
        .findOne({ _id: entityId }, { projection: { sequentialId: 1 } });
      if (!character) {
        skipped.push({ oldSlug: page.slug, reason: "Character no longer exists" });
        continue;
      }
      if (typeof character.sequentialId !== "number") {
        skipped.push({ oldSlug: page.slug, reason: "Character has no sequentialId" });
        continue;
      }
      newSlug = playerWikiSlug(character.sequentialId);
    } else if (kind === "corporation") {
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: entityId }, { projection: { sequentialId: 1 } });
      if (!corp) {
        skipped.push({ oldSlug: page.slug, reason: "Corporation no longer exists" });
        continue;
      }
      if (typeof corp.sequentialId !== "number") {
        skipped.push({ oldSlug: page.slug, reason: "Corporation has no sequentialId" });
        continue;
      }
      newSlug = corporationWikiSlug(corp.sequentialId);
    } else {
      const party = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ _id: entityId }, { projection: { sequentialId: 1, countryId: 1 } });
      if (!party) {
        skipped.push({ oldSlug: page.slug, reason: "Party no longer exists" });
        continue;
      }
      if (typeof party.sequentialId !== "number" || !party.countryId) {
        skipped.push({ oldSlug: page.slug, reason: "Party has no sequentialId or countryId" });
        continue;
      }
      newSlug = partyWikiSlug(party.countryId, party.sequentialId);
    }

    if (newSlug === page.slug) {
      skipped.push({ oldSlug: page.slug, reason: "Slug already in new format" });
      continue;
    }

    const collision = await wikiPages.findOne({ slug: newSlug }, { projection: { _id: 1 } });
    if (collision) {
      skipped.push({
        oldSlug: page.slug,
        reason: `New slug "${newSlug}" already exists`,
      });
      continue;
    }

    await wikiPages.updateOne(
      { _id: page._id },
      {
        $set: { slug: newSlug, updatedAt: now },
        $push: {
          editHistory: {
            userId: moderatorId,
            timestamp: now,
            action: "edited",
            note: `Sync prior submissions: ${page.slug} → ${newSlug}`,
          },
        },
      }
    );
    renamed.push({ oldSlug: page.slug, newSlug, kind });
  }

  return { renamed, skipped };
}
