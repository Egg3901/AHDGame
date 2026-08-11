import type { Db, ObjectId } from "mongodb";
import { ObjectId as Oid } from "mongodb";
import type { Corporation, NPP } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { buildCeoAffiliations, chooseNppCorpCeo } from "@/lib/admin/nppCorpCeoSelection";
import { createNPP } from "@/lib/npp/generator";

/**
 * Pick (or create) an NPP to run a brand-new corporation, balanced across
 * participating parties — mirrors the spawn-NPP-corp path. Used by spin-off when
 * the appointed CEO is an NPP. Returns the NPP `_id`.
 *
 * Affiliation gathering is inlined here (as in caretakerCeo) to avoid importing
 * the heavyweight spawn module.
 */
export async function pickOrCreateNppCeoForNewCorp(
  db: Db,
  countryId: CountryId,
  headquartersState: string,
  forcedNppId?: string
): Promise<ObjectId> {
  const partyDocs = await db
    .collection("politicalParties")
    .find({ countryId, isDefunct: { $ne: true } })
    .project<{ sequentialId: number }>({ sequentialId: 1 })
    .toArray();
  const nonDefunctPartyIds = partyDocs.map((p) => String(p.sequentialId));

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", countryId })
    .project<{ ceoId: ObjectId }>({ ceoId: 1 })
    .toArray();
  const ceoIds = corps.map((c) => c.ceoId).filter(Boolean);
  const ceoNppDocs = ceoIds.length
    ? await db
        .collection<NPP>("npps")
        .find({ _id: { $in: ceoIds } })
        .project<{ _id: ObjectId; party: string }>({ _id: 1, party: 1 })
        .toArray()
    : [];
  const existingCorpCeos = ceoNppDocs.map((n) => ({ nppId: n._id.toString(), party: n.party }));

  const activeNppDocs = await db
    .collection<NPP>("npps")
    .find({ countryId, retiredAt: null })
    .project<{ _id: ObjectId; party: string; politicalInfluence: number; sequentialId?: number }>({
      _id: 1,
      party: 1,
      politicalInfluence: 1,
      sequentialId: 1,
    })
    .toArray();
  const activeNpps = activeNppDocs.map((n) => ({
    id: n._id.toString(),
    party: n.party,
    influence: n.politicalInfluence ?? 0,
    seq: n.sequentialId ?? Number.MAX_SAFE_INTEGER,
  }));

  const affiliations = buildCeoAffiliations({ nonDefunctPartyIds, existingCorpCeos, activeNpps });

  // Honor a forced free NPP if it is genuinely free; else balance.
  if (forcedNppId) {
    const isFree = affiliations.some((a) => a.freeNpps.some((n) => n.id === forcedNppId));
    if (isFree) return new Oid(forcedNppId);
  }

  const choice = chooseNppCorpCeo({ affiliations });
  if (choice.kind === "existing") return new Oid(choice.nppId);

  const npp = await createNPP({
    state: headquartersState,
    party: choice.party,
    countryId,
    targetOffice: null,
  });
  return npp._id;
}
