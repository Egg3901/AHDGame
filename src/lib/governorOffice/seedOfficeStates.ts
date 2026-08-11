import type { Db } from "mongodb";
import type { ElectedOfficial, GovernorOfficeState } from "@/lib/db/types";
import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";
import {
  COUNTRY_ORDER,
  getRegionalExecutiveOfficeKey,
  type CountryId,
} from "@/lib/constants/countries";
import { NATIONAL_POLICY_STATE_IDS } from "@/lib/policy/nationalStateId";
import { GUBERNATORIAL_ACTION_CAP } from "@/lib/constants/governorOffice";
import { isUKDevolutionRegion } from "@/lib/constants/devolution";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";

/**
 * Default Devolution Policy per (UK region, preset) for newly-seeded First
 * Minister seats. Mirrors the historical baseline of the seeded FM's party
 * — see docs/design/uk-devolution-policy.md. NIR's "anti" is unionist
 * (UUP in 1991, DUP in 2019). LON is excluded — Mayor of London has no
 * devolution axis.
 */
const UK_DEVOLUTION_POLICY_DEFAULTS: Record<string, Record<string, DevolutionPolicy>> = {
  "1991-default": { SCO: "pro", WAL: "pro", NIR: "anti" },
  "2019-default": { SCO: "independence", WAL: "pro", NIR: "anti" },
};

function resolveDevolutionPolicyDefault(
  countryId: CountryId,
  stateId: string,
  preset: string
): DevolutionPolicy | undefined {
  if (countryId !== "UK") return undefined;
  if (!isUKDevolutionRegion(stateId)) return undefined;
  const presetMap =
    UK_DEVOLUTION_POLICY_DEFAULTS[preset] ?? UK_DEVOLUTION_POLICY_DEFAULTS["2019-default"];
  return presetMap[stateId.toUpperCase()];
}

/**
 * Ensure a `governorOfficeState` row exists for every regional executive seat
 * (Governor / Minister-President / etc., player or NPP) and every national
 * pseudo-stateId (federal, uk_national, …) so the office AP system has a
 * spendable balance whenever a leader or admin acts on their behalf.
 *
 * Idempotent — skips entries that already exist. Safe to call from
 * `resetGameWorld` after officials are re-seeded. Without this, both the
 * Governor's Office and the (new) Orders in Council flow silently fail with
 * "Insufficient office action points" because the spend paths require an
 * existing row and never upsert.
 */
export async function seedOfficeStates(
  db: Db,
  currentTurn: number,
  preset?: string
): Promise<{ inserted: number; skipped: number }> {
  const now = new Date();
  let inserted = 0;
  let skipped = 0;

  // Resolve preset for UK Devolution Policy defaults. Explicit arg wins,
  // otherwise read from gameState. Falls back to 2019-default.
  let activePreset = preset;
  if (!activePreset) {
    activePreset = await getGameStatePresetOrDefault(db);
  }

  const countryIds: CountryId[] = COUNTRY_ORDER;

  // Pre-fetch existing rows so we can decide insert vs skip without a per-key
  // round-trip.
  const existing = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .find({})
    .project<{ countryId: CountryId; stateId: string }>({ countryId: 1, stateId: 1 })
    .toArray();
  const have = new Set(existing.map((r) => `${r.countryId}:${r.stateId}`));

  const inserts: GovernorOfficeState[] = [];

  for (const countryId of countryIds) {
    // Regional executives — one row per filled seat (player or NPP).
    const officeKey = getRegionalExecutiveOfficeKey(countryId);
    const seats = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: officeKey, countryId })
      .toArray();
    for (const seat of seats) {
      if (!seat.state) {
        skipped++;
        continue;
      }
      const key = `${countryId}:${seat.state}`;
      if (have.has(key)) {
        skipped++;
        continue;
      }
      const devolutionPolicy = resolveDevolutionPolicyDefault(countryId, seat.state, activePreset);
      inserts.push({
        countryId,
        stateId: seat.state,
        characterId: seat.characterId ?? null,
        characterName: seat.characterName ?? "Vacant",
        gubernatorialActions: GUBERNATORIAL_ACTION_CAP,
        lastActionGrantedTurn: currentTurn,
        ...(devolutionPolicy ? { devolutionPolicy } : {}),
        createdAt: now,
        updatedAt: now,
      } as GovernorOfficeState);
      have.add(key);
      inserted++;
    }

    // National pseudo-stateId — one row per country regardless of who currently
    // holds the seat (President / PM / Chancellor). Admins can use the row
    // immediately via Admin Override even before a leader is installed.
    const nationalStateId = NATIONAL_POLICY_STATE_IDS[countryId];
    if (nationalStateId) {
      const nationalKey = `${countryId}:${nationalStateId}`;
      if (!have.has(nationalKey)) {
        inserts.push({
          countryId,
          stateId: nationalStateId,
          characterId: null,
          characterName: "National Office",
          gubernatorialActions: GUBERNATORIAL_ACTION_CAP,
          lastActionGrantedTurn: currentTurn,
          createdAt: now,
          updatedAt: now,
        } as GovernorOfficeState);
        have.add(nationalKey);
        inserted++;
      } else {
        skipped++;
      }
    }
  }

  if (inserts.length > 0) {
    await db.collection<GovernorOfficeState>("governorOfficeState").insertMany(inserts);
  }
  return { inserted, skipped };
}
