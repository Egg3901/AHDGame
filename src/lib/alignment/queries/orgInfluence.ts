/**
 * Read model for an organization's Influence tab: what this org can do to whom,
 * what it can afford, and what its members' money has already bought.
 *
 * Read-only. The only alignment write paths are seeding, the alignment turn
 * phase, and `commitInfluencePlay`.
 */
import {
  blocPlayEffectiveness,
  blocStressLabel,
  computeBlocStress,
} from "@/lib/alignment/blocStress";
import type { Db } from "mongodb";
import {
  ALIGNMENT_GATES,
  CRISIS_TURN_CAP,
  ALIGNMENT_POLES,
  PER_NATION_TURN_CAP,
  polesForYear,
  resolveAlignmentEra,
  type AlignmentPoleId,
  type AlignmentPoleToken,
} from "@/lib/constants/alignmentEras";
import { ROSTER_BY_KEY, type AlignmentCountryKey } from "@/lib/constants/alignmentRoster";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  GDP_MILLIONS_TO_USD,
  orgTributeRateAnnual,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";
import {
  getAlignmentCrisesCollection,
  getAlignmentPlaysCollection,
  getCountryAlignmentsCollection,
  getOrganizationLegislationCollection,
  getOrganizationMembershipsCollection,
} from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";
import { resolveGameYear } from "@/lib/era/era";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { loadGdpUsdMillionsByEntity } from "@/lib/internationalOrganizations/entityGdp";
import { getOrganizationFund } from "@/lib/internationalOrganizations/organizationFund";
import { POINT_COST_GDP_SHARE } from "../influence";
import { NON_ALIGNED_RESISTANCE } from "../drift";
import { isIntOrgAlignmentEnabled } from "../featureFlag";
import type { AlignmentStatus } from "../project";
import { JOIN_SHARE, LEAVE_SHARE, SUSTAIN_TURNS, standingFor } from "../membershipEligibility";
import { roundToShareGrid } from "../normalize";
import {
  eraPoleVocabulary,
  projectNationStanding,
  type LedgerPole,
  type NationStanding,
} from "./nationStanding";
import { computeWorldBalance, type WorldBalance } from "./worldBalance";

export interface InfluenceChannelView {
  poleId: AlignmentPoleId;
  poleLabel: string;
  accentToken: AlignmentPoleToken;
  weight: number;
}

export interface InfluenceTarget {
  entityId: AlignmentCountryKey;
  name: string;
  lead: number;
  status: AlignmentStatus;
  /** This org's pole share in the target, 0–100. */
  ourShare: number;
  /**
   * What one share point that ACTUALLY LANDS costs here, in the fund's own
   * currency. Null when the target's economy is not on record — the command
   * refuses those, so the tab must not offer a price it cannot honour.
   *
   * This is the delivered price, not the list price: a nation inside the
   * non-aligned band resists at half strength, so a point costs twice as much
   * there. Quoting the raw 1%-of-GDP figure would understate the real cost of
   * the contested nations — the ones actually worth courting — by 2x.
   */
  pointCostLocal: number | null;
  /** What moving it as far as a turn allows costs, at the delivered price. */
  turnCapCostLocal: number | null;
  /** True when this target resists at half strength (lead within the band). */
  resistsAtHalfStrength: boolean;
  shares: Partial<Record<AlignmentPoleId, number>>;
  nonAligned: number;
  topPoleId: AlignmentPoleId | null;
  /** Change in LEAD since last turn. Null until a turn has passed. */
  trend: number | null;
  /**
   * Change in THIS ORG'S pole share since last turn — not in the lead, which
   * can move the other way when a third party gains. Shown beside a member's
   * standing; null until a turn has passed.
   */
  ourShareTrend: number | null;
  /** Open flashpoint on this nation, or null. */
  crisis: { turnsRemaining: number; movementCap: number } | null;
  /** Orgs currently sanctioning it — the drag on their own standing here. */
  sanctionedBy: string[];
  /** Already on this organisation's roll — the nations you are holding, not taking. */
  isMember: boolean;
  /**
   * Delivered cost to carry it from `ourShare` up to the join gate (60).
   * Null when unpriceable, AND null when `ourShare` already sits at or above
   * the gate — nothing left to buy is not the same as free. Both sort last.
   */
  costToGate: number | null;
  /**
   * For a non-member nation sitting at or above the join gate: how long it has
   * held there, and how many turns remain before it files a membership
   * application. Null unless it qualifies — a nation below the gate has no run
   * to count, and a player-run nation never auto-applies (players pick their own
   * blocs), so neither shows a countdown. `turnsToApply === 0` means the run is
   * complete and the application is due; the members' vote still decides after.
   */
  joinCountdown: { turnsHeld: number; turnsToApply: number } | null;
}

export interface InfluencePlayRow {
  targetEntityId: string;
  targetName: string;
  sponsorCountryId: CountryId;
  amountLocal: number;
  turn: number;
  resolvedTurn: number | null;
  appliedPoints: number | null;
  /** Spend returned to the fund because the play resolved at zero points. */
  refunded: boolean;
}

export interface RivalIntelEntry {
  /** The rival bloc's pole label — never the org, its fund, or the sponsor. */
  poleLabel: string;
  accentToken: AlignmentPoleToken;
  pointsLanded: number;
  turnsAgo: number;
}

export interface InfluenceMemberRow {
  countryId: CountryId;
  name: string;
  /** Whether this member still clears the bar for the org's own pole. */
  eligible: boolean;
  /** Share in the org's pole, 0–100. */
  share: number;
  /** At or below the leave threshold — actively on the way out. */
  wantsOut: boolean;
  /** Turns it has sat below the gate, or null while it stands. */
  turnsBelowGate: number | null;
  /** Founding members cannot be shown the door, whatever their standing. */
  exempt: boolean;
  /**
   * Whether this member votes. Player-enabled countries do; everyone else is a
   * full member that pays tribute instead of dues and casts no ballot.
   */
  hasVote: boolean;
}

export interface OrgInfluenceView {
  enabled: boolean;
  year: number;
  /** Null when this org carries no influence in the current era. */
  channel: InfluenceChannelView | null;
  fundBalanceLocal: number;
  fundCurrencyCountryId: CountryId;
  /**
   * ₳ (≈ era USD) per one unit of the fund's currency, resolved SERVER-SIDE for
   * the active era (refs #3778). Every money figure on this view is in the
   * fund's currency; this is what lets the client show those in the viewer's
   * preferred one without re-deriving a rate from `COUNTRY_CONFIGS`, whose
   * values are modern and would misprice a 1953 world. Absent on the gate-off
   * shape, where there are no figures to convert.
   */
  usdToFundRate?: number;
  targets: InfluenceTarget[];
  recent: InfluencePlayRow[];
  /** Standing of this org's own members — who is wobbling, and for how long. */
  members: InfluenceMemberRow[];
  /**
   * How strained this bloc is, and what that costs its plays.
   *
   * Surfaced because it DAMPENS the org's own influence spending: a player whose
   * money quietly bought less, with no visible cause, would reasonably read that
   * as the game cheating. Null when the org carries no alignment channel and so
   * has no bloc to strain.
   */
  blocStress: {
    /** 0-1 gauge. */
    stress: number;
    /** Settled / Strained / Overextended. */
    label: string;
    /** Multiplier currently applied to this org's plays, 0.6-1. */
    effectiveness: number;
    /** Fraction of members a rival pole is actively pulling at. */
    contested: number;
    /** Fraction at the leave threshold. */
    wantsOut: number;
    /** Fraction acceded recently enough to still be settling in. */
    digesting: number;
  } | null;
  /** Turns a threshold must hold before a non-player nation acts on it. */
  sustainTurns: number;
  /** Share needed to join. */
  joinShare: number;
  /** Share at or below which a member leaves. */
  leaveShare: number;
  /** The era's poles, for the share bars. */
  poles: LedgerPole[];
  /** What the remainder is called this era. */
  remainderLabel: string;
  /** World standing, both weightings. Null when there is nothing to weigh. */
  balance: WorldBalance | null;
  /** Recent rival activity per target entity. Points only, never money. */
  rivalIntel: Record<string, RivalIntelEntry[]>;
  /**
   * Whether this organisation actually levies tribute in this world. Only the
   * two armed blocs do, and only in a 1953-start world — so a member without a
   * vote is not automatically a member who pays.
   */
  leviesTribute: boolean;
}

const RECENT_LIMIT = 20;
/** How far back the dossier reports rival activity. */
const INTEL_WINDOW_TURNS = 12;

export async function loadOrgInfluence(
  db: Db,
  organizationId: InternationalOrganizationId
): Promise<OrgInfluenceView> {
  const gs = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, currentTurn: 1, startingYear: 1, intOrgAlignmentEnabled: 1 } }
    );
  const currentTurn = gs?.currentTurn ?? 0;

  const year = (gs ? resolveGameYear(gs) : null) ?? new Date().getFullYear();
  const fund = await getOrganizationFund(db, organizationId);
  const base: {
    year: number;
    fundBalanceLocal: number;
    fundCurrencyCountryId: CountryId;
    usdToFundRate?: number;
  } = {
    year,
    fundBalanceLocal: fund?.balanceLocal ?? 0,
    fundCurrencyCountryId: (fund?.currencyCountryId ?? "US") as CountryId,
  };

  // Gate off: report the shape so the tab can explain itself, but never read
  // the alignment or play collections.
  if (!(await isIntOrgAlignmentEnabled(gs ?? {}))) {
    return {
      ...base,
      enabled: false,
      channel: null,
      targets: [],
      recent: [],
      members: [],
      blocStress: null,
      sustainTurns: SUSTAIN_TURNS,
      joinShare: JOIN_SHARE,
      leaveShare: LEAVE_SHARE,
      poles: [],
      remainderLabel: eraPoleVocabulary(year).remainderLabel,
      balance: null,
      rivalIntel: {},
      leviesTribute: false,
    };
  }

  const era = resolveAlignmentEra(year);
  const channelDef = era.channels.find((c) => c.organizationId === organizationId);
  if (!channelDef) {
    // The common case for most orgs in most eras. Not an error — the tab says so.
    return {
      ...base,
      enabled: true,
      channel: null,
      targets: [],
      recent: [],
      members: [],
      blocStress: null,
      sustainTurns: SUSTAIN_TURNS,
      joinShare: JOIN_SHARE,
      leaveShare: LEAVE_SHARE,
      poles: [],
      remainderLabel: eraPoleVocabulary(year).remainderLabel,
      balance: null,
      rivalIntel: {},
      leviesTribute: false,
    };
  }

  const pole = ALIGNMENT_POLES[channelDef.poleId];
  const channel: InfluenceChannelView = {
    poleId: channelDef.poleId,
    poleLabel: pole.label,
    accentToken: pole.accentToken,
    weight: channelDef.weight,
  };

  const poleIds = polesForYear(year);
  const { poles, remainderLabel } = eraPoleVocabulary(year);
  const alignments = await getCountryAlignmentsCollection(db);
  const rows = await alignments.find({}).toArray();

  // Influence is priced against each target's own economy, so the tab has to
  // show the price per target — with a flat rate a player could memorise one
  // number, and now every nation costs something different.
  const gdpMillions = await loadGdpUsdMillionsByEntity(
    db,
    rows.map((r) => r.entityId as string)
  );
  // Era-aware: the base config carries 2019 rates, so a 1953 world would price
  // every influence play with the wrong currency normaliser (refs #3778).
  const preset = await loadWorldPreset(db);
  const fundRate = getGdpAnchorRate(base.fundCurrencyCountryId, preset);
  // Handed to the client so cost figures can follow the display-currency
  // preference; the same rate the costs below are normalised by, so the two can
  // never disagree about what a fund unit is worth.
  base.usdToFundRate = fundRate;

  // Loaded before the targets loop so a target can say whether it is already
  // ours; the members panel below reuses the same rows rather than re-querying.
  const membershipsCol = await getOrganizationMembershipsCollection(db);
  const memberRows = await membershipsCol.find({ organizationId }).toArray();
  const memberIds = new Set<string>(memberRows.map((m) => String(m.countryId)));

  // Loaded here rather than only for the members panel below: the targets loop
  // needs it too, to decide whether a nation over the gate is actually on the
  // path to apply. A player-run nation never auto-applies, so it must not be
  // shown a countdown that will never fire.
  const access = await getAllCountryAccess(db);

  const crisesCol = await getAlignmentCrisesCollection(db);
  const openCrises = await crisesCol.find({ status: "open" }).sort({ closesTurn: 1 }).toArray();
  const crisisByTarget = new Map(
    openCrises.map((c) => [
      c.targetEntityId as string,
      {
        turnsRemaining: Math.max(0, c.closesTurn - currentTurn),
        movementCap: CRISIS_TURN_CAP,
      },
    ])
  );

  // Sanctions erode the sanctioning bloc's own standing in the target, so the
  // dossier names them among the modifiers acting on a nation.
  const sanctionsByTarget = new Map<string, string[]>();
  for (const legislation of await (
    await getOrganizationLegislationCollection(db)
  )
    .find({ type: "sanctions", status: "active" })
    .toArray()) {
    const sanctionTarget = legislation.sanctionsTargetCountryId;
    if (!sanctionTarget) continue;
    sanctionsByTarget.set(sanctionTarget, [
      ...(sanctionsByTarget.get(sanctionTarget) ?? []),
      legislation.organizationId,
    ]);
  }

  // Every projected nation, including the locked ones targets excludes — the
  // balance is the world's, and dropping locked nations would make the bar
  // lurch every time a country locked.
  const allStandings: NationStanding[] = [];

  const targets: InfluenceTarget[] = [];
  for (const row of rows) {
    const standing = projectNationStanding(row, {
      era,
      poleIds,
      memberPoleIds: new Set<AlignmentPoleId>(),
      preset,
    });
    if (!standing) continue;
    allStandings.push(standing);

    const lead = standing.lead;
    // Locked nations are rejected by the command, so offering them would be a
    // trap rather than a choice. They still count toward the balance above.
    if (lead >= ALIGNMENT_GATES.locked) continue;

    const targetGdpUsd = (gdpMillions.get(row.entityId as string) ?? 0) * GDP_MILLIONS_TO_USD;
    // A nation inside the non-aligned band absorbs only half of what is pushed
    // at it, so a point delivered there costs twice the list price.
    const resistsAtHalfStrength = lead <= ALIGNMENT_GATES.nonAligned;
    const grossPointCost = (targetGdpUsd * POINT_COST_GDP_SHARE) / fundRate;
    const pointCostLocal =
      targetGdpUsd > 0
        ? Math.round(grossPointCost / (resistsAtHalfStrength ? NON_ALIGNED_RESISTANCE : 1))
        : null;

    const ourShare = standing.shares[channelDef.poleId] ?? 0;
    const previousOurShare = standing.previousShares?.[channelDef.poleId];
    const pointsToGate = Math.max(0, JOIN_SHARE - ourShare);

    // The sustain clock the turn engine keeps in `joinReadySince`, surfaced.
    // Only a non-member, non-player nation actually holding the gate is on the
    // path to apply, so the countdown is null otherwise (see accession skips in
    // alignmentPhase.ts). Reads the raw pole share, not `standing.eligible`,
    // because the clock itself is stamped on the raw share crossing the gate.
    const joinReadySince = row.joinReadySince?.[channelDef.poleId];
    const isPlayerRun = access[row.entityId as CountryId]?.enabledForPlayers === true;
    const joinCountdown =
      !memberIds.has(standing.entityId) &&
      !isPlayerRun &&
      ourShare >= JOIN_SHARE &&
      joinReadySince != null
        ? {
            turnsHeld: Math.max(0, currentTurn - joinReadySince),
            turnsToApply: Math.max(0, SUSTAIN_TURNS - (currentTurn - joinReadySince)),
          }
        : null;

    targets.push({
      ...standing,
      ourShare,
      resistsAtHalfStrength,
      pointCostLocal,
      turnCapCostLocal: pointCostLocal === null ? null : pointCostLocal * PER_NATION_TURN_CAP,
      // Null, not zero: a nation already past the gate has nothing left to buy,
      // and a zero would sort it to the top of "cheapest to flip".
      costToGate:
        pointCostLocal === null || pointsToGate <= 0
          ? null
          : Math.round(pointCostLocal * pointsToGate),
      ourShareTrend:
        previousOurShare === undefined ? null : roundToShareGrid(ourShare - previousOurShare),
      crisis: crisisByTarget.get(standing.entityId) ?? null,
      sanctionedBy: sanctionsByTarget.get(standing.entityId) ?? [],
      isMember: memberIds.has(standing.entityId),
      joinCountdown,
    });
  }

  // Cheapest to win first: the least committed nations sit at the top.
  targets.sort((a, b) => a.lead - b.lead || a.name.localeCompare(b.name));

  const plays = await getAlignmentPlaysCollection(db);
  const recentDocs = await plays
    .find({ organizationId })
    .sort({ turn: -1 })
    .limit(RECENT_LIMIT)
    .toArray();

  // One grouped read for every target rather than a fetch per dossier. Plays
  // are rare — at most one per org per turn — so this set stays small.
  const intelDocs = await plays
    .find({
      organizationId: { $ne: organizationId },
      resolvedTurn: { $ne: null, $gte: currentTurn - INTEL_WINDOW_TURNS },
    })
    .sort({ resolvedTurn: -1 })
    .toArray();

  const rivalIntel: Record<string, RivalIntelEntry[]> = {};
  for (const doc of intelDocs) {
    if (doc.organizationId === organizationId) continue;
    const intelChannel = era.channels.find((c) => c.organizationId === doc.organizationId);
    if (!intelChannel) continue; // stranded by an era crossing; unmappable to a pole
    const points = doc.appliedPoints ?? 0;
    if (points <= 0) continue; // resolved at zero is noise, not intelligence
    const intelPole = ALIGNMENT_POLES[intelChannel.poleId];
    // `amountUsd` is deliberately not read here. Withholding a rival's spend is
    // enforced at this boundary so no later UI change can leak fund depth.
    const entry: RivalIntelEntry = {
      poleLabel: intelPole.label,
      accentToken: intelPole.accentToken,
      pointsLanded: roundToShareGrid(points),
      turnsAgo: Math.max(0, currentTurn - (doc.resolvedTurn ?? currentTurn)),
    };
    rivalIntel[doc.targetEntityId] = [...(rivalIntel[doc.targetEntityId] ?? []), entry];
  }

  const recent: InfluencePlayRow[] = recentDocs.map((p) => ({
    targetEntityId: p.targetEntityId,
    targetName:
      COUNTRY_CONFIGS[p.targetEntityId as CountryId]?.name ??
      ROSTER_BY_KEY[p.targetEntityId]?.name ??
      p.targetEntityId,
    sponsorCountryId: p.sponsorCountryId,
    amountLocal: p.amountLocal,
    turn: p.turn,
    resolvedTurn: p.resolvedTurn,
    appliedPoints: p.appliedPoints,
    refunded: p.refunded === true,
  }));

  // Members' own standing. Computed from `lead` via standingFor, deliberately
  // NOT from statusFor's band: that band puts `isPlayer` first, so a player
  // country would read "player" and have its own defection risk hidden from it —
  // the opposite of a warning.
  const alignmentByEntity = new Map(rows.map((r) => [r.entityId as string, r]));

  const members: InfluenceMemberRow[] = [];
  for (const m of memberRows) {
    const row = alignmentByEntity.get(m.countryId);
    if (!row) continue;
    const standing = standingFor({
      shares: { shares: row.shares, nonAligned: row.nonAligned },
      year,
      organizationId,
    });
    if (!standing) continue;
    const exempt = m.status === "founding";
    members.push({
      countryId: m.countryId as CountryId,
      name:
        COUNTRY_CONFIGS[m.countryId as CountryId]?.name ??
        ROSTER_BY_KEY[m.countryId as AlignmentCountryKey]?.name ??
        m.countryId,
      eligible: standing.eligible,
      share: standing.share,
      wantsOut: standing.wantsOut,
      // A founder never defects, so showing it a countdown would promise
      // something the engine will not do.
      turnsBelowGate:
        exempt || m.wantsOutSinceTurn == null
          ? null
          : Math.max(0, currentTurn - m.wantsOutSinceTurn),
      exempt,
      hasVote: access[m.countryId as CountryId]?.enabledForPlayers === true,
    });
  }
  // Bloc stress over the same member rows, so the gauge and the roster below it
  // can never disagree. `rivalShare` is the largest share any other pole holds —
  // what makes a member contested.
  const blocStressBreakdown = channel
    ? computeBlocStress(
        memberRows
          .map((m) => {
            const row = alignmentByEntity.get(m.countryId);
            if (!row) return null;
            // The era's pole IDS, not the display vocabulary `poles` above.
            const rivalShare = era.poles
              .filter((p) => p !== channel.poleId)
              .reduce((max, p) => Math.max(max, row.shares[p] ?? 0), 0);
            return {
              entityId: m.countryId,
              share: row.shares[channel.poleId] ?? 0,
              rivalShare,
              wantsOutSinceTurn: m.wantsOutSinceTurn,
              joinedTurn: m.joinedTurn,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null),
        currentTurn
      )
    : null;

  // Wobbling members first — they are what a bloc needs to act on.
  // Genuinely at-risk members first — a founder below the bar is not at risk.
  members.sort(
    (a, b) =>
      Number(!a.wantsOut || a.exempt) - Number(!b.wantsOut || b.exempt) ||
      a.name.localeCompare(b.name)
  );

  return {
    ...base,
    enabled: true,
    channel,
    targets,
    recent,
    members,
    blocStress: blocStressBreakdown
      ? {
          stress: blocStressBreakdown.stress,
          label: blocStressLabel(blocStressBreakdown.stress),
          effectiveness: blocPlayEffectiveness(blocStressBreakdown.stress),
          contested: blocStressBreakdown.contested,
          wantsOut: blocStressBreakdown.wantsOut,
          digesting: blocStressBreakdown.digesting,
        }
      : null,
    sustainTurns: SUSTAIN_TURNS,
    joinShare: JOIN_SHARE,
    leaveShare: LEAVE_SHARE,
    poles,
    remainderLabel,
    balance: computeWorldBalance(allStandings, gdpMillions, poleIds),
    rivalIntel,
    leviesTribute: orgTributeRateAnnual(organizationId, await loadWorldPreset(db)) > 0,
  };
}
