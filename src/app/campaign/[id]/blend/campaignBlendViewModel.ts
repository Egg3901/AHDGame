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
  /**
   * The viewer's own country, used to close contributions the server would
   * refuse across a border. Null when it is not known (signed out, or the
   * `/api/auth/me` fetch degraded), in which case nothing is blocked on it.
   */
  countryId: string | null;
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
  /** Which ledger tab is open. Defaults to the activity log. */
  ledgerTab?: LedgerTab;
  /** Page within the endorsements tab, tracked separately from `ledgerPage`. */
  endorsementPage?: number;
  endorsementFilter?: EndorsementFilter;
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
  /**
   * The candidates this campaign may research, scoped server-side to the race
   * and its phase. Empty when the viewer cannot retarget, or when nobody is
   * standing against them.
   */
  targetOptions: { id: string; name: string; party: string | null }[];
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

export type LedgerTab = "activity" | "endorsements";
export type EndorsementFilter = "all" | "player" | "npp";

export interface EndorsementRowVM {
  kind: "player" | "npp";
  /**
   * What the reader calls this endorser. "NPP" is an internal word for a
   * non-player politician and never reaches the panel.
   */
  kindLabel: string;
  name: string;
  /**
   * No "when" column. Endorsement records store only a real-world `createdAt`
   * and no turn number, and the game runs on its era preset's own calendar, so
   * any date shown here would stamp the wrong year on the fiction. The
   * timestamp still orders the list; it just never reaches the reader.
   */
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

/**
 * Campaign strength for display: two decimals, grouped.
 *
 * Two rather than none because a contribution can be worth a fraction of a
 * point, so rounding to whole numbers would show a purchase moving nothing.
 */
function formatStrength(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface StrengthVM {
  /**
   * The current strength, already formatted.
   *
   * Campaign strength is the product of a contribution curve and accumulates
   * an irrational tail, so the stored value is a full double —
   * `5920.075743469171`. Printed raw it read as false precision on a figure
   * nobody can act on past the decimal, and it overflowed the panel it sits
   * in. Every other figure in this view model arrives at the sidebar as a
   * finished string; this one now does too.
   */
  strength: string;
  boostPct: string;
  /** Kept numeric: `canContribute` tests it, and the copy formats it itself. */
  strengthAdded: number;
  costFunds: number;
  costActions: number;
  costText: string;
  newBoostPct: string;
  canContribute: boolean;
  /**
   * Why this viewer cannot contribute, or null when they can.
   *
   * Contribution is NOT a campaign-staff lever. `contributeCampaignStrength`
   * accepts a contribution from any authenticated character in the race's
   * country, which is how allied and rival players fund a nominee, so the
   * control is gated on the race and the viewer's own resources rather than on
   * their access to this campaign. Anything an affordability check already
   * covers stays in `canContribute` and leaves this null.
   */
  blockedReason: string | null;
}

/**
 * Why this viewer may not contribute campaign strength, or null when they may.
 *
 * Only the presidential engine reads `campaignStrength`; the down-ballot
 * engines ignore it and the server rejects those contributions outright, so
 * the desk says so rather than quoting a price for nothing. A campaign whose
 * election row did not resolve falls in here too: the server cannot check the
 * race, so it refuses, and the desk must not promise otherwise.
 *
 * Suspension and the cross-border rule used to be carried for free by the
 * `canAct` gate this control no longer sits behind: `canManage` and
 * `canSurrogate` both require `!campaignSuspended`, and both are only ever
 * true for someone in the race's own country. Opening the control to every
 * player means stating those two rules here instead of inheriting them.
 *
 * Affordability is NOT decided here. It stays in `canContribute`, which
 * disables the button while leaving the price on screen, so a player who is
 * merely short of funds still sees what they are short of.
 */
function campaignStrengthBlockedReason(
  campaign: CampaignData,
  me: ViewerResources,
  /** What one contribution would add, already derived from the viewer's influence. */
  strengthAdded: number
): string | null {
  if (campaign.electionInfo?.electionType !== "president") {
    return "Campaign strength only affects presidential races right now, so contributions to this race are closed.";
  }
  if (campaign.electionInfo.isEnded) {
    return "This race has ended, so contributions are closed.";
  }
  if (campaign.isArchived) {
    return "This campaign is no longer running, so contributions are closed.";
  }
  if (campaign.campaignSuspended) {
    return "This candidate has suspended their campaign, so contributions are closed.";
  }
  if (me.nationalInfluence == null) {
    return "Sign in to contribute campaign strength.";
  }
  // Compared on `countryId`, never on currency: SUR is shared by RU / BLR /
  // UKR / BAL and GBP by UK / SCO / WAL, so equal currencies do not mean
  // `assertSameCountry` will pass. An unknown country on either side blocks
  // nothing and falls through to the server's own check, because failing
  // closed would lock out legitimate players whenever the `/api/auth/me`
  // fetch degrades, which the page is written to tolerate.
  if (me.countryId != null && campaign.countryId != null && me.countryId !== campaign.countryId) {
    return "You can only contribute to campaigns in your own country.";
  }
  if (strengthAdded <= 0) {
    return "You need national influence to contribute campaign strength.";
  }
  return null;
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
    tab: LedgerTab;
    /** Activity rows. Empty while the endorsements tab is open. */
    rows: LedgerRowVM[];
    /** Endorser rows. Empty while the activity tab is open. */
    endorsementRows: EndorsementRowVM[];
    filter: EndorsementFilter;
    /** Unfiltered totals, so the chips say what sits behind each filter. */
    filterCounts: { all: number; player: number; npp: number };
    /**
     * Whether to offer the source filter at all. False for a fogged viewer,
     * whose counts are zero only because the payload was redacted.
     */
    showFilters: boolean;
    emptyText: string;
    /** Pager state belongs to whichever tab is open. */
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
  // Not "The ledger": BlendLedger heads itself with exactly that, and the pane
  // header sits directly above it. Naming the two tabs distinguishes them.
  log: "Activity & endorsements",
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
  /**
   * Newest first. The array is stored oldest-first because every writer
   * `$push`es onto the end, so it has to be reversed for display: a ledger that
   * opens on a campaign's first purchase and buries last turn's on the final
   * page reads backwards. While only the last ten entries were kept this was
   * invisible, since the one page held the newest ten either way.
   */
  const history = [...(campaign.activityHistory ?? [])].reverse();
  const totalInvested = CATEGORY_ORDER.reduce((sum, c) => sum + investedIn(campaign, c), 0);

  // ── Rail ──────────────────────────────────────────────────────────────────
  const railItems: CampaignBlendVM["railItems"] = [
    { id: "overview", label: "Overview" },
    { id: "ops", label: "Operations", badge: `${totalInvested}/${OPS_TOTAL_CAP}` },
    { id: "money", label: "Money" },
    {
      id: "log",
      label: "Ledger",
      // No badge for a fogged viewer: their history arrives empty because the
      // payload was redacted, so a count would report an absence rather than
      // measure one. The panel is two tabs now, so the rail names the panel.
      ...(campaign.accessLevel === "owner"
        ? { badge: String(history.length + (campaign.endorsements?.length ?? 0)) }
        : {}),
    },
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
      value: formatStrength(campaign.campaignStrength),
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
      targetOptions: t.requiresTarget ? (c.oppositionTargets ?? []) : [],
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
  // Two tabs share one pager. The open tab decides which list is paged, so the
  // pager reports that list's length rather than the other one's.
  const ledgerTab: LedgerTab = inp.ledgerTab ?? "activity";
  const endorsementFilter: EndorsementFilter = inp.endorsementFilter ?? "all";
  const allEndorsements = campaign.endorsements ?? [];
  const filteredEndorsements =
    endorsementFilter === "all"
      ? allEndorsements
      : allEndorsements.filter((e) => e.kind === endorsementFilter);

  const pagedLength = ledgerTab === "endorsements" ? filteredEndorsements.length : history.length;
  const requestedPage = ledgerTab === "endorsements" ? (inp.endorsementPage ?? 0) : inp.ledgerPage;
  const pageCount = Math.max(1, Math.ceil(pagedLength / LEDGER_PAGE_SIZE));
  // Clamp rather than trust the caller: narrowing the filter can strand the
  // viewer on a page the shorter list no longer has.
  const page = Math.min(Math.max(0, requestedPage), pageCount - 1);
  const start = page * LEDGER_PAGE_SIZE;

  const endorsementRows: EndorsementRowVM[] =
    ledgerTab === "endorsements"
      ? filteredEndorsements.slice(start, start + LEDGER_PAGE_SIZE).map((e) => ({
          kind: e.kind,
          kindLabel: e.kind === "npp" ? "Politician" : "Player",
          name: e.name,
        }))
      : [];

  const pageRows = ledgerTab === "activity" ? history.slice(start, start + LEDGER_PAGE_SIZE) : [];

  const ledgerRows: LedgerRowVM[] = pageRows.map((a) => {
    // Suspending and endorsing buys no lever, so it carries no category, level
    // or cost. Through the purchase builder below it reads as a level 0 buy at
    // no price, which is not what happened.
    if (a.type === "suspend_endorse") {
      return {
        turnTag: `T${a.turnNumber}`,
        label: `Suspended and endorsed ${a.targetName ?? "another candidate"}`,
        cost: "",
        demoted: false,
        reason: null,
      };
    }
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

  const strengthBlockedReason = campaignStrengthBlockedReason(campaign, me, strengthAdded);

  const strength: StrengthVM | null =
    campaign.campaignStrength != null
      ? {
          strength: formatStrength(currentStrength),
          boostPct: campaignStrengthBoostPercent(currentStrength).toFixed(1),
          strengthAdded,
          costFunds,
          costActions,
          costText: `${money(costFunds, symbol)} and ${costActions} action${costActions === 1 ? "" : "s"}`,
          newBoostPct: campaignStrengthBoostPercent(currentStrength + strengthAdded).toFixed(1),
          blockedReason: strengthBlockedReason,
          canContribute:
            strengthBlockedReason === null &&
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
      tab: ledgerTab,
      rows: ledgerRows,
      endorsementRows,
      filter: endorsementFilter,
      filterCounts: {
        all: allEndorsements.length,
        player: allEndorsements.filter((e) => e.kind === "player").length,
        npp: allEndorsements.filter((e) => e.kind === "npp").length,
      },
      showFilters: campaign.accessLevel === "owner",
      // A fogged viewer's payload is redacted before either list is read, so
      // both arrive empty whatever the campaign has actually done. Telling them
      // nobody has endorsed it, or that nothing was bought, reports absence for
      // something they were simply not shown.
      emptyText:
        campaign.accessLevel !== "owner"
          ? "These records are visible only to the campaign's own side."
          : ledgerTab === "endorsements"
            ? endorsementFilter === "all"
              ? "No players or politicians have endorsed this campaign yet."
              : "No endorsements from this source yet."
            : "Nothing has been bought yet.",
      rangeText: pagedLength
        ? `${start + 1}-${start + (ledgerTab === "endorsements" ? endorsementRows.length : pageRows.length)} of ${pagedLength}`
        : "0 of 0",
      pageText: `Page ${page + 1} of ${pageCount}`,
      hasPager: pagedLength > LEDGER_PAGE_SIZE,
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
