/**
 * Crisis pressure for NPP governing agendas. Metric effects mark affected agenda
 * domains, and current effect values plus chained-crisis rungs expose material
 * changes without inventing a generic crisis-severity scale.
 */

import type { CrisisEffect } from "@/lib/db/types/crisis";
import type { CountryId } from "@/lib/constants/countries";

export type MetricDomainMap = Record<string, Record<string, string>>;

export interface CrisisAgendaRecord {
  status: "active" | "resolved";
  scope: "global" | "country" | "region";
  countryIds: string[];
  startTurn: number;
  effects?: CrisisEffect[];
  chain?: { family: string; rung: number };
}

export interface CrisisAgendaIntake {
  /** Domain → severity in [0, 1] for `computeGoverningAgenda`'s crisis input. */
  signals: Record<string, number>;
  /** Latest start turn among contributing crises; drives immediate recompute. */
  latestStartTurn: number;
  /** Current metric effect values and chain rung, serialized by domain. */
  effectFingerprintByDomain: Record<string, string>;
}

/** Crisis-affected domains register at full emergency severity. */
const CRISIS_DOMAIN_SEVERITY = 1;

/**
 * Map metric-targeting effects to agenda domains. Non-metric and unmapped
 * effects do not become agenda pressure.
 */
export function crisisSignalsFromEffects(
  effects: readonly CrisisEffect[],
  metricToDomain: MetricDomainMap
): Record<string, number> {
  const signals: Record<string, number> = {};
  for (const effect of effects) {
    if (effect.targetType !== "metric") continue;
    if (!effect.metricCategory || !effect.metricField) continue;
    const domain = metricToDomain[effect.metricCategory]?.[effect.metricField];
    if (!domain) continue;
    signals[domain] = CRISIS_DOMAIN_SEVERITY;
  }
  return signals;
}

/**
 * Aggregate a bounded, already-loaded crisis cohort into agenda pressure and a
 * deterministic comparison snapshot. This is portable: time, country scope,
 * and the metric vocabulary arrive as data.
 */
export function crisisAgendaSignalsFromCrises(
  crises: readonly CrisisAgendaRecord[],
  countryId: CountryId,
  metricToDomain: MetricDomainMap
): CrisisAgendaIntake {
  const signals: Record<string, number> = {};
  const effectsByDomain: Record<string, string[]> = {};
  let latestStartTurn = 0;

  for (const crisis of crises) {
    if (crisis.status !== "active") continue;
    if (crisis.scope !== "global" && !crisis.countryIds.includes(countryId)) continue;
    const effects = crisis.effects ?? [];
    const crisisSignals = crisisSignalsFromEffects(effects, metricToDomain);
    if (Object.keys(crisisSignals).length === 0) continue;

    for (const [domain, severity] of Object.entries(crisisSignals)) {
      signals[domain] = Math.max(signals[domain] ?? 0, severity);
    }
    for (const effect of effects) {
      if (effect.targetType !== "metric" || !effect.metricCategory || !effect.metricField) continue;
      const domain = metricToDomain[effect.metricCategory]?.[effect.metricField];
      if (!domain) continue;
      const currentEffect = [
        crisis.chain?.family ?? "",
        crisis.chain?.rung ?? 0,
        effect.effectType,
        effect.metricCategory,
        effect.metricField,
        effect.value,
      ];
      (effectsByDomain[domain] ??= []).push(JSON.stringify(currentEffect));
    }
    if (crisis.startTurn > latestStartTurn) latestStartTurn = crisis.startTurn;
  }

  const effectFingerprintByDomain = Object.fromEntries(
    Object.entries(effectsByDomain).map(([domain, effects]) => [domain, effects.sort().join("|")])
  );
  return { signals, latestStartTurn, effectFingerprintByDomain };
}
