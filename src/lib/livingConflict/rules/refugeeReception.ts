/**
 * Humanitarian reception moves actual civilian cohorts between named countries.
 * planRefugeeReceptions preserves age and sex cells, protects serving personnel,
 * shares existing migration caps and prices initial services from realized arrivals.
 */
import type { AgeSexVector } from "@/lib/demographics/cohortVector";
import { totalPopulation } from "@/lib/demographics/cohortVector";
import { transferBilateralCohorts } from "@/lib/demographics/flows/rules/bilateralMigration";

export const REFUGEE_SERVICE_SPENDING_KEY = "refugeeReceptionServices";

export interface RefugeeReceptionSpec {
  originCountryId: string;
  conflictKey: string;
  /** Authored request, bounded again by each region's existing migration cap. */
  hostPopulationShare: number;
  /** Initial annual services in host currency per person, as a share of host GDP/person. */
  annualServiceGdpPerCapitaShare: number;
  serviceDurationTurns: number;
}

export const YUGOSLAV_REFUGEE_RECEPTION: RefugeeReceptionSpec = {
  originCountryId: "YU",
  conflictKey: "yugoslav_dissolution",
  hostPopulationShare: 0.003,
  annualServiceGdpPerCapitaShare: 0.2,
  serviceDurationTurns: 24,
};

export interface RefugeeAdmissionLaw {
  legislationTypeId: string;
  policyOptionIndex?: number;
  enactedAt: number;
}

export interface RefugeeAdmissionAuthorization {
  basis: "humanitarian-response";
  admissionMultiplier: number;
  laws: Array<{ legislationTypeId: string; policyOptionIndex: number }>;
  /** Active displacement is a condition, never a conversion of a pressure score into people. */
  displacementActive?: boolean;
}

/** Seven-option asylum and border catalogs run from open to restrictive. */
export const REFUGEE_ADMISSION_LAW_IDS = [
  "us_border_security_enforcement",
  "uk_immigration_asylum",
  "de_asylum_policy",
  "de_immigration_policy",
  "ie_immigration_asylum",
] as const;

const ADMISSION_BY_OPTION = [1, 1, 0.75, 0.5, 0.25, 0.1, 0] as const;

/** Reserve the modeled conscript stock in its eligible age band, without removing residents. */
export function servingCohortsForReception(
  vector: AgeSexVector,
  band: readonly [number, number],
  servingMale: number,
  servingFemale: number
): AgeSexVector {
  const reserved: AgeSexVector = {
    male: Array<number>(101).fill(0),
    female: Array<number>(101).fill(0),
  };
  if (
    !Number.isInteger(band[0]) ||
    !Number.isInteger(band[1]) ||
    band[0] < 0 ||
    band[1] > 100 ||
    band[0] > band[1]
  )
    throw new Error("Serving cohorts need a valid age band");
  for (const sex of ["male", "female"] as const) {
    const serving = sex === "male" ? servingMale : servingFemale;
    if (!Number.isFinite(serving) || serving < 0)
      throw new Error("Serving personnel must be finite and non-negative");
    const eligible = vector[sex].slice(band[0], band[1] + 1).reduce((sum, cell) => sum + cell, 0);
    const fraction = eligible > 0 ? Math.min(1, serving / eligible) : 0;
    for (let age = band[0]; age <= band[1]; age++) reserved[sex][age] = vector[sex][age] * fraction;
  }
  return reserved;
}

/** The sovereign reception choice supplies permission; enacted restrictions narrow it. */
export function refugeeAdmissionAuthorization(
  laws: readonly RefugeeAdmissionLaw[]
): RefugeeAdmissionAuthorization {
  const latest = new Map<string, RefugeeAdmissionLaw>();
  for (const law of laws) {
    if (!REFUGEE_ADMISSION_LAW_IDS.some((id) => id === law.legislationTypeId)) continue;
    if (!Number.isFinite(law.enactedAt)) throw new Error("Asylum law needs an enactment date");
    const previous = latest.get(law.legislationTypeId);
    if (!previous || law.enactedAt > previous.enactedAt) latest.set(law.legislationTypeId, law);
  }
  const snapshot = [...latest.values()]
    .sort((a, b) => a.legislationTypeId.localeCompare(b.legislationTypeId))
    .map((law) => {
      const index = law.policyOptionIndex;
      if (!Number.isInteger(index) || index === undefined || index < 0 || index > 6)
        throw new Error("Asylum law needs a valid enacted option");
      return { legislationTypeId: law.legislationTypeId, policyOptionIndex: index };
    });
  return {
    basis: "humanitarian-response",
    admissionMultiplier: Math.min(
      1,
      ...snapshot.map((law) => ADMISSION_BY_OPTION[law.policyOptionIndex])
    ),
    laws: snapshot,
  };
}

export interface RefugeeReceptionOrder {
  _id: string;
  worldEpochId: string;
  interactionId: string;
  crisisId: string;
  nodeId: string;
  optionId: string;
  originCountryId: string;
  destinationCountryId: string;
  effectiveTurn: number;
  expiresTurn: number;
  requestedPeople: number;
  annualServiceCostPerPerson: number;
  serviceDurationTurns: number;
  authorization: RefugeeAdmissionAuthorization;
  status: "pending" | "complete";
}

export interface RefugeeReceptionRoute {
  originRegionId: string;
  destinationRegionId: string;
  originCountryId: string;
  destinationCountryId: string;
  people: number;
}

export interface RefugeeReceptionResult {
  _id: string;
  worldEpochId: string;
  interactionId: string;
  crisisId: string;
  originCountryId: string;
  destinationCountryId: string;
  requestedPeople: number;
  movedPeople: number;
  appliedTurn: number;
  serviceEndTurn: number;
  annualServiceCost: number;
  authorization: RefugeeAdmissionAuthorization;
  routes: RefugeeReceptionRoute[];
  reason:
    | "received"
    | "closed-by-law"
    | "no-displacement"
    | "authorization-expired"
    | "no-modeled-route"
    | "capacity-or-cohort-limit";
}

export interface RefugeeRegion {
  regionId: string;
  countryId: string;
  vector: AgeSexVector;
  /** Remaining absolute international allowance after ordinary flows this turn. */
  remainingMigrationCapacity: number;
  servingMaleByAge?: readonly number[];
  servingFemaleByAge?: readonly number[];
}

function assertOrder(order: RefugeeReceptionOrder): void {
  if (
    !order._id ||
    !order.worldEpochId ||
    !order.interactionId ||
    !order.crisisId ||
    !order.originCountryId ||
    !order.destinationCountryId ||
    order.originCountryId === order.destinationCountryId
  )
    throw new Error("Reception order needs distinct sovereign endpoints and an identity");
  for (const value of [order.requestedPeople, order.annualServiceCostPerPerson])
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid reception quantity or cost");
  if (
    !Number.isSafeInteger(order.effectiveTurn) ||
    order.effectiveTurn < 1 ||
    !Number.isSafeInteger(order.expiresTurn) ||
    order.expiresTurn <= order.effectiveTurn ||
    !Number.isSafeInteger(order.serviceDurationTurns) ||
    order.serviceDurationTurns < 1 ||
    order.serviceDurationTurns > 480 ||
    order.authorization.basis !== "humanitarian-response" ||
    !Number.isFinite(order.authorization.admissionMultiplier) ||
    order.authorization.admissionMultiplier < 0 ||
    order.authorization.admissionMultiplier > 1
  )
    throw new Error("Invalid reception turn or authorization");
}

function civilianProfile(region: RefugeeRegion) {
  const profile: AgeSexVector = { male: [], female: [] };
  let civilians = 0;
  for (const sex of ["male", "female"] as const) {
    const serving = sex === "male" ? region.servingMaleByAge : region.servingFemaleByAge;
    profile[sex] = region.vector[sex].map((cell, age) => {
      const active = serving?.[age] ?? 0;
      if (!Number.isFinite(cell) || cell < 0 || !Number.isFinite(active) || active < 0)
        throw new Error("Reception cohorts and serving personnel must be finite and non-negative");
      const civilian = Math.max(0, cell - active);
      civilians += civilian;
      return civilian;
    });
  }
  if (civilians > 0)
    for (const sex of ["male", "female"] as const)
      profile[sex] = profile[sex].map((cell) => cell / civilians);
  return { profile, civilians };
}

/** Deterministic one-shot admissions; unmatched requests create neither people nor services. */
export function planRefugeeReceptions(
  orders: readonly RefugeeReceptionOrder[],
  regions: readonly RefugeeRegion[],
  turn: number,
  worldEpochId: string
) {
  if (!worldEpochId || !Number.isSafeInteger(turn) || turn < 1)
    throw new Error("Reception planning needs a world and turn");
  const work = regions
    .map((region) => {
      if (
        !region.regionId ||
        !region.countryId ||
        !Number.isFinite(region.remainingMigrationCapacity) ||
        region.remainingMigrationCapacity < 0 ||
        region.vector.male.length !== 101 ||
        region.vector.female.length !== 101
      )
        throw new Error("Invalid reception region");
      const copy = {
        ...region,
        vector: { male: [...region.vector.male], female: [...region.vector.female] },
      };
      civilianProfile(copy);
      return copy;
    })
    .sort((a, b) => a.regionId.localeCompare(b.regionId));
  if (
    new Set(work.map((region) => region.regionId)).size !== work.length ||
    new Set(orders.map((order) => order._id)).size !== orders.length
  )
    throw new Error("Reception regions and orders must be unique");
  const results: RefugeeReceptionResult[] = [];
  const netByRegion: Record<string, number> = {};
  for (const order of [...orders].sort((a, b) => a._id.localeCompare(b._id))) {
    assertOrder(order);
    if (order.worldEpochId !== worldEpochId)
      throw new Error("Reception order belongs to another world");
    if (order.status !== "pending" || order.effectiveTurn > turn) continue;
    const origins = work.filter((region) => region.countryId === order.originCountryId);
    const destinations = work.filter((region) => region.countryId === order.destinationCountryId);
    const routes: RefugeeReceptionRoute[] = [];
    const expired = turn >= order.expiresTurn;
    const request =
      expired || order.authorization.displacementActive === false
        ? 0
        : order.requestedPeople * order.authorization.admissionMultiplier;
    let remaining = request;
    for (const origin of origins) {
      for (const destination of destinations) {
        const { profile, civilians } = civilianProfile(origin);
        const count = Math.min(
          remaining,
          civilians,
          origin.remainingMigrationCapacity,
          destination.remainingMigrationCapacity
        );
        if (!(count > 0)) continue;
        const moved = transferBilateralCohorts(origin.vector, destination.vector, count, profile);
        origin.vector = moved.origin;
        destination.vector = moved.destination;
        origin.remainingMigrationCapacity = Math.max(
          0,
          origin.remainingMigrationCapacity - moved.moved
        );
        destination.remainingMigrationCapacity = Math.max(
          0,
          destination.remainingMigrationCapacity - moved.moved
        );
        remaining = Math.max(0, remaining - moved.moved);
        netByRegion[origin.regionId] = (netByRegion[origin.regionId] ?? 0) - moved.moved;
        netByRegion[destination.regionId] = (netByRegion[destination.regionId] ?? 0) + moved.moved;
        routes.push({
          originRegionId: origin.regionId,
          destinationRegionId: destination.regionId,
          originCountryId: origin.countryId,
          destinationCountryId: destination.countryId,
          people: moved.moved,
        });
      }
    }
    const movedPeople = routes.reduce((sum, route) => sum + route.people, 0);
    results.push({
      _id: order._id,
      worldEpochId,
      interactionId: order.interactionId,
      crisisId: order.crisisId,
      originCountryId: order.originCountryId,
      destinationCountryId: order.destinationCountryId,
      requestedPeople: order.requestedPeople,
      movedPeople,
      appliedTurn: turn,
      serviceEndTurn: turn + order.serviceDurationTurns,
      annualServiceCost: movedPeople * order.annualServiceCostPerPerson,
      authorization: structuredClone(order.authorization),
      routes,
      reason:
        movedPeople > 0
          ? "received"
          : expired
            ? "authorization-expired"
            : order.authorization.displacementActive === false
              ? "no-displacement"
              : order.authorization.admissionMultiplier === 0
                ? "closed-by-law"
                : !origins.length || !destinations.length
                  ? "no-modeled-route"
                  : "capacity-or-cohort-limit",
    });
  }
  const before = regions.reduce((sum, region) => sum + totalPopulation(region.vector), 0);
  const after = work.reduce((sum, region) => sum + totalPopulation(region.vector), 0);
  if (Math.abs(before - after) > Math.max(1e-6, before * 1e-12))
    throw new Error("Reception failed population conservation");
  return { regions: work, results, netByRegion };
}

/** Standing services remain payable for admitted residents even after new arrivals close. */
export function refugeeServiceCostsByCountry(
  receptions: readonly RefugeeReceptionResult[],
  worldEpochId: string,
  turn: number
): Record<string, number> {
  const costs: Record<string, number> = {};
  const ids = new Set<string>();
  for (const reception of receptions) {
    if (
      reception.worldEpochId !== worldEpochId ||
      reception.appliedTurn > turn ||
      reception.serviceEndTurn <= turn
    )
      continue;
    if (ids.has(reception._id)) throw new Error("Duplicate refugee service obligation");
    ids.add(reception._id);
    if (!Number.isFinite(reception.annualServiceCost) || reception.annualServiceCost < 0)
      throw new Error("Invalid refugee service obligation");
    costs[reception.destinationCountryId] =
      (costs[reception.destinationCountryId] ?? 0) + reception.annualServiceCost;
  }
  return costs;
}
