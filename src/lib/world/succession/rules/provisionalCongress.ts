/**
 * A negotiated Soviet split keeps deputies from retained Russian territory as
 * a provisional Congress. Its mandate has the capacity of those live regions,
 * with vacancies preserved and a simple majority for government formation.
 */
export interface ProvisionalCongressRegion {
  stateId: string;
  seats: number;
}

export interface ProvisionalCongressOfficial {
  id: string;
  officeType: string;
  stateId?: string;
  party?: string;
  seatsHeld?: number;
  characterId?: string;
  nppId?: string;
}

export function planProvisionalRussianCongress(
  regions: readonly ProvisionalCongressRegion[],
  officials: readonly ProvisionalCongressOfficial[]
) {
  const capacities = new Map<string, number>();
  for (const region of regions) {
    if (
      !region.stateId ||
      capacities.has(region.stateId) ||
      !Number.isSafeInteger(region.seats) ||
      region.seats < 0
    ) {
      throw new Error(
        "Provisional Congress requires distinct retained regions and valid seat capacities"
      );
    }
    capacities.set(region.stateId, region.seats);
  }
  const totalSeats = regions.reduce((sum, region) => sum + region.seats, 0);
  if (!Number.isSafeInteger(totalSeats) || totalSeats < 1) {
    throw new Error("Provisional Congress requires a positive retained seat capacity");
  }
  const ids = new Set<string>();
  const occupied = new Map<string, number>();
  const playerMandates = new Set<string>();
  const seatsByParty: Record<string, number> = {};
  const retained: ProvisionalCongressOfficial[] = [];
  const retired: ProvisionalCongressOfficial[] = [];
  for (const official of officials) {
    if (!official.id || ids.has(official.id))
      throw new Error("Provisional Congress has duplicate office records");
    ids.add(official.id);
    if (
      official.officeType !== "unionCongressDeputy" ||
      !official.stateId ||
      !capacities.has(official.stateId)
    ) {
      retired.push(official);
      continue;
    }
    const weight = official.seatsHeld ?? 1;
    if (!Number.isSafeInteger(weight) || weight < 1)
      throw new Error("Provisional Congress has an invalid deputy weight");
    if (!official.characterId && !official.nppId) {
      retired.push(official);
      continue;
    }
    if (official.characterId && weight !== 1) {
      throw new Error("A retained player deputy can hold only one seat");
    }
    if (official.characterId) {
      if (official.nppId || playerMandates.has(official.characterId))
        throw new Error("A retained player must have one distinct deputy mandate");
      playerMandates.add(official.characterId);
    }
    const filled = (occupied.get(official.stateId) ?? 0) + weight;
    if (filled > capacities.get(official.stateId)!)
      throw new Error("Retained deputies exceed their live constituency capacity");
    occupied.set(official.stateId, filled);
    if (official.party) {
      // Party keys are identifiers, never object-prototype setters.
      Object.defineProperty(seatsByParty, official.party, {
        value:
          (Object.hasOwn(seatsByParty, official.party) ? seatsByParty[official.party] : 0) + weight,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    retained.push(official);
  }
  const occupiedSeats = [...occupied.values()].reduce((sum, seats) => sum + seats, 0);
  return {
    retained,
    retired,
    totalSeats,
    occupiedSeats,
    vacantSeats: totalSeats - occupiedSeats,
    majorityThreshold: Math.floor(totalSeats / 2) + 1,
    seatsByParty,
  };
}
