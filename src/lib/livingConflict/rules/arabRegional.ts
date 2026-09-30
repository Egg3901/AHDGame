import type { LivingConflictState } from "../types";
import {
  ARAB_ORIGINS,
  ARAB_UPRISINGS_KEY,
  applyArabGovernmentChoice,
  applyArabNpcPolicy,
  boundedArab,
  classifyArabOrigin,
  initialArabOrigin,
  pressureOnArabOrigin,
  type ArabOriginId,
  type ArabOriginSignal,
  type ArabRegionalState,
} from "./arabOrigins";

export interface ArabAcceptedResponse {
  countryId: string;
  optionId: string;
}
export const ARAB_HOSTS = ["TR", "JO", "LB", "IQ", "GR", "IT", "DE", "FR", "UK", "SE"];

/** Preserve origin and host identity even when their authorities are not playable. */
export function advanceArabRegion(
  previous: ArabRegionalState | undefined,
  signals: readonly ArabOriginSignal[],
  hostPopulations: Readonly<Record<string, number>>,
  turn: number
): ArabRegionalState {
  if (previous?.lastPressureTurn === turn) return previous;
  const next: ArabRegionalState = {
    origins: { ...previous?.origins },
    hosts: { ...previous?.hosts },
    resolutionIds: previous?.resolutionIds ?? [],
    lastPressureTurn: turn,
  };
  for (const [id, population] of Object.entries(hostPopulations)) {
    if (population > 0 && ARAB_HOSTS.includes(id))
      next.hosts[id] = { protection: 0, refugeePeople: 0, ...next.hosts[id], population };
  }
  const regionalMobilization = Math.max(
    0,
    ...Object.values(next.origins).map((origin) => origin?.mobilization ?? 0)
  );
  for (const signal of signals) {
    if (!ARAB_ORIGINS.includes(signal.countryId as ArabOriginId)) continue;
    const id = signal.countryId as ArabOriginId;
    const prior = next.origins[id];
    next.origins[id] =
      prior && turn % 12 === 0
        ? pressureOnArabOrigin(prior, signal, regionalMobilization)
        : (prior ?? initialArabOrigin(signal));
    next.origins[id] = applyArabNpcPolicy(next.origins[id]!, signal, turn);
  }
  return allocateArabRefugees(next);
}

/** Half of displacement crosses borders; the rest remains internally displaced.
 * Numbers represent exposure, never an extra population stock. Hosting weights
 * use actual host population and accepted protection, then conserve the total. */
export function allocateArabRefugees(state: ArabRegionalState): ArabRegionalState {
  const refugees = Object.values(state.origins).reduce(
    (sum, origin) => sum + (origin ? ((origin.population * origin.displacement) / 1000) * 0.5 : 0),
    0
  );
  const weights = Object.entries(state.hosts).map(
    ([id, host]) =>
      [
        id,
        host.population *
          (["TR", "JO", "LB", "IQ"].includes(id) ? 4 : 1) *
          (1 + host.protection / 100),
      ] as const
  );
  const weight = weights.reduce((sum, [, value]) => sum + value, 0);
  return {
    ...state,
    hosts: Object.fromEntries(
      weights.map(([id, value]) => [
        id,
        { ...state.hosts[id], refugeePeople: weight > 0 ? (refugees * value) / weight : 0 },
      ])
    ),
  };
}

/** One durable regional result per response window. Missing governments keep
 * their current policy; foreign mediation cannot manufacture domestic reform. */
export function resolveArabRegion(
  previous: ArabRegionalState,
  responses: readonly ArabAcceptedResponse[],
  resolutionId: string
): ArabRegionalState {
  if (previous.resolutionIds.includes(resolutionId)) return previous;
  const next: ArabRegionalState = {
    ...previous,
    origins: { ...previous.origins },
    hosts: { ...previous.hosts },
    resolutionIds: [...previous.resolutionIds, resolutionId],
  };
  for (const response of responses) {
    const originId = response.countryId as ArabOriginId;
    const origin = next.origins[originId];
    if (origin) next.origins[originId] = applyArabGovernmentChoice(origin, response.optionId);
    const host = next.hosts[response.countryId];
    if (host && ["host_refugees", "share_refugees", "close_border"].includes(response.optionId)) {
      next.hosts[response.countryId] = {
        ...host,
        protection: boundedArab(
          host.protection + (response.optionId === "close_border" ? -20 : 20)
        ),
      };
    }
  }
  // External armed support follows the most fragmented repressive origin. It
  // cannot turn five independent countries into the same civil war.
  const target = Object.entries(next.origins)
    .filter(([, origin]) => origin && origin.repression >= 55)
    .sort((a, b) => (a[1]?.cohesion ?? 100) - (b[1]?.cohesion ?? 100))[0];
  if (target?.[1]) {
    const origin = { ...target[1] };
    for (const { optionId } of responses) {
      if (["sanction", "bloc_sanctions"].includes(optionId))
        origin.sanctions = boundedArab(origin.sanctions + 15);
      if (["arm_opposition", "protect", "support_state"].includes(optionId)) {
        origin.outsideSupport = boundedArab(origin.outsideSupport + 12);
        origin.opposition = boundedArab(
          origin.opposition + (optionId === "support_state" ? 3 : 12)
        );
        origin.cohesion = boundedArab(origin.cohesion - (optionId === "support_state" ? 0 : 4));
      }
    }
    origin.trajectory = classifyArabOrigin(origin);
    next.origins[target[0] as ArabOriginId] = origin;
  }
  const diplomacy = responses.filter(({ optionId }) =>
    ["mediate_west", "contact_group", "un_talks"].includes(optionId)
  ).length;
  const aid = responses.filter(({ optionId }) =>
    ["host_refugees", "share_refugees", "un_relief"].includes(optionId)
  ).length;
  for (const id of ARAB_ORIGINS) {
    const origin = next.origins[id];
    if (!origin) continue;
    const updated = { ...origin, civilianStrain: boundedArab(origin.civilianStrain - aid * 2) };
    if (["civil_war", "frozen"].includes(origin.trajectory)) {
      updated.settlement = boundedArab(origin.settlement + diplomacy * 5);
      updated.opposition = boundedArab(origin.opposition - diplomacy * 2);
    }
    updated.trajectory = classifyArabOrigin(updated);
    next.origins[id] = updated;
  }
  return allocateArabRefugees(next);
}

export function arabEconomicTarget(conflict: LivingConflictState, countryId: string) {
  const zero = { displacedShare: 0, hostingShare: 0, infrastructureDamage: 0 };
  if (conflict.defKey !== ARAB_UPRISINGS_KEY || !conflict.hasOpened || conflict.status === "closed")
    return zero;
  const origin = conflict.arabRegional?.origins[countryId as ArabOriginId];
  if (origin)
    return {
      ...zero,
      displacedShare: origin.displacement / 1000,
      infrastructureDamage: origin.infrastructureDamage / 100,
    };
  const host = conflict.arabRegional?.hosts[countryId];
  return host ? { ...zero, hostingShare: host.refugeePeople / host.population } : zero;
}

/** Targeted restrictions reduce the background sovereign's exposed output,
 * capped at five percent; food, population and treasury stocks are untouched. */
export function arabTradeMultiplier(
  conflict: LivingConflictState | undefined,
  countryId: string
): number {
  if (!conflict?.hasOpened || conflict.status === "closed") return 1;
  return (
    1 -
    boundedArab(conflict.arabRegional?.origins[countryId as ArabOriginId]?.sanctions ?? 0) / 2000
  );
}
export function arabExtremistSpillover(conflict: LivingConflictState | null): number {
  if (!conflict?.hasOpened || conflict.status === "closed") return 0;
  return Math.max(
    0,
    ...Object.values(conflict.arabRegional?.origins ?? {}).map((origin) =>
      origin ? (origin.extremistSpace * origin.opposition) / 500 : 0
    )
  );
}
