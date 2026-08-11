import type { Db, ObjectId } from "mongodb";
import { CABINET_POSITIONS } from "@/lib/constants/cabinet";
import { UK_CABINET_POSITIONS } from "@/lib/constants/ukCabinet";
import { JP_CABINET_POSITIONS } from "@/lib/constants/jpCabinet";
import { DE_CABINET_POSITIONS } from "@/lib/constants/deCabinet";
import { IE_CABINET_POSITIONS } from "@/lib/constants/ieCabinet";
import { CN_CABINET_POSITIONS } from "@/lib/constants/cnCabinet";
import { NG_CABINET_POSITIONS } from "@/lib/constants/ngCabinet";
import { SCO_CABINET_POSITIONS } from "@/lib/constants/scoCabinet";
import { WAL_CABINET_POSITIONS } from "@/lib/constants/walCabinet";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import type { CabinetMember, CabinetNomination } from "@/lib/db/types/cabinet";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { OfficeType } from "@/lib/db/types/character";
import { cabinetOfficeTypeForCountry } from "@/lib/actions/officeActionBonus";
import { getCabinetEligibleOfficeTypes } from "@/lib/legislature/chamberOfficeType";

/**
 * For the cleared cabinet holders, (1) restore each holder's `currentOffice` so
 * they stop drawing the cabinet office-action bonus after the government falls,
 * and (2) notify the player ones. Mirrors the PM-facing fire flow: restore to
 * the holder's legislative seat (from `electedOfficials`) or unset it when there
 * is none. Guarded — a holder whose `currentOffice` has already moved on (no
 * longer the cabinet office type) is left untouched, never clobbered.
 */
async function notifyAndRestoreClearedHolders(
  db: Db,
  countryId: CountryId,
  memberIds: ObjectId[]
): Promise<void> {
  if (memberIds.length === 0) {
    await createNotifications([]);
    return;
  }

  const cabinetType = cabinetOfficeTypeForCountry(countryId);
  const eligibleOfficeTypes = getCabinetEligibleOfficeTypes(countryId);
  const [chars, seats] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({ _id: { $in: memberIds } }, { projection: { _id: 1, userId: 1, currentOffice: 1 } })
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        characterId: { $in: memberIds },
        countryId,
        officeType: { $in: eligibleOfficeTypes },
      })
      .toArray(),
  ]);
  const seatByChar = new Map(
    seats.filter((s) => s.characterId).map((s) => [s.characterId!.toString(), s])
  );

  const now = new Date();
  for (const c of chars) {
    // Only ex-ministers still flagged as cabinet get reset — don't clobber a
    // holder whose office already moved on (e.g. re-seated elsewhere).
    if (c.currentOffice?.type !== cabinetType) continue;
    const seat = seatByChar.get(c._id.toString());
    if (seat?.state) {
      const restoreOffice = { type: seat.officeType, state: seat.state } as OfficeType;
      await db
        .collection<Character>("characters")
        .updateOne({ _id: c._id }, { $set: { currentOffice: restoreOffice, updatedAt: now } });
    } else {
      await db
        .collection<Character>("characters")
        .updateOne({ _id: c._id }, { $unset: { currentOffice: "" }, $set: { updatedAt: now } });
    }
  }

  const notifications: NotificationInput[] = chars
    .filter((c) => c.userId)
    .map((c) => ({
      userId: c.userId,
      type: "system",
      title: "Cabinet Resigned",
      message: "Your cabinet appointment has ended due to a change in government.",
    }));
  await createNotifications(notifications);
}

/**
 * Clears all cabinet members and pending nominations for the given country
 * when a government transition occurs (new President/PM, or government falls).
 *
 * Restores each cleared holder's `currentOffice` (so they stop drawing the
 * cabinet office bonus) and sends in-app notifications to the player ones.
 * Both are best-effort; failures are non-fatal.
 *
 * Note: Does NOT clear UK cabinet cooldowns — those persist across government transitions
 * and are only cleared when a new PM is appointed (in ukGovernmentFormation.ts).
 */
export async function clearCabinetOnTransition(db: Db, countryId: CountryId): Promise<void> {
  const positionsByCountry: Partial<Record<CountryId, readonly { id: string }[]>> = {
    US: CABINET_POSITIONS,
    UK: UK_CABINET_POSITIONS,
    JP: JP_CABINET_POSITIONS,
    DE: DE_CABINET_POSITIONS,
    IE: IE_CABINET_POSITIONS,
    CN: CN_CABINET_POSITIONS,
    NG: NG_CABINET_POSITIONS,
    SCO: SCO_CABINET_POSITIONS,
    WAL: WAL_CABINET_POSITIONS,
  };
  const positions = positionsByCountry[countryId];
  if (!positions) return; // Country has no cabinet positions defined yet
  const positionIds = positions.map((p) => p.id);

  const filter = { positionId: { $in: positionIds } };

  if (countryId === COUNTRY_CONFIGS.US.id) {
    // Handle US cabinet (confirmation-based)
    const members = await db.collection<CabinetMember>("cabinetMembers").find(filter).toArray();
    await db.collection<CabinetMember>("cabinetMembers").deleteMany(filter);
    await db
      .collection<CabinetNomination>("cabinetNominations")
      .updateMany(
        { ...filter, status: { $in: ["proposed", "active"] } },
        { $set: { status: "withdrawn", updatedAt: new Date() } }
      );

    // Restore office state for the cleared secretaries and notify the players.
    await notifyAndRestoreClearedHolders(
      db,
      countryId,
      members.map((m) => m.characterId)
    );
  } else {
    // Parliamentary / one-party cabinets (UK, JP, DE, IE, CN, NG). The unified
    // cabinetMembers collection is the single source of truth for seat holders,
    // so a transition clears the country's seats there and restores/notifies the
    // affected players.
    const members = await db
      .collection<CabinetMember>("cabinetMembers")
      .find({ ...filter, countryId })
      .toArray();

    await db.collection<CabinetMember>("cabinetMembers").deleteMany({ ...filter, countryId });

    await db
      .collection<CabinetNomination>("cabinetNominations")
      .updateMany(
        { ...filter, countryId, status: { $in: ["proposed", "active"] } },
        { $set: { status: "withdrawn", updatedAt: new Date() } }
      );

    await db.collection("cabinetSettings").deleteMany({ countryId });
    await db
      .collection("ministerialOrders")
      .updateMany({ countryId, active: true }, { $set: { active: false } });

    // Restore office state and notify the player holders. NPP-held seats carry a
    // null characterId — they have no player to notify and no office to restore.
    const memberIds = members.filter((m) => m.characterId).map((m) => m.characterId);
    await notifyAndRestoreClearedHolders(db, countryId, memberIds);
  }
}
