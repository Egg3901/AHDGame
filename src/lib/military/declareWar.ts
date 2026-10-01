import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { createConflict } from "@/lib/military/createConflict";
import { joinSide } from "@/lib/military/joinSide";
import { findWarBetween } from "@/lib/military/findWarBetween";
import { sideOf } from "@/lib/military/occupation";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { resolveTreatyDefenders, toTreatyEntries } from "@/lib/military/treatyDefence";
import { announceTreatyEntries } from "@/lib/military/treatyEntryNotice";
import { enactImmediateWarEntry } from "@/lib/military/warEntryPolicy";
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
      const opposing = (defenderSide === "A" ? live.sideB : live.sideA).countries;
      const defenders = await resolveTreatyDefenders(db, {
        defender,
        attackers: [declarer, ...opposing.filter((c) => c !== declarer)],
        conflict: live,
        currentTurn,
      });
      // The same entry primitive the per-turn reconciliation and the bloc
      // collective-defence resolution use: roster, `joinTurns`, a reserve commitment
      // to the front, and the treaty entry. One path, so an ally pulled in here pays
      // exactly what an ally pulled in on any later turn pays.
      for (const d of defenders) {
        await enactImmediateWarEntry({
          db,
          conflict: live,
          countryId: d.countryId,
          side: defenderSide,
          organizationId: d.organizationId,
          currentTurn,
          stake: "collective_defense",
          defendingCountryId: defender,
          organizationName: d.organizationName,
          basis: d.basis,
        });
      }
      await announceTreatyEntries(
        db,
        toTreatyEntries(defenders, defender, currentTurn),
        live.name,
        currentTurn
      );
    }

    const target = defenderSide === "A" ? "B" : "A";
    await joinSide(db, live, declarer, target, currentTurn);
    return { conflict: live, joined: true };
  }

  const defenderName = COUNTRY_CONFIGS[defender]?.name ?? defender;
  const declarerName = COUNTRY_CONFIGS[declarer]?.name ?? declarer;

  // Resolved BEFORE createConflict, deliberately. The roster it is handed drives
  // `initialControl`, `deployOpeningForces` (so allies arrive with troops instead of an
  // empty theatre) and `baseStrength = 320 + sideB.countries.length * 60`. Enrolling
  // afterwards with `joinSide` leaves all three computed for a coalition of one.
  const defenders = await resolveTreatyDefenders(db, {
    defender,
    attackers: [declarer],
    currentTurn,
  });
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
