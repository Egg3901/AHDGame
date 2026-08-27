import { NextResponse } from "next/server";

/**
 * How long an acting cabinet appointment lasts before it lapses.
 *
 * Matches `SETTING_CHANGE_COOLDOWN_TURNS`, so an acting holder could make at
 * most one policy change in a full tenure even if policy were open to them.
 */
export const ACTING_TENURE_TURNS = 24;

/**
 * Acting appointments a President may make per cabinet seat, per presidency.
 *
 * `hasUnspentActingCharge` implements this as "no charge row exists", which is
 * only equivalent while the value is 1. Raising it means changing that helper
 * to compare a count against this constant.
 */
export const ACTING_CHARGES_PER_SEAT = 1;

/**
 * What kind of power a cabinet route exercises.
 *
 * An acting holder keeps `operational` only. The other four are reserved to a
 * confirmed holder, because each either sets department direction, moves
 * people, or commits the nation past the acting holder's own tenure.
 */
export type CabinetCapability =
  "operational" | "policyStance" | "personnel" | "strategicCommitment" | "capitalProject";

/** Capabilities an acting holder may NOT exercise. */
const ACTING_RESTRICTED: ReadonlySet<CabinetCapability> = new Set<CabinetCapability>([
  "policyStance",
  "personnel",
  "strategicCommitment",
  "capitalProject",
]);

/**
 * Every mutating cabinet route group, keyed by its path below
 * `/api/country/[code]/executive/cabinet/[positionId]/`.
 *
 * Read (GET) handlers are never gated by this manifest; who may READ a cabinet
 * office is decided by `resolveCabinetOfficeVisibility` instead.
 *
 * Adding a cabinet route means adding a line here. That is deliberate: the
 * classification is a decision, not a default.
 */
export const CABINET_ROUTE_CAPABILITIES: Record<string, CabinetCapability> = {
  // Operational: reversible, and spent within a tenure.
  "military/recruit": "operational",
  "military/[unitId]": "operational",
  "military/[unitId]/assign": "operational",
  "military/[unitId]/posture": "operational",
  "military/[unitId]/upgrade": "operational",
  "military/assign-branch": "operational",
  formations: "operational",
  theaters: "operational",
  commands: "operational",
  "battle/declare": "operational",
  "battle/auto-join": "operational",
  manpower: "operational",
  order: "operational",
  banner: "operational",
  // Funding something already running keeps a department alive; starting
  // something new does not.
  "infra/[projectId]/funding": "operational",
  "estates/[estateId]/fund": "operational",

  // Policy stance: sets department direction on a 24-turn cooldown.
  setting: "policyStance",
  allocation: "policyStance",

  // Personnel: who serves, which outlasts whoever appointed them.
  generals: "personnel",
  "generals/[characterId]": "personnel",

  // Strategic commitment: irreversible, and permanent at national scale.
  "doctrine/adopt": "strategicCommitment",
  "nuclear/adopt": "strategicCommitment",
  // `nuclear/covert` itself is a GET surface; its mutations are the two below.
  "nuclear/covert/breakout": "strategicCommitment",
  "nuclear/covert/funding": "strategicCommitment",
  "nuclear/production": "strategicCommitment",
  "nuclear/test": "strategicCommitment",

  // Capital: commitments whose horizon exceeds an acting tenure.
  "estates/open": "capitalProject",
  "estates/[estateId]/expand": "capitalProject",
  "estates/[estateId]": "capitalProject",
  "infra/start": "capitalProject",
  "infra/[projectId]": "capitalProject",
  "energy/build": "capitalProject",
  "energy/[plantId]": "capitalProject",
  "energy/[plantId]/upgrade": "capitalProject",
  "debt-operation": "capitalProject",
  "bond-profile": "capitalProject",
  "defence-contracts": "capitalProject",
};

/** Player-facing refusal copy, per capability. No dashes, per project rules. */
const REFUSAL: Record<CabinetCapability, string> = {
  operational: "",
  policyStance:
    "An acting secretary cannot set department policy. Senate confirmation unlocks this.",
  personnel:
    "An acting secretary cannot appoint or dismiss personnel. Senate confirmation unlocks this.",
  strategicCommitment:
    "An acting secretary cannot make permanent national commitments. Senate confirmation unlocks this.",
  capitalProject:
    "An acting secretary cannot open new projects, though existing ones may still be funded. Senate confirmation unlocks this.",
};

/**
 * Is this seat holder permitted to exercise `capability`?
 *
 * Answers one question only. It never decides whether the caller HOLDS the
 * seat: that stays with each route's own holder check, which already refuses a
 * vacant seat. So a null member, or a confirmed one, is always allowed here.
 *
 * `isAdmin` exists because every cabinet route admits an admin who does NOT
 * hold the seat. Without the exemption, an admin operating on a seat that
 * happens to be acting-held would be refused for a limit that was never meant
 * to apply to them: the caretaker rule binds the caretaker, not the operator.
 */
export function assertActingAllowed(
  member: { acting?: boolean } | null | undefined,
  capability: CabinetCapability,
  { isAdmin = false }: { isAdmin?: boolean } = {}
): { ok: true } | { ok: false; response: NextResponse } {
  if (isAdmin) return { ok: true };
  if (!member?.acting) return { ok: true };
  if (!ACTING_RESTRICTED.has(capability)) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json({ error: REFUSAL[capability] }, { status: 403 }),
  };
}
