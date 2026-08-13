/**
 * ministerialGovernance — the NPP cabinet's teeth (V1.4).
 *
 * Once an NPP government has a cabinet (V1.3), each NPP minister steers their
 * portfolio toward the government's `governingAgenda` using the same bounded
 * levers a player minister has: a standing **tier setting** (a persistent policy
 * posture) and per-turn **ministerial orders** (action-costed, time-limited
 * metric pushes). Both flow through the existing cabinet-effect pipeline
 * (`ministerialOrderProcessing`), which already caps the per-metric movement per
 * turn — so this turns on the dormant levers without inventing new ones.
 *
 * The decision is deterministic and bounded (formula + clamp): a lever is scored
 * by how well its effects move the minister's agenda-relevant metrics in the
 * agenda's desired direction, weighted by the agenda item's priority. The
 * minister's archetype only sets how many actions it is willing to spend — an
 * ambitious reformer empties its action pool; a steward keeps one in reserve.
 *
 * Gating: `nppAutonomyAtLeast(v1)` (also the player rail). Idempotent per turn —
 * tier changes respect the 24-turn cooldown and only fire on a real change;
 * orders are never duplicated against an already-active order.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP, NPPPersonality } from "@/lib/db/types/npp";
import type { MinisterialOrder } from "@/lib/db/types/ministerialOrder";
import type {
  CabinetPositionMechanics,
  MetricConfig,
  MinisterialOrderConfig,
} from "@/lib/constants/cabinetMechanicsTypes";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { getMinisterialOrders } from "@/lib/constants/cabinetOrders";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  getCabinetSettingsCollection,
  getMinisterialOrdersCollection,
} from "@/lib/db/collections/cabinetSettings";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { SETTING_CHANGE_COOLDOWN_TURNS } from "@/lib/cabinet/settingCooldowns";
import {
  computeMinisterialOrderExpiresTurn,
  expireMinisterialOrders,
  isMinisterialOrderActive,
} from "@/lib/cabinet/ministerialOrderLifecycle";
import type { GoverningAgendaItem } from "./governingAgenda";
import { computeGoverningAgenda } from "./governingAgenda";
import { loadConditionsSignal } from "@/lib/turn/npp/billSponsorship";
import { METRIC_TO_DOMAIN } from "./selectNppBill";
import { deriveGoverningArchetype, governingArchetypeModifiers } from "./governingArchetype";
import { loadDomainHealth } from "./governingMetrics";
import { nppAutonomyAtLeast } from "./featureFlag";

/** Map a position metric to its agenda domain, or null if it has no mapping. */
function domainForMetric(category: string, metricId: string): string | null {
  return METRIC_TO_DOMAIN[category]?.[metricId] ?? null;
}

/**
 * Score how well a lever's effects advance the agenda. Positive = the effects
 * push agenda-relevant metrics in the agenda's desired direction; higher = more
 * aligned. Effects on metrics with no agenda item (or a "hold" item) contribute
 * nothing, so a lever is only ever chosen for genuine agenda progress.
 */
export function scoreLeverAlignment(
  effects: Array<{ metric: string; modifier: number }>,
  positionMetrics: MetricConfig[],
  agendaByDomain: Map<string, GoverningAgendaItem>
): number {
  let score = 0;
  for (const { metric, modifier } of effects) {
    const config = positionMetrics.find((m) => m.metricId === metric);
    if (!config) continue; // inflation-pressure keys & unknowns don't map to a domain
    const domain = domainForMetric(config.category, config.metricId);
    if (!domain) continue;
    const item = agendaByDomain.get(domain);
    if (!item || item.direction === "hold") continue;
    // Desired raw-metric direction: improving a domain's health means raising a
    // higher-is-better metric and lowering a lower-is-better one.
    const desiredSign = (item.direction === "raise" ? 1 : -1) * (config.higherIsBetter ? 1 : -1);
    score += item.priority * modifier * desiredSign;
  }
  return score;
}

/**
 * How many ministerial actions an archetype is willing to spend this turn.
 * Ambitious archetypes (reformer/ideologue) empty the pool; cautious ones
 * (technocrat/steward) keep one action in reserve.
 */
export function actionBudgetForArchetype(
  personality: NPPPersonality,
  actionsAvailable: number
): number {
  const archetype = deriveGoverningArchetype(personality);
  const ambitious = archetype === "reformer" || archetype === "ideologue";
  return ambitious ? actionsAvailable : Math.max(0, actionsAvailable - 1);
}

// ── Reshuffle (V1.4 improvement) ─────────────────────────────────────────────

/** A minister must be at least this far below target to be reshuffle-eligible. */
const MIN_RESHUFFLE_SHORTFALL = 0.3;

/** The agenda domains a position is accountable for (its metrics' domains). */
export function positionDomains(
  mechanics: Pick<CabinetPositionMechanics, "nationalMetrics" | "regionalMetrics">
): Set<string> {
  const out = new Set<string>();
  for (const m of [...mechanics.nationalMetrics, ...mechanics.regionalMetrics]) {
    const domain = domainForMetric(m.category, m.metricId);
    if (domain) out.add(domain);
  }
  return out;
}

/**
 * Worst shortfall in [0,1] across the minister's agenda-relevant "raise"
 * domains: how far below target the weakest one sits. 0 = all met / not on the
 * agenda. Pure.
 */
export function ministerShortfall(
  domains: Set<string>,
  agendaByDomain: Map<string, GoverningAgendaItem>,
  domainHealth: Record<string, number>
): number {
  let worst = 0;
  for (const domain of domains) {
    const item = agendaByDomain.get(domain);
    if (!item || item.direction !== "raise" || item.target <= 0) continue;
    const health = domainHealth[domain];
    if (typeof health !== "number") continue;
    worst = Math.max(worst, Math.min(1, Math.max(0, (item.target - health) / item.target)));
  }
  return worst;
}

/**
 * Whether the head of government reshuffles an underperforming minister. A
 * reshuffle-prone head (high archetype `reshufflePropensity`) acts on a smaller
 * shortfall; a stable one (ideologue/steward) tolerates more. Floored so no one
 * is reshuffled over a small miss. Pure.
 */
export function shouldReshuffleMinister(shortfall: number, reshufflePropensity: number): boolean {
  return shortfall >= MIN_RESHUFFLE_SHORTFALL && shortfall > 1 - reshufflePropensity;
}

export interface MinisterialPlan {
  /** Tier option to set, or null to leave the current tier unchanged. */
  tier: string | null;
  /** Ordered list of order ids to issue this turn (best-aligned first). */
  orderIds: string[];
}

/**
 * Pure per-minister decision: which tier to stand on and which orders to issue
 * to advance the agenda. Deterministic and total.
 */
export function planMinisterialActions(params: {
  agenda: GoverningAgendaItem[];
  mechanics: Pick<CabinetPositionMechanics, "tierSetting" | "nationalMetrics" | "regionalMetrics">;
  orders: MinisterialOrderConfig[];
  personality: NPPPersonality;
  currentTier: string | null;
  activeOrderIds: Set<string>;
  actionsAvailable: number;
  /** Current `domain → health`; items already at/above target are not pursued. */
  domainHealth?: Record<string, number>;
}): MinisterialPlan {
  const {
    agenda,
    mechanics,
    orders,
    personality,
    currentTier,
    activeOrderIds,
    actionsAvailable,
    domainHealth,
  } = params;
  const positionMetrics: MetricConfig[] = [
    ...mechanics.nationalMetrics,
    ...mechanics.regionalMetrics,
  ];
  const agendaByDomain = new Map<string, GoverningAgendaItem>();
  for (const item of agenda) {
    // Target-gating: a minister doesn't spend effort on a "raise" goal whose
    // metric has already reached its target (no overshoot, no wasted actions).
    if (item.direction === "raise" && domainHealth) {
      const health = domainHealth[item.domain];
      if (typeof health === "number" && health >= item.target) continue;
    }
    // Symmetric gate for "lower" goals: once the metric has eased down to (or
    // past) the floor the government was steering toward, stop trimming - the
    // mirror of the raise-side gate above, so a comfort/ideology/distress-
    // driven cut can't autonomously run a domain past its floor turn after
    // turn just because the agenda item is still technically active.
    if (item.direction === "lower" && domainHealth) {
      const health = domainHealth[item.domain];
      if (typeof health === "number" && health <= item.target) continue;
    }
    // Keep the highest-priority item per domain (agenda is already ranked).
    if (!agendaByDomain.has(item.domain)) agendaByDomain.set(item.domain, item);
  }

  // Tier: pick the best-aligned option; only switch if it strictly beats the
  // current tier's alignment (avoids cooldown-burning churn on ties).
  let tier: string | null = null;
  if (mechanics.tierSetting) {
    let best: { id: string; score: number } | null = null;
    for (const option of mechanics.tierSetting.options) {
      const effects = Object.entries(option.effects).map(([metric, modifier]) => ({
        metric,
        modifier,
      }));
      const score = scoreLeverAlignment(effects, positionMetrics, agendaByDomain);
      if (!best || score > best.score) best = { id: option.id, score };
    }
    if (best && best.score > 0 && best.id !== currentTier) tier = best.id;
  }

  // Orders: rank available, agenda-advancing, not-already-active orders; issue
  // the top ones up to the archetype's action budget.
  const budget = Math.min(
    actionsAvailable,
    actionBudgetForArchetype(personality, actionsAvailable)
  );
  const orderIds: string[] = [];
  if (budget > 0) {
    const ranked = orders
      .filter((o) => !activeOrderIds.has(o.id))
      .map((o) => ({
        id: o.id,
        score: scoreLeverAlignment(o.effects, positionMetrics, agendaByDomain),
      }))
      .filter((o) => o.score > 0)
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id < b.id ? -1 : 1));
    for (const o of ranked.slice(0, budget)) orderIds.push(o.id);
  }

  return { tier, orderIds };
}

export interface MinisterialGovernanceResult {
  ran: boolean;
  /** Number of ministers whose tier setting changed this call. */
  tiersSet: number;
  /** Number of ministerial orders issued this call. */
  ordersIssued: number;
  /** Number of underperforming ministers reshuffled (vacated) this call. */
  reshuffled: number;
}

const INACTIVE: MinisterialGovernanceResult = {
  ran: false,
  tiersSet: 0,
  ordersIssued: 0,
  reshuffled: 0,
};

/** The cabinet-member fields a minister needs to act through its levers. */
type ActingMinister = {
  _id: ObjectId;
  positionId: string;
  nppId?: ObjectId;
  ministerialActions?: number;
};

/**
 * Apply one minister's planned levers — tier setting (cooldown-guarded) and
 * action-costed orders — against `agenda`. Shared by the V1 government-wide
 * `runMinisterialGovernance` and the V2.1 player-country `runCaretakerMinisters`
 * so both speak the identical, already-clamped cabinet-effect pipeline; only the
 * agenda each passes differs (government-wide vs. the caretaker's own portfolio).
 * Returns whether a tier was set and how many orders were issued.
 */
async function applyMinisterialPlanForMinister(
  db: Db,
  args: {
    countryId: CountryId;
    minister: ActingMinister;
    mechanics: CabinetPositionMechanics;
    agenda: GoverningAgendaItem[];
    personality: NPPPersonality;
    domainHealth: Record<string, number>;
    currentTurn: number;
    now: Date;
  }
): Promise<{ tierSet: boolean; ordersIssued: number }> {
  const { countryId, minister, mechanics, agenda, personality, domainHealth, currentTurn, now } =
    args;
  if (!minister.nppId) return { tierSet: false, ordersIssued: 0 };

  const settingsCol = getCabinetSettingsCollection(db);
  const ordersCol = getMinisterialOrdersCollection(db);
  const membersCol = getCabinetMembersCollection(db);

  const settingId = `${countryId}_${minister.positionId}`;
  const setting = await settingsCol.findOne({ _id: settingId });
  const activeOrders = await ordersCol
    .find({ countryId, positionId: minister.positionId, active: true })
    .toArray();
  const activeOrderIds = new Set(
    activeOrders.filter((o) => isMinisterialOrderActive(o, currentTurn)).map((o) => o.orderId)
  );

  const plan = planMinisterialActions({
    agenda,
    mechanics,
    orders: getMinisterialOrders(countryId, minister.positionId),
    personality,
    currentTier: setting?.tierSetting ?? null,
    activeOrderIds,
    actionsAvailable: minister.ministerialActions ?? 0,
    domainHealth,
  });

  let tierSet = false;
  // Tier change — respect the 24-turn cooldown, mirroring the settings API.
  const tierCooldownOk =
    setting?.lastChangedTurn === undefined ||
    currentTurn - setting.lastChangedTurn >= SETTING_CHANGE_COOLDOWN_TURNS;
  if (plan.tier && tierCooldownOk) {
    await settingsCol.updateOne(
      { _id: settingId },
      {
        $set: {
          countryId,
          positionId: minister.positionId,
          characterId: null,
          isNPP: true,
          nppId: minister.nppId,
          tierSetting: plan.tier,
          lastChangedTurn: currentTurn,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
    tierSet = true;
  }

  // Orders — spend an action per order, mirroring the order API's spend-guard.
  const positionMetrics = [...mechanics.nationalMetrics, ...mechanics.regionalMetrics];
  const ordersConfig = getMinisterialOrders(countryId, minister.positionId);
  let ordersIssued = 0;
  for (const orderId of plan.orderIds) {
    const config = ordersConfig.find((o) => o.id === orderId);
    if (!config) continue;
    const spend = await membersCol.updateOne(
      { _id: minister._id, ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
    if (spend.modifiedCount === 0) break; // pool exhausted

    const effects = config.effects.map((e) => ({
      metric: resolveMetricPath(e.metric, positionMetrics),
      modifier: e.modifier,
      scope: e.scope,
    }));
    const order: MinisterialOrder = {
      _id: new ObjectId(),
      countryId,
      positionId: minister.positionId,
      characterId: null,
      isNPP: true,
      nppId: minister.nppId,
      orderId: config.id,
      orderName: config.name,
      effects,
      issuedAt: now,
      issuedTurn: currentTurn,
      duration: config.duration,
      expiresTurn: computeMinisterialOrderExpiresTurn(currentTurn, config.duration),
      active: true,
      createdAt: now,
    };
    await ordersCol.insertOne(order);
    ordersIssued++;
  }

  return { tierSet, ordersIssued };
}

/**
 * Run V1.4 ministerial governance for every NPP minister in `countryId`: steer
 * tiers and issue orders that advance the government's agenda.
 */
export async function runMinisterialGovernance(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date
): Promise<MinisterialGovernanceResult> {
  if (!(await nppAutonomyAtLeast(db, countryId, "v1"))) return INACTIVE;

  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov || gov.status !== "formed") return INACTIVE;
  const agenda = gov.governingAgenda?.items ?? [];
  if (agenda.length === 0) return { ran: true, tiersSet: 0, ordersIssued: 0, reshuffled: 0 };

  const membersCol = getCabinetMembersCollection(db);
  let ministers = await membersCol.find({ countryId, isNPP: true }).toArray();
  if (ministers.length === 0) return { ran: true, tiersSet: 0, ordersIssued: 0, reshuffled: 0 };

  // Hydrate the ministers' NPP personalities (drives the per-archetype action
  // budget). Cabinet docs don't denormalise personality, so batch-load them.
  const ministerNppIds = ministers.map((m) => m.nppId).filter((id): id is ObjectId => !!id);
  const nppDocs = await db
    .collection<NPP>("npps")
    .find({ _id: { $in: ministerNppIds } })
    .toArray();
  const personalityByNpp = new Map<string, NPPPersonality>(
    nppDocs.map((n) => [n._id.toString(), n.personality])
  );

  // Current domain health (target-gating + reshuffle), and the highest-priority
  // agenda item per domain for shortfall scoring.
  const domainHealth = await loadDomainHealth(db, countryId);
  const agendaByDomain = new Map<string, GoverningAgendaItem>();
  for (const item of agenda)
    if (!agendaByDomain.has(item.domain)) agendaByDomain.set(item.domain, item);

  // Reshuffle (V1.4 improvement): the head vacates ministers whose briefs are
  // badly missing target, scaled by the head's archetype reshuffle propensity.
  // Vacated seats are refilled by formNppCabinet next turn.
  const headNppId = gov.presidentNppId ?? gov.pmNppId ?? null;
  const headNpp = headNppId ? await db.collection<NPP>("npps").findOne({ _id: headNppId }) : null;
  const reshufflePropensity = headNpp
    ? governingArchetypeModifiers(headNpp.personality).reshufflePropensity
    : 0;

  let reshuffled = 0;
  const survivors: typeof ministers = [];
  for (const minister of ministers) {
    const mechanics = getCabinetMechanics(countryId, minister.positionId);
    const shortfall = mechanics
      ? ministerShortfall(positionDomains(mechanics), agendaByDomain, domainHealth)
      : 0;
    if (mechanics && shouldReshuffleMinister(shortfall, reshufflePropensity)) {
      await membersCol.deleteOne({ countryId, positionId: minister.positionId });
      reshuffled++;
      console.log(
        `[nppAutonomy] ${countryId}: reshuffled ${minister.positionId} (shortfall ${shortfall.toFixed(2)})`
      );
      continue;
    }
    survivors.push(minister);
  }
  ministers = survivors;

  // Expire stale orders once before reading active sets / issuing new ones.
  await expireMinisterialOrders(db, currentTurn);

  let tiersSet = 0;
  let ordersIssued = 0;

  for (const minister of ministers) {
    const mechanics = getCabinetMechanics(countryId, minister.positionId);
    if (!mechanics) continue;
    if (!minister.nppId) continue;

    const personality =
      personalityByNpp.get(minister.nppId.toString()) ??
      ({ loyalty: 50, ambition: 50, stubbornness: 50 } as NPPPersonality);
    const applied = await applyMinisterialPlanForMinister(db, {
      countryId,
      minister,
      mechanics,
      agenda,
      personality,
      domainHealth,
      currentTurn,
      now,
    });
    if (applied.tierSet) tiersSet++;
    ordersIssued += applied.ordersIssued;
  }

  if (tiersSet > 0 || ordersIssued > 0) {
    console.log(
      `[nppAutonomy] ${countryId}: ministerial governance set ${tiersSet} tier(s), issued ${ordersIssued} order(s)`
    );
  }

  return { ran: true, tiersSet, ordersIssued, reshuffled };
}

/**
 * Run V2.1 caretaker ministers in a player-enabled country.
 *
 * A caretaker minister is an NPP a player head-of-government appointed into a
 * single cabinet seat (so the seat carries `isNPP` + `nppId` + a non-null
 * `appointedByCharacterId`). Unlike a V1 NPP government there is no head NPP and
 * no government-wide `governingAgenda` to read — the player runs the country.
 * So each caretaker pursues its **own portfolio agenda**, derived from national
 * conditions + that NPP's ideology/personality (the same pure
 * `computeGoverningAgenda` a head uses, minus crises), and steers only the
 * levers its portfolio actually controls through the identical clamped pipeline.
 *
 * Player-controlled, not autonomous-controlled: caretakers are never reshuffled
 * here (the appointing player dismisses/replaces them via the cabinet surface).
 *
 * Gating: `nppAutonomyAtLeast(v2)` — caretaker ministers are the comingle-tier,
 * player-country surface. A no-op below v2 / in non-player countries.
 */
export async function runCaretakerMinisters(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date
): Promise<MinisterialGovernanceResult> {
  if (!(await nppAutonomyAtLeast(db, countryId, "v2"))) return INACTIVE;

  const membersCol = getCabinetMembersCollection(db);
  // Caretaker seats: NPP-held AND appointed by a human head of government.
  const ministers = (await membersCol.find({ countryId, isNPP: true }).toArray()).filter(
    (m): m is typeof m & { nppId: ObjectId } => !!m.nppId && m.appointedByCharacterId != null
  );
  if (ministers.length === 0) return { ran: true, tiersSet: 0, ordersIssued: 0, reshuffled: 0 };

  // Hydrate each caretaker NPP's personality + ideology (drives its agenda and
  // its per-archetype action budget).
  const ministerNppIds = ministers.map((m) => m.nppId);
  const nppDocs = await db
    .collection<NPP>("npps")
    .find({ _id: { $in: ministerNppIds } })
    .toArray();
  const nppById = new Map(nppDocs.map((n) => [n._id.toString(), n]));

  const domainHealth = await loadDomainHealth(db, countryId);
  const conditions = await loadConditionsSignal(db, countryId);
  await expireMinisterialOrders(db, currentTurn);

  let tiersSet = 0;
  let ordersIssued = 0;
  for (const minister of ministers) {
    const mechanics = getCabinetMechanics(countryId, minister.positionId);
    if (!mechanics) continue;
    const npp = nppById.get(minister.nppId.toString());
    if (!npp) continue;

    // The caretaker's own portfolio agenda: conditions + its ideology, ranked
    // and clamped by its archetype. No crises (no NPP government owns them here).
    const agenda = computeGoverningAgenda({
      conditions,
      ideology: { economic: npp.policies?.economic ?? 0, social: npp.policies?.social ?? 0 },
      personality: npp.personality,
      crises: {},
      currentTurn,
    }).items;

    const applied = await applyMinisterialPlanForMinister(db, {
      countryId,
      minister,
      mechanics,
      agenda,
      personality: npp.personality,
      domainHealth,
      currentTurn,
      now,
    });
    if (applied.tierSet) tiersSet++;
    ordersIssued += applied.ordersIssued;
  }

  if (tiersSet > 0 || ordersIssued > 0) {
    console.log(
      `[nppAutonomy] ${countryId}: caretaker ministers set ${tiersSet} tier(s), issued ${ordersIssued} order(s)`
    );
  }
  return { ran: true, tiersSet, ordersIssued, reshuffled: 0 };
}
