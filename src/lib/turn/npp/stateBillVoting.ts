import { getSubNationalLegislatureKey } from "@/lib/constants/countries";
import type { GovernorAddress, NPPVotePrediction, StateBill } from "@/lib/db/types";
import type { NPPContext } from "./context";
import { resolveWhipForNPP } from "./whipResolution";
import {
  computeCrossPressureForces,
  computePartyLineForce,
  verdictFromForces,
  type CrossPressureVerdict,
} from "./crossPressure";
import { ADDRESS_AGENDA_FORCE_BIAS } from "@/lib/constants/governorOffice";

const LOCAL_BILL_FORCE_WEIGHTS = {
  ideology: 1,
  whip: 1,
  // Local legislators should feel home-region issue pressure more sharply than
  // federal legislators because the bill directly governs their own state/region.
  district: 1.35,
  // Local donor ecosystems are intentionally softer than the federal model so
  // regional bills don't become donor-led mirror images of Congress votes.
  donors: 0.65,
} as const;

function isOverrideVote(bill: StateBill): boolean {
  return bill.status === "veto_override";
}

export async function processStateBillVoting(ctx: NPPContext): Promise<number> {
  const {
    db,
    nppMap,
    nppOfficials,
    activeStateBills,
    stateBillWhips,
    statePartyOrgs,
    legislationTypeMap,
    stateDemographicsMap,
    statesById,
    partyByCompositeKey,
    partyCountries,
    currentTurn,
    now,
  } = ctx;

  let votesCast = 0;
  const officialsByOfficeAndState = new Map<string, typeof nppOfficials>();
  for (const official of nppOfficials) {
    if (!official.state) continue;
    const key = `${official.officeType}|${official.state}`;
    const officials = officialsByOfficeAndState.get(key) ?? [];
    officials.push(official);
    officialsByOfficeAndState.set(key, officials);
  }

  // Pre-fetch active governor addresses with a non-expired agenda effect.
  // Keyed by stateId for O(1) lookup inside the per-bill loop. Each entry
  // captures the party that benefits and the emphasized bill categories.
  const stateIdsWithBills = [...new Set(activeStateBills.map((b) => b.stateId))];
  const addressesByState = new Map<string, { partyId: string; categories: Set<string> }[]>();
  if (stateIdsWithBills.length > 0) {
    const activeAddresses = await db
      .collection<GovernorAddress>("governorAddresses")
      .find({
        stateId: { $in: stateIdsWithBills },
        "agendaEffect.expiresAtTurn": { $gt: currentTurn },
      })
      .toArray();
    for (const addr of activeAddresses) {
      if (!addr.agendaEffect) continue;
      const list = addressesByState.get(addr.stateId) ?? [];
      list.push({
        partyId: addr.agendaEffect.partyId,
        categories: new Set(addr.emphasizedCategories ?? []),
      });
      addressesByState.set(addr.stateId, list);
    }
  }

  for (const bill of activeStateBills) {
    const state = statesById.get(bill.stateId);
    if (!state) continue;

    const subNationalOffice = getSubNationalLegislatureKey(state.countryId);
    const relevantOfficials =
      officialsByOfficeAndState.get(`${subNationalOffice}|${bill.stateId}`) ?? [];
    if (relevantOfficials.length === 0) continue;

    const existingVotes = isOverrideVote(bill) ? (bill.overrideVotes ?? {}) : (bill.votes ?? {});
    const whips = stateBillWhips.get(bill._id.toString()) ?? [];
    const legislationType = bill.legislationTypeId
      ? (legislationTypeMap.get(bill.legislationTypeId) ?? null)
      : null;

    const voteUpdates: Record<string, "for" | "against" | "abstain"> = {};
    let incFor = 0;
    let incAgainst = 0;
    let incAbstain = 0;
    const predictionOps: Array<{
      nppId: import("mongodb").ObjectId;
      forces: { ideology: number; whip: number; district: number; donors: number };
      donorsLabel: string;
      verdict: CrossPressureVerdict;
      resolvedVote: "for" | "against" | "abstain";
    }> = [];

    const seenNppIds = new Set<string>();
    for (const official of relevantOfficials) {
      if (!official.nppId) continue;
      const nppIdStr = official.nppId.toString();
      if (seenNppIds.has(nppIdStr)) continue;
      seenNppIds.add(nppIdStr);
      const nppKey = `npp_${nppIdStr}`;
      if (existingVotes[nppKey]) continue;

      const npp = nppMap.get(official.nppId.toString());
      if (!npp) continue;

      // Technocrat NPPs (isTechnocrat: { $ne: true } at the query layer) are
      // excluded from state bill voting — they hold non-partisan office.
      if (npp.isTechnocrat) continue;

      const applicableWhip = resolveWhipForNPP(npp, whips, statePartyOrgs, subNationalOffice, {
        partyByCompositeKey,
        partyCountries,
      });
      const homeStateDemographics = stateDemographicsMap.get(npp.homeState) ?? null;
      const { forces, donorsLabel } = computeCrossPressureForces(npp, bill, {
        legislationType,
        homeStateDemographics,
        whips: { partyWhip: applicableWhip, caucusWhip: null },
        weights: LOCAL_BILL_FORCE_WEIGHTS,
      });

      // Agenda bonus: a State of the State address creates a soft "the
      // governor's party is pushing this through" signal. It applies when the
      // bill is sponsored by a member of the governor's party AND falls in an
      // emphasized category — independent of the voting NPP's own party. Every
      // NPP voting on the bill picks up the nudge toward "for". Clamped to the
      // normal force range.
      const agendaList = addressesByState.get(bill.stateId);
      if (agendaList && bill.category && bill.sponsorParty) {
        for (const addr of agendaList) {
          if (addr.partyId === bill.sponsorParty && addr.categories.has(bill.category)) {
            forces.ideology = Math.max(
              -100,
              Math.min(100, forces.ideology + ADDRESS_AGENDA_FORCE_BIAS)
            );
            break;
          }
        }
      }

      // Party-line default: when no explicit whip is set, co-partisan NPPs
      // lean FOR their own party's bills. Scaled by compliance.
      if (!applicableWhip) {
        const partyBias = computePartyLineForce(npp, bill.sponsorParty);
        if (partyBias !== 0) {
          forces.ideology = Math.max(-100, Math.min(100, forces.ideology + partyBias));
        }
      }

      const rawVerdict = verdictFromForces(forces);
      let vote: "for" | "against" | "abstain" = rawVerdict;
      if (isOverrideVote(bill) && vote === "abstain") {
        vote = "against";
      }

      const weight = official.seatsHeld ?? 1;
      voteUpdates[nppKey] = vote;
      if (vote === "for") incFor += weight;
      else if (vote === "against") incAgainst += weight;
      else incAbstain += weight;

      predictionOps.push({
        nppId: official.nppId,
        forces,
        donorsLabel,
        verdict: rawVerdict,
        resolvedVote: vote,
      });
      votesCast++;
    }

    if (Object.keys(voteUpdates).length === 0) continue;

    const setFields: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(voteUpdates)) {
      const voteField = isOverrideVote(bill) ? "overrideVotes" : "votes";
      setFields[`${voteField}.${key}`] = value;
    }

    const incFields: Record<string, number> = {};
    if (isOverrideVote(bill)) {
      incFields.overrideVotesFor = incFor;
      incFields.overrideVotesAgainst = incAgainst;
    } else {
      incFields.votesFor = incFor;
      incFields.votesAgainst = incAgainst;
      incFields.votesAbstain = incAbstain;
    }

    await db
      .collection<StateBill>("stateBills")
      .updateOne({ _id: bill._id }, { $set: setFields, $inc: incFields });

    if (predictionOps.length > 0) {
      await db.collection<NPPVotePrediction>("nppVotePredictions").bulkWrite(
        predictionOps.map((op) => ({
          updateOne: {
            filter: { nppId: op.nppId, stateBillId: bill._id },
            update: {
              $set: {
                computedAtTurn: currentTurn,
                forces: op.forces,
                donorsLabel: op.donorsLabel,
                verdict: op.verdict,
                resolvedVote: op.resolvedVote,
                updatedAt: now,
              },
              $setOnInsert: {
                nppId: op.nppId,
                stateBillId: bill._id,
                createdAt: now,
              },
            },
            upsert: true,
          },
        }))
      );
    }
  }

  return votesCast;
}
