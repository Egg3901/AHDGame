import type { Db } from "mongodb";
import { isSingleplayer } from "@/lib/singleplayer";
import {
  invalidateMaintenanceCache,
  normalizeMaintenanceMode,
  type MaintenanceMode,
} from "@/lib/maintenanceStatus";
import type { GameConfig } from "@/lib/db/types";

export function canOperateSingleplayerWorld(): boolean {
  return isSingleplayer();
}

export async function getSingleplayerWorldAvailability(db: Db): Promise<MaintenanceMode> {
  if (!canOperateSingleplayerWorld()) throw new Error("Singleplayer operator is unavailable");
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { maintenanceMode: 1 } });
  return normalizeMaintenanceMode(config?.maintenanceMode);
}

export async function setSingleplayerWorldAvailability(
  db: Db,
  availability: "open" | "sealed"
): Promise<MaintenanceMode> {
  if (!canOperateSingleplayerWorld()) throw new Error("Singleplayer operator is unavailable");
  const mode: MaintenanceMode = availability === "open" ? "off" : "full";
  const update =
    mode === "off"
      ? {
          $set: { maintenanceMode: "off" as const },
          $unset: {
            maintenanceReason: "" as const,
            maintenanceExpectedEnd: "" as const,
            maintenanceEnabledBy: "" as const,
            maintenanceEnabledAt: "" as const,
          },
        }
      : {
          $set: {
            maintenanceMode: "full" as const,
            maintenanceReason: "Singleplayer world paused by its local operator.",
            maintenanceExpectedEnd: "",
            maintenanceEnabledBy: "singleplayer-operator",
            maintenanceEnabledAt: new Date().toISOString(),
          },
        };
  await db.collection<GameConfig>("gameConfig").updateOne({ _id: "default" }, update, {
    upsert: true,
  });
  invalidateMaintenanceCache();
  return mode;
}
