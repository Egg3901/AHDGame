import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  GovernmentApproval,
  NationalizationLedgerEntry,
  PoliticalParty,
} from "@/lib/db/types";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";
import { writeGovBudgetLocal } from "@/lib/currency/govBudgetFields";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import type { NationalizationTrigger } from "./consequences/types";
import { TIER_LABEL, PATH_LABEL, TRIGGER_LABEL, isPrivatizationKind } from "./labels";
import {
  classifyTakingPopularity,
  computeIdeologyMultiplier,
  computePrivatizationApprovalNudge,
} from "./consequences/compute";
import {
  CONFIDENCE_TIER_WEIGHT,
  APPROVAL_PUBLIC_TRUST_BOOST,
  APPROVAL_PUBLIC_TRUST_HIT,
  EXPROPRIATION_RISK_MARGIN_MAX,
  SOVEREIGN_CONFIDENCE_PREMIUM_MAX,
  FOUNDING_CONFIDENCE_PENALTY_MAX,
  type CompensationTier,
} from "./constants";

/** A NPC/unowned taking — no investor it expropriated, so no approval/political movement. */
function isNpcOrUnowned(triggers: string[]): boolean {
  return triggers.some((t) => t === "npc" || t === "unowned");
}

/** One display-ready row of the State Ownership Register (a taking or a privatization). */
export interface RegisterRow {
  id: string;
  firm: string;
  sectorLabel: string;
  turn: number;
  kind: NationalizationLedgerEntry["kind"];
  isPrivatization: boolean;
  /** Foreign owner's home country (display), if the seized corp was foreign-owned. */
  foreignOwnerCountryId: string | null;
  triggerShort: string;
  triggerDetail: string;
  tierLabel: string | null;
  tierKey: CompensationTier | null;
  pathLabel: string | null;
  /** Local currency; null when nothing was paid (seizure) so the UI shows "—". */
  compensationLocal: number | null;
  /** Local currency; null when not recorded (pre-persistence rows, privatizations). */
  debtLocal: number | null;
  shareholdersSettled: number | null;
  /** Political impact (display estimate for approval; stored for legitimacy/confidence). */
  approvalDelta: number | null;
  legitimacyDelta: number | null;
  confidenceDelta: number | null;
  /** Unrest is not modelled yet — surfaced as N/A in the UI. */
  unrestDelta: null;
}

export interface RegisterTotals {
  firmsAbsorbed: number;
  compensationLocal: number;
  debtLocal: number;
  shareholdersSettled: number;
}

interface SummarizeOpts {
  currency: CurrencyCode;
  fxRate: number;
  ideologyMultiplier: number;
}

/** Approval nudge a taking/privatization produced — mirrors the consequences engine. */
function estimateApprovalDelta(
  entry: NationalizationLedgerEntry,
  ideologyMultiplier: number
): number {
  const triggers = entry.triggers ?? [];
  if (isPrivatizationKind(entry.kind)) {
    // Market govts gain approval selling; statist govts pay a cost (engine formula).
    return computePrivatizationApprovalNudge(ideologyMultiplier);
  }
  if (isNpcOrUnowned(triggers)) return 0; // no private investor expropriated
  const scale = CONFIDENCE_TIER_WEIGHT[entry.tier ?? "fair"];
  return classifyTakingPopularity(triggers as NationalizationTrigger[]) === "popular"
    ? APPROVAL_PUBLIC_TRUST_BOOST * scale
    : -APPROVAL_PUBLIC_TRUST_HIT * scale * ideologyMultiplier;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Build the display rows + stat-strip totals from the country's ledger (pure). */
export function summarizeRegister(
  entries: NationalizationLedgerEntry[],
  opts: SummarizeOpts
): { rows: RegisterRow[]; totals: RegisterTotals } {
  const rows: RegisterRow[] = entries.map((e) => {
    const priv = isPrivatizationKind(e.kind);
    const triggers = e.triggers ?? [];
    const triggerLabelList = triggers.map((t) => TRIGGER_LABEL[t] ?? t);
    const comp = writeGovBudgetLocal(e.compensationAnchor ?? 0, opts.currency, opts.fxRate);
    const confidenceDelta =
      typeof e.confidenceAfter === "number" && typeof e.confidenceBefore === "number"
        ? round1(e.confidenceAfter - e.confidenceBefore)
        : null;
    return {
      id: String(e._id),
      firm: priv ? (e.newCorpName ?? "Spin-out") : (e.formerCorpName ?? "Asset"),
      sectorLabel:
        e.sectorTypes?.map((s) => CORPORATION_TYPE_LABELS[s as CorporationType] ?? s).join(", ") ||
        "—",
      turn: e.turn,
      kind: e.kind,
      isPrivatization: priv,
      foreignOwnerCountryId: e.foreignOwnerCountryId ?? null,
      triggerShort: triggerLabelList[0] ?? (priv ? "Divestiture" : "—"),
      triggerDetail: triggerLabelList.join(", ") || "—",
      tierLabel: e.tier ? TIER_LABEL[e.tier] : null,
      tierKey: e.tier ?? null,
      pathLabel: e.method ? PATH_LABEL[e.method] : null,
      compensationLocal: comp > 0 ? Math.round(comp) : null,
      debtLocal:
        typeof e.debtAnchor === "number"
          ? Math.round(writeGovBudgetLocal(e.debtAnchor, opts.currency, opts.fxRate))
          : null,
      shareholdersSettled: typeof e.shareholdersSettled === "number" ? e.shareholdersSettled : null,
      approvalDelta: round1(estimateApprovalDelta(e, opts.ideologyMultiplier)),
      legitimacyDelta: typeof e.legitimacyDelta === "number" ? round1(e.legitimacyDelta) : null,
      confidenceDelta,
      unrestDelta: null,
    };
  });

  const totals: RegisterTotals = {
    firmsAbsorbed: entries.filter((e) => e.kind === "nationalize_whole").length,
    compensationLocal: rows.reduce((s, r) => s + (r.compensationLocal ?? 0), 0),
    debtLocal: rows.reduce((s, r) => s + (r.debtLocal ?? 0), 0),
    shareholdersSettled: rows.reduce((s, r) => s + (r.shareholdersSettled ?? 0), 0),
  };
  return { rows, totals };
}

/** The three live systems the confidence index feeds (display tiles). Pure. */
export interface ConfidenceFeed {
  label: string;
  value: string;
  desc: string;
}
export function confidenceFeeds(confidence: number, baseline: number): ConfidenceFeed[] {
  const below = baseline > 0 ? Math.max(0, baseline - Math.max(0, confidence)) : 0;
  const frac = baseline > 0 ? below / baseline : 0;
  const margin = EXPROPRIATION_RISK_MARGIN_MAX * frac; // ≤ 0 (pp)
  const sovBps = Math.round(SOVEREIGN_CONFIDENCE_PREMIUM_MAX * frac * 10000);
  const founding = Math.round(FOUNDING_CONFIDENCE_PENALTY_MAX * frac * 100);
  return [
    {
      label: "Private-corp margins",
      value: `${round1(margin)}%`,
      desc: "expropriation-risk drag on private firms (SOEs exempt)",
    },
    {
      label: "Sovereign borrowing",
      value: `+${sovBps} bps`,
      desc: "risk premium added to the state's own bond rate",
    },
    {
      label: "New-corp founding",
      value: `-${founding}%`,
      desc: "dampened private founding & growth rate",
    },
  ];
}

/** Governing-bloc political standing for the political-ledger header. */
export interface RegisterStanding {
  ideologyStance: "Statist" | "Market" | "Centrist" | "Unknown";
  ideologyNote: string;
  nationalizeCapital: string;
  privatizeCapital: string;
  approval: number | null;
  legitimacy: number | null;
  unrest: null;
  /** Cost scalar fed to per-taking approval estimates (<1 statist, >1 market). */
  ideologyMultiplier: number;
}

const STANCE_NOTE: Record<RegisterStanding["ideologyStance"], string> = {
  Statist:
    "The governing bloc favors public ownership. Nationalization costs little political capital; privatization is what draws a fight.",
  Market:
    "The governing bloc favors private enterprise. Nationalization is politically costly; privatization is the easier sell.",
  Centrist:
    "The governing bloc is balanced on public versus private ownership — neither direction is a free move.",
  Unknown: "No governing bloc resolved — political costs default to neutral.",
};

function capitalLabel(cost: number): string {
  return cost < 0.9 ? "Low" : cost > 1.1 ? "High" : "Moderate";
}

/** Read the governing bloc + approval/legitimacy for the political-ledger header. */
export async function loadRegisterStanding(
  db: Db,
  countryId: CountryId
): Promise<RegisterStanding> {
  const leader = await db
    .collection<CountryLeaderState>("countryLeaderStates")
    .findOne({ countryId }, { sort: { updatedAt: -1 } });
  const legitimacy =
    typeof leader?.popularLegitimacy === "number" ? Math.round(leader.popularLegitimacy) : null;

  let economicPosition: number | null = null;
  const seq = Number(leader?.governingPartyId);
  if (Number.isFinite(seq)) {
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId, sequentialId: seq }, { projection: { economicPosition: 1 } });
    if (party && typeof party.economicPosition === "number")
      economicPosition = party.economicPosition;
  }

  const approvalDoc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ countryId }, { sort: { updatedAt: -1 } });
  const approval =
    typeof approvalDoc?.approvalRating === "number" ? Math.round(approvalDoc.approvalRating) : null;

  const stance: RegisterStanding["ideologyStance"] =
    economicPosition == null
      ? "Unknown"
      : economicPosition < -0.5
        ? "Statist"
        : economicPosition > 0.5
          ? "Market"
          : "Centrist";
  // Ideology multiplier scales the cost of a taking: <1 cheap (statist), >1 dear (market).
  const natCost = computeIdeologyMultiplier(economicPosition != null ? economicPosition / 5 : null);

  return {
    ideologyStance: stance,
    ideologyNote: STANCE_NOTE[stance],
    nationalizeCapital: capitalLabel(natCost),
    privatizeCapital: capitalLabel(2 - natCost), // mirror — selling is the inverse fight
    approval,
    legitimacy,
    unrest: null,
    ideologyMultiplier: natCost,
  };
}
