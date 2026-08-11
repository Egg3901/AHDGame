import type { Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { GameConfig } from "@/lib/db/types";
import { gameConfig } from "@/lib/seeds/reference/gameConfig";
import { eraForPreset } from "@/lib/seeds/presetSelector";

export async function seedGameConfig(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
) {
  if (reset)
    await db
      .collection("gameConfig")
      .drop()
      .catch((error) => {
        logWarning("Collection drop failed (may not exist)", {
          component: "AdminSeed",
          action: "drop collection",
          metadata: { error: String(error) },
        });
      });
  const { _id, ...configData } = gameConfig;
  const extra: Pick<GameConfig, "seedYear"> = preset
    ? { seedYear: parseInt(eraForPreset(preset), 10) }
    : {};
  await db
    .collection<GameConfig>("gameConfig")
    .updateOne({ _id }, { $set: { ...configData, ...extra } }, { upsert: true });
  log("Seeded game config");
}
