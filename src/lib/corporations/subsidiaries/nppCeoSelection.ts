import type { Db, ObjectId } from "mongodb";
import { ObjectId as Oid } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import { chooseNppCorpCeo } from "@/lib/admin/nppCorpCeoSelection";
import {
  gatherNppCeoAffiliations,
  nppCeoSelectionLane,
} from "@/lib/corporations/nppCeoAffiliations";
import { createNPP } from "@/lib/npp/generator";

/**
 * Pick (or create) an NPP to run a brand-new corporation, balanced across
 * participating parties — mirrors the spawn-NPP-corp path. Used by spin-off when
 * the appointed CEO is an NPP. Returns the NPP `_id`.
 *
 * Affiliation gathering is shared (`nppCeoAffiliations`) to avoid importing the
 * heavyweight spawn module. `lane` is the new corp's operating lane; at v6 it
 * makes the picker prefer a good CEO record there.
 */
export async function pickOrCreateNppCeoForNewCorp(
  db: Db,
  countryId: CountryId,
  headquartersState: string,
  forcedNppId?: string,
  lane?: OperatingSectorType
): Promise<ObjectId> {
  // NPP engine 6: an unforced pick prefers a good CEO record in the new corp's
  // lane. A forced (player-chosen) NPP is honored as before.
  const sectorLane = forcedNppId ? undefined : await nppCeoSelectionLane(db, countryId, lane);
  const affiliations = await gatherNppCeoAffiliations(db, countryId, {
    withTrackRecords: sectorLane != null,
  });

  // Honor a forced free NPP if it is genuinely free; else balance.
  if (forcedNppId) {
    const isFree = affiliations.some((a) => a.freeNpps.some((n) => n.id === forcedNppId));
    if (isFree) return new Oid(forcedNppId);
  }

  const choice = chooseNppCorpCeo({ affiliations, ...(sectorLane ? { sectorLane } : {}) });
  if (choice.kind === "existing") return new Oid(choice.nppId);

  const npp = await createNPP({
    state: headquartersState,
    party: choice.party,
    countryId,
    targetOffice: null,
  });
  return npp._id;
}
