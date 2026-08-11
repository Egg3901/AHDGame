/**
 * Player handoff for mid-world Tier-1 takeover and constitutional replacement (#3725).
 *
 * Deep module, small surface:
 *   - classify claimable vs systemic roles
 *   - open a ready country to players without reseeding live state
 *   - close player access while vacating only claimable player-held roles
 *   - describe how vacancies refill and what caretaker mode may do
 *
 * Locked product rules (epic #3712):
 *   - Mid-world entry preserves economy, government, diplomacy, relationships,
 *     and sphere state (no reset / reseed / wipe).
 *   - Only claimable roles transfer to player control; systemic roles stay on
 *     their own pipelines.
 *   - Player exit does not summon an instant NPP replacement — vacancies persist
 *     for election, appointment, succession, and government formation.
 *   - Caretaker mode is technical continuity only (no new strategic or sphere
 *     choices). Country-level strategy remains gated by #3724's player rail.
 */

import type { Db, ObjectId } from "mongodb";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  isImperialCountry,
  type CountryId,
  type GovernmentType,
} from "@/lib/constants/countries";
import type { CountryGameState, GameState } from "@/lib/db/types/gameState";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { PM_VACANCY_DEADLINE_TURNS } from "@/lib/constants/turnTime";
import {
  assertCanOpenCountryToPlayers,
  PlayerOpenBlockedError,
  resolvePresetIdFromGameState,
  type CountryReadinessReport,
} from "@/lib/world/countryReadinessContract";

// ─── Role taxonomy ───────────────────────────────────────────────────────────

/**
 * Roles players may hold through normal constitutional play after a country
 * opens. Authority transfers to the player game loop; NPP incumbents are not
 * wiped on entry (government is preserved).
 */
export const CLAIMABLE_ROLE_KINDS = [
  "elected-office",
  "head-of-government",
  "head-of-state",
  "cabinet-minister",
] as const;

export type ClaimableRoleKind = (typeof CLAIMABLE_ROLE_KINDS)[number];

/**
 * Roles that stay on their own pipelines across handoff. Not transferred to
 * player control by entry, and not vacated by exit (unless a player somehow
 * held them — then vacancy is left for that pipeline).
 */
export const SYSTEMIC_ROLE_KINDS = [
  "central-bank-chair",
  "supreme-court-justice",
  "imperial-monarch",
  "sphere-sponsorship",
] as const;

export type SystemicRoleKind = (typeof SYSTEMIC_ROLE_KINDS)[number];

/** Collections / domains that entry and exit must never wipe or reseed. */
export const PRESERVED_HANDOFF_DOMAINS = [
  "economy",
  "government",
  "diplomacy",
  "relationships",
  "sphere",
] as const;

export type PreservedHandoffDomain = (typeof PRESERVED_HANDOFF_DOMAINS)[number];

/**
 * Constitutional processes that refill claimable vacancies after player exit.
 * Instant NPP appointment outside these processes is forbidden by handoff.
 */
export const CONSTITUTIONAL_REFILL_PROCESSES = [
  "election",
  "appointment",
  "succession",
  "government-formation",
] as const;

export type ConstitutionalRefillProcess = (typeof CONSTITUTIONAL_REFILL_PROCESSES)[number];

export type CaretakerDecisionClass = "technical" | "strategic" | "sphere";

/** Office keys that are always systemic (parallel pipelines, not claimable). */
const SYSTEMIC_OFFICE_KEYS = new Set(["centralBankChair"]);

export type HandoffRoleClassification =
  { kind: "claimable"; role: ClaimableRoleKind } | { kind: "systemic"; role: SystemicRoleKind };

/**
 * Classify a country office-type key for handoff. Central-bank chairs are
 * systemic; imperial head-of-state is systemic; other configured offices and
 * cabinet seats are claimable.
 */
export function classifyHandoffRole(
  countryId: CountryId,
  officeKey: string
): HandoffRoleClassification {
  if (SYSTEMIC_OFFICE_KEYS.has(officeKey) || officeKey === "centralBankChair") {
    return { kind: "systemic", role: "central-bank-chair" };
  }
  if (officeKey === "supremeCourtJustice" || officeKey === "scotusJustice") {
    return { kind: "systemic", role: "supreme-court-justice" };
  }

  const config = getCountryConfig(countryId);
  const office = config.officeTypes.find((o) => o.key === officeKey);

  if (office?.isHeadOfState) {
    if (isImperialCountry(config)) {
      return { kind: "systemic", role: "imperial-monarch" };
    }
    return { kind: "claimable", role: "head-of-state" };
  }
  if (office?.isExecutive) {
    return { kind: "claimable", role: "head-of-government" };
  }
  if (office) {
    return { kind: "claimable", role: "elected-office" };
  }
  // Cabinet position ids are not in officeTypes — treat unknown as cabinet.
  return { kind: "claimable", role: "cabinet-minister" };
}

export function isClaimableOfficeKey(countryId: CountryId, officeKey: string): boolean {
  return classifyHandoffRole(countryId, officeKey).kind === "claimable";
}

/** Claimable role kinds that apply to this country's institutions. */
export function claimableRolesForCountry(countryId: CountryId): ClaimableRoleKind[] {
  const config = getCountryConfig(countryId);
  const roles = new Set<ClaimableRoleKind>();

  for (const office of config.officeTypes) {
    const c = classifyHandoffRole(countryId, office.key);
    if (c.kind === "claimable") roles.add(c.role);
  }
  // Every Tier-1 country with a cabinet surface can appoint ministers.
  roles.add("cabinet-minister");
  return CLAIMABLE_ROLE_KINDS.filter((k) => roles.has(k));
}

/** Systemic roles always retained across handoff (country may not exercise all). */
export function systemicRolesRetained(): SystemicRoleKind[] {
  return [...SYSTEMIC_ROLE_KINDS];
}

/**
 * Which constitutional process refills a vacant claimable role. Pure — used to
 * verify exit wires into existing vacancy machinery rather than instant NPP fill.
 */
export function refillProcessForClaimableVacancy(
  role: ClaimableRoleKind,
  governmentType: GovernmentType
): ConstitutionalRefillProcess {
  switch (role) {
    case "elected-office":
      return "election";
    case "cabinet-minister":
      return "appointment";
    case "head-of-state":
      return governmentType === "presidential" ? "election" : "appointment";
    case "head-of-government":
      if (governmentType === "presidential") {
        return "succession";
      }
      return "government-formation";
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/**
 * Country-level caretaker contract after player control / departure (#3724+#3725).
 * Technical continuity (markets, contracts, budget settlement) is allowed;
 * new strategic policy and sphere choices are not.
 *
 * Note: V2.1 player-appointed caretaker ministers are a separate, explicit
 * player action surface — not this country-level caretaker mode.
 */
export function caretakerDecisionAllowed(decision: CaretakerDecisionClass): boolean {
  return decision === "technical";
}

// ─── Entry / exit ────────────────────────────────────────────────────────────

export interface PlayerHandoffEntryResult {
  countryId: CountryId;
  presetId: string;
  readiness: CountryReadinessReport;
  /** Claimable role kinds now under player control (incumbents preserved). */
  claimableRolesTransferred: ClaimableRoleKind[];
  systemicRolesRetained: SystemicRoleKind[];
  /** Domains explicitly left untouched (no reseed / wipe). */
  preservedDomains: PreservedHandoffDomain[];
}

export interface VacatedClaimableOffice {
  collection: "electedOfficials" | "cabinetMembers";
  officeKey: string;
  role: ClaimableRoleKind;
  characterId: string;
}

export interface PlayerHandoffExitResult {
  countryId: CountryId;
  vacatedOffices: VacatedClaimableOffice[];
  /** Always false — exit never seats an NPP replacement. */
  instantNppReplacement: false;
  refillProcesses: ConstitutionalRefillProcess[];
  caretakerMode: true;
  preservedDomains: PreservedHandoffDomain[];
}

export { PlayerOpenBlockedError };

async function resolvePresetId(db: Db, explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  return resolvePresetIdFromGameState(gameState);
}

async function currentTurn(db: Db): Promise<number> {
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  return gs?.currentTurn ?? 1;
}

/**
 * Open a ready Tier-1 country to players mid-world.
 *
 * Gates on the #3722 player-readiness verdict. Flips `enabledForPlayers` only —
 * does not reseed or wipe economy, government, diplomacy, relationships, or
 * sphere state. Claimable role *authority* transfers to the player loop; live
 * NPP/player officeholders are left in place.
 */
export async function enterCountryForPlayers(
  db: Db,
  countryId: CountryId,
  opts?: { presetId?: string; now?: Date; status?: CountryGameState["status"] }
): Promise<PlayerHandoffEntryResult> {
  if (!COUNTRY_CONFIGS[countryId]) {
    throw new Error(`Invalid country ID: ${countryId}`);
  }

  const presetId = await resolvePresetId(db, opts?.presetId);
  const readiness = assertCanOpenCountryToPlayers(countryId, presetId);
  const now = opts?.now ?? new Date();

  const updateFields: Record<string, unknown> = {
    enabledForPlayers: true,
    updatedAt: now,
  };
  if (opts?.status !== undefined) {
    updateFields.status = opts.status;
  } else {
    // Opening for play implies an active political surface.
    updateFields.status = "active";
  }

  await db
    .collection<CountryGameState>("countryGameStates")
    .updateOne({ _id: countryId }, { $set: updateFields }, { upsert: true });

  return {
    countryId,
    presetId,
    readiness,
    claimableRolesTransferred: claimableRolesForCountry(countryId),
    systemicRolesRetained: systemicRolesRetained(),
    preservedDomains: [...PRESERVED_HANDOFF_DOMAINS],
  };
}

/**
 * Close player access and vacate player-held claimable offices.
 *
 * Does not create an instant NPP replacement. NPP-held claimable seats and all
 * systemic holders stay put. Government formation is marked pending when a
 * player head of government vacates so normal formation / vacancy clocks apply.
 */
export async function exitCountryForPlayers(
  db: Db,
  countryId: CountryId,
  opts?: { now?: Date }
): Promise<PlayerHandoffExitResult> {
  if (!COUNTRY_CONFIGS[countryId]) {
    throw new Error(`Invalid country ID: ${countryId}`);
  }

  const now = opts?.now ?? new Date();
  const vacatedOffices: VacatedClaimableOffice[] = [];
  const refill = new Set<ConstitutionalRefillProcess>();
  const governmentType = getCountryConfig(countryId).governmentType;

  const playerChars = await db
    .collection<Character>("characters")
    .find({ countryId, userId: { $exists: true } })
    .project({ _id: 1 })
    .toArray();
  const playerIds = playerChars.map((c) => c._id);

  if (playerIds.length > 0) {
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId, characterId: { $in: playerIds }, isNPP: { $ne: true } })
      .toArray();

    for (const official of officials) {
      const officeKey = official.officeType;
      const classified = classifyHandoffRole(countryId, officeKey);
      if (classified.kind !== "claimable") continue;

      const isExecutiveSlot =
        classified.role === "head-of-government" || classified.role === "head-of-state";

      if (isExecutiveSlot) {
        await db.collection<ElectedOfficial>("electedOfficials").updateOne(
          { _id: official._id },
          {
            $set: {
              characterId: null,
              isNPP: false,
              updatedAt: now,
            },
            $unset: {
              characterName: "",
              party: "",
              nppId: "",
              electedAt: "",
            },
          }
        );
      } else {
        await db.collection<ElectedOfficial>("electedOfficials").deleteOne({ _id: official._id });
      }

      vacatedOffices.push({
        collection: "electedOfficials",
        officeKey,
        role: classified.role,
        characterId: String(official.characterId),
      });
      refill.add(refillProcessForClaimableVacancy(classified.role, governmentType));
    }

    const cabinetCol = getCabinetMembersCollection(db);
    const ministers = (await cabinetCol
      .find({ countryId, characterId: { $in: playerIds } })
      .toArray()) as UnifiedCabinetMember[];

    for (const minister of ministers) {
      if (!minister.characterId) continue;
      await cabinetCol.deleteOne({ _id: minister._id });
      vacatedOffices.push({
        collection: "cabinetMembers",
        officeKey: minister.positionId,
        role: "cabinet-minister",
        characterId: String(minister.characterId),
      });
      refill.add(refillProcessForClaimableVacancy("cabinet-minister", governmentType));
    }

    await db.collection<Character>("characters").updateMany(
      { _id: { $in: playerIds }, countryId },
      {
        $set: { currentOffice: null, updatedAt: now },
        $unset: { cabinetPosition: "" },
      }
    );

    await clearPlayerHeadOfGovernment(db, countryId, playerIds, now, vacatedOffices, refill);
  }

  await db.collection<CountryGameState>("countryGameStates").updateOne(
    { _id: countryId },
    {
      $set: {
        enabledForPlayers: false,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  return {
    countryId,
    vacatedOffices,
    instantNppReplacement: false,
    refillProcesses: CONSTITUTIONAL_REFILL_PROCESSES.filter((p) => refill.has(p)),
    caretakerMode: true,
    preservedDomains: [...PRESERVED_HANDOFF_DOMAINS],
  };
}

async function clearPlayerHeadOfGovernment(
  db: Db,
  countryId: CountryId,
  playerIds: ObjectId[],
  now: Date,
  vacatedOffices: VacatedClaimableOffice[],
  refill: Set<ConstitutionalRefillProcess>
): Promise<void> {
  const govCol = getGovernmentFormationsCollection(db);
  const gov = await govCol.findOne({ _id: countryId });
  if (!gov) return;

  const pmIsPlayer =
    gov.pmCharacterId != null && playerIds.some((id) => id.equals(gov.pmCharacterId!));
  // Presidential player heads are tracked via electedOfficials; formation may
  // only carry NPP president ids. Still arm pending when a player PM leaves.
  if (!pmIsPlayer) return;

  const turn = await currentTurn(db);
  await govCol.updateOne(
    { _id: countryId },
    {
      $set: {
        status: "pending",
        pmCharacterId: null,
        pmName: null,
        pmNppId: null,
        formationType: null,
        formedAt: null,
        formedTurn: null,
        updatedAt: now,
        pmVacancyDeadlineTurn: turn + PM_VACANCY_DEADLINE_TURNS,
      },
    }
  );

  // Ensure refill process is recorded even if the electedOfficials row was
  // already handled above.
  if (!vacatedOffices.some((v) => v.role === "head-of-government")) {
    refill.add(
      refillProcessForClaimableVacancy(
        "head-of-government",
        getCountryConfig(countryId).governmentType
      )
    );
  }
}
