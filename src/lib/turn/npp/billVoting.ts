// src/lib/turn/npp/billVoting.ts
/**
 * NPP Bill Voting
 *
 * Handles deterministic cross-pressure voting for NPP elected officials in the
 * **federal** legislature (House/Senate chambers). As of Phase 4 of the
 * party-npp-rework, this path is RNG-free: every vote is the sum of four
 * signed forces (ideology, whip, district, donors) with verdict thresholds at
 * ±15. See `crossPressure.ts` for the full model.
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. Cross-pressure verdict: each NPP's vote is `verdictFromForces(forces)` —
 *    deterministic given identical inputs. The full force vector is persisted
 *    to `nppVotePredictions` so the prediction surface (Phase 5) and bug
 *    investigations can replay the exact decision.
 *
 * 2. Whip directive: party whips contribute to the `whip` force, gated by
 *    NPP loyalty + stubbornness. The whip resolution finds the most specific
 *    applicable whip (state party first, then national). Phase 3 stacks
 *    caucus whips on top via the same composer.
 *
 * 3. Multi-seat weighting: NPPs holding multiple seats (e.g., 7 House seats
 *    from a multi-seat election) contribute full seatsHeld weight to the tally.
 *
 * 4. Catch-up voting: Runs every turn so NPPs who gained seats after a bill
 *    opened still vote before it closes. Already-voted NPPs are skipped.
 *
 * 5. Veto override special case: Override votes don't allow abstain — NPPs
 *    must vote for or against overriding. Defaults to "against" if cross-pressure
 *    would produce abstain.
 *
 * Note: This file only processes federal bills from the `bills` collection.
 * State/regional bills (`stateBills` collection) — including those voted on by
 * `stateSenate` and `regionalCouncil` NPPs — are not currently processed here.
 */

import type { Bill, GovernorAddress, NPPVotePrediction } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import type { NPPContext } from "./context";
import { resolveWhipForNPP } from "./whipResolution";
import {
  computeCrossPressureForces,
  computePartyLineForce,
  verdictFromForces,
  type CrossPressureVerdict,
} from "./crossPressure";
import { type CountryId } from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { tallySeatsByParty } from "@/lib/turn/parliamentaryGovernment";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import {
  identifyOppositionParty,
  computeOppositionVoteForce,
} from "@/lib/nppAutonomy/oppositionBehavior";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { NATIONAL_POLICY_STATE_IDS } from "@/lib/policy/nationalStateId";
import { ADDRESS_AGENDA_FORCE_BIAS } from "@/lib/constants/governorOffice";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";

export async function processBillVoting(ctx: NPPContext): Promise<number> {
  const {
    db,
    now,
    nppMap,
    nppOfficials,
    activeBills,
    billWhips,
    statePartyOrgs,
    legislationTypeMap,
    stateDemographicsMap,
    currentTurn,
  } = ctx;

  let votescast = 0;
  const officialsByOfficeType = new Map<string, typeof nppOfficials>();
  for (const official of nppOfficials) {
    const officials = officialsByOfficeType.get(official.officeType) ?? [];
    officials.push(official);
    officialsByOfficeType.set(official.officeType, officials);
  }
  const vetoOverrideOfficials = [
    ...(officialsByOfficeType.get("house") ?? []),
    ...(officialsByOfficeType.get("senate") ?? []),
  ];
  const countryStateByCountry = new Map(
    await Promise.all(
      Array.from(new Set(activeBills.map((bill) => (bill.countryId ?? "US") as CountryId))).map(
        async (countryId) => [countryId, await getCountryState(ctx.db, countryId)] as const
      )
    )
  );

  // Pre-fetch active national (head-of-government) addresses with a
  // non-expired agenda effect, keyed by countryId. Each entry captures the
  // leader's party and the emphasized bill categories. Federal bills
  // sponsored by a co-partisan in an emphasized category pick up a +bias to
  // the ideology force — same mechanic as state agenda bonus, scoped to
  // federal-pipeline bills.
  const nationalStateIds = Object.values(NATIONAL_POLICY_STATE_IDS);
  const addressesByCountry = new Map<CountryId, { partyId: string; categories: Set<string> }[]>();
  if (activeBills.length > 0) {
    const activeNationalAddresses = await db
      .collection<GovernorAddress>("governorAddresses")
      .find({
        stateId: { $in: nationalStateIds },
        "agendaEffect.expiresAtTurn": { $gt: currentTurn },
      })
      .toArray();
    for (const addr of activeNationalAddresses) {
      if (!addr.agendaEffect) continue;
      const list = addressesByCountry.get(addr.countryId) ?? [];
      list.push({
        partyId: addr.agendaEffect.partyId,
        categories: new Set(addr.emphasizedCategories ?? []),
      });
      addressesByCountry.set(addr.countryId, list);
    }
  }

  // V1.7 opposition: for each formed NPP government (at v1), resolve the
  // governing party and the leader of the opposition. Opposition NPPs bloc-vote
  // against the governing party's bills. Gated per country, so player countries
  // and sub-v1 worlds populate nothing and behave exactly as before.
  const oppositionByCountry = new Map<
    CountryId,
    { governingPartyId: string; oppositionPartyId: string }
  >();
  if (activeBills.length > 0) {
    const billCountries = Array.from(
      new Set(activeBills.map((bill) => (bill.countryId ?? "US") as CountryId))
    );
    const govCol = getGovernmentFormationsCollection(db);
    for (const countryId of billCountries) {
      if (!(await nppAutonomyAtLeast(db, countryId, "v1"))) continue;
      const gov = await govCol.findOne({ _id: countryId });
      if (!gov || gov.status !== "formed" || !gov.governingPartyId) continue;
      // Tallied live from electedOfficials rather than `gov.seatsByParty` — a
      // write-triggered cache refreshed only on specific turn events that can
      // drift arbitrarily far from the real chamber between them (measured:
      // BR/NG summed to 0 against real totals of 513/360). A stale zero here
      // would silently drop the opposition bloc-vote for every NPP in the
      // chamber.
      const seatsByParty = await tallySeatsByParty(db, countryId);
      const opposition = identifyOppositionParty(seatsByParty, gov.governingPartyId);
      if (!opposition) continue;
      oppositionByCountry.set(countryId, {
        governingPartyId: gov.governingPartyId,
        oppositionPartyId: opposition.partyId,
      });
    }
  }

  for (const bill of activeBills) {
    const isOtherChamber = bill.status === "active_other";
    const isUSVetoOverride = bill.status === "veto_override";
    const isJPShugiinOverride = bill.status === "override_shugiin";
    const chamberType = bill.currentChamber ?? "house";

    // Bills are country-scoped. US, BR, and others all map their upper chamber
    // to officeType "senate" (likewise "house"), so the global
    // officialsByOfficeType grouping below would otherwise pull every senate
    // NPP across all countries into a single country's bill. Resolve the bill's
    // own country (and its runtime state) once per bill; the per-NPP loop then
    // skips any official from a different country.
    const billCountry = (bill.countryId ?? "US") as CountryId;
    const billRuntime =
      countryStateByCountry.get(billCountry) ?? (await getCountryState(ctx.db, billCountry));

    const relevantOfficials = isUSVetoOverride
      ? vetoOverrideOfficials
      : isJPShugiinOverride
        ? (officialsByOfficeType.get("shugiin") ?? [])
        : (officialsByOfficeType.get(getOfficeTypeForChamber(billCountry, chamberType)) ?? []);

    // Determine vote field — JP override_shugiin uses main "votes" (reset by jpBillLifecycle)
    const voteField = isOtherChamber
      ? "otherChamberVotes"
      : isUSVetoOverride
        ? "vetoOverrideVotes"
        : "votes";
    const existingVotes =
      (isOtherChamber
        ? bill.otherChamberVotes
        : isUSVetoOverride
          ? bill.vetoOverrideVotes
          : bill.votes) ?? {};

    // Get whips for this bill
    const whips = billWhips.get(bill._id.toString()) ?? [];

    const voteUpdates: Record<string, "for" | "against" | "abstain"> = {};
    let incFor = 0,
      incAgainst = 0,
      incAbstain = 0;

    // Predictions to persist for this bill — written in a single bulk op below.
    const predictionOps: Array<{
      nppId: ObjectId;
      forces: { ideology: number; whip: number; district: number; donors: number };
      donorsLabel: string;
      verdict: CrossPressureVerdict;
      resolvedVote: "for" | "against" | "abstain";
    }> = [];

    // Resolve cross-pressure inputs that don't change per NPP.
    const legislationType = bill.legislationTypeId
      ? (legislationTypeMap.get(bill.legislationTypeId) ?? null)
      : null;

    const seenNppIds = new Set<string>();
    for (const official of relevantOfficials) {
      if (!official.nppId) continue;
      const nppIdStr = official.nppId.toString();
      if (seenNppIds.has(nppIdStr)) continue;
      seenNppIds.add(nppIdStr);
      if ((official.countryId ?? "US") !== billCountry) continue;
      const nppKey = `npp_${nppIdStr}`;
      if (existingVotes[nppKey]) continue; // Already voted

      const npp = nppMap.get(official.nppId.toString());
      if (!npp) continue;

      // Technocrat NPPs (isTechnocrat: { $ne: true } at the query layer) are
      // excluded from bill voting — they hold non-partisan office and never
      // cast legislative votes.
      if (npp.isTechnocrat) continue;

      // Country guard: an NPP may only vote on its own country's bills.
      // Root-cause fix for bug #0699 — foreign senators leaked into the US
      // Senate tally and were mislabeled via cross-country party sequentialId
      // collision. npp.countryId is authoritative (always set on NPP docs).
      if ((npp.countryId ?? "US") !== billCountry) continue;

      // One-party-state guard: banned-party NPCs do not vote. Their seat
      // is effectively silent until they regain regime status or lose
      // their seat at next election. Runtime governmentType so a
      // post-Stage-4 conversion immediately lets banned-party NPCs vote
      // again (the regimeStatus itself becomes meaningless after Stage 4
      // since all parties get null status, but the gate ensures we don't
      // silence them in the interim).
      if (billRuntime.governmentType === "onePartyState") {
        const nppParty = ctx.partyByCompositeKey.get(`${billCountry}:${npp.party}`);
        if (isBannedParty({ governmentType: billRuntime.governmentType }, nppParty ?? null)) {
          continue;
        }
      }

      // Find applicable whip (state party first, then national)
      const applicableWhip = resolveWhipForNPP(npp, whips, statePartyOrgs, official.officeType);

      // Compute the four cross-pressure forces and the resulting verdict.
      const homeStateDemographics = stateDemographicsMap.get(npp.homeState) ?? null;
      const { forces, donorsLabel } = computeCrossPressureForces(npp, bill, {
        legislationType,
        homeStateDemographics,
        whips: { partyWhip: applicableWhip, caucusWhip: null },
      });

      // National-address agenda bonus on federal bills. Mirrors the state
      // agenda bonus: if a co-partisan national leader has an active address
      // emphasizing the bill's category, every NPP voting on the bill picks
      // up an additive ideology nudge toward "for", clamped to the normal
      // force range.
      const agendaList = bill.countryId ? (addressesByCountry.get(bill.countryId) ?? null) : null;
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
      // lean FOR their own party's bills. Scaled by compliance so it can be
      // overridden by ideology or an opposition whip.
      if (!applicableWhip) {
        const partyBias = computePartyLineForce(npp, bill.sponsorParty);
        if (partyBias !== 0) {
          forces.ideology = Math.max(-100, Math.min(100, forces.ideology + partyBias));
        }

        // V1.7: the opposition bloc-votes against the governing party's bills.
        const opposition = oppositionByCountry.get(billCountry);
        if (opposition) {
          const oppForce = computeOppositionVoteForce(npp, {
            sponsorParty: bill.sponsorParty,
            governingPartyId: opposition.governingPartyId,
            oppositionPartyId: opposition.oppositionPartyId,
          });
          if (oppForce !== 0) {
            forces.ideology = Math.max(-100, Math.min(100, forces.ideology + oppForce));
          }
        }
      }

      const rawVerdict = verdictFromForces(forces);

      // Override votes don't allow abstain (US veto override or JP Shugiin override).
      let vote: "for" | "against" | "abstain" = rawVerdict;
      if ((isUSVetoOverride || isJPShugiinOverride) && vote === "abstain") {
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

      votescast++;
    }

    if (Object.keys(voteUpdates).length === 0) continue;

    // Build update
    const setFields: Record<string, unknown> = { updatedAt: now };
    for (const [k, v] of Object.entries(voteUpdates)) {
      setFields[`${voteField}.${k}`] = v;
    }

    const incFields: Record<string, number> = {};
    if (isOtherChamber) {
      incFields.otherChamberVotesFor = incFor;
      incFields.otherChamberVotesAgainst = incAgainst;
      incFields.otherChamberVotesAbstain = incAbstain;
    } else if (isUSVetoOverride) {
      incFields.vetoOverrideVotesFor = incFor;
      incFields.vetoOverrideVotesAgainst = incAgainst;
    } else {
      incFields.votesFor = incFor;
      incFields.votesAgainst = incAgainst;
      incFields.votesAbstain = incAbstain;
    }

    await db.collection<Bill>("bills").updateOne(
      { _id: bill._id },
      {
        $set: setFields,
        $inc: incFields,
      }
    );

    // Persist cross-pressure predictions for the prediction surface (Phase 5)
    // and replayable vote audit. One upsert per NPP per bill, keyed by the pair.
    if (predictionOps.length > 0) {
      const collection = db.collection<NPPVotePrediction>("nppVotePredictions");
      await collection.bulkWrite(
        predictionOps.map((op) => ({
          updateOne: {
            filter: { nppId: op.nppId, billId: bill._id },
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
                billId: bill._id,
                createdAt: now,
              },
            },
            upsert: true,
          },
        }))
      );
    }
  }

  return votescast;
}
