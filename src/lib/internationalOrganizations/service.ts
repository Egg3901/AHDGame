import {
  ObjectId,
  type Collection,
  type Db,
  type Document,
  type OptionalUnlessRequiredId,
} from "mongodb";
import {
  getOrganizationLeadershipCollection,
  getOrganizationLegislationCollection,
  getOrganizationMembershipsCollection,
  getOrganizationProposalsCollection,
  getOrganizationLeadershipElectionsCollection,
  getCountryHistoryCollection,
  getCustomInternationalOrganizationsCollection,
} from "@/lib/db/collections";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { getAllCountryAccess } from "@/lib/countryAccess";
import {
  loadWithdrawnMemberKeys,
  recordOrganizationWithdrawal,
  withdrawalKey,
} from "@/lib/internationalOrganizations/withdrawalTombstone";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { entityFlag, entityName } from "@/lib/constants/entityDisplay";
import { resolveOrgCategory } from "@/lib/constants/orgCategory";
import type { GameState } from "@/lib/db/types";
import type {
  PendingOrganizationWithdrawalMeasure,
  OrganizationLeadership,
  OrganizationLegislation,
  OrganizationMembership,
  OrganizationMembershipProposal,
  OrganizationLeadershipElection,
} from "@/lib/db/types/internationalOrganization";
import type { CustomInternationalOrganization } from "@/lib/db/types/customInternationalOrganization";
import type {
  InternationalOrganizationDef,
  InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import {
  INTERNATIONAL_ORGANIZATION_ORDER,
  INTERNATIONAL_ORGANIZATIONS,
  ORG_PROPOSAL_VOTING_TURNS,
  getOrganizationDef,
  isBuiltInInternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig } from "@/lib/constants/countries";
import { DEFAULT_CUSTOM_ORG_CATEGORY } from "@/lib/constants/orgCategory";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import type { Character } from "@/lib/db/types";
import { isOrganizationFounded, loadOrgFoundingContext, resolveSeedRoster } from "./founding";

/**
 * Read-side aggregates used by the world page and per-org views.
 * Service layer pre-shapes data so route handlers stay focused on auth
 * and validation.
 */

export interface OrganizationSummary {
  id: InternationalOrganizationId;
  def: InternationalOrganizationDef;
  members: Array<{
    countryId: OrgMemberId;
    countryName: string;
    flagEmoji: string;
    status: OrganizationMembership["status"];
    joinedTurn: number;
    /**
     * Whether this member casts a ballot. Any entity may be a member; only
     * player-enabled countries vote. Vote rosters MUST filter on this or they
     * promise a ballot that can never arrive.
     */
    hasVote: boolean;
    /**
     * Whether the game models this member as a country with its own economy and
     * treasury. False for macro-tier entities, which have no `federalBudget` —
     * anything that pays money to a member has to check this first.
     */
    isCountry: boolean;
  }>;
  pendingMembershipProposals: OrganizationMembershipProposal[];
  pendingLegislation: OrganizationLegislation[];
  activeLegislation: OrganizationLegislation[];
  pendingWithdrawalMeasures: PendingOrganizationWithdrawalMeasure[];
  leadership: OrganizationLeadership | null;
  pendingLeadershipElections: OrganizationLeadershipElection[];
}

export function customOrgToDef(org: CustomInternationalOrganization): InternationalOrganizationDef {
  return {
    id: org.id,
    name: org.name,
    shortName: org.shortName,
    description: org.description,
    logoPath: org.logoPath ?? null,
    foundingMembers: org.foundingMembers,
    leadership: { title: org.leadership.title, termTurns: org.leadership.termTurns },
    charter: org.charter,
    category: org.category ?? DEFAULT_CUSTOM_ORG_CATEGORY,
    isCustom: true,
  };
}

export async function loadCustomOrganizations(db: Db): Promise<CustomInternationalOrganization[]> {
  const col = await getCustomInternationalOrganizationsCollection(db);
  return col.find({}).sort({ createdOnTurn: 1 }).toArray();
}

/**
 * The world's bloc-designation context, read once.
 *
 * Both def paths go through this so the panel a player sees and the route that
 * accepts their resolution can never disagree about what an organisation is
 * allowed to do — the classic way a gated UI drifts from its API.
 */
async function loadCategoryContext(db: Db): Promise<{ preset?: string; coldWarEnded: boolean }> {
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, coldWarEndedTurn: 1 } });
  return { preset: gs?.preset, coldWarEnded: gs?.coldWarEndedTurn != null };
}

/** Apply the world's bloc designation to a def, leaving every other org alone. */
function withEffectiveCategory(
  def: InternationalOrganizationDef,
  ctx: { preset?: string; coldWarEnded: boolean }
): InternationalOrganizationDef {
  const category = resolveOrgCategory({
    organizationId: def.id,
    category: def.category,
    preset: ctx.preset,
    coldWarEnded: ctx.coldWarEnded,
  });
  return category === def.category ? def : { ...def, category };
}

/**
 * Resolve a def for any organization id — built-in or custom. Returns null if
 * the id matches neither. Used by API routes that accept arbitrary org ids.
 *
 * The category here is the ARCHETYPE, not the world's effective one. Resolving
 * the bloc designation costs a `gameState` read, and this is called inside turn-
 * phase loops (per defecting membership, per accession channel) where only the
 * name and the founding years are wanted — so it would have been N round-trips
 * per turn for an answer nobody read. Anything gating on POWERS must use
 * {@link loadOrganizationDefWithPowers}.
 */
export async function loadOrganizationDef(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<InternationalOrganizationDef | null> {
  if (isBuiltInInternationalOrganizationId(organizationId)) {
    return getOrganizationDef(organizationId);
  }
  const col = await getCustomInternationalOrganizationsCollection(db);
  const row = await col.findOne({ id: organizationId });
  return row ? customOrgToDef(row) : null;
}

/**
 * A def whose category is the world's EFFECTIVE one, for the single place that
 * gates on what an organisation may DO.
 *
 * `loadOrganizationSummaries` (what a tab renders) and this (what
 * `proposeLegislation` checks) share `withEffectiveCategory`, so a tab can never
 * offer a resolution the write path refuses.
 */
export async function loadOrganizationDefWithPowers(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<InternationalOrganizationDef | null> {
  const def = await loadOrganizationDef(db, organizationId);
  return def ? withEffectiveCategory(def, await loadCategoryContext(db)) : null;
}

/**
 * Permanent-leadership orgs (Commonwealth, Warsaw Pact) derive their holder at
 * read time: the leader country's sitting head of government, shown only
 * while the leader country is a member. The stored leadership row remains a
 * vacant placeholder; nothing is written.
 */
async function resolvePermanentLeadership(
  db: Db,
  def: InternationalOrganizationDef,
  memberCountryIds: Set<CountryId>,
  storedRow: OrganizationLeadership | null
): Promise<OrganizationLeadership> {
  const leaderCountry = def.permanentLeadership!.countryId;
  const base: OrganizationLeadership = storedRow ?? {
    _id: new ObjectId(),
    organizationId: def.id,
    holderCharacterId: null,
    holderCharacterName: null,
    holderCountryId: null,
    electedAt: null,
    electedOnTurn: null,
    termEndsOnTurn: null,
    updatedAt: new Date(),
  };
  const vacant: OrganizationLeadership = {
    ...base,
    holderCharacterId: null,
    holderCharacterName: null,
    holderCountryId: null,
    termEndsOnTurn: null,
  };
  if (!memberCountryIds.has(leaderCountry)) return vacant;
  const hogId = await getHeadOfGovernmentCharacterId(db, leaderCountry);
  if (!hogId) return vacant;
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: hogId }, { projection: { name: 1 } });
  return {
    ...base,
    holderCharacterId: hogId,
    holderCharacterName: character?.name ?? null,
    holderCountryId: leaderCountry,
    termEndsOnTurn: null,
  };
}

export async function loadOrganizationSummaries(db: Db): Promise<OrganizationSummary[]> {
  const [
    memberships,
    countryAccess,
    proposals,
    legislation,
    withdrawalBills,
    leadership,
    leadershipElections,
    customOrgs,
  ] = await Promise.all([
    (await getOrganizationMembershipsCollection(db)).find({}).toArray(),
    getAllCountryAccess(db),
    (await getOrganizationProposalsCollection(db)).find({ status: "pending" }).toArray(),
    (await getOrganizationLegislationCollection(db))
      .find({ status: { $in: ["pending", "active"] } })
      .toArray(),
    db
      .collection("bills")
      .find({
        status: { $nin: NATIONAL_TERMINAL_STATUSES },
        internationalAction: { $exists: true },
      })
      .project({
        _id: 1,
        internationalAction: 1,
      })
      .toArray(),
    (await getOrganizationLeadershipCollection(db)).find({}).toArray(),
    (await getOrganizationLeadershipElectionsCollection(db)).find({ status: "pending" }).toArray(),
    loadCustomOrganizations(db),
  ]);

  const membersByOrg = new Map<InternationalOrganizationId, OrganizationMembership[]>();
  for (const m of memberships) {
    const list = membersByOrg.get(m.organizationId) ?? [];
    list.push(m);
    membersByOrg.set(m.organizationId, list);
  }

  // Founding-window visibility: built-ins outside their founded/dissolved
  // window are hidden entirely (list + detail page, which resolves from this
  // list). MEMBER presence always wins — a populated org never vanishes on
  // year math (no forced history) — but a leadership row alone does not, so
  // an org emptied past its dissolution year is gone for good. Custom orgs
  // are always live.
  const { liveYear } = await loadOrgFoundingContext(db);
  const visibleBuiltIns = INTERNATIONAL_ORGANIZATION_ORDER.filter((id) =>
    isOrganizationFounded({
      def: INTERNATIONAL_ORGANIZATIONS[id],
      liveYear,
      hasMembers: (membersByOrg.get(id)?.length ?? 0) > 0,
    })
  );

  // Built-ins first, in their canonical display order; player-created orgs
  // follow in creation order so the UI list stays stable across renders.
  const orderedIds: InternationalOrganizationId[] = [
    ...visibleBuiltIns,
    ...customOrgs.map((o) => o.id),
  ];
  const customDefsById = new Map(customOrgs.map((o) => [o.id, customOrgToDef(o)] as const));

  // Derived permanent leadership — resolved before the (synchronous) summary
  // map since it needs head-of-government lookups.
  const permanentLeadershipByOrg = new Map<InternationalOrganizationId, OrganizationLeadership>();
  for (const id of visibleBuiltIns) {
    const def = INTERNATIONAL_ORGANIZATIONS[id];
    if (!def.permanentLeadership) continue;
    permanentLeadershipByOrg.set(
      id,
      await resolvePermanentLeadership(
        db,
        def,
        // A chair is a member's head of government, so only modelled countries
        // can hold one.
        new Set(
          (membersByOrg.get(id) ?? [])
            .map((m) => m.countryId)
            .filter((c): c is CountryId => c in COUNTRY_CONFIGS)
        ),
        leadership.find((l: OrganizationLeadership) => l.organizationId === id) ?? null
      )
    );
  }

  // Same designation the write path applies, so a tab never offers a resolution
  // the route will refuse.
  const categoryCtx = await loadCategoryContext(db);

  return orderedIds.map((id) => {
    const def = withEffectiveCategory(
      isBuiltInInternationalOrganizationId(id)
        ? getOrganizationDef(id)
        : (customDefsById.get(id) as InternationalOrganizationDef),
      categoryCtx
    );
    const orgMembers = (membersByOrg.get(id) ?? []).map((m) => {
      // A macro-tier member has no CountryConfig; name/flag fall back to the
      // alignment roster and ISO regional-indicator emoji so seated-but-unplayable
      // allies (Canada, the Benelux, …) do not render as a white-flag blank.
      const isCountry = m.countryId in COUNTRY_CONFIGS;
      return {
        countryId: m.countryId,
        countryName: entityName(m.countryId),
        flagEmoji: entityFlag(m.countryId),
        status: m.status,
        joinedTurn: m.joinedTurn,
        hasVote: countryAccess[m.countryId as CountryId]?.enabledForPlayers === true,
        isCountry,
      };
    });
    orgMembers.sort((a, b) => a.countryName.localeCompare(b.countryName));

    return {
      id,
      def,
      members: orgMembers,
      pendingMembershipProposals: proposals.filter(
        (p: OrganizationMembershipProposal) => p.organizationId === id
      ),
      pendingLegislation: legislation.filter(
        (l: OrganizationLegislation) => l.organizationId === id && l.status === "pending"
      ),
      activeLegislation: legislation.filter(
        (l: OrganizationLegislation) => l.organizationId === id && l.status === "active"
      ),
      pendingWithdrawalMeasures: withdrawalBills
        .filter((bill) => bill.internationalAction?.organizationId === id)
        .map((bill) => ({
          billId: bill._id,
          targetType: bill.internationalAction.type,
          targetCountryId: bill.internationalAction.targetCountryId,
          organizationId: bill.internationalAction.organizationId,
          ...(bill.internationalAction.organizationLegislationId
            ? {
                organizationLegislationId: bill.internationalAction.organizationLegislationId,
              }
            : {}),
          ...(bill.internationalAction.organizationLegislationTitle
            ? {
                organizationLegislationTitle: bill.internationalAction.organizationLegislationTitle,
              }
            : {}),
        })),
      leadership:
        permanentLeadershipByOrg.get(id) ??
        leadership.find((l: OrganizationLeadership) => l.organizationId === id) ??
        null,
      pendingLeadershipElections: leadershipElections.filter(
        (e: OrganizationLeadershipElection) => e.organizationId === id
      ),
    };
  });
}

export async function isMember(
  db: Db,
  organizationId: InternationalOrganizationId,
  countryId: CountryId
): Promise<boolean> {
  const col = await getOrganizationMembershipsCollection(db);
  const row = await col.findOne({ organizationId, countryId });
  return row != null;
}

/**
 * Every member, of any kind. Use `votingMembers` from `orgMembership.ts` where a
 * vote, a veto or an office is at stake — most members cannot cast one.
 */
export async function getMembers(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<OrgMemberId[]> {
  const col = await getOrganizationMembershipsCollection(db);
  const rows = await col.find({ organizationId }, { projection: { countryId: 1 } }).toArray();
  return rows.map((r: { countryId: OrgMemberId }) => r.countryId);
}

export async function hasOpenMembershipProposal(
  db: Db,
  organizationId: InternationalOrganizationId,
  countryId: CountryId
): Promise<boolean> {
  const col = await getOrganizationProposalsCollection(db);
  const row = await col.findOne({
    organizationId,
    proposingCountryId: countryId,
    status: "pending",
  });
  return row != null;
}

/**
 * Insert founding rows + vacant leadership for any orgs missing them. Idempotent.
 * Used by tests and on-demand admin reseed; the bootstrap path runs the same
 * seed via runCoreSeed.
 *
 * Era + founding-year aware: repairs toward the SAME state the reset seeder
 * produced (the preset's era roster, not the modern default), and never
 * touches orgs founded after the preset's start — those found EMPTY mid-game
 * via foundDueOrganizations and must not receive a healed member roster.
 */
export async function ensureFoundingMembershipsAndLeadership(db: Db): Promise<void> {
  const membershipsCol = await getOrganizationMembershipsCollection(db);
  const leadershipCol = await getOrganizationLeadershipCollection(db);
  const now = new Date();

  const { preset } = await loadOrgFoundingContext(db);
  const startingYear = getStartingYearForPreset(preset);

  // Founders that deliberately withdrew must NOT be re-added by the self-heal.
  const withdrawn = await loadWithdrawnMemberKeys(db);

  // Batched, and it has to be: this runs on EVERY read of the world-org view,
  // and the per-member `findOne` it replaced cost ~1s of round-trips per page
  // load once the UN's 1953 roster grew from 12 seats to 60 — about a hundred
  // sequential queries to discover, almost always, that there is nothing to do.
  // Two reads and at most two writes now, and the writes only when short.
  const existingMemberships = new Set(
    (
      await membershipsCol.find({}, { projection: { organizationId: 1, countryId: 1 } }).toArray()
    ).map((m) => `${m.organizationId}|${m.countryId}`)
  );
  const existingLeadership = new Set(
    (await leadershipCol.find({}, { projection: { organizationId: 1 } }).toArray()).map(
      (l) => l.organizationId as string
    )
  );

  const missingMemberships: OrganizationMembership[] = [];
  const missingLeadership: OrganizationLeadership[] = [];

  for (const id of INTERNATIONAL_ORGANIZATION_ORDER) {
    const def = INTERNATIONAL_ORGANIZATIONS[id];
    if (def.foundedYear != null && def.foundedYear > startingYear) continue;
    // Dissolution: an org whose window closed before this preset started was
    // never part of this world (e.g. Warsaw Pact at 1991+). Running games
    // that seeded it keep healing it — startingYear, not liveYear, governs.
    if (def.dissolvedYear != null && def.dissolvedYear <= startingYear) continue;
    for (const countryId of resolveSeedRoster(def, preset)) {
      if (withdrawn.has(withdrawalKey(id, countryId))) continue;
      if (existingMemberships.has(`${id}|${countryId}`)) continue;
      missingMemberships.push({
        _id: new ObjectId(),
        organizationId: id,
        countryId,
        status: "founding",
        joinedAt: now,
        joinedTurn: 0,
      });
    }
    if (!existingLeadership.has(id)) {
      missingLeadership.push({
        _id: new ObjectId(),
        organizationId: id,
        holderCharacterId: null,
        holderCharacterName: null,
        holderCountryId: null,
        electedAt: null,
        electedOnTurn: null,
        termEndsOnTurn: null,
        updatedAt: now,
      });
    }
  }

  // Unordered, and a duplicate is SUCCESS rather than an error.
  //
  // `organizationMemberships` carries a unique index on (organizationId,
  // countryId), and this sweep runs on every read of the world-org view — so two
  // concurrent page loads can both find a member missing and both try to write
  // it. Batching widened that window from "between one findOne and its insert"
  // to "between one bulk read and one bulk write", which is long enough to hit
  // in practice: right after a roster grows, every visitor is short the same
  // members. An E11000 here means another sweep already wrote the row, which is
  // precisely the state this function exists to reach — rethrowing it would 500
  // the page for being correct. Unordered so one collision cannot abort the
  // rows behind it.
  await insertMissing(membershipsCol, missingMemberships);
  await insertMissing(leadershipCol, missingLeadership);
}

/** True for a duplicate-key error, whatever driver shape it arrives in. */
function isDuplicateKeyError(err: unknown): boolean {
  const code = (err as { code?: unknown; writeErrors?: { code?: number }[] } | null)?.code;
  if (code === 11000) return true;
  const writeErrors = (err as { writeErrors?: { code?: number }[] } | null)?.writeErrors;
  return Array.isArray(writeErrors) && writeErrors.every((e) => e.code === 11000);
}

async function insertMissing<T extends Document>(col: Collection<T>, rows: T[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await col.insertMany(rows as OptionalUnlessRequiredId<T>[], { ordered: false });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
}

export async function recordOrgHistoryEvent(
  db: Db,
  countryId: CountryId,
  turn: number,
  title: string,
  details?: Record<string, unknown>
): Promise<void> {
  const col = await getCountryHistoryCollection(db);
  await col.insertOne({
    _id: new ObjectId(),
    countryId,
    turn,
    timestamp: new Date(),
    eventType: "international_relations",
    title,
    details: details ?? {},
  });
}

export const PROPOSAL_VOTE_WINDOW_TURNS = ORG_PROPOSAL_VOTING_TURNS;

/**
 * Unilaterally withdraw a country from an org. Side-effects:
 * - Removes the membership document.
 * - Terminates any active or pending FTAs the country is a named party to.
 * - Vacates the leadership seat if the country currently holds it.
 * - Records a history event.
 */
export async function withdrawFromOrg(
  db: Db,
  organizationId: InternationalOrganizationId,
  countryId: CountryId,
  /** The character who withdrew, or null when the world did it — see below. */
  characterId: ObjectId | null,
  characterName: string | null,
  currentTurn: number
): Promise<void> {
  const [membershipsCol, legislationCol, leadershipCol] = await Promise.all([
    getOrganizationMembershipsCollection(db),
    getOrganizationLegislationCollection(db),
    getOrganizationLeadershipCollection(db),
  ]);

  await membershipsCol.deleteOne({ organizationId, countryId });

  // Tombstone the departure so the founding-member self-heal doesn't re-add a
  // founder that deliberately left.
  await recordOrganizationWithdrawal(db, organizationId, countryId, currentTurn);

  await legislationCol.updateMany(
    { organizationId, status: { $in: ["active", "pending"] }, parties: countryId },
    { $set: { status: "terminated", terminatedAt: new Date() } }
  );

  await leadershipCol.updateOne(
    { organizationId, holderCountryId: countryId },
    {
      $set: {
        holderCharacterId: null,
        holderCharacterName: null,
        holderCountryId: null,
        electedAt: null,
        electedOnTurn: null,
        termEndsOnTurn: null,
        updatedAt: new Date(),
      },
    }
  );

  const orgDef = await loadOrganizationDef(db, organizationId);
  const orgName = orgDef?.name ?? organizationId;
  await recordOrgHistoryEvent(
    db,
    countryId,
    currentTurn,
    characterId === null
      ? `${getCountryConfig(countryId).name} left ${orgName}.`
      : `${getCountryConfig(countryId).name} withdrew from ${orgName}.`,
    // Omitted rather than stubbed when the world drove this. A placeholder id
    // would read back as a real character having done it, and the history entry
    // is the only record of who did.
    characterId === null
      ? { organizationId }
      : { organizationId, characterId: characterId.toString(), characterName }
  );
}
