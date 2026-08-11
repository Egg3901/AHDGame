import { getDb } from "@/lib/mongodb";
import type { DemographicConfigOverride } from "@/lib/db/types/demographicConfigOverride";
import type { EraId } from "./presetSelector";

/** The authored global override fields consumed by the gated seed path. */
export interface Layer1ModelOverride {
  positions?: DemographicConfigOverride["positions"];
  turnout?: DemographicConfigOverride["turnout"];
  composition?: DemographicConfigOverride["composition"];
}

/** Returns the full admin-authored model override for a country+era, or null if none. */
export async function loadFullOverride(
  countryId: string,
  era: EraId
): Promise<Layer1ModelOverride | null> {
  const db = await getDb();
  const id = `${countryId}:${era}`;
  const doc = await db
    .collection<DemographicConfigOverride>("demographicConfigOverrides")
    .findOne({ _id: id });
  if (!doc) return null;
  return { positions: doc.positions, turnout: doc.turnout, composition: doc.composition };
}

/** Returns the admin-authored positions override for a country+era, or null if none. */
export async function loadPositionOverride(
  countryId: string,
  era: EraId
): Promise<DemographicConfigOverride["positions"] | null> {
  const db = await getDb();
  const id = `${countryId}:${era}`;
  const doc = await db
    .collection<DemographicConfigOverride>("demographicConfigOverrides")
    .findOne({ _id: id });
  return doc?.positions ?? null;
}

/** Back-compat wrapper: loads the US positions override for a given era. */
export async function loadEraPositionOverride(
  era: EraId
): Promise<DemographicConfigOverride["positions"] | null> {
  return loadPositionOverride("US", era);
}

/** Loads the full US override bundle for a given era. */
export async function loadEraFullOverride(era: EraId): Promise<Layer1ModelOverride | null> {
  return loadFullOverride("US", era);
}
