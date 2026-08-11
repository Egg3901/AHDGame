/**
 * Caretaker minister — NPP-autonomy V2.1.
 *
 * A player head of government may appoint an NPP into a single cabinet seat as a
 * "caretaker". The seat is a normal `UnifiedCabinetMember` flagged `isNPP` with a
 * non-null `appointedByCharacterId` (the appointing human head), so the V2.1
 * `runCaretakerMinisters` runner recognises it and steers that one portfolio
 * through the existing clamped tier/order levers. The appointing player dismisses
 * or replaces the caretaker; nothing here is automatic.
 *
 * Contrast with `formNppCabinet` (V1): that fills *every* vacant seat under an
 * *NPP* head of government in a non-player country. This fills *one* seat under a
 * *player* head in a player country, on explicit player action. The feature gate
 * (`nppAutonomyAtLeast(countryId, "v2")`) and the "is the caller the head of
 * government?" check live at the call site.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types/npp";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetPositionById } from "@/lib/constants";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { getLiveGameYear } from "@/lib/cabinet/liveGameYear";
import { resetCabinetSettingCooldowns } from "@/lib/db/collections/cabinetSettings";
import { initialMinisterialActionFields } from "@/lib/cabinet/ministerialActionPool";

export type CaretakerMinisterError =
  | "invalid-position"
  | "head-of-gov-seat"
  | "npp-not-found"
  | "npp-wrong-country"
  | "npp-retired"
  | "npp-already-seated";

/**
 * Validate (purely) that `positionId` is an appointable cabinet seat for
 * `countryId` — a real position that is not the head-of-government seat (which
 * is filled by election/executive formation, never by caretaker appointment).
 */
export function validateCaretakerPosition(
  countryId: CountryId,
  positionId: string
): CaretakerMinisterError | null {
  const position = getCabinetPositionById(positionId);
  if (!position) return "invalid-position";
  const known = getCabinetPositions(countryId).find((p) => p.id === positionId);
  if (!known) return "invalid-position";
  if (known.isHeadOfGovernment) return "head-of-gov-seat";
  return null;
}

export interface AppointCaretakerMinisterResult {
  ok: boolean;
  error?: CaretakerMinisterError;
  nppName?: string;
}

/**
 * Appoint `nppId` as caretaker minister of `positionId` in `countryId`, on
 * behalf of the human head of government `appointingCharacterId`. Replaces any
 * current holder of the seat (mirroring the acting-appointment path) and resets
 * the seat's setting cooldowns so the caretaker can act immediately.
 */
export async function appointCaretakerMinister(
  db: Db,
  args: {
    countryId: CountryId;
    positionId: string;
    nppId: ObjectId;
    appointingCharacterId: ObjectId;
    now: Date;
  }
): Promise<AppointCaretakerMinisterResult> {
  const { countryId, positionId, nppId, appointingCharacterId, now } = args;

  const invalidPosition = validateCaretakerPosition(countryId, positionId);
  if (invalidPosition) return { ok: false, error: invalidPosition };

  // Era gating: a seat outside its yearEnabled/yearRetired range cannot take a
  // caretaker either (same rule as player appointments).
  const seat = getCabinetPositions(countryId).find((p) => p.id === positionId);
  if (seat && !isSeatActive(seat, await getLiveGameYear(db))) {
    return { ok: false, error: "invalid-position" };
  }

  const npp = await db.collection<NPP>("npps").findOne({ _id: nppId });
  if (!npp) return { ok: false, error: "npp-not-found" };
  if (npp.countryId !== countryId) return { ok: false, error: "npp-wrong-country" };
  if (npp.retiredAt != null) return { ok: false, error: "npp-retired" };

  // One seat per NPP: refuse if this NPP already holds a cabinet seat anywhere.
  const cabinetCol = getCabinetMembersCollection(db);
  const alreadySeated = await cabinetCol.findOne({ isNPP: true, nppId });
  if (alreadySeated) return { ok: false, error: "npp-already-seated" };

  // Replace any current holder of the seat, then install the caretaker.
  await cabinetCol.deleteOne({ countryId, positionId });
  const member: Omit<UnifiedCabinetMember, "_id"> = {
    countryId,
    positionId,
    characterId: null,
    characterName: npp.name,
    party: npp.party,
    isNPP: true,
    nppId,
    appointedByCharacterId: appointingCharacterId,
    appointedAt: now,
    confirmedAt: now,
    ...initialMinisterialActionFields(now),
    createdAt: now,
    updatedAt: now,
  };
  await cabinetCol.insertOne(member as UnifiedCabinetMember);

  // Clear the predecessor's setting cooldowns (settings are keyed by position).
  await resetCabinetSettingCooldowns(db, countryId, positionId);

  return { ok: true, nppName: npp.name };
}

export interface DismissCaretakerMinisterResult {
  ok: boolean;
  error?: "not-caretaker";
}

/**
 * Dismiss the caretaker minister in `positionId`. Only removes a seat that is
 * actually an NPP caretaker (player-appointed: `isNPP` + non-null
 * `appointedByCharacterId`) — a player member or a V1 NPP-government seat
 * (appointed by an NPP head) is left untouched. The seat is left vacant for the
 * head to re-appoint.
 */
export async function dismissCaretakerMinister(
  db: Db,
  args: { countryId: CountryId; positionId: string }
): Promise<DismissCaretakerMinisterResult> {
  const { countryId, positionId } = args;
  const cabinetCol = getCabinetMembersCollection(db);
  const result = await cabinetCol.deleteOne({
    countryId,
    positionId,
    isNPP: true,
    appointedByCharacterId: { $ne: null },
  });
  if (result.deletedCount === 0) return { ok: false, error: "not-caretaker" };
  return { ok: true };
}
