/**
 * GET /api/country/[code]/regime/leader
 *
 * Full diagnostics for the sitting head of government: raw scalars,
 * dwell counters, the active decision (if any) with its options,
 * reform-action availability + cooldowns, convention state, and the
 * popular-legitimacy / party-confidence history series.
 *
 * Auth: the sitting head of government always sees their own
 * diagnostics. Site admins/moderators also get read access (mirroring
 * the requireAdmin() guard on the admin override endpoints) so the
 * Admin and Regime Health tabs stay usable even when there is no
 * sitting head of government yet. Everyone else gets 403 — the Regime
 * Health tab in the UI uses this to decide whether to render the
 * diagnostic surface or fall back to the public panel.
 *
 * Errors:
 *   400 — unknown country
 *   401 — not authenticated and not an admin
 *   403 — caller is neither the sitting leader nor an admin
 *   500 — anything else
 */
import { NextResponse } from "next/server";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getCountryState } from "@/lib/countryState";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import {
  classifyPopularBand,
  INITIAL_POPULAR_LEGITIMACY,
  MAX_POPULAR_LEGITIMACY,
  MIN_POPULAR_LEGITIMACY,
} from "@/lib/turn/popularLegitimacy";
import {
  classifyConfidenceBand,
  MAX_CONFIDENCE,
  MIN_CONFIDENCE,
} from "@/lib/turn/rulingPartyConfidence";
import { getDecisionHandler } from "@/lib/onePartyState/decisionEvents/registry";
// Side-effect import to ensure all stage decision handlers are registered
// before the leader API tries to look them up. Without this, a fresh
// server boot that hits /regime/leader before the per-turn driver has
// run for any country would find an empty registry and return decisions
// with empty options arrays — the Active decision card would render
// just the kind string and no buttons.
import "@/lib/onePartyState/decisionEvents";
import { isActionAvailable, type ReformActionId } from "@/lib/onePartyState/reformCooldowns";
import { COUNTRY_CONFIGS as COUNTRY_CFGS_FOR_MOOD } from "@/lib/constants/countries";
import { computePopularTurnDrift } from "@/lib/turn/popularLegitimacyTurn";
import { collectEconomicSignalsForCountry } from "@/lib/turn/popularLegitimacyDriverCollectors";
import { popularLegitimacyBleedIntoParty } from "@/lib/turn/rulingPartyPriorities";

const PROJECTION_TURNS = 48;

const REFORM_ACTIONS: ReformActionId[] = [
  "legalizeParty",
  "reduceVoteMultipliers",
  "holdHonestByElection",
  "anticorruptionPurge",
  "constitutionalAmendment",
];

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    // The sitting head of government always sees their own diagnostics.
    // Site admins/moderators also get read access — the Admin and Regime
    // Health tabs on the executive page need the status pane to load even
    // when there is no sitting head of government yet. We reuse the same
    // requireAdmin() guard the admin override endpoints use, so anyone who
    // can drive the admin controls can also read the status.
    const auth = await requireHumanSessionWithCharacter(request);
    const db = await getDb();
    const leader = auth.ok && (await isSittingLeader(db, countryId, auth.user.character._id));
    if (!leader) {
      const admin = await requireAdmin();
      if (!admin.ok) {
        // Preserve the original 401 when the caller wasn't authenticated at
        // all; otherwise it's an authenticated non-leader, non-admin.
        return auth.ok
          ? NextResponse.json(
              { error: "Only the sitting leader can view regime diagnostics" },
              { status: 403 }
            )
          : auth.response;
      }
    }

    const currentTurn = await getCurrentTurn(db);
    const runtime = await getCountryState(db, countryId);

    // Leader scalars (history + bands). Look up by ruling party id so we
    // get the current leader's row even if multiple historical leaders
    // share the country.
    // Leader-state lookup: prefer the primary-key lookup by
    // {countryId, leaderCharacterId} since the caller IS the sitting
    // leader. Falls back to the {countryId, governingPartyId} query
    // for compatibility with rows seeded before the self-heal in
    // adjustLeaderConfidence / adjustPopularLegitimacy started
    // populating governingPartyId reliably.
    let popularLegitimacy = INITIAL_POPULAR_LEGITIMACY;
    let partyConfidence = 75;
    let popularHistory: unknown[] = [];
    let confidenceHistory: unknown[] = [];
    const leaderColl = getCountryLeaderStatesCollection(db);
    // Admin viewers may have no character in this country (or none at all),
    // so only run the by-character lookup when we actually have one — the
    // governingPartyId fallback below still surfaces the ruling regime's row.
    const leaderRowById = auth.ok
      ? await leaderColl.findOne({
          countryId,
          leaderCharacterId: auth.user.character._id,
        })
      : null;
    const leaderRowByParty =
      leaderRowById ??
      (runtime.rulingPartyId !== null
        ? await leaderColl.findOne({
            countryId,
            governingPartyId: String(runtime.rulingPartyId),
          })
        : null);
    if (leaderRowByParty) {
      popularLegitimacy = leaderRowByParty.popularLegitimacy ?? INITIAL_POPULAR_LEGITIMACY;
      partyConfidence = leaderRowByParty.partyConfidence ?? 75;
      popularHistory = leaderRowByParty.popularLegitimacyHistory ?? [];
      confidenceHistory = leaderRowByParty.confidenceHistory ?? [];
    }

    // Escalation state — stage, dwell counters, active decision, convention.
    const esc = await getRegimeEscalationCollection(db).findOne({ _id: countryId });
    const stage = esc?.currentStage ?? "stable";
    const dwellCounters = esc?.dwellCounters ?? {
      stage1: 0,
      stage2: { sustained: 0, cumulativeIn168: 0 },
      stage3: 0,
      stage4: 0,
    };

    // Active decision — pull the registered options so the UI can render
    // the choices without round-tripping. Falls through to empty when no
    // handler is registered (e.g. partial rollout).
    let activeDecision: {
      id: string;
      kind: string;
      offeredAtTurn: number;
      expiresAtTurn: number;
      payload: Record<string, unknown>;
      options: { id: string; label: string; description: string }[];
    } | null = null;
    if (esc?.activeDecision) {
      const handler = getDecisionHandler(esc.activeDecision.kind);
      activeDecision = {
        id: esc.activeDecision.id.toHexString(),
        kind: esc.activeDecision.kind,
        offeredAtTurn: esc.activeDecision.offeredAtTurn,
        expiresAtTurn: esc.activeDecision.expiresAtTurn,
        payload: esc.activeDecision.payload,
        options:
          handler?.options.map((o) => ({
            id: o.id,
            label: o.label,
            description: o.description,
          })) ?? [],
      };
    }

    // Reform-action availability + cooldown turn (when on cooldown). For
    // legalizeParty we report a placeholder shape — the UI will need a
    // party id to query per-party; surfacing the *general* flag here is
    // enough for the menu to render the button row.
    const reformAvailability: Record<
      string,
      { available: boolean; cooldownUntil?: number; note?: string }
    > = {};
    for (const action of REFORM_ACTIONS) {
      if (action === "legalizeParty") {
        // Per-party cooldown — UI computes per-party availability.
        reformAvailability[action] = {
          available: true,
          note: "Per-party cooldown — pick a banned party to check availability",
        };
        continue;
      }
      const avail = await isActionAvailable(db, countryId, action, currentTurn);
      const cdMap = runtime.reformCooldowns ?? {};
      const cooldownUntil =
        action === "reduceVoteMultipliers"
          ? cdMap.reduceVoteMultipliers
          : action === "holdHonestByElection"
            ? cdMap.holdHonestByElection
            : action === "anticorruptionPurge"
              ? cdMap.anticorruptionPurge
              : undefined;
      reformAvailability[action] = {
        available: avail,
        ...(cooldownUntil !== undefined && cooldownUntil > currentTurn ? { cooldownUntil } : {}),
        ...(action === "constitutionalAmendment" && cdMap.constitutionalAmendment === "used"
          ? { note: "Already used (one-time)" }
          : {}),
      };
    }

    // Banned parties — Stage-2 'selectiveConcession' and the
    // legalizeParty reform both need a banned partyId picker on the UI
    // side. Surfacing the list here saves the UI a second round-trip.
    // Wrapped in try/catch so MockDb-shaped tests that don't stub the
    // politicalParties collection still get the rest of the diagnostic
    // surface back instead of a 500.
    let bannedParties: { sequentialId: number; name: string; abbreviation?: string }[] = [];
    try {
      bannedParties = await db
        .collection<{ sequentialId: number; name: string; abbreviation?: string }>(
          "politicalParties"
        )
        .find({ countryId, regimeStatus: "banned" })
        .project<{ sequentialId: number; name: string; abbreviation?: string }>({
          _id: 0,
          sequentialId: 1,
          name: 1,
          abbreviation: 1,
        })
        .sort({ sequentialId: 1 })
        .toArray();
    } catch (err) {
      console.warn(`${countryId} banned-parties lookup skipped:`, err);
    }

    // 48-turn forward projection: re-runs the popular-drift aggregator
    // each turn against the current economy + decrementing boost
    // modifiers, and applies the popular-bleed coupling for the
    // intra-party scalar. Only the steady-state per-turn drivers are
    // included — episodic shocks (new purges, decision-handler effects)
    // would only materialise if the player or simulation triggers them
    // mid-projection. Skip the work for non-OPS countries (no drift).
    let projection: { popularLegitimacy: number[]; partyConfidence: number[] } | null = null;
    if (runtime.governmentType === "onePartyState") {
      const moodProfile = COUNTRY_CFGS_FOR_MOOD[countryId]?.popularMoodProfile;
      if (moodProfile) {
        try {
          const economic = await collectEconomicSignalsForCountry(db, countryId);
          const initialBoosts = (runtime.popularBoostModifiers ?? []).map((b) => ({
            source: b.source,
            perTurnDelta: b.perTurnDelta,
            untilTurn: b.untilTurn,
          }));
          let projPop = popularLegitimacy;
          let projConf = partyConfidence;
          const popSeries: number[] = [];
          const confSeries: number[] = [];
          for (let i = 1; i <= PROJECTION_TURNS; i++) {
            const futureTurn = currentTurn + i;
            const activeBoosts = initialBoosts.filter((b) => b.untilTurn >= futureTurn);
            const drift = computePopularTurnDrift({
              currentLegitimacy: projPop,
              partyConfidence: projConf,
              economic,
              purges: [],
              enactedBills: [],
              election: { isElectionTurn: false, opsMultiplier: 1.0 },
              moodProfile,
              boosts: activeBoosts,
              currentTurn: futureTurn,
            });
            projPop = Math.max(
              MIN_POPULAR_LEGITIMACY,
              Math.min(MAX_POPULAR_LEGITIMACY, projPop + drift.total)
            );
            // Intra-party drift in the projection only models the popular
            // bleed coupling — the other intra-party drivers (purges,
            // policy alignment, renewal bumps) are episodic and would
            // require synthesising future events to project here.
            const bleed = popularLegitimacyBleedIntoParty(projPop);
            projConf = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, projConf + bleed));
            popSeries.push(Number(projPop.toFixed(2)));
            confSeries.push(Number(projConf.toFixed(2)));
          }
          projection = { popularLegitimacy: popSeries, partyConfidence: confSeries };
        } catch (err) {
          // Projection is a "nice to have" diagnostic; if the
          // economic-signals lookup fails (e.g. test mock without a
          // central bank collection) we degrade to no projection
          // rather than failing the whole endpoint.
          console.warn(`${countryId} projection skipped:`, err);
        }
      }
    }

    return NextResponse.json({
      countryId,
      currentTurn,
      governmentType: runtime.governmentType,
      scalars: {
        popularLegitimacy,
        popularBand: classifyPopularBand(popularLegitimacy),
        partyConfidence,
        confidenceBand: classifyConfidenceBand(partyConfidence),
      },
      projection,
      history: {
        popularLegitimacy: popularHistory,
        partyConfidence: confidenceHistory,
      },
      stage,
      dwellCounters,
      activeDecision,
      convention: esc?.convention ?? null,
      conventionInProgress: esc?.conventionInProgress ?? false,
      conversionPendingAtTurn: esc?.conversionPendingAtTurn ?? null,
      stage4Delay: esc?.stage4Delay ?? null,
      transitionHistory: (esc?.transitionHistory ?? []).slice(0, 10),
      reformAvailability,
      bannedParties,
      pendingReformDiscount: runtime.pendingReformDiscount ?? null,
      pendingHonestByElection: runtime.pendingHonestByElection ?? null,
      pendingPostConversionElection: runtime.pendingPostConversionElection ?? null,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
