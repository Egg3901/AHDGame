import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";
import { isSingleplayer } from "@/lib/singleplayer";

/**
 * Whether a newcomer can sign up, and whether a signed-in account can create a
 * character, right now.
 *
 * The mutation routes (`POST /api/auth/register`, the OAuth callbacks,
 * `POST /api/auth/character`) each enforce these gates server-side. The pages
 * in front of them used to know only part of it: the register page reacted to
 * full maintenance but not to closed registration, and `/create-character`
 * checked nothing, so a player filled in every step and learned at submit that
 * creation was closed. Every page now reads this one derivation before it
 * renders a form, so what a page offers and what its route accepts agree.
 */
export type RegistrationClosedReason = "maintenance" | "registration_closed";
export type CharacterCreationClosedReason = "maintenance";

export interface IntakeStatus {
  registration: { open: true; reason: null } | { open: false; reason: RegistrationClosedReason };
  characterCreation:
    { open: true; reason: null } | { open: false; reason: CharacterCreationClosedReason };
  /** Maintenance mode, so copy can tell a short partial window from a world reset. */
  maintenanceMode: "off" | "partial" | "full";
  /** ISO timestamp an admin set as the expected reopen time, or null. */
  expectedEnd: string | null;
}

export type IntakeConfig = Pick<
  GameConfig,
  "maintenanceMode" | "registrationEnabled" | "maintenanceExpectedEnd"
>;

const OPEN: IntakeStatus = {
  registration: { open: true, reason: null },
  characterCreation: { open: true, reason: null },
  maintenanceMode: "off",
  expectedEnd: null,
};

/** Pure derivation, shared by every reader. `null` config means the world is unconfigured. */
export function computeIntakeStatus(config: IntakeConfig | null | undefined): IntakeStatus {
  if (isSingleplayer()) return OPEN;
  const maintenanceMode = normalizeMaintenanceMode(config?.maintenanceMode);
  const rawEnd = config?.maintenanceExpectedEnd;
  const expectedEnd =
    maintenanceMode !== "off" && rawEnd && !Number.isNaN(Date.parse(rawEnd)) ? rawEnd : null;
  const inMaintenance = maintenanceMode !== "off";

  return {
    // Maintenance outranks the registration switch: it is the more specific
    // explanation and it carries the ETA.
    registration: inMaintenance
      ? { open: false, reason: "maintenance" }
      : config?.registrationEnabled === false
        ? { open: false, reason: "registration_closed" }
        : { open: true, reason: null },
    // Closed registration never blocks an existing account from creating a
    // character; only maintenance does (see POST /api/auth/character).
    characterCreation: inMaintenance
      ? { open: false, reason: "maintenance" }
      : { open: true, reason: null },
    maintenanceMode,
    expectedEnd,
  };
}

/** Reads the gates fresh from `gameConfig`. One small projected findOne. */
export async function loadIntakeStatus(db: Db): Promise<IntakeStatus> {
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: { maintenanceMode: 1, registrationEnabled: 1, maintenanceExpectedEnd: 1 },
    }
  );
  return computeIntakeStatus(config);
}
