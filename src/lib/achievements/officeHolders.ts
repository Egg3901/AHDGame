/**
 * Turn-time award of the office-holder achievements. The profile page check only
 * sees a seat while its holder is looking at their own profile, so anyone who
 * was appointed and left (or reset) between visits never got the award.
 */
import { ObjectId, type Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types";
import type { CharacterAchievement } from "@/lib/db/types";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getAchievementBySlug } from "./index";
import { invalidateRarityCache } from "./cache";
import { resolveOfficeHolderGrants } from "./officeHolderRules";

export async function awardOfficeHolderAchievements(
  db: Db,
  characters: ReadonlyArray<{ _id: ObjectId; userId: ObjectId }>
): Promise<number> {
  try {
    const [cabinetRows, chairRows] = await Promise.all([
      getCabinetMembersCollection(db)
        .find({ characterId: { $ne: null } }, { projection: { characterId: 1 } })
        .toArray(),
      db
        .collection<CentralBank>("centralBanks")
        .find({ chairCharacterId: { $ne: null } }, { projection: { chairCharacterId: 1 } })
        .toArray(),
    ]);
    const cabinetCharacterIds = new Set(
      cabinetRows.flatMap((m) => (m.characterId ? [m.characterId.toString()] : []))
    );
    const chairCharacterIds = new Set(
      chairRows.flatMap((b) => (b.chairCharacterId ? [b.chairCharacterId.toString()] : []))
    );
    if (cabinetCharacterIds.size === 0 && chairCharacterIds.size === 0) return 0;

    const grants = resolveOfficeHolderGrants({
      cabinetCharacterIds,
      chairCharacterIds,
      // A character row without an owning account (legacy or system rows) must
      // not throw and silently skip every other holder's award.
      characters: characters.flatMap((c) =>
        c.userId ? [{ characterId: c._id.toString(), userId: c.userId.toString() }] : []
      ),
    });
    if (grants.length === 0) return 0;

    const [cabinetDef, chairDef] = await Promise.all([
      getAchievementBySlug("cabinet_seat"),
      getAchievementBySlug("central_banker"),
    ]);
    const defIds = new Map([
      ["cabinet_seat", cabinetDef?._id],
      ["central_banker", chairDef?._id],
    ]);
    const achievementIds = [...defIds.values()].filter((id): id is ObjectId => id != null);
    if (achievementIds.length === 0) return 0;

    const col = db.collection<CharacterAchievement>("characterAchievements");
    const existing = await col
      .find(
        {
          userId: { $in: grants.map((g) => new ObjectId(g.userId)) },
          achievementId: { $in: achievementIds },
        },
        { projection: { userId: 1, achievementId: 1 } }
      )
      .toArray();
    const have = new Set(existing.map((e) => `${e.achievementId}:${e.userId}`));

    const now = new Date();
    const docs: CharacterAchievement[] = [];
    for (const g of grants) {
      const achievementId = defIds.get(g.slug);
      if (!achievementId || have.has(`${achievementId}:${g.userId}`)) continue;
      docs.push({
        _id: new ObjectId(),
        userId: new ObjectId(g.userId),
        characterId: new ObjectId(g.characterId),
        achievementId,
        earnedAt: now,
      });
    }
    if (docs.length === 0) return 0;

    try {
      await col.insertMany(docs, { ordered: false });
    } catch (error: unknown) {
      const duplicateOnly =
        error != null && typeof error === "object" && (error as { code?: number }).code === 11000;
      if (!duplicateOnly) throw error;
    }
    invalidateRarityCache();
    return docs.length;
  } catch (error) {
    console.error("[achievements] awardOfficeHolderAchievements error:", error);
    return 0;
  }
}
