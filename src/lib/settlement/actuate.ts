/**
 * What a resolved German Question actually does to the world.
 *
 * `incumbent` — West Germany stays sovereign in NATO. Nothing is absorbed and
 * no border moves; the crisis closes, both Germanies get a history entry, and a
 * cooldown runs before the question can be asked again.
 *
 * `challenger` — the two Germanies become one, in the Warsaw Pact, under a
 * one-party constitutional settlement.
 *
 * WHICH SHELL SURVIVES, AND WHY IT IS DE.
 *
 * The design called for the winner's shell to survive, which would mean the GDR
 * absorbing the Federal Republic. That is not buildable and the reason is not
 * effort — a country's NAME is seed data (`countryState` calls it immutable,
 * `COUNTRY_CONFIGS.DD.name` is compiled in and read at ~90 synchronous call
 * sites, many of them client components). A unified Germany that renders as
 * "East Germany" everywhere is not the outcome the design describes.
 *
 * DE survives instead, and the outcome supplies the CHARACTER rather than the
 * shell: DE is already named "Germany", `governmentType` genuinely is runtime
 * state (`countryState`, which is how post-conversion head-of-government
 * resolution already works), and bloc membership is a document. So a unified
 * socialist Germany in the Warsaw Pact is expressible today, while a renamed
 * GDR is not.
 *
 * What a player sees is identical: one country called Germany, one-party, in
 * the Pact, holding every Land. Only the surviving document id differs — and
 * DD, not DE, is the one with players to carry across, which `mergeCountry`
 * does by bringing residents over with their regions.
 */
import type { Db } from "mongodb";
import type { SettlementCrisisDoc, SettlementOutcome } from "@/lib/db/types/settlementCrisis";
import type { CountryId } from "@/lib/constants/countries";
import { SETTLEMENT_REOPEN_COOLDOWN_TURNS } from "@/lib/constants/settlementCrisis";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { mergeCountry } from "@/lib/country/mergeCountry";
import { getCountryState } from "@/lib/countryState";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { blocOrgFor } from "@/lib/world/blocMembership";
import { admitMember } from "@/lib/internationalOrganizations/joinApplication";

export interface ActuationResult {
  actuated: boolean;
  outcome: SettlementOutcome | null;
  /** True when the outcome is recorded but the world change did not complete. */
  deferred: boolean;
  error?: string;
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

  // challenger — the merge. `target` (DE) is the surviving shell; `challenger`
  // (DD) is absorbed into it. See the header for why that direction.
  const merged = await mergeCountry(db, {
    fromCountryId: challenger,
    toCountryId: target,
    currentTurn,
  });
  if (!merged.ok) {
    // The cooldown is already claimed, so this will not retry on the next tick.
    // Report the failure rather than a success the map does not show.
    return {
      actuated: false,
      outcome: "challenger",
      deferred: true,
      error: merged.error ?? "The merge did not complete.",
    };
  }

  // The unified state takes the winner's constitutional settlement. Both of
  // these are runtime documents, which is exactly why this direction is the
  // buildable one.
  await adoptChallengerSettlement(db, {
    survivor: target,
    absorbed: challenger,
    currentTurn,
  });

  await recordCountryEvent(db, {
    countryId: target,
    turn: currentTurn,
    eventType: "international_relations",
    title: "The German Question carried: one Germany, in the Warsaw Pact.",
    details: {
      crisis: crisis.kind,
      outcome: crisis.outcome,
      absorbed: challenger,
      regionsTransferred: merged.regionsTransferred,
    },
  });
  return { actuated: true, outcome: "challenger", deferred: false };
}

/**
 * Give the surviving shell the winner's character: the absorbed state's
 * government type, and its side of the Cold War.
 *
 * `countryState.governmentType` is read at runtime by `getHeadOfGovernment` and
 * `isSittingLeader`, so flipping it moves the whole executive-resolution path
 * over in a single write. Bloc membership is an organisation row, so the
 * unified state joins the Pact the same way any country does.
 */
async function adoptChallengerSettlement(
  db: Db,
  params: { survivor: CountryId; absorbed: CountryId; currentTurn: number }
): Promise<void> {
  const absorbedState = await getCountryState(db, params.absorbed);
  await getCountryStateCollection(db).updateOne(
    { _id: params.survivor },
    { $set: { governmentType: absorbedState.governmentType, updatedAt: new Date() } },
    { upsert: true }
  );

  const preset = await getGameStatePresetOrDefault(db);
  const pactOrg = blocOrgFor(preset, "east");
  // Silent no-op when the era has no eastern accession organisation — the
  // honest answer rather than inventing a membership in a body that never
  // existed in this world's year.
  if (pactOrg) {
    await admitMember(db, pactOrg, params.survivor, params.currentTurn);
  }
}
