/** Local pause state stops manual turns without hiding the game behind hosted maintenance. */
import type { Db } from "mongodb";
import { isSingleplayer } from "@/lib/singleplayer";
import type { MaintenanceMode } from "@/lib/maintenanceStatus";

interface LocalRuntimeState {
  _id: string;
  paused: boolean;
}

export function canOperateSingleplayerWorld(): boolean {
  return isSingleplayer();
}

// Preserve the legacy availability response while storing pause independently.
export async function getSingleplayerWorldAvailability(db: Db): Promise<MaintenanceMode> {
  if (!canOperateSingleplayerWorld()) throw new Error("Singleplayer operator is unavailable");
  const state = await db
    .collection<LocalRuntimeState>("singleplayerRuntime")
    .findOne({ _id: "current" }, { projection: { paused: 1 } });
  return state?.paused === true ? "full" : "off";
}

export async function setSingleplayerWorldAvailability(
  db: Db,
  availability: "open" | "sealed"
): Promise<MaintenanceMode> {
  if (!canOperateSingleplayerWorld()) throw new Error("Singleplayer operator is unavailable");
  const paused = availability === "sealed";
  await db
    .collection<LocalRuntimeState>("singleplayerRuntime")
    .updateOne({ _id: "current" }, { $set: { paused } }, { upsert: true });
  return paused ? "full" : "off";
}
