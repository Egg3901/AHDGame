/**
 * Alignment turn phase — the only per-turn write path for country alignment.
 *
 * Runs AFTER the international-organizations batch: drift reads the memberships
 * that phase writes, so it must not join it.
 *
 * Order within a country: cross the era first (so everything below is expressed
 * in the poles the world actually has), then gather the turn's whole pull —
 * membership channels, queued influence plays, and the counter-ops those plays
 * provoke — into ONE vector, then drift once. Routing plays through the same
 * vector is what makes them share the per-nation cap with drift instead of
 * stacking on top of it. Finally snapshot the pre-drift shares, so the Ledger's
 * Trend column measures this turn's movement.
 */
import { ObjectId, type Db } from "mongodb";
import { applyEraCrossing } from "@/lib/alignment/crossing";
import { computeDrift, membershipPullForTurn } from "@/lib/alignment/drift";
import { pointsForSpend, pullForPlay } from "@/lib/alignment/influence";
import { loadGdpUsdMillionsByEntity } from "@/lib/internationalOrganizations/entityGdp";
import { GDP_MILLIONS_TO_USD } from "@/lib/constants/internationalOrganizations";
import { closeDueCrises, openCrisisTargets, openDueCrises } from "@/lib/alignment/crisisTurn";
import { JOIN_SHARE, SUSTAIN_TURNS, standingFor } from "@/lib/alignment/membershipEligibility";
import { resolveOpeningShares } from "@/lib/alignment/seedAlignment";
import { isIntOrgAlignmentEnabled } from "@/lib/alignment/featureFlag";
import { applyAlignmentToMembership } from "@/lib/alignment/sphereProjection";
import { leadFor } from "@/lib/alignment/project";
import {
  ALIGNMENT_GATES,
  CRISIS_TURN_CAP,
  polesForYear,
  resolveAlignmentEra,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import { ROSTER_BY_KEY, type AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import type { CountryId } from "@/lib/constants/countries";
import { getAlignmentPlaysCollection, getCountryAlignmentsCollection } from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";
import type { AlignmentPlay } from "@/lib/db/types/alignmentPlay";
import {
  blocPlayEffectiveness,
  computeBlocStress,
  type BlocStressBreakdown,
} from "@/lib/alignment/blocStress";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { resolveGameYear } from "@/lib/era/era";
import { getAllCountryAccess } from "@/lib/countryAccess";
import {
  getOrganizationLegislationCollection,
  getOrganizationMembershipsCollection,
} from "@/lib/db/collections";
import { removeOrganizationMembership } from "@/lib/internationalOrganizations/withdrawalBills";
import {
  loadOrganizationDef,
  hasOpenMembershipProposal,
} from "@/lib/internationalOrganizations/service";
import { isOrganizationFoundedLive } from "@/lib/internationalOrganizations/founding";
import { getOrganizationProposalsCollection } from "@/lib/db/collections";
import { ORG_PROPOSAL_VOTING_TURNS } from "@/lib/constants/internationalOrganizations";
import {
  saveSphereMembership,
  SPHERE_MEMBERSHIPS_COLLECTION,
  type PersistedSphereMembership,
} from "@/lib/world/spheres/membershipStore";

// Membership pull lives in `drift.ts` as `membershipPullForTurn`, alongside the
// ceiling it is bounded by.
/**
 * Share points a bloc loses per turn in a nation it is sanctioning.
 *
 * Sanctions were a free hit: a bloc could embargo a country with no political
 * consequence at all. Now the coercion costs the coercer standing in the very
 * country it is squeezing — the historical pattern, and something a rival can
 * bait an opponent into.
 *
 * Deliberately smaller than `MEMBERSHIP_PULL`, so a bloc sanctioning its own
 * member sours the relationship without expelling it by accident: the tie still
 * nets positive, just far less than an unsanctioned member's would.
 */
const SANCTIONS_ALIGNMENT_EROSION = 1;

export interface AlignmentPhaseResult {
  countriesDrifted: number;
  erasCrossed: number;
  /** Sphere memberships re-pointed because alignment moved. */
  spheresSynced: number;
  /** Rows created for entities that came into existence after the world was seeded. */
  rowsHealed: number;
  /** Queued influence plays consumed this turn. */
  playsResolved: number;
  /**
   * Bloc stress by channel organisation, 0-1. Reported rather than hidden: it
   * dampens the bloc's own plays, and a player who cannot see why their spending
   * bought less would read that as the game cheating rather than as pressure.
   */
  blocStress: Record<string, number>;
  /** Members that left a bloc because their alignment collapsed. */
  defections: number;
  /** Player-controlled members flagged as wobbling but left alone. */
  defectionWarnings: number;
  /** Non-player nations that asked to join a bloc they have swung toward. */
  joinRequests: number;
  /** Flashpoints opened this turn. */
  crisesOpened: number;
  /** Flashpoints settled this turn. */
  crisesResolved: number;
}

export async function processAlignmentTurn(
  db: Db,
  currentTurn: number
): Promise<AlignmentPhaseResult> {
  const gs = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentYear: 1,
        currentTurn: 1,
        startingYear: 1,
        intOrgAlignmentEnabled: 1,
      },
    }
  );

  // Gate off: touch nothing. Alignment must be invisible until it is switched on.
  if (!(await isIntOrgAlignmentEnabled(gs ?? {}))) {
    return {
      countriesDrifted: 0,
      erasCrossed: 0,
      spheresSynced: 0,
      rowsHealed: 0,
      playsResolved: 0,
      blocStress: {},
      defections: 0,
      defectionWarnings: 0,
      joinRequests: 0,
      crisesOpened: 0,
      crisesResolved: 0,
    };
  }

  const year = (gs ? resolveGameYear(gs) : null) ?? new Date().getFullYear();
  const era = resolveAlignmentEra(year);
  const poles = polesForYear(year);

  const col = await getCountryAlignmentsCollection(db);
  const [docs, memberships] = await Promise.all([
    col.find({}).toArray(),
    db
      .collection<OrganizationMembership>("organizationMemberships")
      .find({})
      .project<{
        organizationId: string;
        countryId: CountryId;
        wantsOutSinceTurn?: number | null;
        joinedTurn?: number | null;
      }>({
        organizationId: 1,
        countryId: 1,
        wantsOutSinceTurn: 1,
        joinedTurn: 1,
      })
      .toArray(),
  ]);

  const orgsByCountry = new Map<CountryId, Set<string>>();
  for (const m of memberships) {
    const set = orgsByCountry.get(m.countryId) ?? new Set<string>();
    set.add(m.organizationId);
    orgsByCountry.set(m.countryId, set);
  }

  // Bloc stress — one gauge per channel org, computed from the memberships and
  // alignment docs already in hand, so it costs no extra round-trip. See
  // `blocStress.ts`: a bloc whose members are contested, heading for the door,
  // or freshly acceded pushes less hard everywhere until it settles.
  const sharesByEntity = new Map(docs.map((d) => [d.entityId, d.shares ?? {}]));
  const stressByOrg = new Map<string, BlocStressBreakdown>();
  for (const channel of era.channels) {
    const orgMembers = memberships.filter((m) => m.organizationId === channel.organizationId);
    stressByOrg.set(
      channel.organizationId,
      computeBlocStress(
        orgMembers.map((m) => {
          const memberShares = sharesByEntity.get(m.countryId) ?? {};
          // Largest share any OTHER pole holds — what makes a member contested.
          const rivalShare = poles
            .filter((p) => p !== channel.poleId)
            .reduce((max, p) => Math.max(max, memberShares[p] ?? 0), 0);
          return {
            entityId: m.countryId,
            share: memberShares[channel.poleId] ?? 0,
            rivalShare,
            wantsOutSinceTurn: m.wantsOutSinceTurn,
            joinedTurn: m.joinedTurn,
          };
        }),
        currentTurn
      )
    );
  }

  // The world's own preset, for healing an org member that has no sphere doc to
  // carry one. Read once here rather than inside the heal loop, which would make
  // it a round-trip per missing row.
  const worldPreset = await loadWorldPreset(db);

  // Sphere memberships exist for macro-tier entities, every one of which
  // alignment now seeds. Loaded once rather than per row.
  const sphereDocs = await db
    .collection<PersistedSphereMembership>(SPHERE_MEMBERSHIPS_COLLECTION)
    .find({})
    .toArray();
  const sphereByEntity = new Map(sphereDocs.map((d) => [d.entityId, d]));

  // Plays queued since the last turn. Grouped by target so one nation's whole
  // turn — memberships, every play against it, and every answer — lands in a
  // single pull vector.
  const playsCol = await getAlignmentPlaysCollection(db);
  const pendingPlays = await playsCol.find({ resolvedTurn: null }).toArray();
  const playsByTarget = new Map<string, AlignmentPlay[]>();
  for (const p of pendingPlays) {
    const list = playsByTarget.get(p.targetEntityId) ?? [];
    list.push(p);
    playsByTarget.set(p.targetEntityId, list);
  }
  // Active sanctions, grouped by who is being squeezed. Loaded once: the loop
  // below runs per nation and would otherwise re-query for each.
  const sanctionsByTarget = new Map<string, Set<string>>();
  for (const row of await (
    await getOrganizationLegislationCollection(db)
  )
    .find({ type: "sanctions", status: "active" })
    .toArray()) {
    const target = row.sanctionsTargetCountryId;
    if (!target) continue;
    const set = sanctionsByTarget.get(target) ?? new Set<string>();
    set.add(row.organizationId);
    sanctionsByTarget.set(target, set);
  }

  // Influence is priced against the target's live economy, so load every target
  // once rather than per play. USD *millions* — scaled to absolute USD at use.
  const targetGdpMillions = await loadGdpUsdMillionsByEntity(db, [...playsByTarget.keys()]);
  const channelFor = (organizationId: string) =>
    era.channels.find((c) => c.organizationId === organizationId);

  /** Stamp a play as consumed. Resolved rows are kept for the audit trail. */
  const resolvePlay = async (playDoc: AlignmentPlay, appliedPoints: number) => {
    await playsCol.updateOne(
      { _id: playDoc._id },
      { $set: { resolvedTurn: currentTurn, appliedPoints } }
    );
  };

  // Close finished crises first, then read which targets are still in one: a
  // nation with an open crisis moves under a raised ceiling this turn.
  const closed = await closeDueCrises(db, { currentTurn });
  const crisisTargets = await openCrisisTargets(db);

  let countriesDrifted = 0;
  let erasCrossed = 0;
  let spheresSynced = 0;
  let rowsHealed = 0;
  let playsResolved = 0;
  let defections = 0;
  let defectionWarnings = 0;
  let joinRequests = 0;
  let crisesOpened = 0;
  const now = new Date();

  // Post-drift shares per entity, so defection is judged on THIS turn's numbers
  // rather than last turn's — a nation that recovered this very turn must not
  // then be shown the door on stale figures.
  const joinReadyByEntity = new Map<string, Partial<Record<AlignmentPoleId, number>>>();
  const sharedAfterDrift = new Map<
    string,
    { shares: Partial<Record<AlignmentPoleId, number>>; nonAligned: number }
  >();

  // Self-heal. Seeding only runs at world creation, so anything that acquires
  // alignment-relevant standing afterwards needs a row written for it here.
  //
  // Two populations, for two different reasons:
  //
  // - **Sphere members.** Decolonisation brings new entities into existence
  //   mid-game — Ghana in 1957, Algeria in 1962, Angola and Mozambique in 1975.
  //   Each gets a sphere membership when it emerges, and without a row its
  //   alignment would be frozen for good.
  // - **Organization members.** Membership is entity-wide, so a bloc can seat a
  //   Background Nation that has no sphere doc and never met the seeder's tier
  //   test — NATO seats Canada, the Benelux, Norway, Denmark, Portugal and
  //   Iceland; the Warsaw Pact seats Albania. Those nine were absent from the
  //   Influence tab's own member roster, and no row meant nothing could ever
  //   measure them against the leave gate: a bloc could not lose a member it
  //   had no standing for.
  //
  // A sphere doc carries the preset that its shares should be authored against;
  // an org member has no such doc, so the world's own preset stands in.
  const haveRows = new Set(docs.map((d) => d.entityId));
  const healCandidates: { key: AlignmentCountryKey; preset: string }[] = [
    ...sphereDocs.map((d) => ({ key: d.entityId as AlignmentCountryKey, preset: d.presetId })),
    ...[...orgsByCountry.keys()].map((countryId) => ({
      key: countryId as unknown as AlignmentCountryKey,
      preset: worldPreset,
    })),
  ];
  for (const candidate of healCandidates) {
    const key = candidate.key;
    if (haveRows.has(key) || !(key in ROSTER_BY_KEY)) continue;

    // Stamp the era the opening shares are actually expressed in — the preset's,
    // which is NOT the live era once a 1953 world has run past 1991. The loop
    // below then crosses the row into the current era on this same turn.
    const { shares, eraKey } = resolveOpeningShares({ key, preset: candidate.preset });
    const healed = {
      _id: new ObjectId(),
      entityId: key,
      eraKey,
      shares: shares.shares,
      nonAligned: shares.nonAligned,
      previous: null,
      turn: currentTurn,
      updatedAt: now,
    };
    await col.insertOne(healed);
    docs.push(healed);
    haveRows.add(key);
    rowsHealed++;
  }

  for (const doc of docs) {
    const before = { shares: doc.shares, nonAligned: doc.nonAligned };
    const crossing = applyEraCrossing({
      shares: before,
      storedEraKey: doc.eraKey,
      year,
    });
    if (crossing.crossed) erasCrossed++;

    // Belonging to a bloc's channel org pulls a nation toward that bloc. A
    // de-aligning channel is deliberately NOT special-cased here, unlike in
    // pullForPlay: joining the Non-Aligned Movement is a nation's own posture,
    // so it builds the NAM share directly. A NAM *play* is pressure applied to
    // someone else, which prises them off whichever bloc holds them instead.
    const orgIds = orgsByCountry.get(doc.entityId as CountryId);
    const pull: Partial<Record<AlignmentPoleId, number>> = {};
    if (orgIds) {
      for (const channel of era.channels) {
        if (!orgIds.has(channel.organizationId)) continue;
        // Read against the POST-crossing shares, which is what computeDrift is
        // handed — a nation whose era just changed is measured in the pole it
        // now has, not the one it used to.
        pull[channel.poleId] =
          (pull[channel.poleId] ?? 0) +
          membershipPullForTurn({
            weight: channel.weight,
            currentShare: crossing.shares.shares[channel.poleId] ?? 0,
          });
      }
    }

    // Sanctioning a nation erodes the sanctioning bloc's OWN standing there.
    // Expressed as negative pull rather than a push toward some rival, because
    // where the resentment goes is not ours to decide — computeDrift lets the
    // uncommitted remainder absorb it, and a rival only gains by acting.
    const sanctioningOrgs = sanctionsByTarget.get(doc.entityId);
    if (sanctioningOrgs) {
      for (const channel of era.channels) {
        if (!sanctioningOrgs.has(channel.organizationId)) continue;
        pull[channel.poleId] =
          (pull[channel.poleId] ?? 0) - SANCTIONS_ALIGNMENT_EROSION * channel.weight;
      }
    }

    // Plays and their answers join the same vector as the membership pull, so
    // computeDrift's cap, non-aligned resistance and locked gate bound the
    // nation's whole turn rather than drift alone.
    const inCrisis = crisisTargets.has(doc.entityId);
    const targetPlays = playsByTarget.get(doc.entityId) ?? [];
    const targetGdpUsd = (targetGdpMillions.get(doc.entityId) ?? 0) * GDP_MILLIONS_TO_USD;
    const settled: Array<{ doc: AlignmentPlay; points: number }> = [];
    for (const playDoc of targetPlays) {
      const channel = channelFor(playDoc.organizationId);
      if (!channel) {
        // The org lost its channel between commit and resolution (an era
        // crossing). Resolve at zero rather than leaving it pending forever.
        settled.push({ doc: playDoc, points: 0 });
        continue;
      }
      const playPull = pullForPlay({
        channel,
        amountUsd: playDoc.amountUsd,
        targetGdpUsd,
        shares: crossing.shares,
        poles,
      });
      // An overextended bloc pushes less hard everywhere. Applied to the pull
      // AND to the recorded points, so the audit trail shows what the play
      // actually bought rather than what it would have bought from a settled
      // alliance.
      const effectiveness = blocPlayEffectiveness(
        stressByOrg.get(playDoc.organizationId)?.stress ?? 0
      );
      for (const [poleId, value] of Object.entries(playPull) as [AlignmentPoleId, number][]) {
        pull[poleId] = (pull[poleId] ?? 0) + value * effectiveness;
      }

      const points =
        pointsForSpend(playDoc.amountUsd, targetGdpUsd) * channel.weight * effectiveness;
      settled.push({ doc: playDoc, points });
    }

    // A flashpoint lifts the brake on its target — it grants nothing by itself,
    // so a crisis nobody acts on changes nothing.
    const drifted = computeDrift({
      shares: crossing.shares,
      poles,
      pull,
      cap: inCrisis ? CRISIS_TURN_CAP : undefined,
    });
    countriesDrifted++;

    // A nation can lock between a play being committed and resolved. The
    // command refuses a locked target up front, but drift no-ops this one, so
    // the play bought nothing and must not be stamped as though it had.
    const moved = leadFor(crossing.shares) < ALIGNMENT_GATES.locked;

    for (const { doc: playDoc, points } of settled) {
      // The points this play contributed BEFORE the per-nation cap scaled the
      // combined vector — what it bought, not what survived the crowd.
      await resolvePlay(playDoc, moved ? Math.round(points * 100) / 100 : 0);
      playsResolved++;
    }
    playsByTarget.delete(doc.entityId);

    // Per-pole accession clock, computed before the write below consumes it.
    const priorJoinReady = doc.joinReadySince ?? {};
    const nextJoinReady: Partial<Record<AlignmentPoleId, number>> = {};
    for (const pole of poles) {
      if ((drifted.shares[pole] ?? 0) >= JOIN_SHARE) {
        nextJoinReady[pole] = priorJoinReady[pole] ?? currentTurn;
      }
    }

    await col.updateOne(
      { entityId: doc.entityId },
      {
        $set: {
          eraKey: crossing.eraKey,
          shares: drifted.shares,
          nonAligned: drifted.nonAligned,
          // A crossing changes the vocabulary the shares are expressed in, so a
          // trend measured across it would compare two different things. Clear
          // it and let the next turn establish a new baseline.
          previous: crossing.crossed ? null : before,
          // Per-pole accession clock. Set the first turn a share reaches the
          // join threshold and cleared the moment it slips, so an accession
          // needs a sustained run rather than one lucky turn.
          joinReadySince: nextJoinReady,
          turn: currentTurn,
          updatedAt: now,
        },
      }
    );

    sharedAfterDrift.set(doc.entityId, drifted);
    joinReadyByEntity.set(doc.entityId, nextJoinReady);

    // The seam: alignment is the cause, the sphere is the effect. A nation whose
    // shares crossed the join gate migrates to that patron here.
    const sphere = sphereByEntity.get(doc.entityId);
    if (sphere) {
      const next = applyAlignmentToMembership({
        membership: {
          entityId: sphere.entityId,
          presetId: sphere.presetId,
          primarySphereId: sphere.primarySphereId,
          relationships: sphere.relationships,
        },
        shares: drifted,
        year,
      });
      await saveSphereMembership(db, next, currentTurn);
      spheresSynced++;
    }
  }

  // Open new flashpoints on this turn's settled state, so a crisis reflects
  // where the world actually is rather than where it was.
  // Read once and share: both the crisis desk and the defection sweep below need
  // the live memberships, and re-reading would be a second trip for the same rows.
  const membershipsCol = await getOrganizationMembershipsCollection(db);
  const access = await getAllCountryAccess(db);
  const liveMemberships = await membershipsCol.find({}).toArray();

  const openedResult = await openDueCrises(db, {
    currentTurn,
    year,
    rows: [...sharedAfterDrift].map(([entityId, shares]) => ({ entityId, shares })),
    memberships: liveMemberships,
  });
  crisesOpened = openedResult.crisesOpened;

  // Defection. Judged after every row has drifted, so a member is measured on
  // the turn it actually just had. Only orgs WITH a channel can lose a member
  // this way — nobody defects from the UN on alignment grounds.

  for (const membership of liveMemberships) {
    const shares = sharedAfterDrift.get(membership.countryId);
    if (!shares) continue;

    // A founding member is never shown the door: you cannot be expelled from a
    // club you founded. This also protects the cases where a founder's seeded
    // alignment legitimately sits below its own bloc's bar — Nigeria is a
    // Commonwealth founder while still a colony, with a colony's damped
    // metropole alignment.
    if (membership.status === "founding") continue;

    const standing = standingFor({
      shares,
      year,
      organizationId: membership.organizationId,
    });
    if (!standing) continue; // no channel — alignment has no opinion
    // The Commonwealth and the EU carry influence but are not left because a
    // nation stopped being Western: their membership answers to history and to
    // their own accession rules.
    if (!standing.governsMembership) continue;

    if (!standing.wantsOut) {
      // Recovered, or sitting in the 41-59 deadband: clear the run so leaving
      // must be sustained, not cumulative.
      if (membership.wantsOutSinceTurn != null) {
        await membershipsCol.updateOne(
          { _id: membership._id },
          { $set: { wantsOutSinceTurn: null } }
        );
      }
      continue;
    }

    const since = membership.wantsOutSinceTurn ?? currentTurn;
    if (membership.wantsOutSinceTurn == null) {
      await membershipsCol.updateOne(
        { _id: membership._id },
        { $set: { wantsOutSinceTurn: currentTurn } }
      );
    }
    if (currentTurn - since < SUSTAIN_TURNS) continue;

    // A player is steering this country: warn, never act. Matches how
    // nppAutonomy treats playerControlled — the engine does not pull a player's
    // nation out of its alliance without them.
    if (access[membership.countryId as CountryId]?.enabledForPlayers) {
      defectionWarnings++;
      continue;
    }

    // Leave through the same path a withdrawal bill uses, so the tombstone is
    // written and the founding-member self-heal cannot re-add the defector.
    const def = await loadOrganizationDef(db, membership.organizationId);
    await removeOrganizationMembership(
      db,
      membership.countryId as CountryId,
      membership.organizationId,
      def?.name ?? membership.organizationId,
      currentTurn,
      now
    );
    defections++;
  }

  // Accession. A non-player nation that has held the join share in a bloc's pole
  // for a sustained run asks to be let in. It only ASKS: the org's unanimous
  // member vote still decides, which is the part players actually play.
  const proposalsCol = await getOrganizationProposalsCollection(db);
  for (const [entityId, ready] of joinReadyByEntity) {
    const countryId = entityId as CountryId;
    // Players choose their own alliances; this is the NPP's autonomy only.
    if (access[countryId]?.enabledForPlayers) continue;

    for (const channel of era.channels) {
      // Only the blocs a nation joins by picking a side. A nation at 60 Western
      // asks to join NATO — not the Commonwealth, which it has no claim on.
      if (channel.alignmentAccession !== true) continue;
      const readySince = ready[channel.poleId];
      if (readySince == null || currentTurn - readySince < SUSTAIN_TURNS) continue;
      if (orgsByCountry.get(countryId)?.has(channel.organizationId)) continue;

      const def = await loadOrganizationDef(db, channel.organizationId);
      if (!def) continue;
      // An org that has not been founded yet in this timeline cannot be applied to.
      if (!(await isOrganizationFoundedLive(db, def))) continue;
      if (await hasOpenMembershipProposal(db, channel.organizationId, countryId)) continue;

      // Do not pester. Without this a refused applicant would re-apply on the
      // very next turn, forever: its share is still high and the accession clock
      // is still old, so every gate above would pass again.
      const recentlyRefused = await proposalsCol.findOne({
        organizationId: channel.organizationId,
        proposingCountryId: countryId,
        resolvedOnTurn: { $gt: currentTurn - SUSTAIN_TURNS },
      });
      if (recentlyRefused) continue;

      await proposalsCol.insertOne({
        _id: new ObjectId(),
        organizationId: channel.organizationId,
        proposingCountryId: countryId,
        status: "pending",
        votes: [],
        proposedAt: now,
        proposedOnTurn: currentTurn,
        closesOnTurn: currentTurn + ORG_PROPOSAL_VOTING_TURNS,
        // An NPP government's own legislature is abstracted, and the sustained
        // run IS its decision — so the domestic gate is pre-satisfied and the
        // org's member vote is left as the only live gate.
        domesticApproved: true,
      } as never);
      joinRequests++;
    }
  }

  // Plays whose target has no alignment row at all would otherwise sit pending
  // forever and accumulate as a queue leak.
  for (const orphans of playsByTarget.values()) {
    for (const playDoc of orphans) {
      await resolvePlay(playDoc, 0);
      playsResolved++;
    }
  }

  return {
    countriesDrifted,
    erasCrossed,
    spheresSynced,
    rowsHealed,
    playsResolved,
    blocStress: Object.fromEntries(
      [...stressByOrg.entries()].map(([orgId, b]) => [orgId, Math.round(b.stress * 1000) / 1000])
    ),
    defections,
    defectionWarnings,
    joinRequests,
    crisesOpened,
    crisesResolved: closed.crisesResolved,
  };
}
