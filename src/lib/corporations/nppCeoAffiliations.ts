/**
 * Gathers the per-affiliation free-NPP view the NPP CEO picker
 * (`chooseNppCorpCeo`) needs for one country. Shared by the spawn, caretaker
 * and new-corp (spin-off, privatization) paths, which each carried a copy.
 *
 * NPP engine 6: `nppCeoSelectionLane` returns the company's lane only at v6, and
 * the gatherer loads CEO track records only when asked, so below v6 the
 * queries and the choice are unchanged.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import type { Corporation, NPP } from "@/lib/db/types";
import type { NppCeoTrackRecord } from "@/lib/db/types/npp";
import { buildCeoAffiliations, type NppCorpCeoAffiliation } from "@/lib/admin/nppCorpCeoSelection";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { NPP_ENGINE_LEVEL } from "@/lib/nppAutonomy/engineVersion";

export interface GatherNppCeoAffiliationsOptions {
  /** Load each free NPP's CEO track record (v6 selection only). */
  withTrackRecords?: boolean;
}

/** The lane to choose a CEO by record for, or undefined below v6. */
export async function nppCeoSelectionLane(
  db: Db,
  countryId: CountryId,
  lane: OperatingSectorType | undefined
): Promise<OperatingSectorType | undefined> {
  if (!lane) return undefined;
  return (await nppAutonomyAtLeast(db, countryId, NPP_ENGINE_LEVEL)) ? lane : undefined;
}

export async function gatherNppCeoAffiliations(
  db: Db,
  countryId: CountryId,
  options: GatherNppCeoAffiliationsOptions = {}
): Promise<NppCorpCeoAffiliation[]> {
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
    .project<{
      _id: ObjectId;
      party: string;
      politicalInfluence: number;
      sequentialId?: number;
      ceoTrackRecord?: NppCeoTrackRecord;
    }>({
      _id: 1,
      party: 1,
      politicalInfluence: 1,
      sequentialId: 1,
      ...(options.withTrackRecords ? { ceoTrackRecord: 1 } : {}),
    })
    .toArray();
  const activeNpps = activeNppDocs.map((n) => ({
    id: n._id.toString(),
    party: n.party,
    influence: n.politicalInfluence ?? 0,
    seq: n.sequentialId ?? Number.MAX_SAFE_INTEGER,
    ...(options.withTrackRecords && n.ceoTrackRecord ? { trackRecord: n.ceoTrackRecord } : {}),
  }));

  return buildCeoAffiliations({ nonDefunctPartyIds, existingCorpCeos, activeNpps });
}
