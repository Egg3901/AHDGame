import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { createConflict } from "@/lib/military/createConflict";
import { joinSide } from "@/lib/military/joinSide";
import { findWarBetween } from "@/lib/military/findWarBetween";
import { sideOf } from "@/lib/military/occupation";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { resolveTreatyDefenders, type TreatyDefender } from "@/lib/military/treatyDefence";
import type { TreatyEntry } from "@/lib/db/types/conflict";
import type { WarGoal } from "@/lib/military/warGoals";

export interface DeclareWarInput {
  declarer: CountryId;
  defender: CountryId;
  warGoal: WarGoal;
  /** The bill that declared it, for the conflict record. */
  billId: string;
  currentTurn: number;
}

export interface DeclareWarResult {
  conflict: ConflictDoc;
  /** True when the declarer enrolled in an existing war rather than starting one. */
  joined: boolean;
}

/**
 * Tell the countries a treaty just took to war, and log it on the alliance.
 *
 * Notifications are addressed to USERS, not countries — `NotificationInput` carries a
 * `userId` and there is no country-addressed notice anywhere in this codebase. So a
 * country's notice goes to the two seats that can act on it: the head of government and
 * the defence minister, the same pair the declare-war route authorises to take a country
 * to war in the first place.
 *
 * A war must never fail over a notification. `createNotifications` already swallows and
 * logs its own errors, which is the behaviour this relies on.
 */
async function announceTreatyEntries(
  db: Db,
  entries: TreatyEntry[],
  conflictName: string,
  currentTurn: number
): Promise<void> {
  if (entries.length === 0) return;

  const inputs: NotificationInput[] = [];
  for (const e of entries) {
    const org =
      INTERNATIONAL_ORGANIZATIONS[e.organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS]
        ?.name ?? e.organizationId;
    const defended = COUNTRY_CONFIGS[e.defending]?.name ?? e.defending;

    const seatCharacterIds: ObjectId[] = [];
    const hog = await getHeadOfGovernmentCharacterId(db, e.countryId);
    if (hog) seatCharacterIds.push(hog);
    const defenceSeat = DEFENSE_POSITION_BY_COUNTRY[e.countryId];
    if (defenceSeat) {
      const row = await db
        .collection<{ characterId?: ObjectId }>("cabinetMembers")
        .findOne({ countryId: e.countryId, positionId: defenceSeat });
      if (row?.characterId) seatCharacterIds.push(row.characterId);
    }
    if (seatCharacterIds.length === 0) continue;

    const chars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: seatCharacterIds } })
      .project<{ _id: ObjectId; userId?: ObjectId }>({ _id: 1, userId: 1 })
      .toArray();

    for (const c of chars) {
      if (!c.userId) continue;
      inputs.push({
        userId: c.userId,
        type: "treaty_defence_invoked" as const,
        title: "Treaty obligations invoked",
        message: `${defended} has been attacked. Under the ${org}, your forces have entered the ${conflictName}.`,
        metadata: {
          countryId: e.countryId,
          organizationId: e.organizationId,
          defending: e.defending,
        },
      });
    }
  }

  // Deduped by user: one player can hold both seats, and two identical notices about one
  // war reads as a bug.
  const seen = new Set<string>();
  await createNotifications(
    inputs.filter((i) => {
      const key = String(i.userId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );

  for (const e of entries) {
    const defended = COUNTRY_CONFIGS[e.defending]?.name ?? e.defending;
    await recordOrgHistoryEvent(
      db,
      e.countryId,
      currentTurn,
      `${e.organizationId} collective defence invoked: entered the ${conflictName} to defend ${defended}.`,
      { organizationId: e.organizationId, defending: e.defending }
    );
  }
}

/** Stamp the resolver's output with who it came for and when. */
function toTreatyEntries(
  defenders: TreatyDefender[],
  defending: CountryId,
  joinedTurn: number
): TreatyEntry[] {
  return defenders.map((d) => ({
    countryId: d.countryId,
    organizationId: d.organizationId,
    defending,
    joinedTurn,
  }));
}

/**
 * Enact a ratified declaration of war.
 *
 * ONE war per defender. If a live conflict is already hosted in the defender, the
 * declarer enrols on the side opposing it rather than opening a parallel war over the
 * same ground — which matches the coalition model, and keeps one map pin per
 * besieged country. Otherwise a new conflict is created, hosted in the defender:
 * `createConflict` derives `region` from `hostCountry`, so the pin lands there with
 * no extra work.
 *
 * Spec: docs/superpowers/specs/2026-08-04-war-declaration-legislation-design.md
 */
export async function declareWar(db: Db, input: DeclareWarInput): Promise<DeclareWarResult> {
  const { declarer, defender, warGoal, billId, currentTurn } = input;

  // ONE war at a time between the same pair, re-checked HERE and not only at
  // proposal. A declaration sits before the chambers for turns; if the two became
  // opposed in a third country's war in the meantime, creating below would open a
  // second war between them — the check the validator already refused.
  const existing = await findWarBetween(db, declarer, defender);
  if (existing) return { conflict: existing, joined: true };

  // A RESOLVED war at this defender must not be resurrected — a fresh declaration
  // starts a fresh war.
  const live = await getConflictsCollection(db).findOne({
    hostCountry: defender,
    status: { $ne: "resolved" },
  });

  if (live) {
    // Enrol on the side opposing the defender, which is not necessarily side B:
    // the defender may already sit on side A of a war someone else started.
    //
    // `sideOf` takes the era's live bloc roll since #4001 — it resolves an unrostered
    // country by matching its bloc against the sides' backers. Loaded here rather
    // than hoisted because enactment runs once per ratified declaration, not per tick.
    const blocs = await loadMilitaryBlocs(db);
    const defenderSide = sideOf(live, defender, blocs);

    // Enforced mutual defence, on the join path. Only when the defender can actually be
    // placed: a null side means we do not know which roster is the defence, and guessing
    // would enrol allies AGAINST the country they came to protect. The declarer's own
    // enrolment keeps its long-standing `?? "A"` fallback below, unchanged.
    if (defenderSide) {
      const defenders = await resolveTreatyDefenders(db, { defender, declarer, conflict: live });
      for (const d of defenders) {
        await joinSide(db, live, d.countryId, defenderSide);
      }
      if (defenders.length > 0) {
        const entries = toTreatyEntries(defenders, defender, currentTurn);
        await getConflictsCollection(db).updateOne({ _id: live._id }, {
          $push: { treatyEntries: { $each: entries } },
        } as never);
        await announceTreatyEntries(db, entries, live.name, currentTurn);
      }
    }

    const target = defenderSide === "A" ? "B" : "A";
    await joinSide(db, live, declarer, target);
    return { conflict: live, joined: true };
  }

  const defenderName = COUNTRY_CONFIGS[defender]?.name ?? defender;
  const declarerName = COUNTRY_CONFIGS[declarer]?.name ?? declarer;

  // Resolved BEFORE createConflict, deliberately. The roster it is handed drives
  // `initialControl`, `deployOpeningForces` (so allies arrive with troops instead of an
  // empty theatre) and `baseStrength = 320 + sideB.countries.length * 60`. Enrolling
  // afterwards with `joinSide` leaves all three computed for a coalition of one.
  const defenders = await resolveTreatyDefenders(db, { defender, declarer });
  const treatyEntries = toTreatyEntries(defenders, defender, currentTurn);

  const conflict = await createConflict(db, {
    id: `war_${declarer}_${defender}_${currentTurn}`.toLowerCase(),
    // Plain hyphen, not an en dash: the war name is player-facing copy and the project
    // bars en dashes there. Conflicts created before this keep their stored name; only
    // new wars are affected.
    name: `${declarerName}-${defenderName} War`,
    hostCountry: defender,
    type: "interstate",
    sideA: { label: declarerName, countries: [declarer], kind: "state" },
    sideB: {
      label: defenderName,
      countries: [defender, ...defenders.map((d) => d.countryId)],
      // Descriptive only: nothing branches on "state" vs "coalition" (only "generated"
      // is ever tested, in createConflict and peaceOffer), but a side of three countries
      // labelled "state" reads as a bug to the next person.
      kind: defenders.length > 0 ? "coalition" : "state",
    },
    createdBy: "player",
    startTurn: currentTurn,
    warGoal,
    declaredByBillId: billId,
    ...(treatyEntries.length > 0 ? { treatyEntries } : {}),
  });
  await announceTreatyEntries(db, treatyEntries, conflict.name, currentTurn);
  return { conflict, joined: false };
}
