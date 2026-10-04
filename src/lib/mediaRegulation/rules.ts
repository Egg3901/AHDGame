/**
 * Media regulation changes how much advertising a private outlet can deliver.
 * Censorship and ownership laws limit audience access before clearing. The
 * ownership limit is measured against the prior audience budget, not the
 * smaller post-limit delivery total.
 */

export interface MediaOutletDelivery {
  stateId: string;
  countryId: string;
  corporationId: string;
  deliveredAdvertisingUnits: number | null;
}

export interface MediaStateRegulation {
  pressFreedom?: number | null;
  stateMediaControl?: number | null;
}

/** Ownership limits represented by the seven `us_media_communications` options. */
export const MEDIA_AUDIENCE_ACCESS_LIMIT_BY_OPTION: readonly (number | null)[] = [
  0.35,
  0.45,
  0.55,
  0.65,
  0.75,
  null,
  null,
];
export const MEDIA_CONCENTRATION_BILL_TRIGGER = 0.65;

/** The Fairness Doctrine applied to US broadcast media through its 1987 repeal. */
export function isFairnessDoctrineInEffect(
  currentYear: number | null | undefined,
  policyOptionIndex: number
): boolean {
  return (
    typeof currentYear === "number" &&
    Number.isFinite(currentYear) &&
    currentYear >= 1953 &&
    currentYear <= 1986 &&
    Number.isInteger(policyOptionIndex) &&
    policyOptionIndex >= 0 &&
    policyOptionIndex <= 2
  );
}

/**
 * Broadcast outlets covered by the historical Fairness Doctrine. Legacy data
 * only identifies `legacy_broadcast` explicitly, so ambiguous `standard`
 * newspaper and publishing rows remain outside the doctrine.
 */
export function isFairnessDoctrineBroadcastOutlet(sectorType: string, strategyId: string): boolean {
  if (sectorType !== "media") return false;
  return (
    strategyId === "legacy_broadcast" ||
    strategyId === "radio_network" ||
    strategyId === "broadcast_tv" ||
    strategyId === "cable_tv"
  );
}

function metric(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : fallback;
}

/**
 * Censorship reduces the private press's available audience using existing
 * state values. Open press keeps full reach; the most restrictive inputs retain
 * half of the addressable audience instead of making private outlets inert.
 */
export function censorshipReachAvailability(state: MediaStateRegulation): number {
  const freedom = metric(state.pressFreedom, 100);
  const control = metric(state.stateMediaControl, 0);
  const stateDirectedShare = Math.max(0, control - 50) / 100;
  const effectiveFreedom = freedom * (1 - stateDirectedShare);
  return 0.5 + 0.5 * (effectiveFreedom / 100);
}

/**
 * Limit each owner's audience access against the state's measured prior-turn
 * delivered advertising budget. This does not claim to instantly divest
 * ownership or guarantee a share of the smaller post-limit delivered total.
 * Incomplete state history fails open rather than inventing concentration.
 */
export function mediaAudienceAccessLimitUnitsByOutlet(
  outlets: readonly MediaOutletDelivery[],
  policyOptionIndex: number
): Map<string, number> {
  const cap = MEDIA_AUDIENCE_ACCESS_LIMIT_BY_OPTION[policyOptionIndex];
  const limitUnitsByOutlet = new Map<string, number>();
  if (cap == null || !Number.isInteger(policyOptionIndex) || policyOptionIndex < 0) {
    return limitUnitsByOutlet;
  }

  const deliveredByState = new Map<string, Map<string, number>>();
  const incompleteStates = new Set<string>();
  for (const outlet of outlets) {
    if (
      outlet.deliveredAdvertisingUnits == null ||
      !Number.isFinite(outlet.deliveredAdvertisingUnits) ||
      outlet.deliveredAdvertisingUnits < 0
    ) {
      incompleteStates.add(outlet.stateId);
      continue;
    }
    const byCorporation = deliveredByState.get(outlet.stateId) ?? new Map<string, number>();
    byCorporation.set(
      outlet.corporationId,
      (byCorporation.get(outlet.corporationId) ?? 0) + outlet.deliveredAdvertisingUnits
    );
    deliveredByState.set(outlet.stateId, byCorporation);
  }

  for (const [stateId, byCorporation] of deliveredByState) {
    if (incompleteStates.has(stateId)) continue;
    const total = [...byCorporation.values()].reduce((sum, units) => sum + units, 0);
    if (!(total > 0)) continue;
    for (const [corporationId, units] of byCorporation) {
      const share = units / total;
      if (share > cap) limitUnitsByOutlet.set(`${stateId}:${corporationId}`, cap * total);
    }
  }
  return limitUnitsByOutlet;
}

/** The federal ownership bill is offered after measured national US share crosses 65%. */
export function isMediaOwnershipBillAvailable(outlets: readonly MediaOutletDelivery[]): boolean {
  const deliveredByCountry = new Map<string, Map<string, number>>();
  const incompleteCountries = new Set<string>();
  for (const outlet of outlets) {
    if (outlet.countryId !== "US") continue;
    if (
      outlet.deliveredAdvertisingUnits == null ||
      !Number.isFinite(outlet.deliveredAdvertisingUnits) ||
      outlet.deliveredAdvertisingUnits < 0
    ) {
      incompleteCountries.add(outlet.countryId);
      continue;
    }
    const byCorporation = deliveredByCountry.get(outlet.countryId) ?? new Map<string, number>();
    byCorporation.set(
      outlet.corporationId,
      (byCorporation.get(outlet.corporationId) ?? 0) + outlet.deliveredAdvertisingUnits
    );
    deliveredByCountry.set(outlet.countryId, byCorporation);
  }
  for (const [countryId, byCorporation] of deliveredByCountry) {
    if (incompleteCountries.has(countryId)) continue;
    const total = [...byCorporation.values()].reduce((sum, units) => sum + units, 0);
    if (!(total > 0)) continue;
    const largestShare = Math.max(...byCorporation.values()) / total;
    if (largestShare > MEDIA_CONCENTRATION_BILL_TRIGGER) return true;
  }
  return false;
}
