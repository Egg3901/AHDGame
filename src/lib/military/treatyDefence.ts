import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ConflictDoc, TreatyEntry } from "@/lib/db/types/conflict";
import type { GameState } from "@/lib/db/types/gameState";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import {
  getGameStateCollection,
  getOrganizationMembershipsCollection,
  getOrganizationPosturesCollection,
} from "@/lib/db/collections";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { resolveOrgCategory } from "@/lib/constants/orgCategory";
import {
  INTERNATIONAL_ORGANIZATIONS,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import { committingPostures, mutualDefenceBasis } from "@/lib/constants/mutualDefence";
import type { MutualDefenceBasis } from "@/lib/constants/mutualDefence";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { loadOrganizationDef } from "@/lib/internationalOrganizations/service";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { sharesBloc, type BlocLookup } from "@/lib/military/bloc";
import { loadMilitaryBlocRollForPreset } from "@/lib/military/blocLookup";
import { isConflictConcluded } from "@/lib/military/conflictLifecycle";
import {
  enactImmediateWarEntry,
  hostSideOf,
  loadCollectiveDefenseEntryBlocks,
} from "@/lib/military/warEntryPolicy";
import { announceTreatyEntries } from "@/lib/military/treatyEntryNotice";

/**
 * Enforced mutual defence: who an alliance drags into a war, and under which alliance.
 *
 * WHICH ORGANIZATIONS BIND is data, decided by `mutualDefenceBasis`: the effective
 * category's `mutualDefence` switches, the organization's current alert posture, and
 * a def's `standingMutualDefence` charter. NATO and the Warsaw Pact in a Cold War
 * world are one case of that rule (a standing charter on a bloc), and any Security or
 * Bloc organization whose members vote the Article 5 posture is another. Nothing here
 * names an organization.
 *
 * WHO MARCHES is `selectTreatyDefenders`, one pure function every path shares:
 * declaration-time enrolment in `declareWar`, and `reconcileMutualDefence`, the
 * per-turn sweep that catches what a declaration cannot (a posture raised to Article 5
 * while a member is already under attack, and a country that joins an alliance while
 * a fellow member is at war).
 *
 * DEFENSIVE ONLY, and that is the whole shape of it. The trigger is a declaration
 * against a member, never "a member is at war", which is what makes chaining impossible
 * by construction: an ally pulled in to defend has not declared on anybody, so it never
 * becomes a victim whose own alliance fires. The reconciliation keeps this: it only
 * ever defends the country a war was declared ON (the host, on the host's roster), and
 * only in wars a declaration opened.
 *
 * Spec: docs/superpowers/specs/2026-08-24-enforced-treaty-defence-design.md
 */
export interface TreatyDefender {
  countryId: CountryId;
  /** The alliance that binds this country to the defence. */
  organizationId: string;
  /** Its display name, so a custom alliance is not shown to players as an id. */
  organizationName: string;
  basis: MutualDefenceBasis;
}

/** One alliance that currently binds its members to mutual defence. */
export interface DefencePact {
  organizationId: string;
  organizationName: string;
  basis: MutualDefenceBasis;
  /** Every member of any kind, with the turn it joined. */
  memberJoinedTurn: Map<string, number>;
}

/** Everything eligibility needs, read once and shared across every war in a sweep. */
export interface MutualDefenceContext {
  pacts: DefencePact[];
  /** The military bloc roll: an ally sharing a bloc with the attacker stays out. */
  blocs: BlocLookup;
  /** Player-enabled countries. Only these march; a member with no government does not. */
  enabled: Set<string>;
}

/**
 * Read every alliance that binds right now, plus the bloc roll and the access table.
 *
 * Null when the conflicts subsystem is off. Narrow by construction: only orgs with a
 * committing posture or a standing charter are loaded, so a world with no Article 5
 * posture and no Cold War blocs costs three small reads and returns no pacts.
 */
export async function loadMutualDefenceContext(db: Db): Promise<MutualDefenceContext | null> {
  const gs = await (
    await getGameStateCollection(db)
  ).findOne(
    { _id: "current" },
    { projection: { conflictsEnabled: 1, preset: 1, coldWarEndedTurn: 1 } }
  );
  if (!gs?.conflictsEnabled) return null;
  const preset = (gs as Partial<GameState>).preset;
  const coldWarEnded = (gs as Partial<GameState>).coldWarEndedTurn != null;

  const postureRows = await (
    await getOrganizationPosturesCollection(db)
  )
    .find({ posture: { $in: committingPostures() } })
    .toArray();
  const postureByOrg = new Map<string, (typeof postureRows)[number]["posture"]>(
    postureRows.map((row) => [row.organizationId, row.posture])
  );
  const chartered = Object.values(INTERNATIONAL_ORGANIZATIONS)
    .filter((def) => def.standingMutualDefence)
    .map((def) => def.id as string);
  const candidateIds = [...new Set<string>([...chartered, ...postureByOrg.keys()])];

  const bound: Array<Omit<DefencePact, "memberJoinedTurn">> = [];
  for (const organizationId of candidateIds) {
    const def = await loadOrganizationDef(db, organizationId as InternationalOrganizationId);
    if (!def) continue;
    const category = resolveOrgCategory({
      organizationId,
      category: def.category,
      preset,
      coldWarEnded,
    });
    const basis = mutualDefenceBasis({
      category,
      posture: postureByOrg.get(organizationId),
      standingMutualDefence: def.standingMutualDefence,
    });
    if (basis) bound.push({ organizationId, organizationName: def.name, basis });
  }

  const [memberships, access, roll] = await Promise.all([
    bound.length === 0
      ? Promise.resolve(
          [] as Array<Pick<OrganizationMembership, "organizationId" | "countryId" | "joinedTurn">>
        )
      : (await getOrganizationMembershipsCollection(db))
          .find({ organizationId: { $in: bound.map((p) => p.organizationId) } })
          .project<Pick<OrganizationMembership, "organizationId" | "countryId" | "joinedTurn">>({
            organizationId: 1,
            countryId: 1,
            joinedTurn: 1,
          })
          .toArray(),
    getAllCountryAccess(db),
    loadMilitaryBlocRollForPreset(db, preset ?? DEFAULT_SEED_PRESET),
  ]);

  const pacts: DefencePact[] = bound.map((pact) => ({
    ...pact,
    memberJoinedTurn: new Map(
      memberships
        .filter((m) => m.organizationId === pact.organizationId)
        .map((m) => [m.countryId as string, m.joinedTurn ?? 0])
    ),
  }));
  const enabled = new Set<string>(
    Object.entries(access)
      .filter(([, row]) => row.enabledForPlayers === true)
      .map(([id]) => id)
  );
  return { pacts, blocs: roll.blocs, enabled };
}

/**
 * THE eligibility rule: which countries an attack on `defender` brings in, and under
 * which alliance. Pure, so every rule below is tested without a database; the two
 * checks that need one (truce, and an existing war with an attacker) are applied by
 * `resolveTreatyDefenders` on top of this.
 *
 * An alliance fires for the defender when:
 * - the defender is a member, and was one when the attack began (`attackedOnTurn`).
 *   Admission is not retroactive: joining an alliance mid-war does not conscript the
 *   alliance into the war the applicant brought with it. A bloc can still vote that
 *   through its conflict-entry resolution.
 * - no attacker is a member. A war between two members is a split the alliance does
 *   not take a side in, so it stays out entirely rather than pick one.
 *
 * A member of a firing alliance marches unless it:
 * - has no government (not player-enabled), or is the defender or an attacker;
 * - is already on either roster of the war, or is listed in `excluded`;
 * - shares a military bloc with an attacker, or belongs to any binding alliance that
 *   an attacker also belongs to. Being bound to both sides means being bound to
 *   neither, and an alliance must never march a member against its own ally.
 *
 * First alliance wins when a country is bound to the defender twice; the order is
 * the pact order, built-ins first, so the result is deterministic.
 */
export function selectTreatyDefenders(params: {
  context: Pick<MutualDefenceContext, "pacts" | "blocs" | "enabled">;
  defender: string;
  attackers: readonly string[];
  conflict?: Pick<ConflictDoc, "sideA" | "sideB">;
  excluded?: Iterable<string>;
  attackedOnTurn?: number;
}): TreatyDefender[] {
  const { context, defender, attackers, conflict, attackedOnTurn } = params;
  const excluded = new Set<string>([
    defender,
    ...attackers,
    ...((conflict?.sideA.countries ?? []) as string[]),
    ...((conflict?.sideB.countries ?? []) as string[]),
    ...(params.excluded ?? []),
  ]);

  const attackerPacts = context.pacts.filter((pact) =>
    attackers.some((attacker) => pact.memberJoinedTurn.has(attacker))
  );
  const alliedToAttacker = (countryId: string) =>
    attackers.some((attacker) => sharesBloc(context.blocs, countryId, attacker)) ||
    attackerPacts.some((pact) => pact.memberJoinedTurn.has(countryId));

  const out: TreatyDefender[] = [];
  const seen = new Set<string>();
  for (const pact of context.pacts) {
    const defenderJoined = pact.memberJoinedTurn.get(defender);
    if (defenderJoined == null) continue;
    if (attackedOnTurn != null && defenderJoined > attackedOnTurn) continue;
    if (attackerPacts.includes(pact)) continue;

    for (const countryId of pact.memberJoinedTurn.keys()) {
      if (excluded.has(countryId) || seen.has(countryId)) continue;
      if (!context.enabled.has(countryId) || !(countryId in COUNTRY_CONFIGS)) continue;
      if (alliedToAttacker(countryId)) continue;
      seen.add(countryId);
      out.push({
        countryId: countryId as CountryId,
        organizationId: pact.organizationId,
        organizationName: pact.organizationName,
        basis: pact.basis,
      });
    }
  }
  return out;
}

export interface ResolveTreatyDefendersParams {
  /** The country being declared on. Alliances are read for THIS country only. */
  defender: CountryId;
  /**
   * Who the defender is fighting. At a declaration, the declarer (plus its side, when
   * it is joining a war already being fought). Always excluded from the result.
   */
  attackers: CountryId[];
  /** The live conflict being joined, when there is one. Its rosters are skipped. */
  conflict?: Pick<ConflictDoc, "_id" | "sideA" | "sideB">;
  /** Turn of the attack, for the truce check and the membership-at-attack rule. */
  currentTurn: number;
  /** When the attack on the defender began. Defaults to `currentTurn`. */
  attackedOnTurn?: number;
  /** Countries that must not be enrolled for reasons the caller knows. */
  excluded?: Iterable<string>;
  /** A context already loaded for this sweep; read fresh when absent. */
  context?: MutualDefenceContext | null;
}

/**
 * `selectTreatyDefenders`, then the two database-backed bars, shared with the bloc
 * conflict-entry resolution through `loadCollectiveDefenseEntryBlocks`:
 *
 * - ONE war at a time between the same pair. An ally already fighting an attacker in
 *   some other war is honouring the treaty on that front; enrolling it here would open
 *   a second live war between the same two countries.
 * - A truce is a hard bar on re-opening a war, and it binds the treaty too. Release
 *   grants a departing ally exactly such a truce; without this an aggressor could
 *   re-declare on the same member and drag the released ally straight back in.
 */
export async function resolveTreatyDefenders(
  db: Db,
  params: ResolveTreatyDefendersParams
): Promise<TreatyDefender[]> {
  const context =
    params.context === undefined ? await loadMutualDefenceContext(db) : params.context;
  if (!context || context.pacts.length === 0) return [];

  const candidates = selectTreatyDefenders({
    context,
    defender: params.defender,
    attackers: params.attackers,
    conflict: params.conflict,
    excluded: params.excluded,
    attackedOnTurn: params.attackedOnTurn ?? params.currentTurn,
  });
  if (candidates.length === 0) return [];

  const blocked = await loadCollectiveDefenseEntryBlocks({
    db,
    conflict: params.conflict,
    candidates: candidates.map((c) => c.countryId),
    opponents: params.attackers.filter((id) => id in COUNTRY_CONFIGS),
    currentTurn: params.currentTurn,
  });
  return candidates.filter((c) => !blocked.has(c.countryId));
}

/** Stamp the resolver's output with who it came for and when. */
export function toTreatyEntries(
  defenders: TreatyDefender[],
  defending: CountryId,
  joinedTurn: number
): TreatyEntry[] {
  return defenders.map((d) => ({
    countryId: d.countryId,
    organizationId: d.organizationId,
    organizationName: d.organizationName,
    basis: d.basis,
    defending,
    joinedTurn,
  }));
}

/**
 * When the attack on a war's defending side began: the latest attacker's entry.
 *
 * The latest, not the earliest, because a declaration into a war already being fought
 * is a fresh attack on the defender. A member that was in the alliance for that one
 * was attacked as a member, even if an earlier attacker came before it joined.
 */
export function attackedOnTurnOf(
  conflict: Pick<ConflictDoc, "startTurn" | "joinTurns">,
  attackers: readonly string[]
): number {
  let latest = conflict.startTurn;
  for (const attacker of attackers) {
    const joined = conflict.joinTurns?.find((entry) => entry.countryId === attacker)?.turn;
    if (joined != null && joined > latest) latest = joined;
  }
  return latest;
}

export interface MutualDefenceReconcileResult {
  conflictsChecked: number;
  entered: number;
}

/**
 * The per-turn sweep: bring every live declared war into line with the alliances as
 * they stand now. Idempotent: an ally already on a roster is skipped, so a second run
 * in the same turn (or every later turn) writes nothing.
 *
 * It exists for what declaration-time enrolment cannot see. A declaration is one
 * moment; a posture raised to Article 5 after it, or a country that joins the
 * defender's alliance after it, changes who is bound while the war is being fought.
 *
 * Scope, deliberately narrow:
 * - wars a declaration opened (`createdBy: "player"`), interstate, not concluded;
 * - the defended members are the war's host entities on the host's roster. Allies
 *   join that roster and never the other one;
 * - a country that has already been in this war and left it (a separate peace, or a
 *   release) is not pulled back in. It holds a truce in the ordinary case; this is
 *   the guard for the case where it does not.
 *
 * Entry goes through `enactImmediateWarEntry`, the same primitive the bloc
 * collective-defence resolution uses, so an ally entering here arrives with the same
 * consequences as any other defensive entry: the roster and `joinTurns` stamp (war
 * weariness, approval, war effort all key on those), a reserve commitment sent to the
 * front, and a treaty entry that the peace bar and release read.
 */
export async function reconcileMutualDefence(
  db: Db,
  currentTurn: number
): Promise<MutualDefenceReconcileResult> {
  const context = await loadMutualDefenceContext(db);
  if (!context || context.pacts.length === 0) return { conflictsChecked: 0, entered: 0 };

  const conflicts = (await getConflictsCollection(db)
    .find({
      createdBy: "player",
      type: "interstate",
      status: { $nin: ["resolved", "terms_pending"] },
    })
    .toArray()) as ConflictDoc[];

  let entered = 0;
  for (const conflict of conflicts) {
    if (isConflictConcluded(conflict.status)) continue;
    const side = hostSideOf(conflict);
    if (!side) continue;
    const roster = (side === "A" ? conflict.sideA.countries : conflict.sideB.countries) as string[];
    const attackers = (side === "A" ? conflict.sideB.countries : conflict.sideA.countries).filter(
      (id): id is CountryId => id in COUNTRY_CONFIGS
    );
    if (attackers.length === 0) continue;

    const hosts = (conflict.hostEntities ?? [conflict.hostCountry]).filter((id): id is CountryId =>
      roster.includes(id)
    );
    const everIn = new Set<string>([
      ...(conflict.joinTurns ?? []).map((entry) => entry.countryId),
      ...(conflict.treatyEntries ?? []).map((entry) => entry.countryId),
    ]);
    const attackedOnTurn = attackedOnTurnOf(conflict, attackers);

    const entries: TreatyEntry[] = [];
    for (const defender of hosts) {
      const defenders = await resolveTreatyDefenders(db, {
        defender,
        attackers,
        conflict,
        currentTurn,
        attackedOnTurn,
        excluded: everIn,
        context,
      });
      for (const d of defenders) {
        await enactImmediateWarEntry({
          db,
          conflict,
          countryId: d.countryId,
          side,
          organizationId: d.organizationId,
          currentTurn,
          stake: "collective_defense",
          defendingCountryId: defender,
          organizationName: d.organizationName,
          basis: d.basis,
        });
        everIn.add(d.countryId);
        entries.push(...toTreatyEntries([d], defender, currentTurn));
      }
    }
    entered += entries.length;
    await announceTreatyEntries(db, entries, conflict.name, currentTurn);
  }
  return { conflictsChecked: conflicts.length, entered };
}
