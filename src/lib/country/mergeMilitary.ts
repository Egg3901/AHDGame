/**
 * The absorbed country's armed forces join the survivor's.
 *
 * A merge that carried the chamber, the parties and the players but let the
 * winner's army evaporate would be absurd — and that is what the region sweep
 * does by omission, because none of the military collections are
 * region-scoped. Units are per-doc and simply re-flag; everything else is ONE
 * DOC PER COUNTRY (`findOne({countryId})` is the read contract), so the merge
 * runs through one shared scaffold: read both docs, combine into the survivor
 * (or let the absorbed doc replace it), and never leave two docs behind.
 *
 * WHOSE RULES SURVIVE. Quantities merge (stocks add, pools add, command lists
 * concatenate) but STANCE follows the absorbed side: its doctrine and its
 * reinforcement mode replace the survivor's. The merge direction runs
 * winner-into-shell, so survivor-stance would leave the losing side's military
 * rules governing the winner's army.
 *
 * No currency crosses here — stock lots, manpower and grades are all real
 * quantities, not money.
 *
 * IDEMPOTENT: a re-run finds nothing keyed to the absorbed country.
 */
import type { Collection, Db, Document, UpdateFilter } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NationalArsenal } from "@/lib/db/types/nationalArsenal";
import type { NationalManpower } from "@/lib/db/types/nationalManpower";
import { EMPTY_ARSENAL_STOCK } from "@/lib/db/types/nationalArsenal";
import { blendGrade } from "@/lib/military/arsenal";
import { getMilitaryCommandsCollection } from "@/lib/db/collections/militaryCommands";
import { getMilitaryFormationsCollection } from "@/lib/db/collections/militaryFormations";

export interface MergeMilitaryArgs {
  fromCountryId: CountryId;
  toCountryId: CountryId;
}

export interface MergeMilitaryResult {
  unitsRescoped: number;
  commandsMerged: number;
  arsenalMerged: boolean;
  manpowerMerged: boolean;
}

/**
 * Merge one one-doc-per-country collection across the border.
 *
 * `combine(fromDoc, toDoc)` returns the survivor's update when the two docs
 * merge, or null when the ABSORBED doc replaces the survivor's outright (the
 * stance collections). Absent counterparts always degrade to a plain rescope,
 * and the absorbed doc never survives under its old country — the shared
 * scaffold is what keeps the one-doc contract and the `updatedAt` stamp from
 * drifting between five hand-rolled copies.
 */
async function mergeOneDocPerCountry<T extends Document>(
  coll: Collection<T>,
  fromCountryId: CountryId,
  toCountryId: CountryId,
  now: Date,
  combine: (fromDoc: T, toDoc: T) => UpdateFilter<T> | null
): Promise<T | null> {
  const fromDoc = await coll.findOne({ countryId: fromCountryId } as never);
  if (!fromDoc) return null;
  const toDoc = await coll.findOne({ countryId: toCountryId } as never);

  if (toDoc) {
    const update = combine(fromDoc as T, toDoc as T);
    if (update) {
      const withStamp = {
        ...update,
        $set: { ...(update.$set ?? {}), updatedAt: now },
      } as UpdateFilter<T>;
      await coll.updateOne({ countryId: toCountryId } as never, withStamp);
      await coll.deleteOne({ countryId: fromCountryId } as never);
      return fromDoc as T;
    }
    // Absorbed replaces survivor: drop the survivor's doc, rescope the
    // absorbed one below.
    await coll.deleteOne({ countryId: toCountryId } as never);
  }

  await coll.updateOne(
    { countryId: fromCountryId } as never,
    { $set: { countryId: toCountryId, updatedAt: now } } as unknown as UpdateFilter<T>
  );
  return fromDoc as T;
}

export async function mergeMilitary(db: Db, args: MergeMilitaryArgs): Promise<MergeMilitaryResult> {
  const { fromCountryId, toCountryId } = args;
  const now = new Date();

  // ── Units: per-doc, a countryId flip is the whole move ─────────────────────
  const units = await db
    .collection("militaryUnits")
    .updateMany({ countryId: fromCountryId }, { $set: { countryId: toCountryId, updatedAt: now } });

  // ── Command groups: concatenated. The absorbed commands cover regions the
  //    survivor's never did (they just changed country), so the sets are
  //    disjoint by construction; the read path self-heals any duplicate
  //    commanding general. ──────────────────────────────────────────────────
  const fromCommands = await mergeOneDocPerCountry(
    getMilitaryCommandsCollection(db),
    fromCountryId,
    toCountryId,
    now,
    (fromDoc, toDoc) => ({
      $set: { commands: [...(toDoc.commands ?? []), ...(fromDoc.commands ?? [])] },
    })
  );
  const commandsMerged = fromCommands?.commands?.length ?? 0;

  // ── Formations/org layer: assignments concatenate; on a position-key
  //    collision the survivor's entry wins (its own units were never
  //    repositioned by the merge). ────────────────────────────────────────────
  await mergeOneDocPerCountry(
    getMilitaryFormationsCollection(db),
    fromCountryId,
    toCountryId,
    now,
    (fromDoc, toDoc) => ({
      $set: {
        conflictAssignments: [
          ...(toDoc.conflictAssignments ?? []),
          ...(fromDoc.conflictAssignments ?? []),
        ],
        positions: { ...(fromDoc.positions ?? {}), ...(toDoc.positions ?? {}) },
      },
    })
  );

  // ── Arsenal: stocks add; grade re-blends through the same volume-weighted
  //    mean deliveries use (`blendGrade`, which also clamps corrupted negative
  //    stocks). Two empty stores keep the survivor's grade — the arsenal
  //    contract says a drained store keeps its last grade. ───────────────────
  const fromArsenal = await mergeOneDocPerCountry(
    db.collection<NationalArsenal>("nationalArsenal"),
    fromCountryId,
    toCountryId,
    now,
    (fromDoc, toDoc) => {
      const stock: Record<string, number> = { ...EMPTY_ARSENAL_STOCK, ...toDoc.stock };
      const grade: Record<string, number> = { ...toDoc.grade };
      for (const [domain, fromStock] of Object.entries(fromDoc.stock ?? {})) {
        const toStock = stock[domain] ?? 0;
        const fromGrade = fromDoc.grade?.[domain as keyof NationalArsenal["grade"]] ?? 0;
        const toGrade = grade[domain] ?? 0;
        grade[domain] =
          toStock + fromStock > 0 ? blendGrade(toStock, toGrade, fromStock, fromGrade) : toGrade;
        stock[domain] = Math.max(0, toStock) + Math.max(0, fromStock);
      }
      return { $set: { stock, grade } };
    }
  );

  // ── Manpower: pools add; the ABSORBED side's reinforcement mode governs. ──
  const fromManpower = await mergeOneDocPerCountry(
    db.collection<NationalManpower>("nationalManpower"),
    fromCountryId,
    toCountryId,
    now,
    (fromDoc) => ({
      $inc: { pool: fromDoc.pool ?? 0 },
      ...(fromDoc.mode ? { $set: { mode: fromDoc.mode } } : {}),
    })
  );

  // ── Doctrine: the ABSORBED side's replaces the survivor's outright. ───────
  await mergeOneDocPerCountry(
    db.collection("nationalDoctrine"),
    fromCountryId,
    toCountryId,
    now,
    () => null
  );

  return {
    unitsRescoped: units?.modifiedCount ?? 0,
    commandsMerged,
    arsenalMerged: fromArsenal !== null,
    manpowerMerged: fromManpower !== null,
  };
}
