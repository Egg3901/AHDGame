/**
 * NPP Autonomous Bill Sponsorship (SP2)
 *
 * Runs before nppBehavior so NPPs can vote in the same turn on bills they just introduced.
 *
 * For each country where isNppAutonomyActive is true, the governing party runs a
 * sponsorship pass (party-scoped throttle → deterministic majority-party sponsor →
 * agenda/fiscal-biased selection → propose). Under a formed NPP government at v1,
 * the largest opposition party runs a second, independently-throttled pass that
 * advances its own counter-agenda (V1.7 rival bills).
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial, LegislationType, StatePolicy } from "@/lib/db/types";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
} from "@/lib/legislationTypeAliases";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import type { NPPContext } from "./context";
import {
  getNppAutonomyLevel,
  isNppAutonomyActive,
  nppAutonomyAtLeast,
  nppAutonomyLevelAtLeast,
} from "@/lib/nppAutonomy/featureFlag";
import { nppSponsorLimitsForCountry } from "@/lib/nppAutonomy/playerImpactBudget";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { careerArchetypeModifiers } from "@/lib/nppAutonomy/v3/careerArchetype";
import { identifyOppositionParty } from "@/lib/nppAutonomy/oppositionBehavior";
import { computeGoverningAgenda } from "@/lib/nppAutonomy/governingAgenda";
// The cap/cooldown pair now comes from nppSponsorLimitsForCountry, which selects
// between the non-player constants and the tighter player-country ones.
import { NPP_BILL_VOTING_DURATION_HOURS } from "@/lib/nppAutonomy/constants";
import {
  selectNppBill,
  buildConditionsSignal,
  type ConditionsSignal,
} from "@/lib/nppAutonomy/selectNppBill";
import { loadPoliticalConditionsDomains } from "@/lib/politicalLegislation/conditionsSignal";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";
import type { PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import { proposeNppNationalBill } from "@/lib/nppAutonomy/proposeNppNationalBill";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { tallySeatsByParty } from "@/lib/turn/parliamentaryGovernment";
import type { GoverningAgendaItem } from "@/lib/nppAutonomy/governingAgenda";
import type { PersistedFiscalStance } from "@/lib/nppAutonomy/fiscalStance";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { getEraContext } from "@/lib/era/context";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import type { Bill } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types";

/**
 * Conservative catalog of legislation types that are clearly market-liberalizing
 * / privatization / price-deregulation scenario levers (SU economic system,
 * eastern-bloc price controls, CN SOE mixed-ownership, kolkhoz breakup). Used
 * only when `isPlannedEconomy` so planned NPP govs do not sponsor shock-therapy
 * bills. Market countries never hit this filter.
 */
export function isMarketLiberalLegislationType(lt: { _id: string; subCategory?: string }): boolean {
  const id = lt._id.toLowerCase();
  if (id.endsWith("_economic_system")) return true;
  if (id.endsWith("_price_controls")) return true;
  if (id === "cn_state_enterprises" || id.endsWith("_state_enterprises")) return true;
  // SU / eastern-bloc farm decollectivization lever.
  if ((lt.subCategory ?? "").toLowerCase() === "farm organization") return true;
  return false;
}

// ── Throttle helpers ──────────────────────────────────────────────────────────

/**
 * Count active (non-terminal) nppSponsored bills in the country. When
 * `sponsorParty` is given, counts only that party's bills — so the governing
 * party and the opposition (V1.7 rival bills) get independent active-bill caps.
 * Party-scoped is behavior-preserving for v0 (only the majority party sponsors).
 */
async function countActiveNppSponsoredBills(
  db: Db,
  countryId: CountryId,
  sponsorParty?: string
): Promise<number> {
  const TERMINAL_STATUSES: Bill["status"][] = ["failed", "withdrawn", "signed", "override_failed"];
  const count = await db.collection<Bill>("bills").countDocuments({
    countryId,
    nppSponsored: true,
    status: { $nin: TERMINAL_STATUSES },
    ...(sponsorParty ? { sponsorParty } : {}),
  });
  return count;
}

/**
 * Find the turn on which the most recent nppSponsored bill (any status) was
 * introduced in this country. With `sponsorParty`, scoped to that party so the
 * opposition's cooldown is independent of the governing party's. Returns null if
 * no such bill exists.
 */
async function lastNppSponsoredBillTurn(
  db: Db,
  countryId: CountryId,
  sponsorParty?: string
): Promise<number | null> {
  const doc = await db.collection<Bill>("bills").findOne(
    { countryId, nppSponsored: true, ...(sponsorParty ? { sponsorParty } : {}) },
    {
      sort: { votingEndsOnTurn: -1 },
      projection: { votingEndsOnTurn: 1, votingStartedAt: 1 },
    }
  );
  if (!doc) return null;

  // votingEndsOnTurn = proposalTurn + NPP_BILL_VOTING_DURATION_HOURS, so
  // proposalTurn = ends - NPP_BILL_VOTING_DURATION_HOURS. Shared constant with the
  // proposer guarantees the two derivations can't drift if the window changes.
  if (typeof doc.votingEndsOnTurn === "number") {
    return doc.votingEndsOnTurn - NPP_BILL_VOTING_DURATION_HOURS;
  }
  return null;
}

// ── Sponsor selection ─────────────────────────────────────────────────────────

/**
 * Determine the majority party among seated lower-chamber NPP officials.
 * `officials` should already be filtered to the country + lower-chamber office type.
 * Returns null if there are no officials or no party assignments.
 */
function resolveMajorityParty(officials: ElectedOfficial[]): string | null {
  if (officials.length === 0) return null;

  const seatsByParty = new Map<string, number>();
  for (const o of officials) {
    if (!o.party) continue;
    const seats = o.seatsHeld ?? 1;
    seatsByParty.set(o.party, (seatsByParty.get(o.party) ?? 0) + seats);
  }

  let majorityParty: string | null = null;
  let maxSeats = 0;
  for (const [party, seats] of seatsByParty) {
    // Tie-break: lower party string wins (deterministic)
    if (
      seats > maxSeats ||
      (seats === maxSeats && majorityParty !== null && party < majorityParty)
    ) {
      maxSeats = seats;
      majorityParty = party;
    }
  }
  return majorityParty;
}

/**
 * Pick the deterministic sponsor: majority-party lower-chamber NPP official with the
 * lowest sequentialId (stable tie-break even across turns).
 */
function pickSponsorOfficial(
  officials: ElectedOfficial[],
  nppMap: NPPContext["nppMap"],
  countryId: CountryId,
  lowerChamberOfficeType: string,
  majorityParty: string
): { official: ElectedOfficial; npp: NPP } | null {
  const candidates = officials.filter(
    (o) =>
      o.countryId === countryId &&
      o.officeType === lowerChamberOfficeType &&
      o.party === majorityParty &&
      o.nppId != null
  );
  if (candidates.length === 0) return null;

  // Sort by NPP sequentialId (lowest = most deterministic pick). Fall back to
  // nppId.toString() if sequentialId is missing.
  candidates.sort((a, b) => {
    const nppA = a.nppId ? nppMap.get(a.nppId.toString()) : undefined;
    const nppB = b.nppId ? nppMap.get(b.nppId.toString()) : undefined;
    const seqA = nppA?.sequentialId ?? Infinity;
    const seqB = nppB?.sequentialId ?? Infinity;
    if (seqA !== seqB) return seqA - seqB;
    return (a.nppId?.toString() ?? "") < (b.nppId?.toString() ?? "") ? -1 : 1;
  });

  const official = candidates[0];
  const npp = official.nppId ? nppMap.get(official.nppId.toString()) : undefined;
  if (!npp) return null;
  return { official, npp };
}

// ── Conditions signal loader ─────────────────────────────────────────────────

/**
 * Load the national conditions signal (weak metrics + inflation) for a country.
 * Exported so the V1 governing-agenda phase reads conditions from the exact same
 * source as bill sponsorship, keeping the two views of "what's urgent" in sync.
 */
export async function loadConditionsSignal(
  db: Db,
  countryId: CountryId
): Promise<ConditionsSignal> {
  const nationalDocId = getNationalDocId(countryId);
  // Board countries derive weakDomains from the nine political category scores
  // (lowercased pipeline vocabulary). The per-metric scan below is what is left
  // for the handful that have no board.
  const political = isPoliticalApprovalCountry(countryId);

  const [budgetDoc, stateMetricsDoc, politicalDomains] = await Promise.all([
    // inflationRate lives on federalBudget.economicFactors.inflationRate for US/UK/etc.
    // For other countries we use the same field (budget docs share the shape).
    db
      .collection("federalBudget")
      .findOne({ countryId }, { projection: { "economicFactors.inflationRate": 1 } }),
    nationalDocId && !political
      ? // A country with no board (SCO/WAL, latent until the independence
        // process activates them) has only the economic half to scan. The
        // political half of this read is gone with the store it came from, so
        // their weak-domain signal is economic-only rather than partly stale.
        (
          db.collection("macroMetrics") as import("mongodb").Collection<Record<string, unknown>>
        ).findOne(
          { _id: nationalDocId } as unknown as import("mongodb").Filter<Record<string, unknown>>,
          { projection: { economic: 1 } }
        )
      : Promise.resolve(null),
    political
      ? loadPoliticalConditionsDomains(db, countryId as PoliticalMetricsCountryId)
      : Promise.resolve(null),
  ]);

  const inflationRate =
    typeof budgetDoc?.economicFactors?.inflationRate === "number"
      ? budgetDoc.economicFactors.inflationRate
      : undefined;

  if (political) {
    // Unseeded playable world → no weakness/comfort signal (never the legacy scan).
    return {
      inflationRate,
      weakDomains: politicalDomains?.weak ?? {},
      strongDomains: politicalDomains?.strong ?? {},
    };
  }

  return buildConditionsSignal({
    inflationRate,
    stateMetrics: stateMetricsDoc as Record<string, unknown> | null,
  });
}

/**
 * Load the governing party's policy agenda (V1.5) + fiscal posture (V1.6) for
 * agenda-driven sponsorship, plus the formation's party makeup so the opposition
 * (V1.7 rival bills) can be identified. Agenda/stance are undefined unless a
 * formed NPP government has computed them, so sponsorship falls back to reactive
 * scoring.
 */
async function loadGovernmentDirectives(
  db: Db,
  countryId: CountryId
): Promise<{
  agenda?: GoverningAgendaItem[];
  fiscalStance?: PersistedFiscalStance;
  governingPartyId?: string | null;
  seatsByParty?: Record<string, number>;
}> {
  const gov = await getGovernmentFormationsCollection(db).findOne(
    { _id: countryId },
    {
      projection: {
        status: 1,
        governingAgenda: 1,
        fiscalStance: 1,
        governingPartyId: 1,
      },
    }
  );
  if (!gov || gov.status !== "formed") return {};
  const items = gov.governingAgenda?.items;
  // Tallied live from electedOfficials rather than the (removed-from-
  // projection) `gov.seatsByParty` — a write-triggered cache refreshed only
  // on specific turn events that can drift arbitrarily far from the real
  // chamber between them (measured: BR/NG summed to 0 against real totals of
  // 513/360). A stale zero here would silently suppress the opposition's
  // rival-bill sponsorship (V1.7) every turn.
  const seatsByParty = await tallySeatsByParty(db, countryId);
  return {
    agenda: items && items.length > 0 ? items : undefined,
    fiscalStance: gov.fiscalStance ?? undefined,
    governingPartyId: gov.governingPartyId,
    seatsByParty,
  };
}

// ── Legislation-type catalog loader ─────────────────────────────────────────

/**
 * Load national-scope legislation types for a country that have policyOptions.
 * Mirrors the query used by /api/game/legislation-types?scope=national&country=XX.
 */
async function loadNationalLegislationTypes(
  db: Db,
  countryId: CountryId
): Promise<LegislationType[]> {
  const countryScope = countryId.toLowerCase() as LegislationType["countryScope"];

  // Build country-scope filter matching the route's logic.
  // US is the default: catches legacy types missing countryScope.
  const countryScopeFilter =
    countryId === COUNTRY_CONFIGS.US.id
      ? { $or: [{ countryScope: "us" }, { countryScope: { $exists: false } }] }
      : { countryScope };

  // National scope: allowedScope is national/both/undefined (types without nationalOnly:true)
  const nationalScopeFilter = {
    $or: [
      { allowedScope: "national" },
      { allowedScope: "both" },
      { allowedScope: { $exists: false } },
    ],
  };

  const query = {
    $and: [countryScopeFilter, nationalScopeFilter],
    // Must have policy options for us to score/select
    "policyOptions.0": { $exists: true },
  };

  return db
    .collection<LegislationType>("legislationTypes")
    .find(query as import("mongodb").Filter<LegislationType>)
    .toArray();
}

// ── Per-party sponsorship attempt ────────────────────────────────────────────

interface PartySponsorshipAttempt {
  db: Db;
  countryId: CountryId;
  officials: ElectedOfficial[];
  nppMap: NPPContext["nppMap"];
  lowerChamberOfficeType: string;
  currentTurn: number;
  now: Date;
  /** The party whose seated NPPs sponsor the bill (governing or opposition). */
  party: string;
  legTypes: LegislationType[];
  signal: ConditionsSignal;
  /** Enacted national policy rung per legislation type (fiscal-restraint ceiling). */
  currentPolicyOptionIds: ReadonlyMap<string, string>;
  agenda?: GoverningAgendaItem[];
  fiscalStance?: PersistedFiscalStance;
  /** Log tag distinguishing the governing pass from the opposition pass. */
  tag: string;
  /**
   * v3 full-agency: when true, the deterministic sponsor's own
   * legislativeActivityMult scales their personal cooldown (higher activity →
   * shorter cooldown → sponsors more often). Below v3, cooldown is the fixed
   * NPP_SPONSOR_COOLDOWN_TURNS, byte-identical to pre-v3 behavior.
   */
  v3Active: boolean;
  /**
   * True when this country is player-enabled — reachable only at v4, where NPP
   * sponsorship stops being scoped to NPP-only countries. Selects the tighter
   * cap/cooldown pair, because in a player country every NPP bill is something a
   * human has to read and vote on rather than the only legislative activity there is.
   */
  isPlayerCountry: boolean;
}

/**
 * Run one party's sponsorship attempt: active-bill cap → deterministic
 * sponsor → per-sponsor cooldown (v3: scaled by legislativeActivityMult) →
 * agenda-biased bill selection → propose. Returns 1 if a bill was introduced,
 * else 0. The cap/cooldown are scoped to the party so the governing and
 * opposition (V1.7 rival-bill) passes are independent of each other.
 */
async function attemptPartySponsorship(a: PartySponsorshipAttempt): Promise<number> {
  const { db, countryId, currentTurn, party, tag } = a;

  const limits = nppSponsorLimitsForCountry(a.isPlayerCountry);

  const activeCount = await countActiveNppSponsoredBills(db, countryId, party);
  if (activeCount >= limits.activeCap) {
    console.log(
      `[nppBillSponsorship] ${countryId} (${tag}): throttled — ${activeCount} active >= cap ${limits.activeCap}`
    );
    return 0;
  }

  // Sponsor is picked before the cooldown check (rather than after, as in the
  // pre-v3 ordering) because v3 scales the cooldown by THIS sponsor's own
  // legislativeActivityMult — the cooldown threshold depends on who the
  // sponsor is, so the sponsor must be known first.
  const sponsorPair = pickSponsorOfficial(
    a.officials,
    a.nppMap,
    countryId,
    a.lowerChamberOfficeType,
    party
  );
  if (!sponsorPair) {
    console.log(`[nppBillSponsorship] ${countryId} (${tag}): no suitable sponsor found`);
    return 0;
  }
  const { official: sponsorOfficial, npp } = sponsorPair;

  const effectiveCooldown = a.v3Active
    ? Math.round(
        limits.cooldownTurns / careerArchetypeModifiers(npp.personality).legislativeActivityMult
      )
    : limits.cooldownTurns;

  const lastTurn = await lastNppSponsoredBillTurn(db, countryId, party);
  if (lastTurn !== null && currentTurn - lastTurn < effectiveCooldown) {
    console.log(
      `[nppBillSponsorship] ${countryId} (${tag}): throttled — cooldown not elapsed (${currentTurn - lastTurn} < ${effectiveCooldown})`
    );
    return 0;
  }

  const selection = selectNppBill(
    a.legTypes,
    npp,
    a.signal,
    a.agenda,
    a.fiscalStance,
    a.currentPolicyOptionIds
  );
  if (!selection) {
    console.log(`[nppBillSponsorship] ${countryId} (${tag}): no bill selected`);
    return 0;
  }

  const result = await proposeNppNationalBill(
    db,
    countryId,
    npp,
    sponsorOfficial,
    selection,
    currentTurn,
    a.now
  );
  if (result.ok) {
    console.log(
      `[nppBillSponsorship] ${countryId} (${tag}): introduced bill ${result.billId} — "${selection.legType.name}" / "${selection.option.name}" (NPP: ${npp.name})`
    );
    return 1;
  }
  console.log(`[nppBillSponsorship] ${countryId} (${tag}): proposal rejected — ${result.reason}`);
  return 0;
}

// ── Main phase function ──────────────────────────────────────────────────────

/**
 * Process NPP autonomous bill sponsorship for all eligible countries.
 * Returns the number of bills successfully introduced.
 */
export async function processNppBillSponsorship(ctx: NPPContext): Promise<number> {
  const { db, nppOfficials, nppMap, currentTurn, now } = ctx;

  // Era gate — a pre-window type cannot be sponsored. Null year (flag off) ⇒
  // every type active, byte-identical legacy.
  const { year: eraYear } = await getEraContext(db);

  // Command-economy regime (default OFF). When on, planned-economy NPP govs
  // drop market-liberalization / privatization levers from the candidate set.
  // Fail-safe: flag off → isPlannedEconomy is false → filter is a no-op.
  const [cmdConfig, cmdGameState] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
  ]);
  const commandEconomyEnabled = cmdConfig?.commandEconomyEnabled === true;
  const currentYear = cmdGameState?.currentYear;

  // v3 full-agency: scales the deterministic sponsor's personal cooldown by
  // their own legislativeActivityMult (see PartySponsorshipAttempt.v3Active).
  // Below v3, cooldown stays the fixed NPP_SPONSOR_COOLDOWN_TURNS.
  // v3 AND ABOVE — a strict `=== "v3"` here used to drop the archetype-scaled
  // cooldown back to the flat one the moment the level was raised to v4.
  const autonomyLevel = await getNppAutonomyLevel(db);
  const v3Active = nppAutonomyLevelAtLeast(autonomyLevel, "v3");

  // Group nppOfficials by countryId
  const officialsByCountry = new Map<CountryId, ElectedOfficial[]>();
  for (const official of nppOfficials) {
    if (!official.countryId) continue;
    const list = officialsByCountry.get(official.countryId as CountryId) ?? [];
    list.push(official);
    officialsByCountry.set(official.countryId as CountryId, list);
  }

  let totalBillsProposed = 0;

  for (const [countryId, officials] of officialsByCountry) {
    // COUNTRY_CONFIGS check — skip unknown countries. Must run before
    // isNppAutonomyActive: that call resolves country access from the same
    // config map and throws "Invalid country ID" instead of returning false,
    // so an unrecognized countryId (e.g. stale pre-rename data) has to be
    // filtered out here first, not after.
    if (!COUNTRY_CONFIGS[countryId]) continue;

    // Safety rail: only run in countries where autonomy is active.
    //
    // v0–v3 use the legacy strict rail (autonomy on AND the country is not
    // player-enabled). At v4 that rail is what stood between "full agency,
    // globally" and reality: bill sponsorship is the defining NPP legislative
    // behaviour, and leaving it non-player-only made v4 functionally identical
    // to v3 for the system that matters most. v4 therefore honours the ordinary
    // per-country gate instead — but only in the same breath as the tighter
    // player-country cap/cooldown below, because lifting the rail without the
    // throttle would just double the volume of bills a player has to sit through.
    const isPlayerCountry = await isCountryEnabledForPlayers(db, countryId);
    const active = nppAutonomyLevelAtLeast(autonomyLevel, "v4")
      ? await nppAutonomyAtLeast(db, countryId, "v4")
      : await isNppAutonomyActive(db, countryId);
    if (!active) continue;

    const lowerChamberOfficeType = getLowerChamberOfficeType(countryId);

    // ── Sponsor pool ─────────────────────────────────────────────────────────

    const lowerOfficials = officials.filter(
      (o) => o.countryId === countryId && o.officeType === lowerChamberOfficeType
    );
    if (lowerOfficials.length === 0) {
      console.log(`[nppBillSponsorship] ${countryId}: no lower-chamber NPP officials`);
      continue;
    }

    const majorityParty = resolveMajorityParty(lowerOfficials);
    if (!majorityParty) {
      console.log(`[nppBillSponsorship] ${countryId}: could not determine majority party`);
      continue;
    }

    // Shared per-country loads (catalog, conditions, government directives,
    // enacted national policy rungs for the fiscal-restraint ceiling).
    const nationalPolicyStoreId =
      getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;
    const [legTypesRaw, signal, directives, nationalPolicies] = await Promise.all([
      loadNationalLegislationTypes(db, countryId),
      loadConditionsSignal(db, countryId),
      loadGovernmentDirectives(db, countryId),
      db
        .collection<StatePolicy>("statePolicies")
        .find(
          { stateId: nationalPolicyStoreId },
          { projection: { legislationTypeId: 1, policyOptionId: 1 } }
        )
        .toArray(),
    ]);
    // Keyed by every equivalent legislation-type id so selectNppBill can look
    // up by whichever alias the catalog row carries.
    const currentPolicyOptionIds = new Map<string, string>();
    for (const policy of nationalPolicies) {
      const canonicalId = canonicalizeLegislationTypeId(policy.legislationTypeId);
      for (const id of canonicalId
        ? getEquivalentLegislationTypeIds(canonicalId)
        : [policy.legislationTypeId]) {
        if (!currentPolicyOptionIds.has(id) || policy.legislationTypeId === canonicalId) {
          currentPolicyOptionIds.set(id, policy.policyOptionId);
        }
      }
    }
    // Drop pre-window types so NPPs never sponsor legislation that cannot exist yet.
    // Planned economies also drop clearly market-liberalizing scenario levers.
    const planned = isPlannedEconomy(countryId, currentYear, commandEconomyEnabled);
    const legTypes = legTypesRaw.filter((lt) => {
      if (!isLegislationTypeActive(lt._id, eraYear)) return false;
      if (planned && isMarketLiberalLegislationType(lt)) return false;
      return true;
    });

    const shared = {
      db,
      countryId,
      officials,
      nppMap,
      lowerChamberOfficeType,
      currentTurn,
      now,
      legTypes,
      signal,
      currentPolicyOptionIds,
      v3Active,
      isPlayerCountry,
    };

    // Governing party (V1.5 agenda + V1.6 fiscal posture). The party-scoped
    // throttle is behavior-preserving for v0, where the majority party is the
    // only sponsor. Planned economies persist a plan stance (same shape) on
    // fiscalStance, so the market fiscal bias in selectNppBill naturally
    // consumes shortage/overhang-driven direction instead of inflation/debt.
    totalBillsProposed += await attemptPartySponsorship({
      ...shared,
      party: majorityParty,
      agenda: directives.agenda,
      fiscalStance: directives.fiscalStance,
      tag: "gov",
    });

    // Opposition rival bills (V1.7): the largest non-governing party sponsors
    // bills advancing its own counter-agenda, with an independent throttle so the
    // government's cooldown never blocks it. Only for a formed NPP government at v1.
    if (
      directives.governingPartyId &&
      directives.seatsByParty &&
      (await nppAutonomyAtLeast(db, countryId, "v1"))
    ) {
      const opposition = identifyOppositionParty(
        directives.seatsByParty,
        directives.governingPartyId
      );
      if (opposition && opposition.partyId !== majorityParty) {
        const oppSponsor = pickSponsorOfficial(
          officials,
          nppMap,
          countryId,
          lowerChamberOfficeType,
          opposition.partyId
        );
        if (oppSponsor) {
          // Counter-agenda: the opposition pursues its own platform, computed
          // from its sponsor's ideology — distinct from the government's agenda.
          const counterAgenda = computeGoverningAgenda({
            conditions: signal,
            ideology: {
              economic: oppSponsor.npp.policies?.economic ?? 0,
              social: oppSponsor.npp.policies?.social ?? 0,
            },
            personality: oppSponsor.npp.personality,
            currentTurn,
          }).items;
          totalBillsProposed += await attemptPartySponsorship({
            ...shared,
            party: opposition.partyId,
            agenda: counterAgenda,
            tag: "opp",
          });
        }
      }
    }
  }

  return totalBillsProposed;
}
