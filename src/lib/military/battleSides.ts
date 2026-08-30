import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { BattleSide } from "@/lib/military/battle";
import type { Front } from "@/lib/military/combat";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { getNationalDoctrine } from "@/lib/db/collections/nationalDoctrine";
import { loadGeneralsById } from "@/lib/db/collections/characterGenerals";
import { natMods } from "@/lib/military/doctrineTree";
import { countryScale } from "@/lib/military/force";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { logisticsCoverageByRegion } from "@/lib/military/calc";

/**
 * Assemble a nation's battle side from live data. Shared by the turn resolver and the
 * war-room forecast so a projection is built from exactly the same inputs the
 * resolution will use.
 *
 * `conflictSupply` is this side's supply at the conflict being fought; the callers
 * that hold the ConflictDoc resolve it, so this module — and the battle math it feeds
 * — never learns what a conflict is. Omit it to fight at neutral supply.
 *
 * `side` is which end of the conflict this contingent fights on, resolved by the same
 * callers. Only report naming reads it; omit it and the enemy is named generically.
 */
export async function buildBattleSide(
  db: Db,
  country: string,
  units: MilitaryUnit[],
  fronts: Record<string, Front>,
  conflictSupply?: number,
  side?: "A" | "B"
): Promise<BattleSide> {
  const [org, doctrine, generalsById, commands] = await Promise.all([
    getMilitaryFormations(db, country),
    getNationalDoctrine(db, country),
    // Authoritative stats, straight from characterGenerals — never client input.
    loadGeneralsById(db, country),
    getMilitaryCommands(db, country),
  ]);
  const unitsById = Object.fromEntries(units.map((unit) => [String(unit._id), unit]));
  return {
    units,
    assignments: org.conflictAssignments,
    generalsById,
    positions: org.positions,
    natMods: natMods(doctrine.adopted),
    countryScale: countryScale(country),
    side,
    country,
    fronts,
    conflictSupply,
    logisticsCoverageByRegion: logisticsCoverageByRegion(commands, unitsById),
  };
}

/**
 * One contingent per country, in the order given so the principal leads.
 *
 * A country with no units still gets a contingent: a declared ally whose army is
 * posted elsewhere belongs on the roster, and dropping it here would silently
 * disagree with the belligerent list written into the battle report.
 *
 * `conflictSupply` and `side` are both per-SIDE figures, so every contingent in the
 * coalition receives the same ones.
 */
export async function buildCoalitionSide(
  db: Db,
  countries: string[],
  unitsByCountry: Map<string, MilitaryUnit[]>,
  fronts: Record<string, Front>,
  conflictSupply?: number,
  side?: "A" | "B"
): Promise<BattleSide[]> {
  return Promise.all(
    countries.map((c) =>
      buildBattleSide(db, c, unitsByCountry.get(c) ?? [], fronts, conflictSupply, side)
    )
  );
}
