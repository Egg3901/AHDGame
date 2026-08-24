/**
 * Per-turn slate processing.
 *
 * Two coupled passes:
 *
 * 1) `processSlateResponses(ctx)` — for every `invited` (and any legacy
 *    `considering`) SlateCandidate, runs the deterministic resolver
 *    (`decideNPPSlateResponse`), which decides on the NPP's compliance, and
 *    writes the result (`accepted` / `declined`) back to the slate row.
 *
 * 2) `fileAcceptedSlateRows(ctx)` — for every `accepted` SlateCandidate that
 *    hasn't yet been converted, inserts a corresponding `ElectionCandidate`
 *    on the parent election and marks the slate row `filed`. Called from
 *    `processElectionEntry` AFTER incumbent defenders re-file but BEFORE the
 *    generic party-pool fallback so Slate challengers can still create a
 *    same-party primary against the sitting NPP.
 *
 * Both passes are idempotent — re-running the same turn is a no-op once
 * everything that can transition has transitioned.
 */

import { ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  PoliticalParty,
  RecruitmentSlate,
  SlateCandidate,
} from "@/lib/db/types";
import type { NPPContext } from "./context";
import { decideNPPSlateResponse } from "./slateResponse";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { materializeSlateAssignmentsFromTemplate } from "@/lib/db/recruitmentSlateLookup";
import { isElectionTypeEntryBlocked } from "@/lib/elections/nationwideExecutive";
import { isPrimaryClosed } from "@/lib/elections/electionDeadlineFilters";
import { canPartyContestState } from "@/lib/parties/regionalContest";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  canFieldExecutiveCandidate,
  canFieldLegislativeCandidate,
} from "@/lib/turn/onePartyConstraints";

interface SlateResponseSummary {
  rowsConsidered: number;
  accepted: number;
  declined: number;
}

interface SlateFilingSummary {
  rowsConsidered: number;
  filed: number;
  skipped: number;
}

export async function syncPersistentSlateAssignments(ctx: NPPContext): Promise<number> {
  const { db, now, openPrimaries, partyByCompositeKey } = ctx;

  // 1) Build the full matrix of (election, party) pairs that qualify.
  const pairs: { election: Election; party: PoliticalParty }[] = [];
  const parties = Array.from(partyByCompositeKey.values());
  for (const election of openPrimaries) {
    if (election.electionType === "president") continue;
    if (isElectionTypeEntryBlocked(election.electionType)) continue;
    const electionCountry = election.countryId ?? "US";
    for (const party of parties) {
      const partyCountry = (party.countryId ?? "US") as PoliticalParty["countryId"];
      if (partyCountry !== electionCountry) continue;
      if (
        ctx.nppElectionEligiblePartyKeys &&
        !ctx.nppElectionEligiblePartyKeys.has(`${partyCountry}:${party.sequentialId}`)
      ) {
        continue;
      }
      pairs.push({ election, party });
    }
  }
  if (pairs.length === 0) return 0;

  // 2) Batch-fetch any existing slates for these (party, election) pairs.
  const electionIds = Array.from(new Set(pairs.map((p) => p.election._id.toString()))).map(
    (id) => new ObjectId(id)
  );
  const partyIds = Array.from(new Set(pairs.map((p) => String(p.party.sequentialId))));
  const existingSlates = await db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find({
      electionId: { $in: electionIds },
      partyId: { $in: partyIds },
    })
    .toArray();
  const slateKey = (s: RecruitmentSlate) =>
    `${s.countryId}:${s.partyId}:${s.electionId.toString()}`;
  const slateByKey = new Map(existingSlates.map((s) => [slateKey(s), s]));

  // 3) Batch-count candidates for all existing slates in one aggregate.
  const slateIdsWithRows = new Set<string>();
  if (existingSlates.length > 0) {
    const slateObjectIds = existingSlates.map((s) => s._id);
    const counts = await db
      .collection<SlateCandidate>("slateCandidates")
      .aggregate<{ _id: ObjectId; count: number }>([
        { $match: { slateId: { $in: slateObjectIds } } },
        { $group: { _id: "$slateId", count: { $sum: 1 } } },
      ])
      .toArray();
    for (const c of counts) {
      if (c.count > 0) slateIdsWithRows.add(c._id.toString());
    }
  }

  // 3b) A template only exists for a pair if there's at least one OTHER
  // recruitmentSlate with the same (country, party, state, electionType) —
  // that's exactly `findLatestSlateTemplate`'s precondition. Pre-load the set
  // of tuples that have ANY slate, once, so step 4 can skip pairs that can't
  // possibly have a template without a per-pair DB round-trip. This was the
  // single biggest turn hotspot (~1.8s): in a pure-NPP world there are zero
  // recruitmentSlates (the slate/recruitment system is player-chair-driven),
  // yet step 4 fired a `findLatestSlateTemplate` query for every one of the
  // hundreds of (election, party) pairs every turn, all returning null. This
  // collapses those hundreds of queries into one (empty here), and even in a
  // player world skips the vast majority of pairs that never had a slate.
  const templateTupleKey = (
    countryId: string,
    partyId: string,
    state: string | null | undefined,
    electionType: string
  ) => `${countryId}:${partyId}:${state ?? ""}:${electionType}`;
  const slateCountries = Array.from(new Set(pairs.map((p) => p.election.countryId ?? "US")));
  const tuplesWithSlate = new Set<string>();
  const slatesForTemplates = await db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find(
      { countryId: { $in: slateCountries as RecruitmentSlate["countryId"][] } },
      { projection: { countryId: 1, partyId: 1, state: 1, electionType: 1 } }
    )
    .toArray();
  for (const s of slatesForTemplates) {
    tuplesWithSlate.add(templateTupleKey(s.countryId, s.partyId, s.state, s.electionType));
  }

  // 4) Only materialize pairs that are genuinely empty or missing AND could
  // actually source a template.
  let materialized = 0;
  for (const { election, party } of pairs) {
    const electionCountry = election.countryId ?? "US";
    const partyId = String(party.sequentialId);
    const key = `${electionCountry}:${partyId}:${election._id.toString()}`;
    const existing = slateByKey.get(key) ?? null;
    if (existing && slateIdsWithRows.has(existing._id.toString())) {
      continue; // Already has candidates — skip.
    }
    if (
      !tuplesWithSlate.has(
        templateTupleKey(electionCountry, partyId, election.state, election.electionType)
      )
    ) {
      continue; // No slate exists for this (country,party,state,type) — no template possible.
    }

    const slate = await materializeSlateAssignmentsFromTemplate({
      db,
      countryId: electionCountry,
      partyId,
      election,
      now,
      knownEmptySlate: existing,
      partyAbbreviation: party.abbreviation ?? null,
    });
    if (slate) materialized += 1;
  }
  return materialized;
}

export async function processSlateResponses(ctx: NPPContext): Promise<SlateResponseSummary> {
  const { db, now, nppMap } = ctx;

  const invitedRows = await db
    .collection<SlateCandidate>("slateCandidates")
    .find({ status: { $in: ["invited", "considering"] }, candidateType: "npp" })
    .toArray();
  if (invitedRows.length === 0) {
    return { rowsConsidered: 0, accepted: 0, declined: 0 };
  }

  // Load slates referenced by these invitations in a single query.
  const slateIds = Array.from(new Set(invitedRows.map((r) => r.slateId.toString()))).map(
    (id) => new ObjectId(id)
  );
  const slates = await db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find({ _id: { $in: slateIds } })
    .toArray();
  const slateById = new Map(slates.map((s) => [s._id.toString(), s]));

  let accepted = 0;
  let declined = 0;
  const bulkOps: import("mongodb").AnyBulkWriteOperation<SlateCandidate>[] = [];

  for (const row of invitedRows) {
    const slate = slateById.get(row.slateId.toString());
    if (!slate || slate.archivedAt) continue;
    const npp = nppMap.get(row.candidateId.toString());
    if (!npp) continue;
    if (
      ctx.nppElectionEligiblePartyKeys &&
      !ctx.nppElectionEligiblePartyKeys.has(`${slate.countryId}:${slate.partyId}`)
    ) {
      bulkOps.push({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              status: "declined",
              refusalReason: "cooldown",
              respondedAt: now,
              updatedAt: now,
            },
          },
        },
      });
      declined += 1;
      continue;
    }

    const cooldownExpiry = npp.electionCooldowns?.[row.electionId.toString()]
      ? new Date(npp.electionCooldowns[row.electionId.toString()])
      : null;
    const isIncumbent =
      ctx.officialsByNPP.get(row.candidateId.toString())?.some((o) => {
        if (slate.electionType === "president") return o.officeType === "president";
        const stateMatch = o.state ? o.state === slate.state : true;
        return stateMatch && officeMatchesElection(o.officeType, slate.electionType);
      }) ?? false;

    const decision = decideNPPSlateResponse({
      npp,
      assignerRole: row.assignedByRole ?? null,
      isIncumbent,
      cooldownExpiry,
      now,
    });

    bulkOps.push({
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: {
            status: decision.status,
            fitScore: decision.fitScore,
            refusalReason: decision.refusalReason,
            respondedAt: now,
            updatedAt: now,
          },
        },
      },
    });

    if (decision.status === "accepted") accepted += 1;
    else declined += 1;
  }

  if (bulkOps.length > 0) {
    await db.collection<SlateCandidate>("slateCandidates").bulkWrite(bulkOps);
  }

  return {
    rowsConsidered: invitedRows.length,
    accepted,
    declined,
  };
}

/**
 * Map an `ElectedOfficial.officeType` onto the `Election.electionType` it
 * defends. Snap variants defend the same seat as the regular variant.
 */
function officeMatchesElection(officeType: string, electionType: string): boolean {
  if (officeType === electionType) return true;
  if (electionType === "snap_commons" && officeType === "commons") return true;
  if (electionType === "snap_shugiin" && officeType === "shugiin") return true;
  return false;
}

function isIncumbentForElection(ctx: NPPContext, candidateId: string, election: Election): boolean {
  const offices = ctx.officialsByNPP.get(candidateId) ?? [];
  return offices.some((office) => {
    const stateMatch = office.state ? office.state === election.state : true;
    return stateMatch && officeMatchesElection(office.officeType, election.electionType);
  });
}

/**
 * Insert ElectionCandidate rows for every accepted slate row that has not
 * yet been filed. Called from `processElectionEntry` after incumbent-defense
 * runs but before the generic party-pool fallback, so accepted slate rows can
 * still create a same-party primary against a defending NPP.
 *
 * Returns counts so the caller can avoid double-filling slots that the
 * slate already covered.
 */
export async function fileAcceptedSlateRows(ctx: NPPContext): Promise<SlateFilingSummary> {
  const { db, now, nppMap, candidatesByElection } = ctx;

  const accepted = (
    await db
      .collection<SlateCandidate>("slateCandidates")
      .find({ status: "accepted", candidateType: "npp", filedAt: null })
      .toArray()
  ).sort(
    (a, b) =>
      b.updatedAt.getTime() - a.updatedAt.getTime() || b.invitedAt.getTime() - a.invitedAt.getTime()
  );
  if (accepted.length === 0) {
    return { rowsConsidered: 0, filed: 0, skipped: 0 };
  }

  // Load only the elections still in primary phase — anything past primary
  // shouldn't accept slate-driven filings, and we want the slate row marked
  // skipped so it doesn't keep retrying.
  const electionIds = Array.from(new Set(accepted.map((r) => r.electionId.toString()))).map(
    (s) => new ObjectId(s)
  );
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: electionIds } })
    .toArray();
  const electionById = new Map(elections.map((e) => [e._id.toString(), e]));
  const candidateIds = Array.from(new Set(accepted.map((r) => r.candidateId.toString()))).map(
    (id) => new ObjectId(id)
  );
  const activeCandidacies =
    candidateIds.length > 0
      ? await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ characterId: { $in: candidateIds }, status: "active" })
          .toArray()
      : [];
  const activeCandidacyByCandidateId = new Map<string, ElectionCandidate>();
  for (const candidacy of activeCandidacies) {
    const key = candidacy.characterId.toString();
    if (!activeCandidacyByCandidateId.has(key)) {
      activeCandidacyByCandidateId.set(key, candidacy);
    }
  }

  let filed = 0;
  let skipped = 0;
  const processedCandidateIds = new Set<string>();
  const processedPartyElectionKeys = new Set<string>();
  const skippedRowIds: ObjectId[] = [];
  const queueSkipped = (row: SlateCandidate) => {
    skippedRowIds.push(row._id);
    skipped += 1;
  };
  for (const row of accepted) {
    try {
      const candidateKey = row.candidateId.toString();
      if (processedCandidateIds.has(candidateKey)) {
        queueSkipped(row);
        continue;
      }
      processedCandidateIds.add(candidateKey);

      const election = electionById.get(row.electionId.toString());
      const npp = nppMap.get(candidateKey);
      if (!election || !npp || npp.retiredAt) {
        queueSkipped(row);
        continue;
      }
      const electionCountry = election.countryId ?? "US";
      const rowCountry = row.countryId ?? electionCountry;
      const nppCountry = npp.countryId ?? "US";
      if (rowCountry !== electionCountry || nppCountry !== electionCountry) {
        queueSkipped(row);
        continue;
      }
      if (election.state && npp.homeState !== election.state) {
        queueSkipped(row);
        continue;
      }
      const slateParty = ctx.partyByCompositeKey.get(`${electionCountry}:${row.partyId}`);
      const opsConfig = COUNTRY_CONFIGS[electionCountry as CountryId];
      if (opsConfig?.governmentType === "onePartyState") {
        if (!canFieldLegislativeCandidate(opsConfig, slateParty ?? null)) {
          queueSkipped(row);
          continue;
        }
        if (!canFieldExecutiveCandidate(opsConfig, slateParty ?? null, election.electionType)) {
          queueSkipped(row);
          continue;
        }
      }
      if (
        !canPartyContestState({
          countryId: electionCountry,
          abbreviation: slateParty?.abbreviation,
          stateId: election.state,
        })
      ) {
        queueSkipped(row);
        continue;
      }
      if (
        ctx.nppElectionEligiblePartyKeys &&
        !ctx.nppElectionEligiblePartyKeys.has(`${rowCountry}:${row.partyId}`)
      ) {
        queueSkipped(row);
        continue;
      }

      if (election.status !== "active" && election.status !== "upcoming") {
        // Keep the manual slate assignment intact for archival/template carryover;
        // once the race is closed this row should stop filing for this cycle but
        // still persist until leadership manually changes it.
        skipped += 1;
        continue;
      }

      // A race stays `status: "active"` all the way through its general phase —
      // status alone never flips when the primary closes. Filing a fresh slate
      // candidate after the primary has resolved would drop them straight into
      // the general election, bypassing the primary entirely. Block it once the
      // primary boundary has passed (turn-first, drift-immune). Like the closed
      // branch above, keep the assignment for template carryover.
      if (isPrimaryClosed(election, ctx.currentTurn, now)) {
        skipped += 1;
        continue;
      }

      const partyElectionKey = `${row.electionId.toString()}_${row.partyId}`;
      if (processedPartyElectionKeys.has(partyElectionKey)) {
        queueSkipped(row);
        continue;
      }

      const activeCandidacy = activeCandidacyByCandidateId.get(candidateKey) ?? null;
      if (activeCandidacy && activeCandidacy.electionId.toString() === election._id.toString()) {
        await db
          .collection<SlateCandidate>("slateCandidates")
          .updateOne({ _id: row._id }, { $set: { status: "filed", filedAt: now, updatedAt: now } });
        filed += 1;
        continue;
      }

      const activeSamePartyNpps = (candidatesByElection.get(election._id.toString()) ?? []).filter(
        (candidate) =>
          candidate.party === row.partyId &&
          candidate.status === "active" &&
          candidate.isNPP === true
      );
      const activeIncumbents = activeSamePartyNpps.filter((candidate) =>
        candidate.nppId ? isIncumbentForElection(ctx, candidate.nppId.toString(), election) : false
      );
      const activeChallengers = activeSamePartyNpps.length - activeIncumbents.length;

      // Slate may create one same-party challenger alongside a defending
      // incumbent, but should not keep stacking extra same-party Slate NPPs once
      // that challenger slot is already occupied.
      //
      // This capacity check MUST run before the move below withdraws the NPP's
      // existing candidacy in another race — otherwise a skipped row still
      // pulls the NPP out of the race they hold, leaving them running nowhere
      // (ticket #1181).
      if (
        activeChallengers > 0 ||
        (activeIncumbents.length === 0 && activeSamePartyNpps.length > 0)
      ) {
        queueSkipped(row);
        continue;
      }

      if (activeCandidacy && activeCandidacy.electionId.toString() !== election._id.toString()) {
        // Slate assignments are chair-issued reassignment orders. When an NPP is
        // already filed elsewhere, the next filing pass moves them out of the
        // old race before seating them in the newly assigned one so the chair's
        // latest instruction wins without waiting for manual cleanup.
        await db.collection<ElectionCandidate>("electionCandidates").updateOne(
          { _id: activeCandidacy._id },
          {
            $set: {
              status: "withdrawn",
              withdrawnAt: now,
            },
          }
        );
        const oldElectionCandidates = candidatesByElection.get(
          activeCandidacy.electionId.toString()
        );
        const oldCandidate = oldElectionCandidates?.find(
          (candidate) => candidate._id.toString() === activeCandidacy._id.toString()
        );
        if (oldCandidate) {
          oldCandidate.status = "withdrawn";
          oldCandidate.withdrawnAt = now;
        }
        ctx.nppCandidacies.delete(row.candidateId.toString());
      }

      const candidateDoc: Omit<ElectionCandidate, "_id"> = {
        electionId: election._id,
        countryId: electionCountry as ElectionCandidate["countryId"],
        characterId: npp._id,
        characterName: npp.name,
        party: row.partyId,
        status: "active",
        support: DEFAULT_CANDIDATE_SUPPORT,
        enteredAt: now,
        isNPP: true,
        nppId: npp._id,
      };
      await db
        .collection<ElectionCandidate>("electionCandidates")
        .insertOne(candidateDoc as ElectionCandidate);

      // Mirror the new candidate into the in-memory map so the rest of
      // processElectionEntry sees the slot as filled.
      if (!candidatesByElection.has(election._id.toString())) {
        candidatesByElection.set(election._id.toString(), []);
      }
      candidatesByElection.get(election._id.toString())!.push({
        ...candidateDoc,
        _id: new ObjectId(),
      } as ElectionCandidate);
      ctx.nppCandidacies.add(npp._id.toString());
      processedPartyElectionKeys.add(partyElectionKey);

      await db
        .collection<SlateCandidate>("slateCandidates")
        .updateOne({ _id: row._id }, { $set: { status: "filed", filedAt: now, updatedAt: now } });
      filed += 1;
    } catch (error) {
      // Never let one bad row abort the whole filing pass — leave it accepted
      // for retry on the next turn and move on to the others.
      console.error(
        `[Turn] fileAcceptedSlateRows: failed to process slate row ${row._id.toString()}; leaving it for retry:`,
        error
      );
      continue;
    }
  }

  if (skippedRowIds.length > 0) {
    await db.collection<SlateCandidate>("slateCandidates").bulkWrite(
      skippedRowIds.map((rowId) => ({
        updateOne: {
          filter: { _id: rowId },
          update: {
            $set: {
              status: "withdrawn",
              respondedAt: now,
              updatedAt: now,
            },
          },
        },
      }))
    );
  }

  return { rowsConsidered: accepted.length, filed, skipped };
}
