import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCharactersCollection } from "@/lib/db/collections/characters";
import type { TreatyEntry } from "@/lib/db/types/conflict";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { postWarWire } from "@/lib/military/emitWarWire";
import { buildTreatyEntryDispatch } from "@/lib/military/warWire";

/**
 * The alliance's display name for a treaty entry. The stored name first, because a
 * custom organization exists only in the database; then the built-in constant; then
 * the id, which is what every entry written before `organizationName` existed has.
 */
export function treatyEntryOrganizationName(
  entry: Pick<TreatyEntry, "organizationId" | "organizationName">
): string {
  return (
    entry.organizationName ??
    INTERNATIONAL_ORGANIZATIONS[entry.organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS]
      ?.name ??
    entry.organizationId
  );
}

/**
 * Tell the countries a treaty just took to war, put it on the World News wire, and log
 * it on the alliance.
 *
 * Shared by every path that writes a treaty entry (declaration-time enrolment and
 * the per-turn mutual-defence reconciliation) so a country pulled in on a later
 * turn hears about it exactly as one pulled in at the declaration does.
 *
 * Notifications are addressed to USERS, not countries: `NotificationInput` carries a
 * `userId` and there is no country-addressed notice anywhere in this codebase. So a
 * country's notice goes to the two seats that can act on it: the head of government and
 * the defence minister, the same pair the declare-war route authorises to take a country
 * to war in the first place.
 *
 * A war must never fail over a notification. `createNotifications` swallows its own
 * errors, but the seat lookups either side of it do not, and this runs AFTER the
 * conflict has been written. An unguarded throw here would abandon the rest of the
 * caller's work over a side effect, reporting a failure for a war entry that was in
 * fact made correctly. Hence the blanket catch.
 */
export async function announceTreatyEntries(
  db: Db,
  entries: TreatyEntry[],
  conflictName: string,
  currentTurn: number
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await announceTreatyEntriesUnguarded(db, entries, conflictName, currentTurn);
  } catch (err) {
    console.error("[treatyEntryNotice] treaty entry announcement failed:", err);
  }
}

async function announceTreatyEntriesUnguarded(
  db: Db,
  entries: TreatyEntry[],
  conflictName: string,
  currentTurn: number
): Promise<void> {
  // World News first, so a failed seat lookup below cannot swallow it. One dispatch
  // per alliance and defended member. Only the entries this call was handed are
  // posted, and every caller hands over only entries it has just written, so nothing
  // already in a war is ever announced again. `postWarWire` never throws.
  const groups = new Map<string, TreatyEntry[]>();
  for (const e of entries) {
    const key = `${e.organizationId}:${e.defending}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const group of groups.values()) {
    await postWarWire(
      buildTreatyEntryDispatch({
        conflictName,
        organizationName: treatyEntryOrganizationName(group[0]),
        defending: group[0].defending,
        entered: group.map((e) => e.countryId),
      })
    );
  }

  const inputs: NotificationInput[] = [];
  for (const e of entries) {
    const org = treatyEntryOrganizationName(e);
    const defended = COUNTRY_CONFIGS[e.defending]?.name ?? e.defending;

    const seatCharacterIds: ObjectId[] = [];
    const hog = await getHeadOfGovernmentCharacterId(db, e.countryId);
    if (hog) seatCharacterIds.push(hog);
    const defenceSeat = DEFENSE_POSITION_BY_COUNTRY[e.countryId];
    if (defenceSeat) {
      const row = await getCabinetMembersCollection(db).findOne({
        countryId: e.countryId,
        positionId: defenceSeat,
      });
      if (row?.characterId) seatCharacterIds.push(row.characterId);
    }
    if (seatCharacterIds.length === 0) continue;

    const chars = await (
      await getCharactersCollection(db)
    )
      .find({ _id: { $in: seatCharacterIds } })
      .project<{ _id: ObjectId; userId?: ObjectId }>({ _id: 1, userId: 1 })
      .toArray();

    for (const c of chars) {
      if (!c.userId) continue;
      inputs.push({
        userId: c.userId,
        type: "treaty_defence_invoked" as const,
        title: "Treaty obligations invoked",
        message: `${defended} has been attacked. Under the ${org}, your forces have entered the ${conflictName}.`,
        metadata: {
          countryId: e.countryId,
          organizationId: e.organizationId,
          defending: e.defending,
        },
      });
    }
  }

  // Deduped by user: one player can hold both seats, and two identical notices about one
  // war reads as a bug.
  const seen = new Set<string>();
  await createNotifications(
    inputs.filter((i) => {
      const key = String(i.userId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );

  for (const e of entries) {
    const defended = COUNTRY_CONFIGS[e.defending]?.name ?? e.defending;
    await recordOrgHistoryEvent(
      db,
      e.countryId,
      currentTurn,
      `${treatyEntryOrganizationName(e)} collective defence invoked: entered the ${conflictName} to defend ${defended}.`,
      { organizationId: e.organizationId, defending: e.defending }
    );
  }
}
