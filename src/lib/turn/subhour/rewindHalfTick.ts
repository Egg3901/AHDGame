import type { AnyBulkWriteOperation, Db, Document } from "mongodb";
import { restoreAdditive, restoreMultiplicative, type SubhourBaseValue } from "./stepBase";

type Restore = "additive" | "multiplicative";

interface RewindSpec {
  collection: string;
  /** Key under `subhourBase` written by the half step. */
  system: string;
  /** Base record key -> [document path, how a later move is kept]. */
  fields: Record<string, [path: string, restore: Restore]>;
}

/**
 * Every field the :30 half tick moves ahead of the turn, and where its
 * start-of-hour value is stored. Exchange rates and price levels compound, so
 * a move made by something else between :30 and the turn (an admin edit, a
 * crisis shock) is kept as a ratio; rates and gaps keep it as an offset.
 */
export const HALF_TICK_REWIND_SPECS: readonly RewindSpec[] = [
  {
    collection: "states",
    system: "growth",
    fields: { gdp: ["gdp", "multiplicative"], outputGap: ["outputGap", "additive"] },
  },
  {
    collection: "macroMetrics",
    system: "growth",
    fields: { gdpGrowth: ["economic.gdpGrowth.value", "additive"] },
  },
  {
    collection: "federalBudget",
    system: "inflation",
    fields: {
      inflationRate: ["economicFactors.inflationRate", "additive"],
      householdPriceIndex: ["economicFactors.householdPriceIndex", "multiplicative"],
    },
  },
  {
    collection: "federalBudget",
    system: "growth",
    fields: { gdpGrowth: ["economicFactors.gdpGrowth", "additive"] },
  },
  {
    collection: "exchangeRates",
    system: "forex",
    fields: { rate: ["rate", "multiplicative"], macroTarget: ["macroTarget", "multiplicative"] },
  },
];

function readPath(doc: Document, path: string): unknown {
  let value: unknown = doc;
  for (const key of path.split(".")) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function isBaseValue(value: unknown): value is SubhourBaseValue {
  const v = value as SubhourBaseValue | null;
  return (
    v != null &&
    typeof v.base === "number" &&
    Number.isFinite(v.base) &&
    typeof v.written === "number" &&
    Number.isFinite(v.written)
  );
}

export interface RewindHalfTickResult {
  /** Documents rewound per collection. */
  rewound: Record<string, number>;
}

/**
 * Turn start: put every value the :30 half tick moved for `turn` back to its
 * start-of-hour value and clear the stamps, so the turn runs on exactly the
 * world it would have seen without the tick and takes the hour's full step.
 * The hour's result is then identical to a turn with no half tick, and no
 * phase can read a half-way value. Players saw and traded at the :30 values
 * during the half hour; only the numbers shown while the turn runs step back.
 *
 * Idempotent: a turn retried after a crash finds no stamps left. Stamps for
 * another turn (a tick that ran for a turn which never happened) are cleared
 * the same way, from their own stored start values.
 */
export async function rewindHalfTick(db: Db, turn: number): Promise<RewindHalfTickResult> {
  const specsFor = (collection: string) =>
    HALF_TICK_REWIND_SPECS.filter((spec) => spec.collection === collection);
  // One projected read and one unordered bulk write per collection.
  const [states, macroMetrics, federalBudget, exchangeRates] = await Promise.all([
    rewindCollection(db, "states", specsFor("states"), turn),
    rewindCollection(db, "macroMetrics", specsFor("macroMetrics"), turn),
    rewindCollection(db, "federalBudget", specsFor("federalBudget"), turn),
    rewindCollection(db, "exchangeRates", specsFor("exchangeRates"), turn),
  ]);
  return { rewound: { states, macroMetrics, federalBudget, exchangeRates } };
}

async function rewindCollection(
  db: Db,
  collection: string,
  specs: readonly RewindSpec[],
  turn: number
): Promise<number> {
  const projection: Record<string, 1> = { subhourStep: 1, subhourBase: 1 };
  for (const spec of specs) for (const [path] of Object.values(spec.fields)) projection[path] = 1;
  const docs = await db
    .collection(collection)
    .find({ subhourStep: { $exists: true } }, { projection })
    .toArray();
  const ops: AnyBulkWriteOperation<Document>[] = [];
  for (const doc of docs) {
    const set: Record<string, number> = {};
    for (const spec of specs) {
      const base = readPath(doc, `subhourBase.${spec.system}`) as
        (Record<string, unknown> & { turn?: number }) | undefined;
      // A record from an hour whose turn never came still holds that hour's
      // start values, which are still the last settled state.
      if (!base || typeof base.turn !== "number" || base.turn > turn) continue;
      for (const [key, [path, restore]] of Object.entries(spec.fields)) {
        const record = base[key];
        if (!isBaseValue(record)) continue;
        const current = readPath(doc, path);
        set[path] =
          restore === "multiplicative"
            ? restoreMultiplicative(current, record)
            : restoreAdditive(current, record);
      }
    }
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          ...(Object.keys(set).length > 0 ? { $set: set } : {}),
          $unset: { subhourStep: "", subhourBase: "" },
        },
      },
    });
  }
  if (ops.length > 0) await db.collection(collection).bulkWrite(ops, { ordered: false });
  return ops.length;
}
