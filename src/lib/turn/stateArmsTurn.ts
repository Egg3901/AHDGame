import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getNationalArsenal, depositLots } from "@/lib/db/collections/nationalArsenal";
import { getUnitArchetype } from "@/lib/constants/military";
import { lotsRequired, lotsToFillUnit } from "@/lib/military/arsenal";
import {
  stateArmsLotsPerTurn,
  stateArmsAllocation,
  materielFloor,
  type DomainDemand,
} from "@/lib/military/stateArmsIndustry";

/**
 * The grade state arsenals issue at.
 *
 * Standard, matching what the US store actually holds on the live world (grade 1 across
 * every domain). Planned production is not a shortcut to better kit than a market economy
 * fields; it is a route to ANY kit for a nation that has no contract pipeline. Upgrading
 * a formation's tech tier remains the paid modernisation route either way.
 */
const STATE_ARMS_GRADE = 1;

export interface StateArmsResult {
  lots: number;
  domain: string | null;
}

/**
 * Per-turn: credit a planned-defence economy's arsenal with what its state factories made.
 *
 * Runs BEFORE `applyDefenceRefit` in the turn order, for the same reason delivery does:
 * materiel has to be in the store before it can be issued, or every lot idles a turn.
 *
 * A market economy is not on the roster and gets no rate, but it does get the emergency
 * FLOOR (`materielFloor`): one lot into a domain whose store has reached zero, which
 * switches itself off the moment the store is no longer empty. Without it a nation with
 * no contract pipeline running has no route back from 0/0/0 equipment at all, which is
 * where the United States finished the War for Germany.
 *
 * The arsenal is read BEFORE the roster so the floor stays cheap: a market economy whose
 * stores all hold something cannot reach the floor, and returns on one small document
 * without ever listing its units.
 */
export async function applyStateArmsProduction(
  db: Db,
  countryId: string
): Promise<StateArmsResult> {
  const planned = stateArmsLotsPerTurn(countryId);
  const arsenal = await getNationalArsenal(db, countryId);

  // Nothing to do for a market economy that is not actually out of anything. `stock` always
  // carries all six domains (EMPTY_ARSENAL_STOCK), so this is a complete test.
  if (planned <= 0 && Object.values(arsenal.stock).every((n) => n > 0)) {
    return { lots: 0, domain: null };
  }

  const units = (await getMilitaryUnitsCollection(db)
    .find({ countryId: countryId as CountryId })
    .toArray()) as MilitaryUnit[];
  if (units.length === 0) return { lots: 0, domain: null };

  // What each domain still needs to top its formations up, and the size of one full
  // re-equip of that domain's roster, which is as much as the store may bank.
  const domains: Record<string, DomainDemand> = {};
  for (const u of units) {
    const archetype = getUnitArchetype(u.domain, u.type);
    // An unrecognised archetype has no known materiel requirement; costing it would be a
    // guess, so it neither raises the ceiling nor claims production.
    if (!archetype) continue;
    const full = lotsRequired(archetype);
    const d = (domains[u.domain] ??= {
      need: 0,
      ceiling: 0,
      stock: arsenal.stock[u.domain as keyof typeof arsenal.stock] ?? 0,
    });
    d.need += lotsToFillUnit(u, full);
    d.ceiling += full;
  }

  // Planned production reaches every domain below its ceiling. The floor reaches only the
  // empty ones, which is what stops one lot a turn becoming a second supply line.
  const floor = planned > 0 ? null : materielFloor(countryId, domains);
  const allocation = stateArmsAllocation(
    planned > 0 ? planned : (floor?.lots ?? 0),
    planned > 0 ? domains : (floor?.domains ?? {})
  );
  if (!allocation || allocation.lots <= 0) return { lots: 0, domain: null };

  await depositLots(
    db,
    countryId,
    allocation.domain as Parameters<typeof depositLots>[2],
    allocation.lots,
    STATE_ARMS_GRADE
  );
  return { lots: allocation.lots, domain: allocation.domain };
}
