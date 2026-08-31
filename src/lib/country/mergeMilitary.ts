/**
 * The absorbed country's armed forces join the survivor's.
 *
 * A merge that carried the chamber, the parties and the players but let the
 * winner's army evaporate would be absurd — and that is what the region sweep
 * does by omission, because none of the military collections are
 * region-scoped. Units are per-doc and simply re-flag; the org layer
 * (`militaryCommands`, `militaryFormations`) is ONE DOC PER COUNTRY whose
 * `findOne({countryId})` contract forbids a second doc, so absorbed contents
 * merge into the survivor's doc and the absorbed doc is deleted; the national
 * stores (`nationalArsenal`, `nationalManpower`) merge quantitatively.
 *
 * No currency crosses here — stock lots, manpower and grades are all
 * real quantities, not money.
 *
 * IDEMPOTENT: a re-run finds nothing keyed to the absorbed country.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NationalArsenal } from "@/lib/db/types/nationalArsenal";
import type { NationalManpower } from "@/lib/db/types/nationalManpower";
import { EMPTY_ARSENAL_STOCK } from "@/lib/db/types/nationalArsenal";

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

export async function mergeMilitary(db: Db, args: MergeMilitaryArgs): Promise<MergeMilitaryResult> {
  const { fromCountryId, toCountryId } = args;
  const now = new Date();

  // ── Units: per-doc, a countryId flip is the whole move ─────────────────────
  const units = await db
    .collection("militaryUnits")
    .updateMany({ countryId: fromCountryId }, { $set: { countryId: toCountryId, updatedAt: now } });

  // ── Command groups: one doc per country, so contents merge ────────────────
  const commandsColl = db.collection("militaryCommands");
  const fromCommands = (await commandsColl.findOne({ countryId: fromCountryId })) as {
    commands?: unknown[];
  } | null;
  let commandsMerged = 0;
  if (fromCommands?.commands?.length) {
    const toCommands = (await commandsColl.findOne({ countryId: toCountryId })) as {
      commands?: unknown[];
    } | null;
    if (toCommands) {
      // Appended, not replaced: the absorbed commands cover regions the
      // survivor's commands never did (they just changed country), so the two
      // sets are disjoint by construction. The read path self-heals any
      // duplicate commanding general.
      await commandsColl.updateOne(
        { countryId: toCountryId },
        {
          $set: {
            commands: [...(toCommands.commands ?? []), ...fromCommands.commands],
            updatedAt: now,
          },
        }
      );
      await commandsColl.deleteOne({ countryId: fromCountryId });
    } else {
      await commandsColl.updateOne(
        { countryId: fromCountryId },
        { $set: { countryId: toCountryId, updatedAt: now } }
      );
    }
    commandsMerged = fromCommands.commands.length;
  } else if (fromCommands) {
    await commandsColl.deleteOne({ countryId: fromCountryId });
  }

  // ── Formations/org layer: same one-doc contract ───────────────────────────
  const formationsColl = db.collection("militaryFormations");
  const fromFormations = (await formationsColl.findOne({ countryId: fromCountryId })) as {
    conflictAssignments?: unknown[];
    positions?: Record<string, string>;
  } | null;
  if (fromFormations) {
    const toFormations = (await formationsColl.findOne({ countryId: toCountryId })) as {
      conflictAssignments?: unknown[];
      positions?: Record<string, string>;
    } | null;
    if (toFormations) {
      await formationsColl.updateOne(
        { countryId: toCountryId },
        {
          $set: {
            conflictAssignments: [
              ...(toFormations.conflictAssignments ?? []),
              ...(fromFormations.conflictAssignments ?? []),
            ],
            // Survivor entries win a key collision: its own units were never
            // repositioned by the merge.
            positions: { ...(fromFormations.positions ?? {}), ...(toFormations.positions ?? {}) },
            updatedAt: now,
          },
        }
      );
      await formationsColl.deleteOne({ countryId: fromCountryId });
    } else {
      await formationsColl.updateOne(
        { countryId: fromCountryId },
        { $set: { countryId: toCountryId, updatedAt: now } }
      );
    }
  }

  // ── Arsenal: stocks add; grade is a volume-weighted mean, so it re-weights ─
  const arsenalColl = db.collection<NationalArsenal>("nationalArsenal");
  const fromArsenal = await arsenalColl.findOne({ countryId: fromCountryId });
  let arsenalMerged = false;
  if (fromArsenal) {
    const toArsenal = await arsenalColl.findOne({ countryId: toCountryId });
    if (toArsenal) {
      const stock: Record<string, number> = { ...EMPTY_ARSENAL_STOCK, ...toArsenal.stock };
      const grade: Record<string, number> = { ...toArsenal.grade };
      for (const [domain, fromStock] of Object.entries(fromArsenal.stock ?? {})) {
        const toStock = stock[domain] ?? 0;
        const fromGrade = fromArsenal.grade?.[domain as keyof NationalArsenal["grade"]] ?? 0;
        const toGrade = grade[domain] ?? 0;
        const combined = toStock + fromStock;
        // Weighted by lots so a big low-grade stock cannot inherit a tiny
        // high-grade one's tier. Empty stores keep the survivor's grade.
        grade[domain] =
          combined > 0 ? (toGrade * toStock + fromGrade * fromStock) / combined : toGrade;
        stock[domain] = combined;
      }
      await arsenalColl.updateOne(
        { countryId: toCountryId },
        { $set: { stock, grade, updatedAt: now } }
      );
      await arsenalColl.deleteOne({ countryId: fromCountryId });
    } else {
      await arsenalColl.updateOne(
        { countryId: fromCountryId },
        { $set: { countryId: toCountryId, updatedAt: now } }
      );
    }
    arsenalMerged = true;
  }

  // ── Manpower: pools add; the survivor keeps its own reinforcement mode ────
  const manpowerColl = db.collection<NationalManpower>("nationalManpower");
  const fromManpower = await manpowerColl.findOne({ countryId: fromCountryId });
  let manpowerMerged = false;
  if (fromManpower) {
    const toManpower = await manpowerColl.findOne({ countryId: toCountryId });
    if (toManpower) {
      await manpowerColl.updateOne(
        { countryId: toCountryId },
        { $inc: { pool: fromManpower.pool ?? 0 } }
      );
      await manpowerColl.deleteOne({ countryId: fromCountryId });
    } else {
      await manpowerColl.updateOne(
        { countryId: fromCountryId },
        { $set: { countryId: toCountryId } }
      );
    }
    manpowerMerged = true;
  }

  // ── Doctrine: the survivor's stands; the absorbed one moves only into a void ─
  const doctrineColl = db.collection("nationalDoctrine");
  const fromDoctrine = await doctrineColl.findOne({ countryId: fromCountryId });
  if (fromDoctrine) {
    const toDoctrine = await doctrineColl.findOne({ countryId: toCountryId });
    if (toDoctrine) {
      await doctrineColl.deleteOne({ countryId: fromCountryId });
    } else {
      await doctrineColl.updateOne(
        { countryId: fromCountryId },
        { $set: { countryId: toCountryId, updatedAt: now } }
      );
    }
  }

  return {
    unitsRescoped: units?.modifiedCount ?? 0,
    commandsMerged,
    arsenalMerged,
    manpowerMerged,
  };
}
