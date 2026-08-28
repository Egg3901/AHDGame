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
 * Countries not on the roster return without a read beyond their own units, so this costs
 * a market economy nothing.
 */
export async function applyStateArmsProduction(
  db: Db,
  countryId: string
): Promise<StateArmsResult> {
  const lotsPerTurn = stateArmsLotsPerTurn(countryId);
  if (lotsPerTurn <= 0) return { lots: 0, domain: null };

  const units = (await getMilitaryUnitsCollection(db)
    .find({ countryId: countryId as CountryId })
    .toArray()) as MilitaryUnit[];
  if (units.length === 0) return { lots: 0, domain: null };

  const arsenal = await getNationalArsenal(db, countryId);

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

  const allocation = stateArmsAllocation(lotsPerTurn, domains);
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
