import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  BargainingCampaign,
  BargainingEscalationLevel,
  GameConfig,
  Union,
} from "@/lib/db/types";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { normalizeServiceIds, servicesWorkerSecurityNudge } from "./unionServices";

/** Political attention fades unless a dispute escalates again. */
export const LABOUR_DISPUTE_DECAY = 0.9;
/** A settlement remains salient for several turns, then leaves the standing board. */
export const LABOUR_SETTLEMENT_DECAY = 0.85;
export const LABOUR_SETTLEMENT_EFFECT_TURNS = 32;

/** Keep labour relations subordinate to the law and structural political channels. */
export const LABOUR_POLITICAL_CAPS = {
  "economy.workerSecurity": 5,
  "society.civicLife": 3,
} as const satisfies Partial<Record<PoliticalMetricId, number>>;

const ESCALATION_SEVERITY: Record<BargainingEscalationLevel, number> = {
  none: 1,
  overtime_ban: 1.5,
  selective_strike: 2.25,
  industry_strike: 3,
};

type LabourPoliticalCampaign = Pick<
  BargainingCampaign,
  | "countryId"
  | "status"
  | "escalationLevel"
  | "mandate"
  | "disputeStartedAtTurn"
  | "escalationStartedAtTurn"
  | "endedAtTurn"
>;

/** Union dues v1: the fields `buildLabourRelationsPoliticalNudges` needs to turn a running service slate into a `workerSecurity` nudge. */
type LabourPoliticalUnion = Pick<Union, "countryId" | "activeServices" | "suspended">;

type CountryPoliticalNudges = Map<CountryId, Map<PoliticalMetricId, number>>;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function ageSince(currentTurn: number, anchor: number | undefined): number {
  return Math.max(0, currentTurn - (anchor ?? currentTurn));
}

function add(
  nudges: CountryPoliticalNudges,
  countryId: CountryId,
  metricId: keyof typeof LABOUR_POLITICAL_CAPS,
  delta: number
): void {
  const byMetric = nudges.get(countryId) ?? new Map<PoliticalMetricId, number>();
  byMetric.set(metricId, (byMetric.get(metricId) ?? 0) + delta);
  nudges.set(countryId, byMetric);
}

/**
 * Convert bargaining outcomes AND running union services into small, temporary
 * political-board nudges.
 *
 * An unresolved dispute weakens the observed settlement and civic-institution
 * signals. Escalation raises the initial severity, while attention decays from
 * the latest escalation. A settlement reverses the sign and decays from the
 * settlement turn. Economic strike damage is deliberately absent here because
 * sector revenue, employment, profits, and GDP already carry that consequence.
 *
 * Union dues v1: `unions` feeds `servicesWorkerSecurityNudge()` into the SAME
 * `economy.workerSecurity` channel the bargaining campaigns above already
 * write, through the same `add()` + end-of-function `clamp(value,
 * LABOUR_POLITICAL_CAPS[...])` pair — one capped total, not a second uncapped
 * channel onto the same metric. There is no separate decay constant for this
 * term: it is recomputed fresh from the union's CURRENT `activeServices` every
 * call (nothing here persists an accumulator), so it rises and falls with the
 * union's own service choices exactly as fast as the caller re-invokes this
 * function each turn — the political board's own per-turn consumption of this
 * map is what gives it the "existing decay," not a second bespoke one grafted
 * on top of a value with no natural start turn to decay from.
 */
export function buildLabourRelationsPoliticalNudges(
  campaigns: readonly LabourPoliticalCampaign[],
  currentTurn: number,
  unions: readonly LabourPoliticalUnion[] = []
): CountryPoliticalNudges {
  const nudges: CountryPoliticalNudges = new Map();

  for (const union of unions) {
    if (union.suspended) continue;
    const nudge = servicesWorkerSecurityNudge(normalizeServiceIds(union.activeServices));
    if (nudge !== 0) add(nudges, union.countryId, "economy.workerSecurity", nudge);
  }

  for (const campaign of campaigns) {
    if (campaign.status === "dispute") {
      const anchor = campaign.escalationStartedAtTurn ?? campaign.disputeStartedAtTurn;
      const salience = LABOUR_DISPUTE_DECAY ** ageSince(currentTurn, anchor);
      const severity = ESCALATION_SEVERITY[campaign.escalationLevel] * salience;
      add(nudges, campaign.countryId, "economy.workerSecurity", -0.75 * severity);
      add(nudges, campaign.countryId, "society.civicLife", -0.4 * severity);
      continue;
    }

    if (campaign.status === "settled" && campaign.endedAtTurn != null) {
      const age = ageSince(currentTurn, campaign.endedAtTurn);
      if (age > LABOUR_SETTLEMENT_EFFECT_TURNS) continue;
      const salience = LABOUR_SETTLEMENT_DECAY ** age;
      const leverage = Math.max(0, Math.min(100, campaign.mandate.leverage));
      const settlementQuality = 0.75 + leverage / 200;
      add(nudges, campaign.countryId, "economy.workerSecurity", 1.5 * settlementQuality * salience);
      add(nudges, campaign.countryId, "society.civicLife", 0.75 * settlementQuality * salience);
    }
  }

  for (const byMetric of nudges.values()) {
    for (const [metricId, value] of byMetric) {
      const limit = LABOUR_POLITICAL_CAPS[metricId as keyof typeof LABOUR_POLITICAL_CAPS];
      const bounded = clamp(value, limit);
      if (Math.abs(bounded) < 0.01) byMetric.delete(metricId);
      else byMetric.set(metricId, +bounded.toFixed(4));
    }
  }
  return nudges;
}

/** Load only live disputes and settlements recent enough to remain visible. */
export async function loadLabourRelationsPoliticalNudgesByCountry(
  db: Db,
  currentTurn: number
): Promise<CountryPoliticalNudges> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { labourSystemMode: 1 } });
  if (!(await isLabourFullMode(config))) return new Map();

  const [campaigns, unions] = await Promise.all([
    db
      .collection<BargainingCampaign>("bargainingCampaigns")
      .find(
        {
          $or: [
            { status: "dispute" },
            {
              status: "settled",
              endedAtTurn: { $gte: currentTurn - LABOUR_SETTLEMENT_EFFECT_TURNS },
            },
          ],
        },
        {
          projection: {
            countryId: 1,
            status: 1,
            escalationLevel: 1,
            "mandate.leverage": 1,
            disputeStartedAtTurn: 1,
            escalationStartedAtTurn: 1,
            endedAtTurn: 1,
          },
        }
      )
      .toArray(),
    // Union dues v1: only unions actually running something can produce a
    // nudge — skips the (common) idle-slate union at the query level.
    db
      .collection<Union>("unions")
      .find(
        { suspended: { $ne: true }, activeServices: { $exists: true, $not: { $size: 0 } } },
        { projection: { countryId: 1, activeServices: 1, suspended: 1 } }
      )
      .toArray(),
  ]);

  return buildLabourRelationsPoliticalNudges(campaigns, currentTurn, unions);
}
