/**
 * Media regulation changes how much advertising a private outlet can deliver.
 * Censorship and ownership laws limit audience access before clearing. The
 * ownership limit caps each owner's delivery at a share of the state's
 * advertising audience.
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

/**
 * Convert the sector clearing snapshot into actual current-turn audience
 * delivery. Political allocations are already reflected in the sector's sold
 * units, so remove every planned unit and restore only seller receipts that
 * were durably applied. Unsettled plans never count as reach.
 */
export function currentTurnDeliveredAdvertisingUnits(input: {
  snapshotTurn: number | null | undefined;
  currentTurn: number | null | undefined;
  physicalSoldUnits: number | null | undefined;
  plannedPoliticalUnits: number;
  settledPoliticalUnits: number;
}): number | null {
  const {
    snapshotTurn,
    currentTurn,
    physicalSoldUnits,
    plannedPoliticalUnits,
    settledPoliticalUnits,
  } = input;
  if (
    !Number.isSafeInteger(snapshotTurn) ||
    !Number.isSafeInteger(currentTurn) ||
    snapshotTurn !== currentTurn ||
    typeof physicalSoldUnits !== "number" ||
    !Number.isFinite(physicalSoldUnits) ||
    physicalSoldUnits < 0 ||
    !Number.isFinite(plannedPoliticalUnits) ||
    plannedPoliticalUnits < 0 ||
    !Number.isFinite(settledPoliticalUnits) ||
    settledPoliticalUnits < 0
  )
    return null;

  return (
    Math.max(0, physicalSoldUnits - plannedPoliticalUnits) +
    Math.min(plannedPoliticalUnits, settledPoliticalUnits)
  );
}

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

export interface MediaOwnershipMarket {
  shareCap: number;
  stateBySector: ReadonlyMap<string, string>;
  corporationBySector: ReadonlyMap<string, string>;
  /** Lagged advertising demand by state, from the commodity ledger. */
  demandByState?: ReadonlyMap<string, number>;
  /**
   * Filled by clearing with each owner's audience limit in units, keyed
   * `${stateId}:${corporationId}`, so later political delivery uses the same
   * ceiling as commercial delivery.
   */
  limitUnitsByOwner?: Map<string, number>;
}

/**
 * Bound each owner's delivered advertising in a state by a share of that
 * state's advertising audience. The audience is the larger of the state's own
 * lagged advertising demand and the clearing-book demand its regulated outlets
 * competed for (`demandUnits`, each seller's slice of its book's demand).
 * Advertising clears in a reachable book, so a state's outlets can serve far
 * more buyers than sit in the state; the ledger state demand alone reads zero
 * in states with no local ad buyers. The limit is measured against demand,
 * not against what competitors delivered, so a sole or dominant broadcaster
 * can serve up to the cap share of its audience. Delivery is reduced, never
 * invented or moved between owners.
 */
export function capDeliveredMediaUnits(
  rows: readonly {
    sectorId: string;
    stateId: string;
    corporationId: string;
    units: number;
    demandUnits?: number;
  }[],
  shareCap: number,
  demandByState?: ReadonlyMap<string, number>,
  limitUnitsByOwnerOut?: Map<string, number>
): Map<string, number> {
  const safeUnits = (units: number | undefined) =>
    typeof units === "number" && Number.isFinite(units) ? Math.max(0, units) : 0;
  const result = new Map(rows.map((row) => [row.sectorId, safeUnits(row.units)]));
  if (!Number.isFinite(shareCap) || shareCap <= 0 || shareCap >= 1) return result;
  const bookDemandByState = new Map<string, number>();
  const unitsByOwner = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.stateId}:${row.corporationId}`;
    unitsByOwner.set(key, (unitsByOwner.get(key) ?? 0) + safeUnits(row.units));
    bookDemandByState.set(
      row.stateId,
      (bookDemandByState.get(row.stateId) ?? 0) + safeUnits(row.demandUnits)
    );
  }
  const scales = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.stateId}:${row.corporationId}`;
    if (scales.has(key)) continue;
    const audience = Math.max(
      safeUnits(demandByState?.get(row.stateId)),
      bookDemandByState.get(row.stateId) ?? 0
    );
    const limit = shareCap * audience;
    limitUnitsByOwnerOut?.set(key, limit);
    const units = unitsByOwner.get(key) ?? 0;
    scales.set(key, units > 0 ? Math.min(1, limit / units) : 0);
  }
  for (const row of rows)
    result.set(
      row.sectorId,
      safeUnits(row.units) * (scales.get(`${row.stateId}:${row.corporationId}`) ?? 0)
    );
  return result;
}

/**
 * Additional political delivery cannot depend on another unpaid seller. This
 * bound remains valid even when every other political receipt is interrupted.
 */
export function mediaPoliticalResidualLimit(
  ownerCommercialUnits: number,
  stateCommercialUnits: number,
  shareCap: number
): number {
  if (!Number.isFinite(shareCap) || shareCap <= 0 || shareCap >= 1) return Infinity;
  return Math.max(0, (shareCap * stateCommercialUnits - ownerCommercialUnits) / (1 - shareCap));
}
