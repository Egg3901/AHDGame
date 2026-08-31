import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getUnitArchetype } from "@/lib/constants/military";
import { getNationalArsenal, drawLots, returnLots } from "@/lib/db/collections/nationalArsenal";
import { lotsRequired, lotsToRepair, repairOrder } from "@/lib/military/arsenal";
import { FREE_REPAIR_CEILING } from "@/lib/navair/repair";

export interface NavalRepairResult {
  unitsRepaired: number;
  lotsUsed: number;
}

/**
 * Per-turn: buy back hull and airframe condition with materiel from the national arsenal.
 *
 * The paid tier of repair. Free repair, in the naval and air pass, is capped by where a
 * formation is: a home port restores it completely, an allied port most of the way, and
 * holding station well short of full. This is how the rest is bought.
 *
 * Not gated on basing, and once it starts it has no ceiling: a forward hull bought out of
 * the hole is carried all the way back to full without ever going home. That is the whole
 * point of the tier, and what stops it being a mere speed-up on something a fleet would
 * get free anyway by rotating out.
 *
 * It DOES have an entry threshold. Nothing at or above the station ceiling is touched,
 * because free repair reaches that far unaided and a lot buys a single point of condition
 * up there against a hundred at the bottom. Without the threshold this sweep would drain
 * the store on scratches and starve `applyDefenceRefit`, which runs immediately after it.
 *
 * Runs BEFORE `applyDefenceRefit`, which is a change to the established order and a
 * deliberate one: a wreck restored to service is worth far more per lot than topping up a
 * working hull's racks, which `computeEffectivePower` caps at a few percent. When the
 * store is short, the lots should go where they buy the most fighting strength.
 *
 * Naval and air only. No other domain carries `integrity`, so no other domain can be
 * charged for repairing it.
 */
export async function applyNavalRepair(db: Db, countryId: string): Promise<NavalRepairResult> {
  const unitsCol = getMilitaryUnitsCollection(db);
  const units = await unitsCol
    .find({ countryId: countryId as CountryId, domain: { $in: ["naval", "air"] } })
    .toArray();
  if (units.length === 0) return { unitsRepaired: 0, lotsUsed: 0 };

  const arsenal = await getNationalArsenal(db, countryId);
  // Nothing in either store anywhere — skip before touching a single unit.
  if (!(arsenal.stock.naval > 0 || arsenal.stock.air > 0)) {
    return { unitsRepaired: 0, lotsUsed: 0 };
  }

  const ops: AnyBulkWriteOperation<MilitaryUnit>[] = [];
  let lotsUsed = 0;
  /** Lots taken per domain this turn, so a failed write can put them back. */
  const drawnByDomain = new Map<string, number>();

  // Grouped by domain because each draws from its own store: a full aircraft store does
  // not help a wrecked fleet, which is the whole point of a per-domain arsenal.
  const byDomain = new Map<string, MilitaryUnit[]>();
  for (const u of units) {
    if (!byDomain.has(u.domain)) byDomain.set(u.domain, []);
    byDomain.get(u.domain)!.push(u);
  }

  for (const [domain, domainUnits] of byDomain) {
    if ((arsenal.stock[domain as keyof typeof arsenal.stock] ?? 0) <= 0) continue;

    for (const unit of repairOrder(domainUnits)) {
      const archetype = getUnitArchetype(unit.domain, unit.type);
      // An unrecognised archetype has no known materiel requirement; leave it alone rather
      // than guessing one.
      if (!archetype) continue;

      const integrity = unit.integrity ?? 100;

      // Materiel is only spent where free repair cannot reach. Above the station ceiling
      // a formation either mends itself for nothing or is a rounding error away from
      // full, and a lot buys a single point of condition up there against a hundred at
      // the bottom — so an unconditional sweep would drain the store on scratches and
      // starve refit, which runs after this one. Below the ceiling there is no cap: a
      // forward hull bought out of the hole is carried all the way back to full.
      if (integrity >= FREE_REPAIR_CEILING.station) continue;

      const needed = lotsToRepair(unit, lotsRequired(archetype));
      if (needed <= 0) continue;

      const drawn = await drawLots(db, countryId, unit.domain, needed);
      if (drawn <= 0) break; // this domain's store is exhausted

      // Proportional to what was actually drawn, never the full restore. Awarding full
      // condition for a partial draw is the same bug `applyEquipmentLots` exists to avoid
      // on the equipment side: materiel a nation paid for must buy exactly what it bought.
      const restored = ((100 - integrity) * drawn) / needed;

      ops.push({
        updateOne: {
          filter: { _id: unit._id },
          update: { $set: { integrity: Math.min(100, integrity + restored) } },
        },
      });
      lotsUsed += drawn;
      drawnByDomain.set(unit.domain, (drawnByDomain.get(unit.domain) ?? 0) + drawn);
    }
  }

  if (ops.length > 0) {
    try {
      await unitsCol.bulkWrite(ops);
    } catch (error) {
      // Lots are drawn per unit but written in one batch, so a failed write would
      // otherwise destroy every lot taken this turn with nothing issued for them. Put them
      // back before rethrowing — materiel a nation paid for must not evaporate because a
      // write failed.
      for (const [domain, lots] of drawnByDomain) {
        await returnLots(db, countryId, domain as MilitaryUnit["domain"], lots);
      }
      throw error;
    }
  }
  return { unitsRepaired: ops.length, lotsUsed };
}
