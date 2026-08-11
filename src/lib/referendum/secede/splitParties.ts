/**
 * Reconcile a seceding region's parties to the new country's CONFIGURED MAJORS:
 *
 *  - The region-homed major (no UK presence outside the region — SNP, Plaid) has
 *    its party doc flipped to the new country with a fresh `sequentialId`.
 *  - Every other region party (UK-wide majors like Labour + non-majors) has its
 *    regional members independentized and its region party-org dissolved; no
 *    party doc survives in the new country. Players re-form those parties.
 *
 * Member characters were already re-homed to the new country by SP2b
 * (`expandToSubRegions`), so region members are found by `countryId`. Officials
 * are NOT migrated here — `carryOverOfficials` (the next step) applies the
 * returned `idMap` to them. Idempotent: re-running once reconciled is a no-op.
 */
import { ObjectId, type Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { Counter } from "@/lib/db/types/counter";
import { CAPITAL_SUBREGION, type SecedingCountryId } from "./subRegions";
import { planPartyRemap, type RegionParty } from "./partyRemap";

/** Region-party ledger collections dissolved on secession (the new country reseeds). */
const REGION_PARTY_LEDGERS = [
  "partyBudget",
  "partyPoliticalStrengthLedger",
  "orgRegLedger",
  "billWhips",
  "statePartyElections",
];

export interface SplitPartiesResult {
  wholesale: number;
  independentized: number;
  /** Old UK `sequentialId` → new-country `sequentialId`, for every carried major. */
  idMap: Record<number, number>;
}

export async function splitParties(
  db: Db,
  regionId: string,
  fromCountryId: CountryId,
  toCountryId: SecedingCountryId
): Promise<SplitPartiesResult> {
  const now = new Date();
  const capital = CAPITAL_SUBREGION[toCountryId];
  const majorPartyIds = getCountryConfig(toCountryId).majorPartyIds ?? [];

  // ── Gather the region's parties + classify region-homed vs UK-wide ──────────
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId: fromCountryId })
    .toArray();
  const orgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId: fromCountryId })
    .toArray();

  const regionSeqIds = new Set<number>();
  for (const o of officials)
    if (o.state === regionId && o.party && o.party !== "independent")
      regionSeqIds.add(Number(o.party));
  for (const g of orgs) if (g.stateId === regionId) regionSeqIds.add(Number(g.partyId));

  const hasOutsidePresence = (seqId: number): boolean =>
    officials.some((o) => o.party === String(seqId) && o.state !== regionId) ||
    orgs.some((g) => g.partyId === String(seqId) && g.stateId !== regionId);

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: fromCountryId })
    .toArray();
  const partyBySeq = new Map(parties.map((p) => [p.sequentialId, p]));
  const partyAbbrevById: Record<number, string> = {};
  const regionParties: RegionParty[] = [];
  for (const seqId of regionSeqIds) {
    const party = partyBySeq.get(seqId);
    if (!party) continue;
    partyAbbrevById[seqId] = party.abbreviation;
    regionParties.push({ sequentialId: seqId, isRegionHomed: !hasOutsidePresence(seqId) });
  }

  // Next free sequentialId in the new country (stood up fresh — usually 1).
  const existingNew = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: toCountryId })
    .toArray();
  const nextSequentialId = existingNew.reduce((m, p) => Math.max(m, p.sequentialId ?? 0), 0) + 1;

  const plan = planPartyRemap({ majorPartyIds, regionParties, partyAbbrevById, nextSequentialId });

  // ── Wholesale: flip the region-homed major's doc to the new country ─────────
  for (const oldSeq of plan.wholesale) {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { sequentialId: oldSeq, countryId: fromCountryId },
        { $set: { countryId: toCountryId, sequentialId: plan.idMap[oldSeq], updatedAt: now } }
      );
  }

  // ── Re-party the new country's member characters ────────────────────────────
  // Snapshot-then-write so a freshly-assigned new id can't collide with an old
  // id mid-remap. Only members whose CURRENT party is in THIS run's old-id scope
  // move: a major's old id → its mapped id; a non-major's old id → independent.
  // Members already carried (new ids) or unrelated are left untouched — so a
  // re-run (empty plan) is a no-op rather than independentizing everyone.
  const independentizedSet = new Set(plan.independentized.map(String));
  const members = (await db
    .collection("characters")
    .find({ countryId: toCountryId })
    .toArray()) as Array<{ _id: unknown; party?: string }>;
  for (const m of members) {
    const mapped = plan.idMap[Number(m.party)];
    let target: string | undefined;
    if (mapped != null) target = String(mapped);
    else if (m.party != null && independentizedSet.has(m.party)) target = "independent";
    if (target != null && target !== m.party) {
      await db
        .collection("characters")
        .updateOne({ _id: m._id as ObjectId }, { $set: { party: target, updatedAt: now } });
    }
  }

  // ── statePartyOrg: re-home the transferred major to the capital; drop the rest ──
  for (const oldSeq of plan.wholesale) {
    const regionOrgs = orgs.filter((g) => g.stateId === regionId && g.partyId === String(oldSeq));
    for (const g of regionOrgs) {
      const newPartyId = String(plan.idMap[oldSeq]);
      const newId = `${toCountryId}_${capital}_${newPartyId}`;
      await db.collection<StatePartyOrg>("statePartyOrg").deleteOne({ _id: g._id });
      await db.collection<StatePartyOrg>("statePartyOrg").insertOne({
        ...g,
        _id: newId,
        countryId: toCountryId,
        stateId: capital,
        partyId: newPartyId,
      });
    }
  }
  if (plan.independentized.length > 0) {
    await db.collection("statePartyOrg").deleteMany({
      countryId: fromCountryId,
      stateId: regionId,
      partyId: { $in: plan.independentized.map(String) },
    });
  }

  // ── Dissolve the region's party-ledger history (the new country reseeds) ────
  for (const coll of REGION_PARTY_LEDGERS) {
    await db.collection(coll).deleteMany({ stateId: regionId });
  }

  // Advance the new country's party counter past the assigned ids.
  const assigned = Object.values(plan.idMap);
  if (assigned.length > 0) {
    await db
      .collection<Counter>("counters")
      .updateOne(
        { _id: `party_${toCountryId}` },
        { $set: { seq: Math.max(nextSequentialId - 1, ...assigned) } },
        { upsert: true }
      );
  }

  return {
    wholesale: plan.wholesale.length,
    independentized: plan.independentized.length,
    idMap: plan.idMap,
  };
}
