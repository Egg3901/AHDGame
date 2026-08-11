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
    const target = defenderSide === "A" ? "B" : "A";
    await joinSide(db, live, declarer, target);
    return { conflict: live, joined: true };
  }

  const defenderName = COUNTRY_CONFIGS[defender]?.name ?? defender;
  const declarerName = COUNTRY_CONFIGS[declarer]?.name ?? declarer;
  const conflict = await createConflict(db, {
    id: `war_${declarer}_${defender}_${currentTurn}`.toLowerCase(),
    name: `${declarerName}–${defenderName} War`,
    hostCountry: defender,
    type: "interstate",
    sideA: { label: declarerName, countries: [declarer], kind: "state" },
    sideB: { label: defenderName, countries: [defender], kind: "state" },
    createdBy: "player",
    startTurn: currentTurn,
    warGoal,
    declaredByBillId: billId,
  });
  return { conflict, joined: false };
}
