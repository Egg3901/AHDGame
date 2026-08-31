// src/lib/turn/npp/context.ts
/**
 * NPP Context Types and Loader
 *
 * Defines the shared NPPContext interface and the loadNPPContext function
 * that loads all required data upfront for consistent NPP turn processing.
 */

import { getDb } from "@/lib/mongodb";
import type { Db, Filter } from "mongodb";
import type {
  NPP,
  Election,
  ElectionCandidate,
  ElectedOfficial,
  Bill,
  StateBill,
  BillWhip,
  StatePartyOrg,
  PoliticalParty,
  LegislationType,
  StateDemographics,
  State,
  GameState,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { buildNppElectionEligiblePartyKeys } from "@/lib/parties/antiAbuseGuards";

// ─── Context Types ─────────────────────────────────────────────────────────────

export interface NPPContext {
  now: Date;
  db: Db;

  // NPPs
  allNPPs: NPP[];
  nppMap: Map<string, NPP>;

  // Elections
  openPrimaries: Election[];
  nppCandidacies: Set<string>; // nppIds currently in active candidacies
  candidatesByElection: Map<string, ElectionCandidate[]>;

  // Officials (for bill/speaker voting)
  nppOfficials: ElectedOfficial[];
  officialsByNPP: Map<string, ElectedOfficial[]>;

  // Bills
  activeBills: Bill[];
  billWhips: Map<string, BillWhip[]>; // billId -> whips
  activeStateBills: StateBill[];
  stateBillWhips: Map<string, BillWhip[]>; // stateBillId -> whips

  // State party leaders (for whip lookup)
  statePartyOrgs: Map<string, StatePartyOrg>; // stateId_partyId -> org

  // Party country lookup (for cross-country collision prevention)
  // Maps "countryId:partyId" -> PoliticalParty for proper country matching
  partyByCompositeKey: Map<string, PoliticalParty>;
  // Maps partyId (sequentialId) -> array of countries that have this party
  partyCountries: Map<string, CountryId[]>;
  /**
   * Party keys allowed to file/control NPP election entries this turn.
   * Key format: `${countryId}:${partyId}`. Undefined in older tests means
   * "do not enforce" so unit fixtures stay focused on entry mechanics.
   */
  nppElectionEligiblePartyKeys?: Set<string>;

  // Cross-pressure inputs (Phase 4) — keyed by their respective string IDs.
  // Loaded once per turn so the deterministic resolver doesn't issue per-NPP
  // lookups during bill voting.
  //
  // NOTE: these three maps hold *projected* documents to cut per-turn memory
  // pressure. Only the fields actually read by NPP behavior are populated at
  // runtime; the full type is preserved here so consumers don't need narrower
  // signatures. Read-only fields actually present:
  //   legislationTypeMap → _id, policyOptions
  //   stateDemographicsMap → _id, groups
  //   statesById → _id, countryId
  // Adding field accesses elsewhere requires extending the projection in
  // loadNPPContext or moving to a separate (unprojected) load.
  legislationTypeMap: Map<string, LegislationType>; // _id -> legislation type
  stateDemographicsMap: Map<string, StateDemographics>; // stateId -> demographics
  statesById: Map<string, State>; // stateId -> state metadata
  /** Current game turn — surfaced here so vote-resolution writes don't issue their own gameState read. */
  currentTurn: number;
  /**
   * The world's reset preset. Legislature SHAPE is preset-dependent (DE's 1953 override
   * flips `bicameral`; TR/ES flip `upperElectionSystem`), so any code resolving a
   * country's chambers needs it. Read off the same gameState fetch as `currentTurn`
   * rather than issuing another.
   */
  preset?: string;
}

// ─── Context Loader ────────────────────────────────────────────────────────────

export interface NPPContextOptions {
  /** When true, include active elections even if primary phase has ended (for admin force-entry) */
  includeGeneralPhase?: boolean;
  /**
   * Wall-clock comparison instant for bill voting windows. Used for the date-based fallback
   * when a bill predates the turn-number migration.
   */
  billDeadlineNow?: Date;
  /**
   * Game-clock current turn. When provided, bill voting queries prefer the turn-number
   * check (`votingEndsOnTurn > currentTurn`) so NPPs only see bills the cron's
   * turn-based resolution would still treat as open.
   */
  currentTurn?: number;
}

/**
 * The national bills an NPP tick may vote on.
 *
 * Exported so the `active_both` branch is directly assertable: this filter is the gate
 * upstream of the entire NPP voting loop, and a missing branch means the loop never sees
 * a concurrent bill at all — every one of them then fails with an empty upper tally and
 * no error anywhere.
 */
export function buildActiveBillFilter(opts: {
  currentTurn?: number;
  now: Date;
}): Record<string, unknown> {
  const stillOpen = (turnField: string, dateField: string) =>
    typeof opts.currentTurn === "number"
      ? {
          $or: [
            { [turnField]: { $gt: opts.currentTurn } },
            { [turnField]: { $exists: false }, [dateField]: { $gt: opts.now } },
          ],
        }
      : { [dateField]: { $gt: opts.now } };

  return {
    $or: [
      { status: "active", ...stillOpen("votingEndsOnTurn", "votingEndsAt") },
      {
        status: "active_other",
        ...stillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
      },
      {
        status: "veto_override",
        ...stillOpen("overrideVotingEndsOnTurn", "overrideVotingEndsAt"),
      },
      // JP Shugiin override uses main votingEndsAt (reset by jpBillLifecycle)
      { status: "override_shugiin", ...stillOpen("votingEndsOnTurn", "votingEndsAt") },
      {
        // Poll while EITHER chamber is open. NESTED, not spread: `stillOpen` returns
        // `{ $or: [...] }` on the turn branch and a FLAT object on the date branch, so
        // spreading two of them drops the first (same key) and spreading their `.$or`
        // arrays throws on the flat branch.
        status: "active_both",
        $or: [
          stillOpen("votingEndsOnTurn", "votingEndsAt"),
          stillOpen("otherChamberVotingEndsOnTurn", "otherChamberVotingEndsAt"),
        ],
      },
    ],
  };
}

export async function loadNPPContext(now: Date, options?: NPPContextOptions): Promise<NPPContext> {
  const db = await getDb();
  const {
    includeGeneralPhase = false,
    billDeadlineNow = now,
    currentTurn: optionsCurrentTurn,
  } = options ?? {};
  const billStillOpen = (turnField: string, dateField: string) =>
    typeof optionsCurrentTurn === "number"
      ? {
          $or: [
            { [turnField]: { $gt: optionsCurrentTurn } },
            { [turnField]: { $exists: false }, [dateField]: { $gt: billDeadlineNow } },
          ],
        }
      : { [dateField]: { $gt: billDeadlineNow } };

  // Election filter: normally only elections still in primary phase,
  // but with includeGeneralPhase, include all active elections.
  // Turn-first (drift-immune, freezes on pause) with a Date fallback,
  // mirroring billStillOpen above.
  const electionFilter: Record<string, unknown> = { status: "active" };
  if (!includeGeneralPhase) {
    electionFilter.$or =
      typeof optionsCurrentTurn === "number"
        ? [
            { primaryEndTurn: { $gt: optionsCurrentTurn } },
            { primaryEndTurn: { $exists: false }, primaryEndTime: { $gt: now } },
          ]
        : [{ primaryEndTime: { $gt: now } }];
  }

  // ── Batch 1: All independent collection loads in parallel ──────────────────
  //
  // NPP projection: enumerated from grepping `npp\.<field>` across every NPP
  // behavior phase + nppBehavior.ts. Drops avatarUrl, gender, ethnicity,
  // politicalInfluence, favorability, currentOffice, generatedAt, createdAt,
  // updatedAt, influenceState, archetypeApprovals, sequentialId — none of
  // which are referenced by the behavior pipeline. archetypeApprovals on
  // NPPs is the biggest potential drop (Record<string, number> per NPP, can
  // grow with more archetypes). Adding new field accesses requires extending
  // this projection or the next turn quietly reads undefined.
  const [
    allNPPs,
    openPrimaries,
    nppOfficials,
    activeBills,
    activeStateBills,
    statePartyOrgsArr,
    allParties,
    allLegislationTypes,
    allStateDemographics,
    allStates,
  ] = await Promise.all([
    db
      .collection<NPP>("npps")
      .find(
        // Technocrat NPPs (e.g. autonomous central-bank chairs) are hard-excluded
        // from the shared NPP context so they never enter political loops
        // (election entry, federal/state bill voting). The in-memory
        // `npp.isTechnocrat` guards in electionEntry/billVoting/stateBillVoting
        // are defense-in-depth backed by this query-layer filter — see
        // technocratExclusion.test.ts for the contract.
        { retiredAt: null, isTechnocrat: { $ne: true } },
        {
          projection: {
            _id: 1,
            countryId: 1,
            donorBaseLevel: 1,
            electionCooldowns: 1,
            homeState: 1,
            isTechnocrat: 1,
            name: 1,
            party: 1,
            personality: 1,
            policies: 1,
            retiredAt: 1,
          },
        }
      )
      .toArray() as Promise<NPP[]>,
    db.collection<Election>("elections").find(electionFilter).toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ isNPP: true, nppId: { $exists: true } })
      .toArray(),
    db
      .collection<Bill>("bills")
      .find(
        buildActiveBillFilter({
          currentTurn: optionsCurrentTurn,
          now: billDeadlineNow,
        }) as Filter<Bill>
      )
      .toArray(),
    db
      .collection<StateBill>("stateBills")
      .find({
        $or: [
          { status: "active", ...billStillOpen("votingEndsOnTurn", "votingEndsAt") },
          {
            status: "veto_override",
            ...billStillOpen("overrideVotingEndsOnTurn", "overrideVotingEndsAt"),
          },
        ],
      })
      .toArray(),
    db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray(),
    db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
    // Phase 4: cross-pressure inputs. Projected to only the fields NPP
    // behavior actually reads (see NPPContext comment) — `legislationTypes`
    // averages 3.9 KB/doc unprojected vs <200 bytes for the policyOptions
    // subset, cutting ~50 MB of in-memory overhead per turn on a 200-doc
    // collection at typical JS object expansion ratios.
    db
      .collection<LegislationType>("legislationTypes")
      .find({}, { projection: { _id: 1, policyOptions: 1 } })
      .toArray() as Promise<LegislationType[]>,
    db
      .collection<StateDemographics>("stateDemographics")
      .find({}, { projection: { _id: 1, groups: 1 } })
      .toArray() as Promise<StateDemographics[]>,
    db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, countryId: 1 } })
      .toArray() as Promise<State[]>,
  ]);

  // Read the current turn for vote-prediction snapshots. Tests that don't seed
  // gameState fall through to 0 — the field is purely informational.
  const gameStateDoc = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, preset: 1 } });
  const currentTurn = gameStateDoc?.currentTurn ?? 0;
  const preset = typeof gameStateDoc?.preset === "string" ? gameStateDoc.preset : undefined;

  const nppMap = new Map(allNPPs.map((n) => [n._id.toString(), n]));
  const statePartyOrgs = new Map(statePartyOrgsArr.map((o) => [o._id, o]));
  const legislationTypeMap = new Map(allLegislationTypes.map((t) => [t._id, t]));
  const stateDemographicsMap = new Map(allStateDemographics.map((s) => [s._id, s]));
  const statesById = new Map(allStates.map((state) => [state._id, state]));

  // Build party lookup maps for cross-country collision prevention
  const partyByCompositeKey = new Map<string, PoliticalParty>();
  const partyCountries = new Map<string, CountryId[]>();
  for (const p of allParties) {
    const countryId = (p.countryId ?? "US") as CountryId;
    const partyId = String(p.sequentialId);
    partyByCompositeKey.set(`${countryId}:${partyId}`, p);
    const existing = partyCountries.get(partyId) ?? [];
    if (!existing.includes(countryId)) {
      existing.push(countryId);
    }
    partyCountries.set(partyId, existing);
  }
  const nppElectionEligiblePartyKeys = buildNppElectionEligiblePartyKeys(allParties, now);

  // Group officials by NPP
  const officialsByNPP = new Map<string, ElectedOfficial[]>();
  for (const o of nppOfficials) {
    if (o.nppId) {
      const key = o.nppId.toString();
      if (!officialsByNPP.has(key)) {
        officialsByNPP.set(key, []);
      }
      officialsByNPP.get(key)!.push(o);
    }
  }

  // ── Batch 2: Dependent queries (need results from batch 1) ────────────────
  const primaryIds = openPrimaries.map((e) => e._id);
  const billIds = activeBills.map((b) => b._id);
  const stateBillIds = activeStateBills.map((bill) => bill._id);

  const [allCandidates, allActiveNPPCandidacies, whips, stateBillWhipsArr] = await Promise.all([
    primaryIds.length > 0
      ? db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ electionId: { $in: primaryIds }, status: "active" })
          .toArray()
      : Promise.resolve([]),
    // Track every active NPP candidacy regardless of the election's phase
    // (primary, general, or upcoming next-cycle). The DB enforces one active
    // candidacy per character via a partial unique index; nppCandidacies must
    // mirror that global invariant, or incumbent-defense / generic fill will
    // attempt a second active insert and throw a duplicate-key error that
    // aborts the whole election-entry pass.
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ isNPP: true, status: "active" })
      .project<{ nppId: import("mongodb").ObjectId }>({ nppId: 1 })
      .toArray(),
    billIds.length > 0
      ? db
          .collection<BillWhip>("billWhips")
          .find({
            targetType: "bill",
            targetId: { $in: billIds },
            // NPP voting only consumes NPP whips. Legacy rows without `audience` are implicitly NPP.
            $or: [{ audience: "npp" }, { audience: { $exists: false } }],
          })
          .toArray()
      : Promise.resolve([]),
    stateBillIds.length > 0
      ? db
          .collection<BillWhip>("billWhips")
          .find({
            targetType: "bill",
            targetId: { $in: stateBillIds },
            $or: [{ audience: "npp" }, { audience: { $exists: false } }],
          })
          .toArray()
      : Promise.resolve([]),
  ]);

  // Build candidacies set from ALL active elections (not just open primaries)
  // so NPPs in general-phase elections are correctly blocked from new entries
  const nppCandidacies = new Set<string>();
  for (const c of allActiveNPPCandidacies) {
    if (c.nppId) {
      nppCandidacies.add(c.nppId.toString());
    }
  }

  // Group candidates by election
  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of allCandidates) {
    const eid = c.electionId.toString();
    if (!candidatesByElection.has(eid)) {
      candidatesByElection.set(eid, []);
    }
    candidatesByElection.get(eid)!.push(c);
  }

  // Group whips by bill
  const billWhips = new Map<string, BillWhip[]>();
  for (const w of whips) {
    const bid = w.targetId.toString();
    if (!billWhips.has(bid)) {
      billWhips.set(bid, []);
    }
    billWhips.get(bid)!.push(w);
  }
  const stateBillWhips = new Map<string, BillWhip[]>();
  for (const w of stateBillWhipsArr) {
    const billId = w.targetId.toString();
    if (!stateBillWhips.has(billId)) {
      stateBillWhips.set(billId, []);
    }
    stateBillWhips.get(billId)!.push(w);
  }

  return {
    now,
    db,
    allNPPs,
    nppMap,
    openPrimaries,
    nppCandidacies,
    candidatesByElection,
    nppOfficials,
    officialsByNPP,
    activeBills,
    billWhips,
    activeStateBills,
    stateBillWhips,
    statePartyOrgs,
    partyByCompositeKey,
    partyCountries,
    nppElectionEligiblePartyKeys,
    legislationTypeMap,
    stateDemographicsMap,
    statesById,
    currentTurn,
    preset,
  };
}
