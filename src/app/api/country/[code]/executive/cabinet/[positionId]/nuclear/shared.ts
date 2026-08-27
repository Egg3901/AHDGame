// Shared plumbing for the nuclear-programme routes. Mirrors the defence-contracts
// route's guard structure: valid country, real defence seat, caller holds it (or
// is admin), then the programme's own three entry gates on top.
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { resolveCabinetOfficeVisibility } from "@/lib/cabinet/officeVisibility";
import { assertActingAllowed, type CabinetCapability } from "@/lib/cabinet/actingScope";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { getNationalDoctrine } from "@/lib/db/collections/nationalDoctrine";
import { getNuclearProgram } from "@/lib/db/collections/nuclearPrograms";
import { isAdoptedByName } from "@/lib/military/doctrineTree";
import { NUCLEAR_CAPABLE, NUCLEAR_ENTRY_DOCTRINE_NODE } from "@/lib/military/nuclearProgram";
import { resolveGameYear } from "@/lib/era/era";

export interface NuclearRouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

/**
 * Shared guard: valid country, real defence seat, caller may reach it.
 *
 * `intent: "manage"` (the default, and what every mutation uses) keeps the
 * original rule: the seated holder or an admin, nobody else.
 *
 * `intent: "read"` is for the GET surfaces, which are office RECORDS rather than
 * levers, so they follow the cabinet office visibility rule instead — the holder,
 * their country's head of government or head of state, or an admin. Without this
 * split a head of government could open the defence office (which the briefing
 * now allows) and then hit a 403 from the nuclear console inside it.
 */
export async function requireDefenceHolder(
  code: string,
  positionId: string,
  {
    intent = "manage",
    capability,
  }: { intent?: "manage" | "read"; capability?: CabinetCapability } = {}
) {
  const auth = await requireAuth();
  if (!auth.ok) return { error: auth.response } as const;

  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: NextResponse.json({ error: "Invalid country" }, { status: 400 }) } as const;
  }
  if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
    return {
      error: NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 }),
    } as const;
  }

  const db = await getDb();
  const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });

  const { canView, canAct } = await resolveCabinetOfficeVisibility(db, {
    countryId,
    holderCharacterId: member?.characterId ?? null,
    viewerCharacterId: auth.user.character?._id ?? null,
    // Keyed by user, not character: a reigning monarch is an imperial character.
    viewerUserId: auth.user.userId ?? null,
    isAdmin: !!auth.user.isAdmin,
  });

  const permitted = intent === "read" ? canView : canAct;
  if (!permitted) {
    return {
      error: NextResponse.json(
        {
          error:
            intent === "read"
              ? "This office's records are not published outside the office."
              : "Only the defence minister may manage the nuclear programme.",
        },
        { status: 403 }
      ),
    } as const;
  }
  // Acting scope, applied after the permission check so a non-holder still
  // gets the permission refusal rather than a scope one. Read intents pass no
  // capability: a caretaker may read their own office freely.
  if (capability) {
    const actingCheck = assertActingAllowed(member, capability, {
      isAdmin: !!auth.user.isAdmin,
    });
    if (!actingCheck.ok) return { error: actingCheck.response } as const;
  }

  return { db, countryId, member, user: auth.user } as const;
}

interface GameStateSlice {
  coldWarEnabled?: boolean;
  currentYear?: number;
  currentTurn?: number;
  startingYear?: number;
}

export async function loadGameStateSlice(db: Db): Promise<GameStateSlice | null> {
  return db
    .collection<GameStateSlice & { _id: string }>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { coldWarEnabled: 1, currentYear: 1, currentTurn: 1, startingYear: 1 } }
    );
}

export interface NuclearEligibility {
  capable: boolean;
  coldWarEnabled: boolean;
  doctrineAdopted: boolean;
  eligible: boolean;
}

/** The programme's three entry gates, as the GET surface reports them. */
export async function resolveEligibility(
  db: Db,
  countryId: CountryId,
  coldWarEnabled: boolean
): Promise<NuclearEligibility> {
  // Capable = the era's named set OR a live programme with anything adopted.
  // The second arm is the covert breakout: a nation that already detonated a
  // device has proven the base the named set stands in for, and may climb the
  // tree like anyone. Used by every route, mutations included.
  const program = await getNuclearProgram(db, countryId);
  const capable = NUCLEAR_CAPABLE.includes(countryId) || Object.keys(program.adopted).length > 0;
  const doctrine = await getNationalDoctrine(db, countryId);
  const doctrineAdopted = isAdoptedByName(doctrine.adopted, NUCLEAR_ENTRY_DOCTRINE_NODE);
  return {
    capable,
    coldWarEnabled,
    doctrineAdopted,
    eligible: capable && coldWarEnabled && doctrineAdopted,
  };
}

/**
 * The mutation routes' hard gate: every ineligibility is a refusal, with the
 * subsystem toggle a 404 (the doctrine route's convention for a disabled
 * subsystem) and the in-world gates a 403/409.
 */
export async function requireEligible(db: Db, countryId: CountryId) {
  const gs = (await loadGameStateSlice(db)) ?? {};
  if (gs.coldWarEnabled !== true) {
    return {
      error: NextResponse.json({ error: "Cold War subsystem disabled" }, { status: 404 }),
    } as const;
  }
  const eligibility = await resolveEligibility(db, countryId, true);
  if (!eligibility.capable) {
    return {
      error: NextResponse.json(
        { error: "This nation cannot open a nuclear programme in this era." },
        { status: 403 }
      ),
    } as const;
  }
  if (!eligibility.doctrineAdopted) {
    return {
      error: NextResponse.json(
        { error: `Adopt the ${NUCLEAR_ENTRY_DOCTRINE_NODE} doctrine node first.` },
        { status: 409 }
      ),
    } as const;
  }
  const year = resolveGameYear(gs);
  return { gs, year, currentTurn: gs.currentTurn ?? 0 } as const;
}
