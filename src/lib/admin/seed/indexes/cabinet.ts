import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

// Cabinet collections — the unified cabinetMembers (all countries) plus the
// UK-specific appointment cooldowns.
export async function seedCabinetIndexes(db: Db, log: (msg: string) => void) {
  log("Cabinet indexes:");

  // Unified cabinetMembers (the single source of truth for all countries).
  await ensureIndex(
    db,
    "cabinetMembers",
    { countryId: 1, positionId: 1 },
    { unique: true, name: "cabinetMembers_countryId_positionId" },
    log
  );
  // One cabinet seat per character (per country). Partial so the many NPP-held
  // seats — which carry `characterId: null` — are exempt and don't collide on a
  // shared null value. Ported from the retired ukCabinetMembers collection,
  // where this constraint (plain-unique, player-only) lived.
  await ensureIndex(
    db,
    "cabinetMembers",
    { countryId: 1, characterId: 1 },
    {
      unique: true,
      name: "cabinetMembers_countryId_characterId",
      partialFilterExpression: { characterId: { $type: "objectId" } },
    },
    log
  );

  // ukCabinetCooldowns — keyed uniquely by country+position. NO TTL index: the
  // cooldown lifetime is turn-based (`cooldownUntilTurn`, checked at appoint
  // time), so a wall-clock TTL on `cooldownUntil` would delete a still-active
  // cooldown during a pause and break the freeze. Stale docs are harmless and
  // bounded (one per position, overwritten on each re-appoint; persists through
  // firing).
  // Operator: drop the legacy prod index — db.ukCabinetCooldowns.dropIndex("ukCabinetCooldowns_ttl").
  await ensureIndex(
    db,
    "ukCabinetCooldowns",
    { countryId: 1, positionId: 1 },
    { unique: true, name: "ukCabinetCooldowns_countryId_positionId" },
    log
  );

  // One acting appointment per seat, per presidency. NO TTL index: like the
  // ukCabinetCooldowns above, this lifetime is turn-based, and a wall-clock TTL
  // would refund a spent charge during a turn-system pause.
  await ensureIndex(
    db,
    "actingAppointmentCharges",
    { countryId: 1, positionId: 1, presidentCharacterId: 1, presidencyStartedAt: 1 },
    { unique: true, name: "actingAppointmentCharges_seat_presidency" },
    log
  );

  log("Cabinet indexes ensured");
}
