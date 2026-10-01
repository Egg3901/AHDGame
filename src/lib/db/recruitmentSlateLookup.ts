import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Character,
  Election,
  NPP,
  RecruitmentSlate,
  RecruitmentSlatePriority,
  SlateCandidate,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { computeSlateAssignmentScore, isNppSlateCompliant } from "@/lib/slateAssignments";
import { SLATE_ASSIGNMENT_CAP } from "@/lib/slateAssignmentCap";
import { getSlateAcceptanceStatBonus } from "@/lib/slateAuthority";

/**
 * List all slates owned by a (countryId, partyId). Active by default; pass
 * `includeArchived` to include resolved-election slates for historical views.
 */
export async function listPartySlates(
  db: Db,
  countryId: CountryId,
  partyId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<RecruitmentSlate[]> {
  const filter: Record<string, unknown> = { countryId, partyId };
  if (!includeArchived) filter.archivedAt = null;
  return db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find(filter)
    .sort({ state: 1, createdAt: -1 })
    .toArray();
}

/**
 * Find the single slate for a (party, election) pair, or `null` if it has not
 * been opened yet. Slates are 1:1 per (party, election).
 */
export async function findSlateForElection(
  db: Db,
  countryId: CountryId,
  partyId: string,
  electionId: ObjectId
): Promise<RecruitmentSlate | null> {
  return db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .findOne({ countryId, partyId, electionId });
}

/**
 * Get-or-create a slate for the given election. Used by chair invites and by
 * the turn loop's incumbent auto-slate pass — neither path should fail when a
 * chair tries to slate a race that nobody has touched yet.
 *
 * The `state` and `electionType` fields are denormalized at create-time from
 * `Election` so the country-map view can aggregate by state without a join.
 */
export async function ensureSlate(
  db: Db,
  args: {
    countryId: CountryId;
    partyId: string;
    election: Pick<Election, "_id" | "state" | "electionType">;
    priority?: RecruitmentSlatePriority;
    createdBy: ObjectId | null;
    now: Date;
  }
): Promise<RecruitmentSlate> {
  const existing = await findSlateForElection(db, args.countryId, args.partyId, args.election._id);
  if (existing) return existing;

  const slate: RecruitmentSlate = {
    _id: new ObjectId(),
    countryId: args.countryId,
    partyId: args.partyId,
    electionId: args.election._id,
    state: args.election.state,
    electionType: args.election.electionType,
    priority: args.priority ?? "none",
    archivedAt: null,
    createdBy: args.createdBy,
    createdAt: args.now,
    updatedAt: args.now,
  };
  await db.collection<RecruitmentSlate>("recruitmentSlates").insertOne(slate);
  return slate;
}

/**
 * List all candidates on a slate, oldest invitation first. Returned regardless
 * of status so the chair can see declined / withdrawn rows alongside accepted
 * ones.
 */
export async function listSlateCandidates(db: Db, slateId: ObjectId): Promise<SlateCandidate[]> {
  return db
    .collection<SlateCandidate>("slateCandidates")
    .find({ slateId })
    .sort({ invitedAt: 1 })
    .toArray();
}

/**
 * Should a slate row appear on the chair's Slate tab?
 *
 * Withdrawn rows are tombstones, but they come from two places. A reasonless
 * one is a chair action — they removed the row, or reassigned that NPP to
 * another race in the same region — and stays hidden. One carrying a
 * `refusalReason` is the turn's filing pass reporting that it could not put
 * the chair's pick on the ballot; before #1181 those were hidden too, so a
 * chair-assigned NPP silently vanished and read as an assignment that never
 * saved.
 */
export function isSlateRowVisibleToChair(
  row: Pick<SlateCandidate, "status" | "refusalReason">
): boolean {
  return row.status !== "withdrawn" || row.refusalReason !== null;
}

/** List candidates across many slates in a single query (UI overview path). */
export async function listSlateCandidatesByIds(
  db: Db,
  slateIds: ObjectId[]
): Promise<SlateCandidate[]> {
  if (slateIds.length === 0) return [];
  return db
    .collection<SlateCandidate>("slateCandidates")
    .find({ slateId: { $in: slateIds } })
    .toArray();
}

/**
 * Candidate IDs already assigned to a non-withdrawn slot in another live race
 * in this (state, party). Used by the slate-detail endpoint to grey those
 * candidates out in the picker.
 *
 * Restricted to slates whose election is still `upcoming` or `active` — slates
 * for resolved elections persist as cross-cycle templates
 * ([[findLatestSlateTemplate]]) and must not block the picker for fresh races.
 * Bug #0573.
 */
export async function listStateAssignedCandidateIds(
  db: Db,
  {
    countryId,
    partyId,
    state,
  }: {
    countryId: CountryId;
    partyId: string;
    state: string;
  }
): Promise<string[]> {
  const liveElectionIds = (
    await db
      .collection<Election>("elections")
      .find({
        countryId,
        state,
        status: { $in: ["upcoming", "active"] },
      })
      .project<Pick<Election, "_id">>({ _id: 1 })
      .toArray()
  ).map((e) => e._id);
  if (liveElectionIds.length === 0) return [];

  const sameStateSlates = await db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find({
      countryId,
      partyId,
      state,
      archivedAt: null,
      electionId: { $in: liveElectionIds },
    })
    .project<Pick<RecruitmentSlate, "_id">>({ _id: 1 })
    .toArray();
  if (sameStateSlates.length === 0) return [];

  const candidateIds = (
    await db
      .collection<SlateCandidate>("slateCandidates")
      .find({
        slateId: { $in: sameStateSlates.map((slate) => slate._id) },
        status: { $ne: "withdrawn" },
      })
      .project<Pick<SlateCandidate, "candidateId">>({ candidateId: 1 })
      .toArray()
  ).map((row) => row.candidateId.toString());
  return Array.from(new Set(candidateIds));
}

interface SlateTemplateMaterializationArgs {
  db: Db;
  countryId: CountryId;
  partyId: string;
  election: Pick<
    Election,
    "_id" | "countryId" | "state" | "electionType" | "cycle" | "senateClass" | "chamberClass"
  >;
  now: Date;
  /** When provided, the caller has already verified this slate has zero candidates.
   *  Skips the findSlateForElection + countDocuments checks. */
  knownEmptySlate?: RecruitmentSlate | null;
  /** Template, rows, and roster already loaded by `prefetchSlateTemplates`.
   *  When set, `knownEmptySlate` is authoritative (null means no slate exists)
   *  and no reads are issued. */
  prefetched?: SlateTemplatePrefetch;
}

type TemplateElection = Pick<Election, "_id" | "cycle" | "senateClass" | "chamberClass">;
type TemplateTarget = SlateTemplateMaterializationArgs["election"];

export interface SlateTemplatePrefetch {
  template: RecruitmentSlate | null;
  rows: SlateCandidate[];
  nppById: Map<string, NPP>;
  characterById: Map<string, Character>;
}

/**
 * Pick the template slate for `election` from candidate slates that already
 * match (country, party, state, electionType) and are sorted updatedAt desc.
 * Newest prior cycle wins, then most recently updated.
 */
function selectSlateTemplate(
  candidates: RecruitmentSlate[],
  electionById: Map<string, TemplateElection>,
  election: TemplateTarget
): RecruitmentSlate | null {
  const senateClass = election.senateClass ?? null;
  const chamberClass = election.chamberClass ?? null;
  return (
    candidates
      .filter((candidate) => {
        if (candidate.electionId.equals(election._id)) return false;
        const templateElection = electionById.get(candidate.electionId.toString());
        if (!templateElection) return false;
        if (templateElection.cycle >= election.cycle) return false;
        if ((templateElection.senateClass ?? null) !== senateClass) return false;
        if ((templateElection.chamberClass ?? null) !== chamberClass) return false;
        return true;
      })
      .sort((a, b) => {
        const aCycle = electionById.get(a.electionId.toString())?.cycle ?? -1;
        const bCycle = electionById.get(b.electionId.toString())?.cycle ?? -1;
        return bCycle - aCycle || b.updatedAt.getTime() - a.updatedAt.getTime();
      })[0] ?? null
  );
}

async function loadTemplateElections(
  db: Db,
  slates: RecruitmentSlate[]
): Promise<Map<string, TemplateElection>> {
  if (slates.length === 0) return new Map();
  const ids = Array.from(new Set(slates.map((slate) => slate.electionId.toString()))).map(
    (id) => new ObjectId(id)
  );
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: ids } })
    .project<TemplateElection>({ _id: 1, cycle: 1, senateClass: 1, chamberClass: 1 })
    .toArray();
  return new Map(elections.map((election) => [election._id.toString(), election]));
}

/**
 * Batch form of the per-election template lookup for the turn's slate sync.
 * Resolves every target's template with the same selection rules as
 * `materializeSlateAssignmentsFromTemplate`, using a fixed number of reads
 * instead of five per target. Keyed by `${countryId}:${partyId}:${electionId}`.
 */
export async function prefetchSlateTemplates(
  db: Db,
  targets: { countryId: CountryId; partyId: string; election: TemplateTarget }[]
): Promise<Map<string, SlateTemplatePrefetch>> {
  const result = new Map<string, SlateTemplatePrefetch>();
  if (targets.length === 0) return result;

  const slates = await db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find({
      countryId: { $in: Array.from(new Set(targets.map((t) => t.countryId))) },
      partyId: { $in: Array.from(new Set(targets.map((t) => t.partyId))) },
      electionType: { $in: Array.from(new Set(targets.map((t) => t.election.electionType))) },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  const electionById = await loadTemplateElections(db, slates);

  const groupKey = (countryId: string, partyId: string, electionType: string) =>
    `${countryId}:${partyId}:${electionType}`;
  const slatesByGroup = new Map<string, RecruitmentSlate[]>();
  for (const slate of slates) {
    const key = groupKey(slate.countryId, slate.partyId, slate.electionType);
    const group = slatesByGroup.get(key);
    if (group) group.push(slate);
    else slatesByGroup.set(key, [slate]);
  }

  const templateByTarget = new Map<string, RecruitmentSlate>();
  for (const { countryId, partyId, election } of targets) {
    const state = election.state ?? null;
    const candidates = (
      slatesByGroup.get(groupKey(countryId, partyId, election.electionType)) ?? []
    ).filter((slate) => (slate.state ?? null) === state);
    const template = selectSlateTemplate(candidates, electionById, election);
    if (template) templateByTarget.set(`${countryId}:${partyId}:${election._id}`, template);
  }

  const templateIds = Array.from(
    new Set(Array.from(templateByTarget.values(), (t) => t._id.toString()))
  ).map((id) => new ObjectId(id));
  const rows =
    templateIds.length === 0
      ? []
      : await db
          .collection<SlateCandidate>("slateCandidates")
          .find({ slateId: { $in: templateIds } })
          .sort({ invitedAt: 1 })
          .toArray();
  const rowsBySlateId = new Map<string, SlateCandidate[]>();
  for (const row of rows) {
    const key = row.slateId.toString();
    const list = rowsBySlateId.get(key);
    if (list) list.push(row);
    else rowsBySlateId.set(key, [row]);
  }

  const idsOfType = (type: SlateCandidate["candidateType"]) =>
    rows.filter((row) => row.candidateType === type).map((row) => row.candidateId);
  const nppIds = idsOfType("npp");
  const characterIds = idsOfType("character");
  const [npps, characters] = await Promise.all([
    nppIds.length === 0
      ? Promise.resolve([] as NPP[])
      : db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray(),
    characterIds.length === 0
      ? Promise.resolve([] as Character[])
      : db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds } })
          .toArray(),
  ]);
  const nppById = new Map(npps.map((npp) => [npp._id.toString(), npp]));
  const characterById = new Map(characters.map((c) => [c._id.toString(), c]));

  for (const { countryId, partyId, election } of targets) {
    const key = `${countryId}:${partyId}:${election._id}`;
    const template = templateByTarget.get(key) ?? null;
    result.set(key, {
      template,
      rows: template ? (rowsBySlateId.get(template._id.toString()) ?? []) : [],
      nppById,
      characterById,
    });
  }
  return result;
}

/**
 * Carry forward the most recent non-withdrawn slate assignments for the same
 * (party, state, electionType) into a newly opened election. This keeps the
 * chair's board persistent across cycles without inventing a second template
 * collection.
 */
export async function materializeSlateAssignmentsFromTemplate({
  db,
  countryId,
  partyId,
  election,
  now,
  knownEmptySlate,
  prefetched,
}: SlateTemplateMaterializationArgs): Promise<RecruitmentSlate | null> {
  const existing = prefetched
    ? (knownEmptySlate ?? null)
    : (knownEmptySlate ?? (await findSlateForElection(db, countryId, partyId, election._id)));
  if (existing && !knownEmptySlate) {
    const rowCount = await db
      .collection<SlateCandidate>("slateCandidates")
      .countDocuments({ slateId: existing._id });
    if (rowCount > 0) return existing;
  }

  const template = prefetched
    ? prefetched.template
    : await findLatestSlateTemplate(db, countryId, partyId, election);
  if (!template) return existing;

  // Oldest invitation first, so a board carried past the cap keeps the chair's
  // earliest decisions rather than an arbitrary slice. Rows that fail the
  // per-row checks below spend no slot, so the cap counts what actually
  // carries, not what was considered.
  const templateRows = (prefetched?.rows ?? (await listSlateCandidates(db, template._id)))
    .filter((row) => row.status !== "withdrawn")
    .sort(
      (a, b) =>
        a.invitedAt.getTime() - b.invitedAt.getTime() ||
        a._id.toString().localeCompare(b._id.toString())
    );
  if (templateRows.length === 0) return existing;

  const { nppById, characterById } = prefetched ?? (await loadTemplateRoster(db, templateRows));
  const slateId = existing?._id ?? new ObjectId();

  const carriedRows: SlateCandidate[] = [];
  for (const row of templateRows) {
    // A carried board may not exceed what a chair could assign by hand. Without
    // this the cap compounded: every cycle re-materialized the whole previous
    // board, and anything the filing pass had added on top came with it.
    if (carriedRows.length >= SLATE_ASSIGNMENT_CAP) break;
    if (row.candidateType === "npp") {
      const npp = nppById.get(row.candidateId.toString());
      if (!npp || npp.retiredAt) continue;
      if ((npp.countryId ?? "US") !== countryId) continue;
      if (npp.party !== partyId || npp.homeState !== election.state) continue;
      const compliant = isNppSlateCompliant(
        npp,
        getSlateAcceptanceStatBonus(row.assignedByRole ?? null)
      );
      carriedRows.push({
        _id: new ObjectId(),
        slateId,
        electionId: election._id,
        partyId,
        countryId,
        candidateType: "npp",
        candidateId: npp._id,
        candidateName: npp.name,
        homeState: npp.homeState,
        // Carried-forward rows are an automatic cross-cycle persistence, not a
        // fresh chair action. Drop the human attribution (the original assigner
        // may have been deleted — e.g. #0961's phantom "Jonah Heidelbaum") and
        // mark the row autoFilled so the board shows "Auto" rather than a stale/
        // nonexistent chair. The role is preserved so the state-chair compliance
        // bonus the race was originally slated under still applies (no behavior
        // change to acceptance).
        assignedByCharacterId: null,
        assignedByCharacterName: null,
        assignedByRole: row.assignedByRole ?? null,
        status: "invited",
        fitScore: computeSlateAssignmentScore(npp),
        invitationNote: row.invitationNote,
        refusalReason: compliant ? null : "low_compliance",
        autoFilled: true,
        invitedAt: now,
        respondedAt: null,
        filedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }

    const character = characterById.get(row.candidateId.toString());
    if (!character) continue;
    if ((character.countryId ?? "US") !== countryId) continue;
    if (character.party !== partyId || character.homeState !== election.state) continue;
    carriedRows.push({
      _id: new ObjectId(),
      slateId,
      electionId: election._id,
      partyId,
      countryId,
      candidateType: "character",
      candidateId: character._id,
      candidateName: character.name,
      homeState: character.homeState,
      // See the NPP branch above: carry-forward is automatic persistence, so
      // strip the (possibly stale) human attribution and flag the row autoFilled.
      assignedByCharacterId: null,
      assignedByCharacterName: null,
      assignedByRole: row.assignedByRole ?? null,
      status: "accepted",
      fitScore: 100,
      invitationNote: row.invitationNote,
      refusalReason: null,
      autoFilled: true,
      invitedAt: now,
      respondedAt: now,
      filedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (carriedRows.length === 0) return existing;

  const slate =
    existing ??
    ({
      _id: slateId,
      countryId,
      partyId,
      electionId: election._id,
      state: election.state,
      electionType: election.electionType,
      priority: template.priority,
      notes: template.notes,
      archivedAt: null,
      createdBy: template.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    } satisfies RecruitmentSlate);

  if (!existing) {
    await db.collection<RecruitmentSlate>("recruitmentSlates").insertOne(slate);
  }
  await db.collection<SlateCandidate>("slateCandidates").insertMany(
    carriedRows.map((row) => ({
      ...row,
      slateId: slate._id,
    }))
  );
  return slate;
}

async function loadTemplateRoster(
  db: Db,
  templateRows: SlateCandidate[]
): Promise<Pick<SlateTemplatePrefetch, "nppById" | "characterById">> {
  const [npps, characters] = await Promise.all([
    db
      .collection<NPP>("npps")
      .find({
        _id: {
          $in: templateRows
            .filter((row) => row.candidateType === "npp")
            .map((row) => row.candidateId),
        },
      })
      .toArray(),
    db
      .collection<Character>("characters")
      .find({
        _id: {
          $in: templateRows
            .filter((row) => row.candidateType === "character")
            .map((row) => row.candidateId),
        },
      })
      .toArray(),
  ]);
  const nppById = new Map(npps.map((npp) => [npp._id.toString(), npp]));
  const characterById = new Map(
    characters.map((character) => [character._id.toString(), character])
  );
  return { nppById, characterById };
}

async function findLatestSlateTemplate(
  db: Db,
  countryId: CountryId,
  partyId: string,
  election: TemplateTarget
): Promise<RecruitmentSlate | null> {
  const candidates = await db
    .collection<RecruitmentSlate>("recruitmentSlates")
    .find({
      countryId,
      partyId,
      state: election.state,
      electionType: election.electionType,
      electionId: { $ne: election._id },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  if (candidates.length === 0) return null;
  return selectSlateTemplate(candidates, await loadTemplateElections(db, candidates), election);
}
