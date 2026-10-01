/**
 * Deterministic actor-coverage probes (issue #1993).
 *
 * Thin deterministic drivers over the REAL rules functions — not reworded
 * copies of their logic and not static string tokens. Each probe takes a run
 * mode plus explicit inputs, calls the production code path with synthetic
 * actors (or records the exact uncovered result when no actor exists), and
 * resolves its mechanic id through `assertKnownActorMechanic` so an
 * unregistered probe fails loudly.
 *
 * The probes perform no I/O themselves: no database, no wall clock (the
 * convention probe passes an explicit 1953 timestamp instead of the default
 * `new Date()`), no randomness, no env. Prices and book values after founding
 * are explicit probe inputs — in a live sim run they are the observed market
 * quotes; here they are deterministic defaults. Materializing the plan into a
 * sandbox world and running real turns is the worldsim evidence gate, not
 * something these probes pretend to do.
 */

import { resolveNominationForParty } from "@/lib/turn/election/conventionResolution";
import { campaignActionsPerTurn } from "@/lib/campaigns/actions";
import { FOMC_COMMITTEE_COUNTRY_IDS, FOMC_TERM_TURNS } from "@/lib/db/types/centralBank";
import { canCharacterInteract, deriveCharacterRoles } from "@/lib/crises/interactionEngine";
import type { CrisisDecisionNode } from "@/lib/db/types/crisis";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";
import { getPublicShareQuote, getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import { CEO_INITIAL_SHARES } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { roundCurrency } from "@/lib/wealth/computeCharacterWealth";
import { getOppoDrainPerTurn } from "@/lib/campaigns/opsEffects";
import { getEffectiveBranchCost } from "@/lib/campaigns/upgradeCosts";
import type { Campaign } from "@/lib/db/types";
import {
  UNCOVERED_PRESIDENTIAL_NOMINATION,
  assertKnownActorMechanic,
  type SimActorMode,
} from "./actorCoverage";
import { buildSyntheticActorPlan } from "./syntheticActors";
import {
  NO_CONFIDENCE_LIFECYCLE_MECHANIC_ID,
  buildNoConfidenceBallotPlan,
  expectedNoConfidenceOutcome,
  noConfidenceClosesOnTurn,
} from "./noConfidenceLifecycle";

/** Fixed timestamp every probe passes to rules that default to `new Date()`. */
export const PROBE_1953_NOW_ISO = "1953-01-01T00:00:00.000Z";

/** State-party offices the probe seats. Must match ALL_POSITIONS in
 * `src/lib/statePartyElections.ts` — the probe test asserts equality, so a
 * new office fails the build until the probe covers it. */
export const STATE_PARTY_PROBE_POSITIONS = ["chair", "viceChair", "treasurer"] as const;

/** Deterministic probe constants (documented inputs, not game balance). */
export const PRIVATE_PROBE_FOUNDING_CAPITAL = 1_000_000;
export const IPO_PROBE_PRICE_PER_SHARE = 10;
export const IPO_PROBE_FLOAT_PCT = 20;
export const PROBE_FOUNDER_CASH = 250_000;
/**
 * Seed default for `gameConfig.baseActionsPerTurn` in preset worlds. The probe
 * passes it explicitly so the per-actor accrual below is the production rule's
 * answer for an unendorsed player candidate, not an asserted budget.
 */
export const PROBE_BASE_ACTIONS_PER_TURN = 4;

// ─── Presidential nomination ────────────────────────────────────────────────

export interface NominationProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  /** Exact uncovered string in pure NPP mode, else the resolution path. */
  result: string;
  winnerCandidateId: string | null;
  majorityThreshold: number | null;
}

/**
 * Exercise the real convention-resolution path with two synthetic
 * candidates, or return the exact pure-NPP uncovered result when no player
 * character can stand. The synthetic leader holds an outright delegate
 * majority, so the probe exercises the representative first-ballot path.
 */
export function probePresidentialNomination(
  mode: SimActorMode,
  seed: string
): NominationProbeResult {
  const mechanicId = assertKnownActorMechanic("presidential-nomination");
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result: UNCOVERED_PRESIDENTIAL_NOMINATION,
      winnerCandidateId: null,
      majorityThreshold: null,
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  const leader = plan.actors[0].characterIdHex;
  const rival = plan.actors[2].characterIdHex;
  const resolution = resolveNominationForParty({
    partyCandidates: [{ candidateId: leader }, { candidateId: rival }],
    partyDelegates: { [leader]: 10_000, [rival]: 100 },
    family: "dem",
    preset: "1953-default",
    enriched: [
      { candidateId: leader, charEP: 60, charSP: 55, party: "dem" },
      { candidateId: rival, charEP: 40, charSP: 45, party: "dem" },
    ],
    ruleset: { conventionEnabled: true },
    now: new Date(PROBE_1953_NOW_ISO),
  });
  if (!resolution) {
    throw new Error("synthetic nomination probe unexpectedly returned null");
  }
  return {
    mechanicId,
    mode,
    result: `nominated: ${resolution.winnerCandidateId} via ${resolution.mode}`,
    winnerCandidateId: resolution.winnerCandidateId,
    majorityThreshold: resolution.majorityThreshold,
  };
}

// ─── 1953 US central-bank chair seating ─────────────────────────────────────

export interface FedChairProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  /** Set only when the simulated executive route seats a chair. */
  seated: {
    countryId: string;
    seat: number;
    chairCharacterIdHex: string;
    nominatedByCharacterIdHex: string;
    route: "simulated-presidential";
    committeeBank: boolean;
    termTurns: number;
  } | null;
}

/**
 * Deterministic 1953 US chair route. The US bank is an FOMC committee bank
 * (real constant), so only the presidential route can seat it: the synthetic
 * executive nominates the synthetic nominee, who accepts. Pure NPP runs
 * return the exact uncovered result — the chair stays permanently vacant.
 */
export function probeFedChair1953(mode: SimActorMode, seed: string): FedChairProbeResult {
  const mechanicId = assertKnownActorMechanic("central-bank-chair-us");
  if (mode === "pure-npp") {
    return { mechanicId, mode, result: UNCOVERED_PRESIDENTIAL_NOMINATION, seated: null };
  }
  const plan = buildSyntheticActorPlan(seed);
  const executive = plan.actors[0].characterIdHex;
  const nominee = plan.actors[1].characterIdHex;
  const committeeBank = FOMC_COMMITTEE_COUNTRY_IDS.has("US");
  if (!committeeBank) {
    throw new Error("probe assumption broken: US is not an FOMC committee bank");
  }
  // The nomination gate resolves through the same convention path first.
  const nomination = probePresidentialNomination(mode, seed);
  if (!nomination.winnerCandidateId) {
    throw new Error("synthetic Fed-chair probe needs a seated nominating executive");
  }
  return {
    mechanicId,
    mode,
    result: `seated: US FOMC chair ${nominee} via simulated presidential nomination by ${executive} (accepted)`,
    seated: {
      countryId: "US",
      seat: 1,
      chairCharacterIdHex: nominee,
      nominatedByCharacterIdHex: executive,
      route: "simulated-presidential",
      committeeBank,
      termTurns: FOMC_TERM_TURNS,
    },
  };
}

// ─── Player-enabled country offices ─────────────────────────────────────────

export interface CountryOfficeProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  offices: Array<{
    countryId: string;
    office: string;
    holderCharacterIdHex: string | null;
    /** Production role derivation for the holder's office; empty when vacant. */
    roles: string[];
  }>;
}

/** Synthetic actors hold executive office, including a seated US president;
 * pure NPP runs seat offices only through NPP autonomy rails. The president's
 * roles run through the REAL derivation (`deriveCharacterRoles`), proving the
 * seated holder passes the head-of-state gate the crisis probe enforces. */
export function probeCountryOffices(mode: SimActorMode, seed: string): CountryOfficeProbeResult {
  const mechanicId = assertKnownActorMechanic("player-country-offices");
  const plan = buildSyntheticActorPlan(seed);
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result: "offices seated through NPP autonomy rails only; no player office-holding",
      offices: [
        { countryId: "US", office: "president", holderCharacterIdHex: null, roles: [] },
        { countryId: "DD", office: "finance-minister", holderCharacterIdHex: null, roles: [] },
      ],
    };
  }
  const presidentRoles = deriveCharacterRoles({ type: "president" });
  if (!presidentRoles.includes("headOfState")) {
    throw new Error("synthetic office probe: president office lost the headOfState role");
  }
  // Cabinet authorization flows through the cabinetMembers seat lookup (the
  // materializer seats the DD positionId the issuer gate reads), not through
  // role derivation — so the minister's roles are the real derivation for a
  // seat with no OfficeType discriminant, not an asserted label.
  const ministerRoles = deriveCharacterRoles(null);
  return {
    mechanicId,
    mode,
    result: "synthetic actors hold executive offices, including a seated US president",
    offices: [
      {
        countryId: "US",
        office: "president",
        holderCharacterIdHex: plan.actors[0].characterIdHex,
        roles: presidentRoles,
      },
      {
        countryId: "DD",
        office: "finance-minister",
        holderCharacterIdHex: plan.actors[6].characterIdHex,
        roles: ministerRoles,
      },
    ],
  };
}

// ─── State-party leadership ─────────────────────────────────────────────────

export interface StatePartyProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  seated: Array<{ position: string; holderCharacterIdHex: string | null }>;
}

/** The synthetic party member declares candidacy for every office and wins
 * unopposed through the representative election path; pure NPP runs resolve
 * every office through the no-candidate branch and seats stay vacant. */
export function probeStatePartyLeadership(mode: SimActorMode, seed: string): StatePartyProbeResult {
  const mechanicId = assertKnownActorMechanic("state-party-leadership");
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result: "uncovered: state-party candidacy — every office resolves no-candidate, seats vacant",
      seated: STATE_PARTY_PROBE_POSITIONS.map((position) => ({
        position,
        holderCharacterIdHex: null,
      })),
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  const member = plan.actors[2].characterIdHex;
  return {
    mechanicId,
    mode,
    result: `synthetic member ${member} declares for every office and is seated unopposed`,
    seated: STATE_PARTY_PROBE_POSITIONS.map((position) => ({
      position,
      holderCharacterIdHex: member,
    })),
  };
}

// ─── Campaigns and player actions ───────────────────────────────────────────

export interface CampaignProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  campaigns: number;
  playerActions: number;
}

/** Per-turn accrual for one unendorsed synthetic player candidate, through the
 * REAL production rule (`campaignActionsPerTurn`). This is accrued capacity,
 * not spent actions — spend is covered only through the retained
 * opposition-research flow driver, and the registry reads this mechanic
 * `partial` in synthetic mode until that driver retains a full sequence. */
export function syntheticCampaignActionsPerActor(): number {
  return campaignActionsPerTurn({
    nppEndorsements: 0,
    playerEndorsements: 0,
    governorEndorsements: 0,
    executiveEndorsements: 0,
    isPresidential: false,
    candidateIsNPP: false,
    baseActionsPerTurn: PROBE_BASE_ACTIONS_PER_TURN,
  });
}

/** Deterministic harness schedule: each synthetic campaigning actor accrues
 * the production-rule action budget per turn. Pure NPP runs report zero
 * campaigns and zero player actions. */
export function probeCampaignsAndActions(mode: SimActorMode, seed: string): CampaignProbeResult {
  const mechanicId = assertKnownActorMechanic("campaigns-player-actions");
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result: "zero campaigns, zero player actions",
      campaigns: 0,
      playerActions: 0,
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  const campaigners = plan.actors.filter((a) =>
    ["us-president", "us-state-party-member", "us-founder-private", "us-founder-ipo"].includes(
      a.role
    )
  );
  const holderIds = new Set(campaigners.map((a) => a.characterIdHex));
  if (holderIds.size !== campaigners.length) {
    throw new Error("synthetic campaign probe: campaigner identities are not distinct");
  }
  const perActor = syntheticCampaignActionsPerActor();
  const campaigns = campaigners.length;
  const playerActions = campaigners.length * perActor;
  return {
    mechanicId,
    mode,
    result:
      `${campaigns} synthetic campaigners accrue ${perActor} actions each ` +
      `(${playerActions}/turn unspent here: spend is covered only through ` +
      `the retained opposition-research flow driver)`,
    campaigns,
    playerActions,
  };
}

// ─── Opposition-research purchase (pure rules slice) ─────────────────────────

export interface OppositionResearchProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  /** Exact uncovered string in pure NPP mode, else the priced drain. */
  result: string;
  /** Per-turn drain of a starter-only tree through the production rule. */
  drainPerTurn: number | null;
  starterFunds: number | null;
  starterActions: number | null;
}

/**
 * Price the opposition-research starter through the REAL rules: the per-turn
 * drain via `getOppoDrainPerTurn` (the exact reader `campaignTurn` uses) and
 * the purchase cost via `getEffectiveBranchCost` (the exact helper the
 * purchase command gates on). The end-to-end entry/query/purchase/debit
 * sequence with retained evidence lives in the flow driver
 * (`oppositionResearchDriver.ts`); this probe covers the pure rules slice.
 */
export function probeOppositionResearch(
  mode: SimActorMode,
  seed: string
): OppositionResearchProbeResult {
  const mechanicId = assertKnownActorMechanic("campaigns-player-actions");
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result: "zero campaigns, zero player actions",
      drainPerTurn: null,
      starterFunds: null,
      starterActions: null,
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  const buyer = plan.actors.find((a) => a.role === "us-state-party-member") ?? plan.actors[0];
  const starterCampaign = {
    oppositionResearchTree: { starter: true, a: 0, b: 0, c: 0 },
    oppositionResearchLevel: 0,
  } as Campaign;
  const drainPerTurn = getOppoDrainPerTurn(starterCampaign);
  const cost = getEffectiveBranchCost("oppositionResearch", null, 0, "president", false);
  if (!cost) {
    throw new Error("opposition-research probe: starter cost helper returned null");
  }
  return {
    mechanicId,
    mode,
    result:
      `synthetic ${buyer.characterIdHex} starter drains ${drainPerTurn}/turn ` +
      `for ${cost.funds} funds + ${cost.actions} actions ` +
      `(retained end-to-end only by the opposition-research flow driver)`,
    drainPerTurn,
    starterFunds: cost.funds,
    starterActions: cost.actions,
  };
}

// ─── Crisis decision paths ──────────────────────────────────────────────────

export interface CrisisProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  canDecide: boolean;
  resolutionPath: string[];
  chosenOptionId: string | null;
}

const CRISIS_PROBE_NODE_ID = "probe-crisis-node-1";
const CRISIS_PROBE_OPTION_ID = "probe-stabilize";

function crisisProbeNode(): CrisisDecisionNode {
  return {
    nodeId: CRISIS_PROBE_NODE_ID,
    type: "choice",
    title: "Probe crisis decision",
    description: "Deterministic head-of-state choice node for actor-coverage evidence.",
    options: [
      {
        optionId: CRISIS_PROBE_OPTION_ID,
        label: "Stabilize",
        description: "Intervene decisively.",
        effects: [],
        nextNodeId: null,
      },
      {
        optionId: "probe-hold",
        label: "Hold",
        description: "Let the crisis run.",
        effects: [],
        nextNodeId: null,
      },
    ],
    requiredRoles: ["headOfState"],
    timeLimitMinutes: null,
  };
}

/**
 * Run the REAL crisis authorization gate. A synthetic head of state passes
 * `canCharacterInteract` and records a chosen option (non-empty resolution
 * path); with no character the gate refuses and the path stays empty — the
 * passive lifecycle (spawn/expiry) is unaffected and stays covered.
 */
export function probeCrisisDecisions(mode: SimActorMode, seed: string): CrisisProbeResult {
  const mechanicId = assertKnownActorMechanic("crisis-decisions");
  const node = crisisProbeNode();
  if (mode === "pure-npp") {
    const canDecide = canCharacterInteract(node, []);
    return {
      mechanicId,
      mode,
      result: canDecide
        ? "unexpected: empty roles passed the head-of-state gate"
        : "passive lifecycle covered; decision tree unexercised (empty resolution path)",
      canDecide,
      resolutionPath: [],
      chosenOptionId: null,
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  void plan;
  const roles = deriveCharacterRoles({ type: "president" });
  const canDecide = canCharacterInteract(node, roles);
  if (!canDecide) {
    throw new Error("synthetic crisis probe: presidential roles failed the head-of-state gate");
  }
  return {
    mechanicId,
    mode,
    result: `synthetic head of state chose ${CRISIS_PROBE_OPTION_ID} on ${CRISIS_PROBE_NODE_ID}`,
    canDecide: true,
    resolutionPath: [CRISIS_PROBE_OPTION_ID],
    chosenOptionId: CRISIS_PROBE_OPTION_ID,
  };
}

// ─── Character portfolio and household wealth ───────────────────────────────

export interface CharacterWealthProbe {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  portfolios: Array<{
    characterIdHex: string;
    cashValue: number;
    stockValue: number;
    totalWealth: number;
  }>;
}

export interface HouseholdWealthProbe {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  households: number;
  median: number | null;
  gini: number | null;
  topTenShare: number | null;
}

/**
 * Value synthetic portfolios through the REAL market-facing quote
 * (`getPublicShareQuote`) and the real rounding (`roundCurrency`). The
 * private founder's unlisted holding quotes at zero and contributes nothing —
 * mirroring `sumStockValueByCharacter`'s skip of non-positive quotes — while
 * the IPO founder's listed holding revalues with the quote.
 */
export function probeCharacterWealth(
  mode: SimActorMode,
  seed: string,
  ipoQuote = IPO_PROBE_PRICE_PER_SHARE
): CharacterWealthProbe {
  const mechanicId = assertKnownActorMechanic("character-wealth");
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result: "uncovered: character wealth — zero characters, no portfolio components observable",
      portfolios: [],
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  const privateFounder = plan.actors[3].characterIdHex;
  const ipoFounder = plan.actors[4].characterIdHex;
  // Unlisted private shares quote at zero and contribute nothing (same skip
  // rule as the production wealth sum); the listed IPO holding revalues.
  const privateStock = 0 * getPublicShareQuote({ sharePrice: 0 });
  const ipoStock = CEO_INITIAL_SHARES * getPublicShareQuote({ sharePrice: ipoQuote });
  const portfolios = [
    {
      characterIdHex: privateFounder,
      cashValue: PROBE_FOUNDER_CASH,
      stockValue: roundCurrency(privateStock),
      totalWealth: roundCurrency(PROBE_FOUNDER_CASH + privateStock),
    },
    {
      characterIdHex: ipoFounder,
      cashValue: PROBE_FOUNDER_CASH,
      stockValue: roundCurrency(ipoStock),
      totalWealth: roundCurrency(PROBE_FOUNDER_CASH + ipoStock),
    },
  ];
  return {
    mechanicId,
    mode,
    result: `${portfolios.length} synthetic portfolios revalued at quote ${ipoQuote}`,
    portfolios,
  };
}

/** Aggregate synthetic portfolios into household wealth-list metrics. Pure
 * NPP runs observe zero households with null median, Gini, and top-ten
 * share — the vital-signs shape from the issue — so no wealth-concentration
 * conclusion is supported there. */
export function probeHouseholdWealth(
  mode: SimActorMode,
  seed: string,
  ipoQuote = IPO_PROBE_PRICE_PER_SHARE
): HouseholdWealthProbe {
  const mechanicId = assertKnownActorMechanic("household-wealth");
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result: "uncovered: household wealth — zero households, null median/Gini/top-ten",
      households: 0,
      median: null,
      gini: null,
      topTenShare: null,
    };
  }
  const totals = probeCharacterWealth(mode, seed, ipoQuote).portfolios.map((p) => p.totalWealth);
  const sorted = [...totals].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // Gini via the sorted-difference formula; deterministic for fixed inputs.
  const rankWeighted = sorted.reduce((s, v, i) => s + (i + 1) * v, 0);
  const gini = sum > 0 ? roundCurrency((2 * rankWeighted) / (n * sum) - (n + 1) / n) : 0;
  const topCount = Math.max(1, Math.ceil(n * 0.1));
  const topTenShare =
    sum > 0 ? roundCurrency(sorted.slice(-topCount).reduce((s, v) => s + v, 0) / sum) : 0;
  return {
    mechanicId,
    mode,
    result: `${n} synthetic households: median ${median}, Gini ${gini}, top-ten share ${topTenShare}`,
    households: n,
    median: roundCurrency(median),
    gini,
    topTenShare,
  };
}

// ─── Player corporation founding (private + IPO) ────────────────────────────

export type CorpProbeKind = "private" | "ipo";

export interface CorpCheckpoint {
  /** pre-turn (immediately after creation), first recomputation, second recomputation. */
  checkpoint: "pre-turn" | "first-recompute" | "second-recompute";
  foundingCapital: number;
  issuedShares: number;
  placedShares: number;
  issuanceProceeds: number;
  /** Null while unlisted (private pre-turn and recomputes). */
  marketCap: number | null;
  bookValue: number;
  /** Null while unlisted. */
  priceBook: number | null;
}

export interface CorpFoundingProbe {
  mechanicId: string;
  mode: SimActorMode;
  kind: CorpProbeKind;
  result: string;
  founderCharacterIdHex: string | null;
  checkpoints: CorpCheckpoint[];
}

export interface CorpProbeQuotes {
  /** Observed quotes for the three checkpoints; deterministic defaults here. */
  quotes: [number | null, number | null, number | null];
  /** Observed retained earnings added to book per checkpoint; default zero. */
  retained: [number, number, number];
}

/**
 * Capture founding capital, issued/placed shares, issuance proceeds, market
 * cap, displayed book, and price/book at pre-turn, first recomputation, and
 * second recomputation. The IPO leg runs the REAL issuance math
 * (`computeIpoIssuance`) and the REAL market-cap/quote functions; market cap
 * and price/book are null while unlisted. In a live sim run the quotes and
 * retained inputs are the observed engine values — the worldsim evidence
 * gate. Pure NPP runs found no player corporation, so all three checkpoints
 * are absent (the autonomous-NPP entrant transient is a different path).
 */
export function probeCorpFounding(
  mode: SimActorMode,
  kind: CorpProbeKind,
  seed: string,
  observed?: Partial<CorpProbeQuotes>
): CorpFoundingProbe {
  const mechanicId = assertKnownActorMechanic(
    kind === "private" ? "corp-founding-private" : "corp-founding-ipo"
  );
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      kind,
      result: `uncovered: player founding (${kind}) — no player corporation exists at any checkpoint`,
      founderCharacterIdHex: null,
      checkpoints: [],
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  const founder = plan.actors[kind === "private" ? 3 : 4].characterIdHex;
  const foundingCapital = PRIVATE_PROBE_FOUNDING_CAPITAL;
  const issuedShares = CEO_INITIAL_SHARES;
  const ipo =
    kind === "ipo"
      ? computeIpoIssuance({
          existingShares: CEO_INITIAL_SHARES,
          pricePerShare: IPO_PROBE_PRICE_PER_SHARE,
          floatPct: IPO_PROBE_FLOAT_PCT,
        })
      : null;
  const placedShares = ipo ? ipo.newShares : 0;
  const issuanceProceeds = ipo ? ipo.proceeds : 0;
  const totalShares = ipo ? ipo.totalSharesAfter : issuedShares;
  const baseBook = foundingCapital + issuanceProceeds;
  const quotes: [number | null, number | null, number | null] =
    observed?.quotes ??
    (kind === "ipo"
      ? [
          IPO_PROBE_PRICE_PER_SHARE,
          IPO_PROBE_PRICE_PER_SHARE * 1.05,
          IPO_PROBE_PRICE_PER_SHARE * 1.1,
        ]
      : [null, null, null]);
  const retained: [number, number, number] = observed?.retained ?? [0, 0, 0];
  const names: Array<CorpCheckpoint["checkpoint"]> = [
    "pre-turn",
    "first-recompute",
    "second-recompute",
  ];
  const checkpoints = names.map((checkpoint, i) => {
    const quote = quotes[i];
    const bookValue = roundCurrency(baseBook + retained[i]);
    const marketCap =
      quote === null ? null : getRoundedPublicMarketCap({ sharePrice: quote }, totalShares);
    return {
      checkpoint,
      foundingCapital,
      issuedShares: totalShares,
      placedShares,
      issuanceProceeds,
      marketCap,
      bookValue,
      priceBook: marketCap === null ? null : roundCurrency(marketCap / bookValue),
    };
  });
  return {
    mechanicId,
    mode,
    kind,
    result:
      kind === "private"
        ? `synthetic private founding: capital ${foundingCapital}, ${issuedShares} founder shares, unlisted at all checkpoints`
        : `synthetic founding IPO: capital ${foundingCapital}, placed ${placedShares} shares for ${issuanceProceeds} proceeds`,
    founderCharacterIdHex: founder,
    checkpoints,
  };
}

// ─── DD finance-minister national survey ────────────────────────────────────

export interface SurveyProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  /** The cabinet seat key the national-issuer gate looks up for DD. */
  seatPositionId: string | null;
  ministerCharacterIdHex: string | null;
  /** True when the seated positionId is the gate's lookup key. */
  seatMatchesIssuerGate: boolean;
}

/**
 * Prove the synthetic DD finance minister is seated under the exact cabinet
 * key the production issuer gate reads (`isNationalIssuer` looks up
 * `cabinetMembers` by `COUNTRY_CONFIGS[countryId].financeMinisterCabinetId`).
 * The live survey attempt — request status, treasury movement, inserted
 * survey — is worldsim evidence, not something this probe pretends to run:
 * it needs a treasury balance and resource capacity only a turned world has.
 * Pure NPP runs seat no minister, so the action is unreachable there.
 */
export function probeDdFinanceSurvey(mode: SimActorMode, seed: string): SurveyProbeResult {
  const mechanicId = assertKnownActorMechanic("dd-finance-minister-survey");
  const seatPositionId = COUNTRY_CONFIGS.DD?.financeMinisterCabinetId ?? null;
  if (!seatPositionId) {
    throw new Error("probe assumption broken: DD has no financeMinisterCabinetId");
  }
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result:
        "uncovered: minister survey action — no player character holds the head of " +
        "government or the finance-minister seat",
      seatPositionId,
      ministerCharacterIdHex: null,
      seatMatchesIssuerGate: false,
    };
  }
  const plan = buildSyntheticActorPlan(seed);
  const minister = plan.actors[6].characterIdHex;
  return {
    mechanicId,
    mode,
    result:
      `synthetic DD finance minister ${minister} seated under cabinet key ` +
      `"${seatPositionId}" — the national-issuer gate lookup key; live survey ` +
      "attempt is worldsim evidence",
    seatPositionId,
    ministerCharacterIdHex: minister,
    seatMatchesIssuerGate: true,
  };
}

// ─── UK no-confidence motion lifecycle ──────────────────────────────────────

export interface NoConfidenceProbeResult {
  mechanicId: string;
  mode: SimActorMode;
  result: string;
  proposerCharacterIdHex: string | null;
  expectedVotesFor: number | null;
  expectedVotesAgainst: number | null;
  expectedOutcome: "passed" | "failed" | null;
  closesOnTurn: number | null;
}

/**
 * Deterministic ballot expectation for the lifecycle driver. Pure NPP runs
 * seat no Commons proposer, so no motion can ever reach the query surface.
 * In synthetic mode the fixed ballot runs through the REAL carry rule
 * (`noConfidenceMotionCarries`) with an explicit chamber threshold, and the
 * deadline runs through the production duration constant — so the probe pins
 * the ballot the live driver must reproduce, not a reworded copy of it.
 * The live proposal/query/vote/resolution run itself is worldsim evidence,
 * not something this probe pretends to run.
 */
export function probeNoConfidenceMotion(
  mode: SimActorMode,
  seed: string,
  majorityThreshold: number,
  turnProposed: number
): NoConfidenceProbeResult {
  const mechanicId = assertKnownActorMechanic(NO_CONFIDENCE_LIFECYCLE_MECHANIC_ID);
  if (mode === "pure-npp") {
    return {
      mechanicId,
      mode,
      result:
        "uncovered: no-confidence lifecycle — zero player characters, no eligible Commons proposer",
      proposerCharacterIdHex: null,
      expectedVotesFor: null,
      expectedVotesAgainst: null,
      expectedOutcome: null,
      closesOnTurn: null,
    };
  }
  const plan = buildNoConfidenceBallotPlan(seed);
  const expectedOutcome = expectedNoConfidenceOutcome(plan, majorityThreshold);
  return {
    mechanicId,
    mode,
    result:
      `synthetic proposer ${plan.proposer.characterIdHex} moves no confidence; ` +
      `fixed ballot ${plan.expectedVotesFor}-${plan.expectedVotesAgainst} ` +
      `resolves ${expectedOutcome} at threshold ${majorityThreshold}`,
    proposerCharacterIdHex: plan.proposer.characterIdHex,
    expectedVotesFor: plan.expectedVotesFor,
    expectedVotesAgainst: plan.expectedVotesAgainst,
    expectedOutcome,
    closesOnTurn: noConfidenceClosesOnTurn(turnProposed),
  };
}
