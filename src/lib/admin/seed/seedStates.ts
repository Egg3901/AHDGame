import type { Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { State } from "@/lib/db/types";
import { states } from "@/lib/seeds/reference/states";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { states1979 } from "@/lib/seeds/reference/states1979";
import { states1991 } from "@/lib/seeds/reference/states1991";
import { states1999 } from "@/lib/seeds/reference/states1999";
import { states2007 } from "@/lib/seeds/reference/states2007";
import { states2023 } from "@/lib/seeds/reference/states2023";
import { selectPresetBundle } from "@/lib/seeds/presetSelector";

/**
 * Full era → US-states bundle map. Single source of truth shared by
 * `runCoreSeed` (full core seed) and `seedStates` (targeted admin "states"
 * reseed) so both paths pick the same era bundle (refs #3242 — seedStates
 * previously mapped only 2019/1991/2023, so a targeted reseed on a
 * 1953/1979/1999/2007 world silently wrote 2019 states).
 */
export function selectStatesBundleForPreset(preset: string): State[] {
  return selectPresetBundle(
    preset,
    {
      "1953-default": states1953,
      "1979-default": states1979,
      "1991-default": states1991,
      "1999-default": states1999,
      "2007-default": states2007,
      "2019-default": states,
      "2023-default": states2023,
    },
    "seedStates:states1953"
  );
}

export async function seedStates(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset)
    await db
      .collection("states")
      .drop()
      .catch((error) => {
        logWarning("Collection drop failed (may not exist)", {
          component: "AdminSeed",
          action: "drop collection",
          metadata: { error: String(error) },
        });
      });
  const bundle = selectStatesBundleForPreset(preset);
  const ops = bundle.map((state) => {
    const { _id, ...stateData } = state;
    return { updateOne: { filter: { _id }, update: { $set: stateData }, upsert: true } };
  });
  if (ops.length > 0) await db.collection<State>("states").bulkWrite(ops, { ordered: false });
  log(`Seeded ${bundle.length} states (${preset})`);
}
