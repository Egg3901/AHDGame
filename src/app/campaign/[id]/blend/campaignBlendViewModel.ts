/**
 * View model for the Blend campaign manager (Proposal D).
 *
 * Pure function: it takes the campaign payload, the viewer's own resources and
 * the screen's UI state, and returns exactly the fields the D markup binds. The
 * whole live-data contract is enforced here so the JSX stays declarative and
 * every derivation is unit-testable.
 *
 * Nothing in the design's placeholder constants survives into this file. Where
 * the mockup showed an invented figure, the field either resolves from the
 * payload or is absent.
 */

import {
  getCampaignCategoriesForElection,
  CAMPAIGN_CATEGORIES,
  type CampaignData,
} from "@/lib/campaigns/dto/campaignView";
import {
  CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER,
  campaignStrengthBoostPercent,
  campaignStrengthContributionActions,
  campaignStrengthContributionCost,
} from "@/lib/campaigns/campaignStrength";
import { describeOpsCurrentEffect } from "@/lib/campaigns/opsCurrentEffect";
import { OPS_MAX_BRANCH_LEVEL, type UpgradeCategory } from "@/lib/campaigns/upgradeCosts";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { formatFundsCompact, resolveElectionYear } from "@/lib/utils/formatters";
import { BLEND, OPS_LEVER_COLOR, blendSegments } from "@/components/blend/tokens";
import type { BlendVitalCell } from "@/components/blend/BlendVitals";

/** Starter plus three branches at max, per lever, across the four levers. */
export const OPS_TOTAL_CAP = 4 * (1 + 3 * OPS_MAX_BRANCH_LEVEL);

export const LEDGER_PAGE_SIZE = 10;

/** Width of the money pane's sparkline, matching the stored history cap. */
export const SPARKLINE_TURNS = 18;

export type CampaignRail = "overview" | "ops" | "money" | "log";

export interface ViewerResources {
  /** Campaign-fund balance usable for a contribution. */
  funds: number | null;
  storedFunds: number | null;
  actions: number | null;
  nationalInfluence: number | null;
  fundsCurrency: CurrencyCode | null;
}

export interface CampaignBlendInput {
  campaign: CampaignData;
  me: ViewerResources;
  /** From game state. Null while it is still loading. */
  currentTurn: number | null;
  /** Headlines from the per-race wire feed. */
  wire: string[];
  runningMateName: string | null;
  rail: CampaignRail;
  ledgerPage: number;
  expandedCategory: UpgradeCategory | null;
}

export interface OpsBranchVM {
  key: "a" | "b" | "c";
  label: string;
  description: string;
  level: number;
  maxLevel: number;
  segments: React.CSSProperties[];
  effect: string;
  costText: string;
  maintenanceText: string;
  maxed: boolean;
  affordable: boolean;
  actionable: boolean;
  statusText: string;
}

export interface OpsTreeVM {
  unlocked: boolean;
  starterEffect: string;
  starterCostText: string;
  starterAffordable: boolean;
  requiresTarget: boolean;
  targetName: string | null;
  branches: OpsBranchVM[];
}

export interface OpsRowVM {
  key: UpgradeCategory;
  label: string;
  description: string;
  effect: string;
  color: string;
  invested: number;
  level: string;
  segments: React.CSSProperties[];
  expanded: boolean;
  tree: OpsTreeVM | null;
  /**
   * What the next tier buys and what it costs.
   *
   * The row used to show a bare "+" with no price while a separate briefing
   * card listed the same four levers' costs, so the reader had to hold two
   * blocks side by side to answer one question. Null when the lever is maxed.
   */
  nextStep: { effect: string; costText: string } | null;
}

export interface LedgerRowVM {
  turnTag: string;
  label: string;
  cost: string;
  demoted: boolean;
  reason: string | null;
}

export interface SparklineBarVM {
  turn: number;
  net: number;
  /** 0..100, relative to the tallest absolute net in the window. */
  heightPct: number;
}

export interface MoneyVM {
  symbol: string;
  incomeTotal: number;
  groundUpkeep: number;
  mediaUpkeep: number;
  net: number;
  cumulative: {
    totalGenerated: number;
    totalSpent: number;
    actionsGenerated: number;
    actionsSpent: number;
  };
  sparkline: SparklineBarVM[];
  personalBalance: number | null;
  personalSymbol: string;
  partyTreasury: {
    partyName: string;
    role: string;
    balance: number;
    symbol: string;
  } | null;
}

export interface SupportVM {
  support: number;
  supportText: string;
  dripText: string;
  fillPct: number;
  rallyActionCost: number;
  canRally: boolean;
  rallyBlockedReason: string | null;
  tourActive: boolean;
}

export interface StrengthVM {
  strength: number;
  boostPct: string;
  strengthAdded: number;
  costFunds: number;
  costActions: number;
  costText: string;
  newBoostPct: string;
  canContribute: boolean;
}

export interface CampaignBlendVM {
  railItems: { id: CampaignRail; label: string; badge?: string }[];
  paneTitle: string;
  standfirst: string;
  turnReadout: string;
  railTitle: string;
  railSubtitle: string;
  fogFootnote: string | null;
  wire: string[];
  vitals: BlendVitalCell[];
  ops: OpsRowVM[];
  money: MoneyVM | null;
  ledger: {
    rows: LedgerRowVM[];
    rangeText: string;
    pageText: string;
    hasPager: boolean;
    canPrev: boolean;
    canNext: boolean;
    page: number;
    pageCount: number;
  };
  support: SupportVM | null;
  strength: StrengthVM | null;
  managers: {
    countText: string;
    list: { characterId: string; name: string }[];
    atCap: boolean;
    canAppoint: boolean;
  };
  ticket: { runningMateName: string | null };
}

const PANE_TITLES: Record<CampaignRail, string> = {
  overview: "Campaign overview",
  ops: "Strategic operations",
  money: "Budget & contributions",
  log: "Activity log",
};

const CATEGORY_ORDER: UpgradeCategory[] = [
  "fundraising",
  "oppositionResearch",
  "groundGame",
  "mediaSpending",
];

/** Manager cap, mirrored the way CampaignManagersPanel mirrors it. */
const MAX_MANAGERS = 3;

function symbolFor(code: CurrencyCode | null | undefined): string {
  return (code && CURRENCY_SYMBOLS[code]) || "$";
}

function money(amount: number, symbol: string): string {
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

/** Total invested in one lever: starter plus its three branch levels. */
function investedIn(campaign: CampaignData, category: UpgradeCategory): number {
  const tree = campaign.opsTrees?.[category];
  if (!tree) return 0;
  return (tree.unlocked ? 1 : 0) + tree.branches.reduce((sum, b) => sum + (b.level ?? 0), 0);
}

/** Turn the DTO's ops tree back into the {starter,a,b,c} shape the effect derivation wants. */
function treeStateOf(campaign: CampaignData, category: UpgradeCategory) {
  const tree = campaign.opsTrees?.[category];
  if (!tree) return undefined;
  const level = (key: "a" | "b" | "c") => tree.branches.find((b) => b.key === key)?.level ?? 0;
  return { starter: tree.unlocked, a: level("a"), b: level("b"), c: level("c") };
}

function buildTurnReadout(campaign: CampaignData, currentTurn: number | null): string {
  const parts: string[] = [];
  if (currentTurn != null) parts.push(`TURN ${currentTurn.toLocaleString("en-US")}`);
  if (campaign.electionInfo?.isEnded) parts.push("RACE CONCLUDED");
  return parts.join(" · ");
}

function buildRailSubtitle(campaign: CampaignData): string {
  const year = campaign.electionInfo
    ? resolveElectionYear({
        electionType: campaign.electionInfo.electionType,
        cycle: campaign.electionInfo.cycle,
        electionYear: campaign.electionInfo.electionYear,
        senateClass: campaign.electionInfo.senateClass,
      })
    : null;
  const race = campaign.electionInfo
    ? campaign.electionInfo.electionType === "president"
      ? "President"
      : campaign.electionInfo.electionType
    : null;
  return [campaign.party, race, year ? String(year) : null].filter(Boolean).join(" · ");
}

function buildFogFootnote(campaign: CampaignData): string | null {
  // An owner sees their own true figures; telling them otherwise would be false.
  if (campaign.accessLevel === "owner") return null;
  const source = campaign.accessLevel === "party" ? "Party" : "Public";
  return `${source} intelligence. Opponent Support and operation levels shown here are estimates.`;
}

export function buildCampaignBlendViewModel(inp: CampaignBlendInput): CampaignBlendVM {
  const { campaign, me, currentTurn, wire, runningMateName, rail, expandedCategory } = inp;

  const symbol = symbolFor(campaign.currencyCode);
  const history = campaign.activityHistory ?? [];
  const totalInvested = CATEGORY_ORDER.reduce((sum, c) => sum + investedIn(campaign, c), 0);

  // ── Rail ──────────────────────────────────────────────────────────────────
  const railItems: CampaignBlendVM["railItems"] = [
    { id: "overview", label: "Overview" },
    { id: "ops", label: "Operations", badge: `${totalInvested}/${OPS_TOTAL_CAP}` },
    { id: "money", label: "Money" },
    { id: "log", label: "Activity log", badge: String(history.length) },
  ];

  // ── Vitals ────────────────────────────────────────────────────────────────
  const vitals: BlendVitalCell[] = [];
  if (campaign.funds != null) {
    // The runway rides along with the balance and the burn rather than sitting
    // in a card of its own further down: that card restated both figures from
    // this cell to add one sentence, so the reader met the same money twice.
    const runway = campaign.briefing?.cashRunway?.turnsOfRunway ?? null;
    const perTurn = campaign.budget
      ? `${campaign.budget.netIncome >= 0 ? "+" : "-"}${money(Math.abs(campaign.budget.netIncome), symbol)} / turn`
      : null;
    vitals.push({
      label: "War chest",
      value: formatFundsCompact(campaign.funds, symbol),
      sub:
        perTurn && runway != null
          ? `${perTurn} · ${runway.toLocaleString("en-US")} turn${runway === 1 ? "" : "s"} of runway`
          : (perTurn ?? undefined),
      color: OPS_LEVER_COLOR.fundraising,
    });
  }
  if (campaign.actions != null) {
    vitals.push({
      label: "Actions",
      value: String(campaign.actions),
      sub: campaign.budget ? `+${campaign.budget.actions.perTurn} / turn` : undefined,
      color: "#22d3ee",
    });
  }
  if (campaign.ownSupport) {
    vitals.push({
      label: "Support",
      value: campaign.ownSupport.support.toFixed(1),
      sub: `+${campaign.ownSupport.pendingDripTotal.toFixed(2)} pending`,
      color: BLEND.ink,
    });
  }
  if (campaign.campaignStrength != null) {
    vitals.push({
      label: "Strength",
      value: String(campaign.campaignStrength),
      sub: `+${campaignStrengthBoostPercent(campaign.campaignStrength).toFixed(1)}% vote boost`,
      color: BLEND.accent,
    });
  }

  // ── Operations ────────────────────────────────────────────────────────────
  const categories = campaign.electionInfo?.electionType
    ? getCampaignCategoriesForElection({ electionType: campaign.electionInfo.electionType })
    : CAMPAIGN_CATEGORIES;

  const ops: OpsRowVM[] = campaign.opsTrees
    ? CATEGORY_ORDER.map((key) => {
        const meta = categories.find((c) => c.key === key);
        const invested = investedIn(campaign, key);
        const color = OPS_LEVER_COLOR[key];
        const expanded = expandedCategory === key;

        const next = campaign.nextUpgradeCosts?.[key] ?? null;

        return {
          key,
          label: meta?.label ?? key,
          description: meta?.description ?? "",
          effect: describeOpsCurrentEffect(key, treeStateOf(campaign, key), symbol),
          color,
          invested,
          level: `${invested}/10`,
          segments: blendSegments(invested, 10, color),
          expanded,
          tree: expanded ? buildTreeVM(campaign, key, symbol) : null,
          nextStep: next
            ? {
                effect: next.effect,
                costText: `${money(next.funds, symbol)} · ${next.actions} action${
                  next.actions === 1 ? "" : "s"
                }`,
              }
            : null,
        };
      })
    : [];

  function buildTreeVM(c: CampaignData, key: UpgradeCategory, sym: string): OpsTreeVM {
    const t = c.opsTrees![key];
    const funds = c.funds ?? 0;
    const actions = c.actions ?? 0;
    const canAfford = (cost: { funds: number; actions: number } | null) =>
      !!cost && funds >= cost.funds && actions >= cost.actions;

    return {
      unlocked: t.unlocked,
      starterEffect: t.starterEffect,
      starterCostText: t.starterCost
        ? `${money(t.starterCost.funds, sym)} · ${t.starterCost.actions}a`
        : "",
      starterAffordable: canAfford(t.starterCost),
      requiresTarget: t.requiresTarget,
      targetName: c.oppositionTargetName,
      branches: t.branches.map((b) => {
        const maxed = b.level >= b.maxLevel;
        const affordable = canAfford(b.next);
        return {
          key: b.key,
          label: b.label,
          description: b.description,
          level: b.level,
          maxLevel: b.maxLevel,
          segments: blendSegments(b.level, b.maxLevel, OPS_LEVER_COLOR[key]),
          effect: b.next?.effect ?? "",
          costText: b.next ? `${money(b.next.funds, sym)} · ${b.next.actions}a` : "",
          maintenanceText: b.next?.maintenance
            ? `+${money(b.next.maintenance, sym)}/turn upkeep`
            : "",
          maxed,
          affordable,
          actionable: t.unlocked && !maxed,
          statusText: !t.unlocked ? "Locked" : maxed ? "Max Level" : "",
        };
      }),
    };
  }

  // ── Money ─────────────────────────────────────────────────────────────────
  const budget = campaign.budget;
  const rawHistory =
    (campaign as { netIncomeHistory?: { turn: number; net: number }[] }).netIncomeHistory ?? [];
  const series = rawHistory.slice(-SPARKLINE_TURNS);
  const peak = series.reduce((m, p) => Math.max(m, Math.abs(p.net)), 0);

  const money_: MoneyVM | null = budget
    ? {
        symbol,
        incomeTotal: budget.income.total,
        groundUpkeep: budget.expenses.groundGameMaintenance,
        mediaUpkeep: budget.expenses.mediaSpendingMaintenance,
        net: budget.netIncome,
        cumulative: budget.cumulative,
        // An absent series renders no bars at all. It fills in going forward;
        // reconstructing it would present a guess as fact.
        sparkline: series.map((p) => ({
          turn: p.turn,
          net: p.net,
          heightPct: peak > 0 ? Math.round((Math.abs(p.net) / peak) * 100) : 0,
        })),
        personalBalance: me.storedFunds,
        personalSymbol: symbolFor(me.fundsCurrency),
        partyTreasury: campaign.partyTreasuryAccess
          ? {
              partyName: campaign.partyTreasuryAccess.partyName,
              role: campaign.partyTreasuryAccess.role,
              balance: campaign.partyTreasuryAccess.treasury,
              symbol: symbolFor(campaign.partyTreasuryAccess.currencyCode),
            }
          : null,
      }
    : null;

  // ── Ledger ────────────────────────────────────────────────────────────────
  const pageCount = Math.max(1, Math.ceil(history.length / LEDGER_PAGE_SIZE));
  const page = Math.min(Math.max(0, inp.ledgerPage), pageCount - 1);
  const start = page * LEDGER_PAGE_SIZE;
  const pageRows = history.slice(start, start + LEDGER_PAGE_SIZE);

  const ledgerRows: LedgerRowVM[] = pageRows.map((a) => {
    const demoted = a.type === "downgrade";
    const spaced = (a.category ?? "").replace(/([A-Z])/g, " $1").trim();
    const label = spaced.charAt(0).toUpperCase() + spaced.slice(1);
    return {
      turnTag: `T${a.turnNumber}`,
      label: `${label}${demoted ? " down to Lv " : " to Lv "}${a.newLevel ?? 0}${
        a.targetName ? ` vs ${a.targetName}` : ""
      }`,
      cost: demoted ? "demoted" : `-${money(a.costFunds ?? 0, symbol)} · -${a.costActions ?? 0}a`,
      demoted,
      reason: a.reason ?? null,
    };
  });

  // ── Support and rally ─────────────────────────────────────────────────────
  const own = campaign.ownSupport;
  const actionsNow = campaign.actions ?? 0;
  let rallyBlockedReason: string | null = null;
  if (own) {
    if (campaign.electionInfo?.isEnded) rallyBlockedReason = "The race has ended.";
    else if (campaign.isArchived) rallyBlockedReason = "This campaign is concluded.";
    else if (campaign.campaignSuspended) rallyBlockedReason = "Campaigning is suspended.";
    else if (own.rallyFiredThisTurn) rallyBlockedReason = "Already fired this turn.";
    else if (actionsNow < own.rallyOneShotActionCost)
      rallyBlockedReason = "Not enough actions to rally.";
  }

  const support: SupportVM | null = own
    ? {
        support: own.support,
        supportText: own.support.toFixed(1),
        dripText: `+${own.pendingDripTotal.toFixed(2)}`,
        fillPct: Math.max(0, Math.min(100, own.support)),
        rallyActionCost: own.rallyOneShotActionCost,
        canRally: rallyBlockedReason === null,
        rallyBlockedReason,
        tourActive: own.rallyTourActive,
      }
    : null;

  // ── Campaign strength ─────────────────────────────────────────────────────
  const currentStrength = campaign.campaignStrength ?? 0;
  const strengthAdded =
    me.nationalInfluence != null
      ? me.nationalInfluence * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER
      : 0;
  const costFunds = Math.round(
    campaignStrengthContributionCost(currentStrength, strengthAdded) * campaign.fxRate
  );
  const costActions = campaignStrengthContributionActions(strengthAdded);

  const strength: StrengthVM | null =
    campaign.campaignStrength != null
      ? {
          strength: currentStrength,
          boostPct: campaignStrengthBoostPercent(currentStrength).toFixed(1),
          strengthAdded,
          costFunds,
          costActions,
          costText: `${money(costFunds, symbol)} and ${costActions} action${costActions === 1 ? "" : "s"}`,
          newBoostPct: campaignStrengthBoostPercent(currentStrength + strengthAdded).toFixed(1),
          canContribute:
            !campaign.electionInfo?.isEnded &&
            !campaign.isArchived &&
            strengthAdded > 0 &&
            me.actions != null &&
            me.actions >= costActions &&
            me.funds != null &&
            me.funds >= costFunds,
        }
      : null;

  // ── Standfirst ────────────────────────────────────────────────────────────
  const managerPart = campaign.managers.length
    ? `Managed by ${campaign.managers[0].name}`
    : "No manager appointed";
  const matePart = runningMateName ? ` · running mate ${runningMateName}` : "";

  return {
    railItems,
    paneTitle: PANE_TITLES[rail],
    standfirst: `${managerPart}${matePart}`,
    turnReadout: buildTurnReadout(campaign, currentTurn),
    railTitle: campaign.candidateName,
    railSubtitle: buildRailSubtitle(campaign),
    fogFootnote: buildFogFootnote(campaign),
    wire,
    vitals,
    ops,
    money: money_,
    ledger: {
      rows: ledgerRows,
      rangeText: history.length
        ? `${start + 1}-${start + pageRows.length} of ${history.length}`
        : "0 of 0",
      pageText: `Page ${page + 1} of ${pageCount}`,
      hasPager: history.length > LEDGER_PAGE_SIZE,
      canPrev: page > 0,
      canNext: page < pageCount - 1,
      page,
      pageCount,
    },
    support,
    strength,
    managers: {
      countText: `${campaign.managers.length} / ${MAX_MANAGERS}`,
      list: campaign.managers,
      atCap: campaign.managers.length >= MAX_MANAGERS,
      canAppoint: campaign.canAppointManagers && campaign.managers.length < MAX_MANAGERS,
    },
    ticket: { runningMateName },
  };
}
