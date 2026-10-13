/**
 * The organisation head's personal agenda pool, and who counts as a head.
 *
 * WHO IS THE HEAD. Every organisation definition (built-in and custom) carries
 * exactly ONE leadership office, `def.leadership.title` (Secretary-General,
 * President of the European Council, Chair of the Non-Aligned Movement, ...),
 * stored as one `organizationLeadership` row per organisation. That office is
 * the top of the organisation, so its holder is the head. Where it is held:
 *  - elected organisations: `organizationLeadership.holderCharacterId`;
 *  - permanent-leadership organisations (Commonwealth, Warsaw Pact, COMECON):
 *    the leader country's sitting head of government while that country is a
 *    member, derived at read time exactly as `resolvePermanentLeadership` in
 *    service.ts does. The stored row there is a vacant placeholder.
 *
 * THE POOL. A head banks {@link ORG_HEAD_AGENDA_ACTIONS_PER_TURN} agenda actions
 * a turn up to {@link ORG_HEAD_AGENDA_ACTION_CAP}, spendable only on resolutions
 * tabled inside the organisation they lead. It is spent before the country's
 * diplomatic budget, and lets a head who is not their country's foreign minister
 * table those resolutions at all. Joining, leaving, nominating and the war
 * resolutions stay on the country budget: those are sovereign acts of a member
 * state, not the chair's agenda.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  INTERNATIONAL_ORGANIZATIONS,
  INTERNATIONAL_ORGANIZATION_ORDER,
  ORG_HEAD_AGENDA_ACTION_CAP,
  ORG_HEAD_AGENDA_ACTIONS_PER_TURN,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import type { OrganizationResolutionType } from "@/lib/db/types/internationalOrganization";
import type { OrgHeadAgendaPool } from "@/lib/db/types/orgHeadAgendaAction";
import {
  getOrganizationLeadershipCollection,
  getOrganizationMembershipsCollection,
} from "@/lib/db/collections";
import { getOrgHeadAgendaActionsCollection } from "@/lib/db/collections/orgHeadAgendaActions";
import { getHeadOfGovernmentCharacterIds } from "@/lib/api/headOfGovernment";
import { loadOrganizationDef } from "@/lib/internationalOrganizations/service";
import {
  getDiplomaticActionsRemaining,
  spendDiplomaticAction,
} from "@/lib/internationalOrganizations/diplomaticActions";

/**
 * Resolution types the head's agenda pool pays for. War declarations and
 * entering a conflict commit the proposing member's own forces, so they stay on
 * that member's diplomatic budget like joining and leaving do.
 */
export const ORG_HEAD_AGENDA_PROPOSAL_TYPES: ReadonlySet<OrganizationResolutionType> = new Set([
  "free_trade_agreement",
  "sanctions",
  "directive",
  "joint_statement",
  "aid_package",
  "set_dues",
  "set_posture",
  "fund_agency",
]);

export interface OrganizationHeadSeat {
  organizationId: InternationalOrganizationId;
  characterId: ObjectId;
  /** The member the head sits for; their proposals are tabled in its name. */
  countryId: CountryId;
}

const PERMANENT_LEADER_BY_ORG = new Map(
  INTERNATIONAL_ORGANIZATION_ORDER.flatMap((id) => {
    const leader = INTERNATIONAL_ORGANIZATIONS[id].permanentLeadership?.countryId;
    return leader ? [[id as InternationalOrganizationId, leader] as const] : [];
  })
);

/**
 * Every sitting organisation head, optionally narrowed to one organisation or
 * one character. Vacant seats and seats with no attributable country are
 * skipped.
 */
export async function loadOrganizationHeads(
  db: Db,
  filter: { organizationId?: InternationalOrganizationId; characterId?: ObjectId } = {}
): Promise<OrganizationHeadSeat[]> {
  const permanentIds = [...PERMANENT_LEADER_BY_ORG.keys()];
  const heads: OrganizationHeadSeat[] = [];

  const wantsElected =
    filter.organizationId === undefined || !PERMANENT_LEADER_BY_ORG.has(filter.organizationId);
  if (wantsElected) {
    const leadershipCol = await getOrganizationLeadershipCollection(db);
    const rows = await leadershipCol
      .find(
        {
          organizationId: filter.organizationId ?? { $nin: permanentIds },
          holderCharacterId: filter.characterId ?? { $ne: null },
        },
        { projection: { organizationId: 1, holderCharacterId: 1, holderCountryId: 1 } }
      )
      .toArray();
    for (const row of rows) {
      if (!row.holderCharacterId || !row.holderCountryId) continue;
      heads.push({
        organizationId: row.organizationId,
        characterId: row.holderCharacterId,
        countryId: row.holderCountryId,
      });
    }
  }

  const permanentWanted = permanentIds.filter(
    (id) => filter.organizationId === undefined || filter.organizationId === id
  );
  if (permanentWanted.length > 0) {
    const membershipsCol = await getOrganizationMembershipsCollection(db);
    const seated = await membershipsCol
      .find(
        {
          $or: permanentWanted.map((organizationId) => ({
            organizationId,
            countryId: PERMANENT_LEADER_BY_ORG.get(organizationId)!,
          })),
        },
        { projection: { organizationId: 1, countryId: 1 } }
      )
      .toArray();
    const leaderCountries = [...new Set(seated.map((row) => row.countryId as CountryId))];
    const hogs = leaderCountries.length
      ? await getHeadOfGovernmentCharacterIds(db, leaderCountries)
      : new Map<CountryId, ObjectId | null>();
    for (const row of seated) {
      const countryId = row.countryId as CountryId;
      const characterId = hogs.get(countryId);
      if (!characterId) continue;
      if (filter.characterId && !characterId.equals(filter.characterId)) continue;
      heads.push({ organizationId: row.organizationId, characterId, countryId });
    }
  }

  return heads;
}

/** The sitting head of one organisation, or null when the seat is vacant. */
export async function resolveOrganizationHead(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<OrganizationHeadSeat | null> {
  const [head] = await loadOrganizationHeads(db, { organizationId });
  return head ?? null;
}

/**
 * Agenda actions banked on a stored pool row at `currentTurn`. A missing row (a
 * head who has never spent) reads as one turn's accrual; a row from an older
 * turn reads as its balance plus the accrual for every turn since, clamped to
 * the cap. Pure so the lazy refresh is unit-tested directly.
 */
export function agendaRemainingFromRow(
  row: Pick<OrgHeadAgendaPool, "turn" | "remaining"> | null,
  currentTurn: number
): number {
  if (!row) return ORG_HEAD_AGENDA_ACTIONS_PER_TURN;
  const elapsed = Math.max(0, currentTurn - row.turn);
  const banked = Math.max(0, row.remaining) + elapsed * ORG_HEAD_AGENDA_ACTIONS_PER_TURN;
  return Math.min(ORG_HEAD_AGENDA_ACTION_CAP, banked);
}

/** Agenda actions `characterId` has banked as head of `organizationId`. */
export async function getOrgHeadAgendaRemaining(
  db: Db,
  organizationId: InternationalOrganizationId,
  characterId: ObjectId,
  currentTurn: number
): Promise<number> {
  const col = await getOrgHeadAgendaActionsCollection(db);
  const row = await col.findOne({ organizationId, characterId });
  return agendaRemainingFromRow(row, currentTurn);
}

/**
 * Spend one agenda action with a version guard. Concurrent proposals cannot
 * both spend the same snapshot; the identity index also guards first use.
 */
export async function spendOrgHeadAgendaAction(
  db: Db,
  organizationId: InternationalOrganizationId,
  characterId: ObjectId,
  currentTurn: number
): Promise<{ ok: boolean; remaining: number }> {
  const col = await getOrgHeadAgendaActionsCollection(db);
  const row = await col.findOne({ organizationId, characterId });
  const current = agendaRemainingFromRow(row, currentTurn);
  if (current < 1) return { ok: false, remaining: 0 };
  const remaining = current - 1;
  const fields = {
    organizationId,
    characterId,
    turn: currentTurn,
    remaining,
    updatedAt: new Date(),
  };
  try {
    const result = row
      ? await col.updateOne(
          { _id: row._id, turn: row.turn, remaining: row.remaining },
          { $set: fields }
        )
      : await col.updateOne(
          { organizationId, characterId },
          { $setOnInsert: fields },
          { upsert: true }
        );
    if (result.modifiedCount === 1 || result.upsertedCount === 1) return { ok: true, remaining };
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000)
      throw error;
  }
  return {
    ok: false,
    remaining: await getOrgHeadAgendaRemaining(db, organizationId, characterId, currentTurn),
  };
}

export type OrgProposalBudgetSource = "agenda" | "country";

export interface OrgProposalBudget {
  /** The actor heads this organisation for `countryId` and the type is agenda business. */
  isOrgHead: boolean;
  /** Pool the proposal will be paid from, or null when neither can pay. */
  source: OrgProposalBudgetSource | null;
  agendaRemaining: number;
  countryRemaining: number;
}

/**
 * Pick the pool a resolution tabled inside `organizationId` is paid from: the
 * head's agenda pool first, then the country's diplomatic budget when the actor
 * is also authorised for it (`countryAuthorized`: foreign minister or head of
 * government). Reads only; pair with {@link spendOrgProposalBudget}.
 */
export async function resolveOrgProposalBudget(params: {
  db: Db;
  organizationId: InternationalOrganizationId;
  countryId: CountryId;
  actorCharacterId: ObjectId;
  proposalType: OrganizationResolutionType;
  countryAuthorized: boolean;
  currentTurn: number;
}): Promise<OrgProposalBudget> {
  const { db, organizationId, countryId, actorCharacterId, currentTurn } = params;
  let isOrgHead = false;
  if (ORG_HEAD_AGENDA_PROPOSAL_TYPES.has(params.proposalType)) {
    const head = await resolveOrganizationHead(db, organizationId);
    isOrgHead =
      head !== null && head.characterId.equals(actorCharacterId) && head.countryId === countryId;
  }
  const agendaRemaining = isOrgHead
    ? await getOrgHeadAgendaRemaining(db, organizationId, actorCharacterId, currentTurn)
    : 0;
  const countryRemaining = params.countryAuthorized
    ? await getDiplomaticActionsRemaining(db, countryId, currentTurn)
    : 0;
  const source: OrgProposalBudgetSource | null =
    agendaRemaining >= 1 ? "agenda" : countryRemaining >= 1 ? "country" : null;
  return { isOrgHead, source, agendaRemaining, countryRemaining };
}

/** Charge the pool {@link resolveOrgProposalBudget} picked. */
export async function spendOrgProposalBudget(
  db: Db,
  source: OrgProposalBudgetSource,
  params: {
    organizationId: InternationalOrganizationId;
    countryId: CountryId;
    characterId: ObjectId;
    currentTurn: number;
  }
): Promise<{ ok: boolean; remaining: number }> {
  return source === "agenda"
    ? spendOrgHeadAgendaAction(db, params.organizationId, params.characterId, params.currentTurn)
    : spendDiplomaticAction(db, params.countryId, params.currentTurn);
}

export interface OrgHeadAgendaInfo {
  organizationId: InternationalOrganizationId;
  /** The member the head tables resolutions for. */
  countryId: CountryId;
  /** The office held, e.g. "Secretary-General". */
  title: string;
  remaining: number;
  cap: number;
  perTurn: number;
}

/** Agenda pools for every organisation `characterId` heads, for the org page. */
export async function loadOrgHeadAgendasForCharacter(
  db: Db,
  characterId: ObjectId,
  currentTurn: number
): Promise<OrgHeadAgendaInfo[]> {
  const seats = await loadOrganizationHeads(db, { characterId });
  return Promise.all(
    seats.map(async (seat) => {
      const def = await loadOrganizationDef(db, seat.organizationId);
      return {
        organizationId: seat.organizationId,
        countryId: seat.countryId,
        title: def?.leadership.title ?? "Head",
        remaining: await getOrgHeadAgendaRemaining(
          db,
          seat.organizationId,
          characterId,
          currentTurn
        ),
        cap: ORG_HEAD_AGENDA_ACTION_CAP,
        perTurn: ORG_HEAD_AGENDA_ACTIONS_PER_TURN,
      };
    })
  );
}
