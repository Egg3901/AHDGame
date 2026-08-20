/**
 * What a resolved German Question actually does to the world.
 *
 * TWO OUTCOMES, AND ONLY ONE OF THEM IS BUILT.
 *
 * `incumbent` — West Germany stays sovereign in NATO. Nothing is absorbed and
 * no border moves; the crisis closes, both Germanies get a history entry, and a
 * cooldown runs before the question can be asked again. Complete and shipped.
 *
 * `challenger` — the Länder transfer into the GDR, which is renamed Germany and
 * the Federal Republic dissolved. NOT IMPLEMENTED, and deliberately not
 * half-implemented: three capabilities it needs do not exist in this codebase.
 *
 *   1. `evacuateRegionPolitics` relocates a transferring region's NPPs to
 *      another region IN THE SOURCE COUNTRY and dissolves the region's party
 *      layer on the understanding that the source survives and the target
 *      re-seeds. A whole-country absorption has no surviving source, so the
 *      last region transferred has nowhere to send anybody.
 *   2. There is no way to retire a country. `getRegisteredCountryIds` returns
 *      `[...COUNTRY_ORDER, ...activated]` and DE is in the static base list, so
 *      it can be added to but never removed from. Taking DE out of the engine
 *      and the player list IS reachable through `countryGameStates.status` +
 *      `enabledForPlayers`, but that is a different, narrower thing than
 *      dissolving it, and it leaves DE in the registered set.
 *   3. A country's name is seed data. Renaming the GDR to "Germany" has no
 *      runtime mechanism — `COUNTRY_CONFIGS.DD.name` is compiled in.
 *
 * Running a loop of `transferRegion` over DE's Länder without those three would
 * strand every NPP, delete the political layer of a live country, and leave an
 * empty DE enumerated by every server site that walks the country list. The
 * outcome is therefore RECORDED and the map is left alone until the platform
 * work is decided. A resolved-but-unactuated crisis is visible and fixable; a
 * half-merged country is neither.
 */
import type { Db } from "mongodb";
import type { SettlementCrisisDoc, SettlementOutcome } from "@/lib/db/types/settlementCrisis";
import type { CountryId } from "@/lib/constants/countries";
import { SETTLEMENT_REOPEN_COOLDOWN_TURNS } from "@/lib/constants/settlementCrisis";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";

export interface ActuationResult {
  actuated: boolean;
  outcome: SettlementOutcome | null;
  /** True when the outcome is recorded but the world change is not built yet. */
  deferred: boolean;
}

const NONE: ActuationResult = { actuated: false, outcome: null, deferred: false };

export async function actuateSettlementOutcome(
  db: Db,
  crisis: SettlementCrisisDoc,
  currentTurn: number
): Promise<ActuationResult> {
  if (crisis.status !== "resolved" || !crisis.outcome) return NONE;
  // Idempotent: a crisis that already carries a cooldown has been actuated, and
  // the history entries below must not be written twice.
  if (crisis.cooldownUntilTurn !== null) return NONE;

  const crises = await getSettlementCrisesCollection(db);
  // Guarded so two turn runners cannot both write the history entries.
  const claimed = await crises.updateOne(
    { _id: crisis._id, cooldownUntilTurn: null },
    {
      $set: {
        cooldownUntilTurn: currentTurn + SETTLEMENT_REOPEN_COOLDOWN_TURNS,
        updatedAt: new Date(),
      },
    }
  );
  if (claimed.matchedCount !== 1) return NONE;

  const target = crisis.targetEntityId as CountryId;
  const challenger = crisis.challengerEntityId as CountryId;

  if (crisis.outcome === "incumbent") {
    const title = "The German Question closed: the Federal Republic stays sovereign in NATO.";
    for (const countryId of [target, challenger]) {
      await recordCountryEvent(db, {
        countryId,
        turn: currentTurn,
        eventType: "international_relations",
        title,
        details: { crisis: crisis.kind, outcome: crisis.outcome },
      });
    }
    return { actuated: true, outcome: "incumbent", deferred: false };
  }

  // challenger — recorded, not enacted. See the header for the three missing
  // capabilities. The history entry says so plainly rather than implying a
  // border moved.
  const title = "The German Question carried for reunification. The settlement awaits enactment.";
  for (const countryId of [target, challenger]) {
    await recordCountryEvent(db, {
      countryId,
      turn: currentTurn,
      eventType: "international_relations",
      title,
      details: { crisis: crisis.kind, outcome: crisis.outcome, enacted: false },
    });
  }
  return { actuated: true, outcome: "challenger", deferred: true };
}
