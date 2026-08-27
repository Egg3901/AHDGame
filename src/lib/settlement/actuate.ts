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
import { isMember } from "@/lib/internationalOrganizations/service";
import { removeOrganizationMembership } from "@/lib/internationalOrganizations/withdrawalBills";
import {
  INTERNATIONAL_ORGANIZATIONS,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";

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
 * over in a single write.
 *
 * Bloc membership is an organisation row, so the re-alignment is three ordinary
 * membership writes rather than anything bespoke: the survivor LEAVES the western
 * alliance, JOINS the eastern one, and the dissolved challenger comes off both
 * rolls. Each step's ordering is argued at its call site — all three are
 * unretryable, because the cooldown is claimed before any of them run.
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
  //
  // EVERYTHING BELOW HANGS OFF THAT SAME GATE. Stripping the western alliance in
  // an era with no eastern one to join would leave a unified Germany aligned
  // with nobody, which is not "the honest answer" — it is a third outcome the
  // design never described, reached silently. No Pact, no re-alignment.
  if (!pactOrg) return;

  const westOrg = blocOrgFor(preset, "west");
  // ONE GERMANY, ONE ALLIANCE. `admitMember` only ever inserts, so without the
  // withdrawal a surviving shell already in NATO — which DE is, in the 1953 era —
  // comes out of reunification holding a row in BOTH poles. That is not a
  // cosmetic duplicate: `loadBlocMembership` writes `out[countryId] = bloc` per
  // row with no precedence, so which bloc a unified Germany reads as would come
  // down to the order Mongo happened to return two documents in, and every
  // military and alignment call downstream reads that map.
  //
  // WEST FIRST, THEN EAST, and the order is load-bearing. `actuateSettlementOutcome`
  // claims the cooldown before any of this runs, so it never retries: whatever
  // state a throw in the middle leaves behind is permanent. Ending up in NEITHER
  // pole is wrong but deterministic and legible to an admin; ending up in BOTH is
  // the non-deterministic read above. Fail toward the one somebody can see.
  await leaveBloc(db, westOrg, pactOrg, {
    countryId: params.survivor,
    currentTurn: params.currentTurn,
  });
  await admitMember(db, pactOrg, params.survivor, params.currentTurn);

  // The absorbed state is dissolved, and `mergeCountry` does not touch
  // organisation rows — it moves regions and retires the shell. Left alone, the
  // GDR stays on the Warsaw Pact roll for ever: `getMembers` keeps listing it and
  // `loadBlocMembership` keeps answering "east" for a country that no longer
  // exists. `votingMembers` already drops it (the retirement clears
  // `enabledForPlayers`), so this is about the roll a player reads, and about not
  // leaving a dissolved country holding a chair it can never vacate.
  //
  // Bloc organisations ONLY. A dissolved country lingering in COMECON or the UN is
  // the same defect, but it belongs to `mergeCountry` — every merge has it, not
  // just this one — and inventing a general cleanup here would hide it.
  //
  // LAST, and after the admission, by the same argument as the ordering above: a
  // throw here leaves the survivor correctly in the Pact with a stale GDR row
  // beside it, which is untidy. Moving it earlier would trade that for a survivor
  // in no alliance at all, which is the state the design has no name for.
  //
  // A Set because the two poles can resolve to the same organisation in a
  // misconfigured era, and withdrawing twice would write the history entry twice.
  for (const orgId of new Set([pactOrg, westOrg])) {
    await leaveBloc(db, orgId, null, {
      countryId: params.absorbed,
      currentTurn: params.currentTurn,
    });
  }
}

/**
 * Take a country out of one bloc organisation, if it is actually in it.
 *
 * `removeOrganizationMembership` and NOT `withdrawFromOrg`, which is the other
 * function in this codebase with this shape. That one is unreferenced, takes a
 * character it only uses for a history detail, terminates every affected
 * agreement outright, and never touches pending leadership elections. This one
 * is the path a real withdrawal already goes through — its own header says it is
 * shared by the two live leave routes "so both behave identically" — and it
 * additionally rejects leadership elections the leaver is standing in or
 * nominating, and tells the REMAINING members somebody left. A settlement that
 * dissolved a country should not leave it on a ballot inside the alliance it
 * just left.
 *
 * The membership test is not belt-and-braces. Every side effect above fires
 * unconditionally, including a history entry written to each remaining member —
 * so calling this for a country that was never in the organisation would tell
 * the whole alliance about a withdrawal that never happened.
 *
 * `skip` guards the degenerate era where one organisation carries both poles:
 * withdrawing from the alliance we are about to join would undo the admission.
 */
async function leaveBloc(
  db: Db,
  orgId: string | null,
  skip: string | null,
  params: { countryId: CountryId; currentTurn: number }
): Promise<void> {
  if (!orgId || orgId === skip) return;
  const org = orgId as InternationalOrganizationId;
  if (!(await isMember(db, org, params.countryId))) return;
  // Bloc organisations are always built-in — `loadBlocMembership` drops any
  // channel whose id is not in this table, so `blocOrgFor` cannot return a custom
  // one and the constant lookup needs no database read.
  //
  // The `keyof` cast is load-bearing: `InternationalOrganizationId` also covers
  // player-founded organisations, which this table does not key, so indexing it
  // with the wider type is an implicit `any`. The `?? org` below is what makes the
  // cast safe rather than merely quiet.
  const name =
    INTERNATIONAL_ORGANIZATIONS[org as keyof typeof INTERNATIONAL_ORGANIZATIONS]?.name ?? org;
  await removeOrganizationMembership(db, params.countryId, org, name, params.currentTurn);
}
