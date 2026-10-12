import { splitPartyOrgReserves } from "./rules/partyOrganization";
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
import { type Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import { TIER_LOSE_REGION_ORG_PCT } from "@/lib/parties/partyTier";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { Counter } from "@/lib/db/types/counter";
import type { State } from "@/lib/db/types/state";
import { populationWeights } from "./apportion";
import { SUB_REGION_SEEDS, CAPITAL_SUBREGION, type SecedingCountryId } from "./subRegions";
import { planPartyRemap, type RegionParty } from "./partyRemap";

/** Region-party ledger collections dissolved on secession (the new country reseeds). */
const REGION_PARTY_LEDGERS = [
  "partyBudget",
  "partyPoliticalStrengthLedger",
  "orgRegLedger",
  "billWhips",
  "statePartyElections",
] as const;

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

  // "Outside presence" must mean the party is actually organised outside the
  // seceding region, not merely that a row exists there. Every party now holds
  // a seed-floor org row in every region (the UK regional parties included,
  // since the home-nation ballot gate was removed), so a bare row proves
  // nothing. Anything below the tier system's own "meaningfully present"
  // threshold is treated as no presence — otherwise a token floor row would
  // flip Sinn Fein or the SNP from a wholesale transfer to being dissolved on
  // the secession their region just voted for.
  const hasOutsidePresence = (seqId: number): boolean =>
    officials.some((o) => o.party === String(seqId) && o.state !== regionId) ||
    orgs.some(
      (g) =>
        g.partyId === String(seqId) &&
        g.stateId !== regionId &&
        (g.organization ?? 0) >= TIER_LOSE_REGION_ORG_PCT
    );

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: fromCountryId })
    .toArray()
    .then((rows) => rows.map((row) => ({ ...row })));
  const partyBySeq = new Map(parties.map((p) => [p.sequentialId, p]));
  const partyAbbrevById: Record<number, string> = {};
  const regionParties: RegionParty[] = [];
  for (const seqId of regionSeqIds) {
    const party = partyBySeq.get(seqId);
    if (!party) continue;
    partyAbbrevById[seqId] = party.abbreviation;
    regionParties.push({ sequentialId: seqId, isRegionHomed: !hasOutsidePresence(seqId) });
  }

  const residentLeaders = await db
    .collection("characters")
    .find(
      { countryId: { $in: [fromCountryId, toCountryId] } },
      { projection: { _id: 1, countryId: 1, party: 1 } }
    )
    .toArray()
    .then((rows) => rows.map((row) => ({ ...row })));

  // Next free sequentialId in the new country (stood up fresh — usually 1).
  const existingNew = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: toCountryId })
    .toArray();
  const nextSequentialId = existingNew.reduce((m, p) => Math.max(m, p.sequentialId ?? 0), 0) + 1;

  const plan = planPartyRemap({ majorPartyIds, regionParties, partyAbbrevById, nextSequentialId });

  if (!plan.wholesale.length && !plan.independentized.length)
    return { wholesale: 0, independentized: 0, idMap: {} };

  const successorStates = await db
    .collection<State>("states")
    .find({ countryId: toCountryId })
    .toArray();
  const regions = successorStates.length ? successorStates : SUB_REGION_SEEDS[toCountryId];
  const shares = populationWeights(regions);

  // ── Wholesale: flip the region-homed major's doc to the new country ─────────
  for (const oldSeq of plan.wholesale) {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { sequentialId: oldSeq, countryId: fromCountryId },
        { $set: { countryId: toCountryId, sequentialId: plan.idMap[oldSeq], updatedAt: now } }
      );
  }

  // Snapshot both actor rosters before any party id changes can collide.
  const memberOps = async (collection: "characters" | "npps") => {
    const members = await db
      .collection(collection)
      .find({ countryId: toCountryId }, { projection: { _id: 1, party: 1 } })
      .toArray();
    const ops = members.map((member) => ({
      updateOne: {
        filter: { _id: member._id },
        update: {
          $set: {
            party:
              plan.idMap[Number(member.party)] != null
                ? String(plan.idMap[Number(member.party)])
                : "independent",
            updatedAt: now,
          },
        },
      },
    }));
    if (ops.length && (plan.wholesale.length || plan.independentized.length))
      await db.collection(collection).bulkWrite(ops);
  };
  await memberOps("characters");
  await memberOps("npps");

  // Office permissions cannot stay with a party member who crossed into another country.
  const leadershipOps = parties.map((party) => {
    const destination = plan.idMap[party.sequentialId] !== undefined ? toCountryId : fromCountryId;
    const allowed = new Set(
      residentLeaders
        .filter(
          (actor) =>
            actor.countryId === destination && String(actor.party) === String(party.sequentialId)
        )
        .map((actor) => String(actor._id))
    );
    const retain = (id: PoliticalParty["chairId"]) => (id && allowed.has(String(id)) ? id : null);
    return {
      updateOne: {
        filter: { _id: party._id },
        update: {
          $set: {
            chairId: retain(party.chairId),
            viceChairId: retain(party.viceChairId),
            treasurerId: retain(party.treasurerId),
            campaignerIds: (party.campaignerIds ?? []).filter((id) => allowed.has(String(id))),
            committeeIds: (party.committeeIds ?? []).filter((id) => allowed.has(String(id))),
            shadowCabinet: Object.fromEntries(
              Object.entries(party.shadowCabinet ?? {}).filter(([, appointment]) =>
                allowed.has(String(appointment.characterId))
              )
            ),
          },
        },
      },
    };
  });
  if (leadershipOps.length)
    await db.collection<PoliticalParty>("politicalParties").bulkWrite(leadershipOps);

  const movedOrgs: StatePartyOrg[] = [];
  const refunds = new Map<number, number>();
  const pools = await db
    .collection<{ _id: string; stateId: string; independent: number }>("stateRegistrationPool")
    .find({ countryId: toCountryId })
    .toArray();
  const removedRegistration = orgs
    .filter((org) => org.stateId === regionId && plan.idMap[Number(org.partyId)] == null)
    .reduce((sum, org) => sum + (org.registration ?? 0), 0);
  for (const org of orgs) {
    const oldSeq = Number(org.partyId);
    const mapped = plan.idMap[oldSeq];
    if (mapped !== undefined && org.stateId === regionId) {
      for (const region of regions)
        movedOrgs.push({
          ...org,
          _id: `${toCountryId}_${region._id}_${mapped}`,
          countryId: toCountryId,
          stateId: region._id,
          partyId: String(mapped),
          ...splitPartyOrgReserves(org, shares[region._id]),
          chairId:
            region._id === capital &&
            residentLeaders.some(
              (actor) =>
                String(actor._id) === String(org.chairId) &&
                actor.countryId === toCountryId &&
                String(actor.party) === String(oldSeq)
            )
              ? org.chairId
              : null,
          viceChairId:
            region._id === capital &&
            residentLeaders.some(
              (actor) =>
                String(actor._id) === String(org.viceChairId) &&
                actor.countryId === toCountryId &&
                String(actor.party) === String(oldSeq)
            )
              ? org.viceChairId
              : null,
          treasurerId:
            region._id === capital &&
            residentLeaders.some(
              (actor) =>
                String(actor._id) === String(org.treasurerId) &&
                actor.countryId === toCountryId &&
                String(actor.party) === String(oldSeq)
            )
              ? org.treasurerId
              : null,
          campaignerId:
            region._id === capital &&
            residentLeaders.some(
              (actor) =>
                String(actor._id) === String(org.campaignerId) &&
                actor.countryId === toCountryId &&
                String(actor.party) === String(oldSeq)
            )
              ? org.campaignerId
              : null,
        });
    } else if (org.stateId === regionId || mapped !== undefined) {
      refunds.set(oldSeq, (refunds.get(oldSeq) ?? 0) + (org.treasury ?? 0));
    }
  }
  if (movedOrgs.length) await db.collection<StatePartyOrg>("statePartyOrg").insertMany(movedOrgs);
  await db.collection<StatePartyOrg>("statePartyOrg").deleteMany({
    countryId: fromCountryId,
    $or: [{ stateId: regionId }, { partyId: { $in: plan.wholesale.map(String) } }],
  });
  const refundOps = [...refunds].map(([old, amount]) => {
    const owner = partyBySeq.get(old);
    if (!owner) throw new Error("Regional party funds have no surviving owner");
    return {
      updateOne: {
        filter: { _id: owner._id },
        update: { $inc: { treasury: amount } },
      },
    };
  });
  if (refundOps.length)
    await db.collection<PoliticalParty>("politicalParties").bulkWrite(refundOps);
  if (pools.length && removedRegistration > 0)
    await db.collection<{ _id: string; independent: number }>("stateRegistrationPool").bulkWrite(
      pools.map((pool) => ({
        updateOne: {
          filter: { _id: pool._id },
          update: { $set: { independent: pool.independent + removedRegistration } },
        },
      }))
    );

  const wholesaleIds = plan.wholesale.map(String);
  // Outside seed-floor organisations retire with their party. Restore their registrations to the local independent pool.
  const outside = orgs.filter(
    (org) => org.stateId !== regionId && wholesaleIds.includes(org.partyId)
  );
  if (outside.length)
    await db.collection<{ _id: string; independent: number }>("stateRegistrationPool").bulkWrite(
      outside.map((org) => ({
        updateOne: {
          filter: { _id: `${fromCountryId}_${org.stateId}` },
          update: { $inc: { independent: org.registration ?? 0 } },
        },
      }))
    );
  const outsideMembers = { countryId: fromCountryId, party: { $in: wholesaleIds } };
  const independentize = { $set: { party: "independent", updatedAt: now } };
  await db.collection("characters").updateMany(outsideMembers, independentize);
  await db.collection("npps").updateMany(outsideMembers, independentize);
  const budgets = await db
    .collection("partyBudget")
    .find({ countryId: fromCountryId, scope: "national", partyId: { $in: wholesaleIds } })
    .toArray();
  if (budgets.length)
    await db.collection("partyBudget").bulkWrite(
      budgets.map((row) => ({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              countryId: toCountryId,
              partyId: String(plan.idMap[Number(row.partyId)]),
              updatedAt: now,
            },
          },
        },
      }))
    );
  const remapRoster = async (
    collection: "recruitmentSlates" | "statePartyCandidates" | "slateCandidates"
  ) => {
    const rows = await db
      .collection(collection)
      .find(
        {
          $or: [
            { countryId: toCountryId },
            {
              countryId: fromCountryId,
              $or: [{ party: { $in: wholesaleIds } }, { partyId: { $in: wholesaleIds } }],
            },
          ],
        },
        { projection: { _id: 1, countryId: 1, party: 1, partyId: 1 } }
      )
      .toArray();
    if (rows.length)
      await db.collection(collection).bulkWrite(
        rows.map((row) => ({
          updateOne: {
            filter: { _id: row._id },
            update: {
              $set: {
                ...(row.party != null
                  ? {
                      party:
                        row.countryId === toCountryId && plan.idMap[Number(row.party)] != null
                          ? String(plan.idMap[Number(row.party)])
                          : "independent",
                    }
                  : {}),
                ...(row.partyId != null
                  ? {
                      partyId:
                        row.countryId === toCountryId && plan.idMap[Number(row.partyId)] != null
                          ? String(plan.idMap[Number(row.partyId)])
                          : "independent",
                    }
                  : {}),
              },
            },
          },
        }))
      );
  };
  await remapRoster("recruitmentSlates");
  await remapRoster("statePartyCandidates");
  await remapRoster("slateCandidates");

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
