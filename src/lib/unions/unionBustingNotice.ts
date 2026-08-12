/**
 * Union-side record of a CEO's union-busting attempt (Phase 7a).
 *
 * The busting action itself lives in
 * `src/lib/corporations/commands/sectorOperations/attemptUnionBusting.ts` and
 * only ever answered the CEO. This module writes the other half: the union
 * that organizes the targeted (countryId, sectorType) learns that a NAMED
 * employer moved against it, and whether the move landed.
 *
 * Attribution follows the corporate-aggression precedent
 * (`corp_sector_attacked`, fired by both the player attack route and
 * `nppCorporateAttacks`): the defender is told the ATTACKING CORPORATION's
 * name and id, never the individual who ordered it. Corporate actions are
 * attributed to the corporation in this game's information model, so a union
 * learns "TestCorp tried to break us", not which character signed off.
 *
 * Recipients follow the union's own electorate: the president plus every
 * organizer holding banked `strength`. That is the same set
 * `unionLeadershipVote` treats as the people with a stake in the union, and
 * they are the ones who can answer a bust by organizing again. Sent as one
 * `createNotifications` batch, the house pattern for multi-recipient events
 * (see `statePartyElections`).
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import type { Character, Union, UnionOrganizer } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";

export interface UnionBustingNoticeInput {
  countryId: CountryId;
  sectorType: string;
  /** Corporation that paid for the attempt — the union is told this name. */
  employerName: string;
  employerId: ObjectId;
  success: boolean;
  unionizationBefore: number;
  unionizationAfter: number;
}

function bustingMessage(union: Union, input: UnionBustingNoticeInput, sectorLabel: string): string {
  const swing = Math.abs(
    Math.round(input.unionizationAfter - input.unionizationBefore)
  ).toLocaleString();
  return input.success
    ? `${input.employerName} broke an organizing drive in ${sectorLabel}. ${union.name} lost ${swing} points of unionization.`
    : `${input.employerName} tried to break ${union.name} in ${sectorLabel} and failed. The shop floor answered with ${swing} points of unionization.`;
}

/**
 * Notify the union organizing this sector that an employer attempted a bust.
 * Returns how many notifications were written (0 when no union organizes the
 * sector, or nobody holds it). Never throws: the busting action has already
 * been paid for and committed by the time this runs.
 */
export async function notifyUnionOfBustingAttempt(
  db: Db,
  input: UnionBustingNoticeInput
): Promise<number> {
  try {
    const union = await db
      .collection<Union>("unions")
      .findOne({ countryId: input.countryId, sectorType: input.sectorType as CorporationType });
    if (!union) return 0;

    // NPP-led unions have no player to tell, but their organizers still might.
    const presidentId = union.ownerType === "npp" ? null : union.ownerId;
    const organizers = await db
      .collection<UnionOrganizer>("unionOrganizers")
      .find({ unionId: union._id, strength: { $gt: 0 } }, { projection: { characterId: 1 } })
      .toArray();

    const characterIds = [
      ...(presidentId ? [presidentId] : []),
      ...organizers.map((o) => o.characterId),
    ];
    if (characterIds.length === 0) return 0;

    const characters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: characterIds } }, { projection: { userId: 1 } })
      .toArray();

    const sectorLabel =
      CORPORATION_TYPE_LABELS[input.sectorType as CorporationType] ?? input.sectorType;
    const message = bustingMessage(union, input, sectorLabel);
    const seen = new Set<string>();
    const inputs: NotificationInput[] = [];
    for (const character of characters) {
      if (!character.userId) continue;
      const key = character.userId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      inputs.push({
        userId: character.userId,
        type: "union_busting_attempted",
        title: input.success ? "Union broken" : "Union-busting backfired",
        message,
        metadata: {
          unionId: union._id.toString(),
          unionName: union.name,
          employerCorporationId: input.employerId.toString(),
          employerCorporationName: input.employerName,
          sectorType: input.sectorType,
          countryId: input.countryId,
          success: input.success,
          unionizationBefore: input.unionizationBefore,
          unionizationAfter: input.unionizationAfter,
        },
      });
    }

    await createNotifications(inputs);
    return inputs.length;
  } catch (err) {
    console.error("[notifyUnionOfBustingAttempt] Failed:", err);
    return 0;
  }
}
