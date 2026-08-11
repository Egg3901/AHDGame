import type { Db, ObjectId } from "mongodb";
import type { ElectedOfficial, PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getCurrentOfficeHolder } from "@/lib/governorOffice/queries";

export type OfficeActingRole =
  "holder" | "stateChair" | "stateViceChair" | "nationalChair" | "nationalViceChair";

export interface OfficeAccess {
  /** The actual seat-holder row (player OR NPP), regardless of viewer. */
  holder: ElectedOfficial | null;
  /** Viewer is the human office-holder. */
  viewerIsHolder: boolean;
  /** Viewer may drive the office's institutional actions (Orders/Legislation/Devolution). */
  canManage: boolean;
  /** How the viewer qualifies, or null if they do not. */
  actingRole: OfficeActingRole | null;
  /** The office's party (holder's party sequentialId string), for office-scoped lookups. */
  officeParty: string | null;
}

function idEquals(a: ObjectId | null | undefined, b: ObjectId | null | undefined): boolean {
  return !!a && !!b && a.equals(b);
}

/**
 * Resolve whether `characterId` may manage the regional chief-executive office
 * of `(countryId, stateId)`.
 *
 * Human-held office: only the holder qualifies (`holder` role). Admin is handled
 * separately by callers and is intentionally NOT folded in here.
 *
 * NPP-held office (`isNPP`): the holding party's leadership may step in —
 *   - the State Party Chair or Vice-Chair of that party in this region; OR
 *   - ONLY when the state party row has neither a chair nor a vice-chair, the
 *     National Party Chair or Vice-Chair.
 */
export async function resolveOfficeAccess(
  db: Db,
  countryId: CountryId,
  stateId: string,
  characterId: ObjectId | null
): Promise<OfficeAccess> {
  stateId = stateId.toUpperCase();
  const holder = await getCurrentOfficeHolder(db, countryId, stateId);
  const officeParty = holder?.party ?? null;

  const base: OfficeAccess = {
    holder,
    viewerIsHolder: false,
    canManage: false,
    actingRole: null,
    officeParty,
  };

  if (!holder || !characterId) return base;

  // Human holder — only the holder qualifies.
  if (holder.characterId) {
    if (idEquals(holder.characterId, characterId)) {
      return { ...base, viewerIsHolder: true, canManage: true, actingRole: "holder" };
    }
    return base;
  }

  // NPP-held office — party-officer fallback chain.
  if (!holder.isNPP || !officeParty) return base;
  const seq = Number(officeParty);
  if (!Number.isFinite(seq)) return base;

  const stateOrg = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .findOne({ countryId, stateId, partyId: String(seq) });

  if (idEquals(stateOrg?.chairId ?? null, characterId)) {
    return { ...base, canManage: true, actingRole: "stateChair" };
  }
  if (idEquals(stateOrg?.viceChairId ?? null, characterId)) {
    return { ...base, canManage: true, actingRole: "stateViceChair" };
  }

  // National fallback ONLY when the state party has neither officer.
  const stateHasOfficer = !!stateOrg?.chairId || !!stateOrg?.viceChairId;
  if (!stateHasOfficer) {
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId, sequentialId: seq });
    if (idEquals(party?.chairId ?? null, characterId)) {
      return { ...base, canManage: true, actingRole: "nationalChair" };
    }
    if (idEquals(party?.viceChairId ?? null, characterId)) {
      return { ...base, canManage: true, actingRole: "nationalViceChair" };
    }
  }

  return base;
}

/** Boolean convenience wrapper: may `characterId` manage this office? */
export async function canManageOffice(
  db: Db,
  countryId: CountryId,
  stateId: string,
  characterId: ObjectId | null
): Promise<boolean> {
  const access = await resolveOfficeAccess(db, countryId, stateId, characterId);
  return access.canManage;
}
