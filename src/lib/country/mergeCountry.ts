/**
 * Absorb one country into another.
 *
 * Generic on purpose. The German Question is the first caller, but nothing here
 * knows about Germany: any merge is "move every region across, then retire the
 * shell". Keeping it country-agnostic is also what makes it testable without a
 * seeded world.
 *
 * WHAT THIS IS NOT. It is not a partial transfer. `transferRegion` already does
 * that (Northern Ireland into Ireland) and its contract assumes the source
 * survives — its evacuated NPPs retreat to another of the source's regions and
 * the source keeps its national layer. A merge inverts both: there is no
 * retreat, and the source's national layer stops existing. That difference is
 * why this cannot be a loop over `transferRegion` with the old arguments, and
 * why `relocateToRegionId` grew a null case.
 *
 * ORDER. Regions first, retirement last. A half-run merge then leaves a country
 * with fewer regions but still simulated — recoverable by re-running, because
 * `transferRegion` is idempotent per region and skips ones already moved. The
 * reverse order would retire a country that still owned regions, stranding them
 * in a state nothing enumerates.
 */
import type { Db } from "mongodb";
import type { Corporation, State } from "@/lib/db/types";
import type { BillStatus } from "@/lib/db/types/legislation";
import type { CountryGameState } from "@/lib/db/types/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { officeRemapFor } from "@/lib/country/dissolvingOfficeRemap";
import { transferRegion } from "@/lib/referendum/transfer/transferRegion";
import { computeNationalMetrics } from "@/lib/nationalMetrics";
import { reseedJoinedRegionElections } from "@/lib/referendum/transfer/reseedJoinedRegionElections";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { LOWER_CHAMBER_FAIL_STATUSES } from "@/lib/turn/parliamentaryGovernment";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { blocOrgFor } from "@/lib/world/blocMembership";
import { admitMember } from "@/lib/internationalOrganizations/joinApplication";
import { loadFxScalePair } from "@/lib/country/mergeFxScale";
import { convertCorpCurrency } from "@/lib/corporations/convertCorpCurrency";
import { isMember } from "@/lib/internationalOrganizations/service";
import { removeOrganizationMembership } from "@/lib/internationalOrganizations/withdrawalBills";
import {
  INTERNATIONAL_ORGANIZATIONS,
  type InternationalOrganizationId,
} from "@/lib/constants/internationalOrganizations";

export interface MergeCountryArgs {
  /** The country being absorbed. Retired when this completes. */
  fromCountryId: CountryId;
  /** The country that survives and takes the regions. */
  toCountryId: CountryId;
  currentTurn: number;
  /**
   * On a colliding TARIFF scope, whether the ABSORBED side's record takes the
   * slot. Defaults true, which is the winner-into-shell contract.
   *
   * ⚠️ FALSE WHEN THE SHELL IS THE WINNER. A tariff is legislated policy, not a
   * quantity: with the victor as the surviving shell, letting the absorbed side
   * win the collision would keep the LOSER's trade policy and delete the
   * winner's on the scopes where both had legislated.
   */
  absorbedTariffsWin?: boolean;
}

export interface MergeCountryResult {
  ok: boolean;
  error?: string;
  regionsTransferred: number;
  regionsSkipped: number;
  retired: boolean;
  /** In-flight races of the absorbed country cancelled with it. */
  electionsCancelled?: number;
}

export async function mergeCountry(db: Db, args: MergeCountryArgs): Promise<MergeCountryResult> {
  const { fromCountryId, toCountryId, currentTurn, absorbedTariffsWin = true } = args;
  const empty = { regionsTransferred: 0, regionsSkipped: 0, retired: false };

  if (fromCountryId === toCountryId) {
    return { ok: false, error: "A country cannot absorb itself.", ...empty };
  }

  const gameStates = db.collection<CountryGameState>("countryGameStates");
  const already = await gameStates.findOne({ _id: fromCountryId });
  // Idempotent: a merge that already ran is a no-op, not an error. The turn
  // phase may see the same resolved crisis more than once.
  if (already?.dissolvedTurn != null) {
    return { ok: true, ...empty, retired: true };
  }

  // Refuse to retire a country into one that is itself gone.
  const target = await gameStates.findOne({ _id: toCountryId });
  if (target?.dissolvedTurn != null) {
    return { ok: false, error: "The absorbing country has itself been dissolved.", ...empty };
  }

  const regions = await db
    .collection<State>("states")
    .find(
      { countryId: fromCountryId },
      { projection: { _id: 1, name: 1, region: 1, votingSystem: 1 } }
    )
    .toArray();

  let regionsTransferred = 0;
  let regionsSkipped = 0;

  for (const region of regions) {
    const result = await transferRegion(db, {
      regionId: String(region._id),
      fromCountryId,
      toCountryId,
      // The absorbed country's own name becomes the province label, so a
      // unified state can still tell where a Land came from.
      province: COUNTRY_CONFIGS[fromCountryId].name,
      // The region KEEPS its own electoral system. `convertRegionDoc` defaults to
      // Ireland's PR-STV, which is right for a referendum transfer that converts a
      // region to its new country's rules and wrong for a merge: both halves of a
      // reunifying country already run the same elections, and switching them is a
      // constitutional change nobody agreed to.
      votingSystem: region.votingSystem,
      // The two COUNTRY-wide passes are deferred and run ONCE below. Per region
      // they are the same whole-world metrics recompute and the same
      // whole-country election re-seed, repeated for every Land — sixteen times
      // over for a German reunification. That is what made this too slow to
      // finish inside the request that started it.
      deferCountryWidePasses: true,
      // NULL: the source is dissolving, so nobody retreats into it.
      relocateToRegionId: null,
      currentTurn,
    });
    if (!result.ok) {
      // Stop at the first genuine failure rather than pressing on: a merge that
      // moved half a country and then retired it is worse than one that stopped
      // and can be re-run.
      return {
        ok: false,
        error: `Region ${String(region._id)} could not transfer (${result.skipped ?? "unknown"}).`,
        regionsTransferred,
        regionsSkipped,
        retired: false,
      };
    }
    if (result.skipped === "already-transferred") regionsSkipped++;
    else regionsTransferred++;
  }

  // The country-wide passes each region transfer deferred, run ONCE now that the
  // whole border has moved. Same end state, a fraction of the work: both read the
  // world as it stands rather than as it stood mid-loop, so running them per
  // region only ever produced intermediate answers that the next region replaced.
  //
  // Best-effort, matching how `transferRegion` treats the election re-seed: the
  // regions have already moved, and the turn's own phases recompute both. A
  // failure here must not fail a merge that has otherwise completed.
  await computeNationalMetrics(db).catch((err) =>
    console.error(`${fromCountryId}->${toCountryId} national metrics recompute failed:`, err)
  );
  await reseedJoinedRegionElections(db, toCountryId, new Date()).catch((err) =>
    console.error(`${toCountryId} election re-seed failed (retries next turn):`, err)
  );

  // National remnants the region loop cannot reach. Every step is filter-
  // idempotent (a re-run finds nothing still keyed to the source), and all run
  // BEFORE the shell retires so a failure leaves a recoverable, still-live
  // source rather than a retired country with dangling rows.
  await transferOrRetireOrgMemberships(db, fromCountryId, toCountryId, currentTurn);
  await sweepNationalStrays(db, fromCountryId, toCountryId, absorbedTariffsWin);
  const electionsCancelled = await cancelAbsorbedElections(db, fromCountryId, toCountryId);

  // Retire the shell. Not deletion — the documents stay for history and the
  // wiki; the country simply stops being enumerated, simulated, or joinable.
  await gameStates.updateOne(
    { _id: fromCountryId },
    {
      $set: {
        dissolvedTurn: currentTurn,
        enabledForPlayers: false,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  const fromName = COUNTRY_CONFIGS[fromCountryId].name;
  const toName = COUNTRY_CONFIGS[toCountryId].name;
  await recordCountryEvent(db, {
    countryId: toCountryId,
    turn: currentTurn,
    eventType: "region_transferred",
    title: `${fromName} was absorbed into ${toName}.`,
    details: {
      fromCountryId,
      toCountryId,
      regionsTransferred,
      electionsCancelled,
      merge: true,
    },
  });

  return { ok: true, regionsTransferred, regionsSkipped, retired: true, electionsCancelled };
}

/**
 * Bill statuses a country's dissolution can still overtake: the chamber-
 * dissolution list (one shared taxonomy — a status added there is
 * automatically overtaken here too) PLUS the past-the-floor statuses a
 * chamber dissolution spares but a COUNTRY dissolution cannot. `enrolled` and
 * `cabinet_review` are pending business until signed, and a bill cannot be
 * signed by a government that no longer exists. Everything else (`signed`,
 * `failed`, `withdrawn`, `override_failed`) is already terminal.
 */
const NON_TERMINAL_BILL_STATUSES: BillStatus[] = [
  ...LOWER_CHAMBER_FAIL_STATUSES,
  "enrolled",
  "cabinet_review",
  "filibustered",
];

/**
 * Move the dissolving country's organisation memberships to the survivor.
 *
 * BLOC organisations (the era's two poles) are deliberately EXCLUDED: which
 * alliance the unified state ends up in is a settlement outcome, decided by
 * `adoptChallengerSettlement` with its own carefully-ordered joins and
 * withdrawals — transferring a Pact seat here would race that logic. Everything
 * else (COMECON, the UN, player-founded bodies) is ordinary membership: the
 * survivor inherits the seat unless it already holds one, and the dissolved
 * country comes off the roll either way — through `removeOrganizationMembership`,
 * the shared live-withdrawal path, so pending leadership ballots are cleaned and
 * the remaining members are told.
 */
async function transferOrRetireOrgMemberships(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId,
  currentTurn: number
): Promise<void> {
  const memberships = (await db
    .collection("organizationMemberships")
    .find({ countryId: fromCountryId })
    .toArray()) as unknown as Array<{ organizationId: string }>;
  if (memberships.length === 0) return;

  const preset = await getGameStatePresetOrDefault(db);
  const blocOrgs = new Set(
    [blocOrgFor(preset, "west"), blocOrgFor(preset, "east")].filter(Boolean) as string[]
  );

  for (const membership of memberships) {
    const orgId = membership.organizationId as InternationalOrganizationId;
    if (blocOrgs.has(orgId)) continue;

    if (!(await isMember(db, orgId, toCountryId))) {
      await admitMember(db, orgId, toCountryId, currentTurn);
    }
    const name =
      INTERNATIONAL_ORGANIZATIONS[orgId as keyof typeof INTERNATIONAL_ORGANIZATIONS]?.name ?? orgId;
    await removeOrganizationMembership(db, fromCountryId, orgId, name, currentTurn);
  }
}

/**
 * National rows with no region to ride and no dedicated merge module.
 *
 *  - NPPs in the national pool (`homeState: ""`) are invisible to the region
 *    sweep, which keys on `homeState`; they cross by countryId.
 *  - Tariff records are the dissolved state's trade policy; the unified state
 *    inherits the ones that do not collide with its own, and `absorbedTariffsWin`
 *    decides which side yields on the ones that do.
 *  - Bills still in flight LAPSE first: the same shape the chamber-dissolution
 *    path writes (`failInProgressBills`), applied to every non-terminal status
 *    because here the whole country, not one chamber, stops existing.
 *  - THEN the whole legislative corpus re-scopes to the survivor. This is not
 *    optional tidiness: the trade turn REBUILDS tariff and embargo records
 *    from signed bills keyed by `bill.countryId`, so a carried tariff whose
 *    enacting bill stayed behind would be deleted and re-created for the
 *    dissolved country on the next reconcile. The survivor inherits the
 *    predecessor state's bill history the same way it inherited its enacted
 *    law book.
 */
async function sweepNationalStrays(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId,
  absorbedTariffsWin: boolean
): Promise<void> {
  const now = new Date();
  await db
    .collection("npps")
    .updateMany({ countryId: fromCountryId }, { $set: { countryId: toCountryId, updatedAt: now } });
  // NATIONAL-scope subsidies: the region-scoped rows crossed with their regions
  // (the `subsidies` collection is in REGION_SCOPED_COLLECTIONS by stateId), so
  // whatever still carries the old countryId here is a national programme — the
  // unified treasury inherits the obligation.
  await db
    .collection("subsidies")
    .updateMany({ countryId: fromCountryId }, { $set: { countryId: toCountryId, updatedAt: now } });
  // Tariffs are collision-aware IN THE WINNER'S FAVOUR: where BOTH states
  // legislated a tariff on the same scope (same sector, same origin country,
  // same corporation, or both economy-wide), one record has to go, because two
  // live records on one scope would double-apply.
  //
  // WHICH ONE depends on which side won, not on which side is the shell. A merge
  // normally runs winner-into-shell, so the absorbed side's record takes the slot
  // and that is the default. When the SURVIVOR is the victor the rule inverts:
  // keeping the absorbed record would leave the defeated state's trade policy
  // standing and delete the winner's. A tariff is legislated policy, so it
  // follows the winner exactly as the tax code and the reserve law do.
  //
  // Later legislation by the unified government supersedes either through the
  // normal reconcile (enactment order), which is the ordinary lex-posterior rule.
  // BOTH SIDES OF THE COMPARISON MOVE TOGETHER. The scopes are read from the side
  // that WINS and the delete lands on the side that loses; taking the scopes from
  // one fixed side and only flipping the delete would match every one of the
  // loser's own records against its own scope list and wipe its entire trade
  // policy, colliding or not.
  const tariffWinner = absorbedTariffsWin ? fromCountryId : toCountryId;
  const tariffLoser = absorbedTariffsWin ? toCountryId : fromCountryId;
  const winningTariffs = (await db
    .collection("tariffs")
    .find({ countryId: tariffWinner })
    .toArray()) as unknown as Array<{
    scopeType: string;
    targetSectorType?: unknown;
    targetOriginCountryId?: unknown;
    targetCorporationId?: unknown;
  }>;
  if (winningTariffs.length > 0) {
    // One $or delete for every colliding scope, not a round trip per tariff.
    // An explicit null in each key matches both a missing and a null field, so
    // "economy_wide vs economy_wide" collides exactly like a shared sector.
    await db.collection("tariffs").deleteMany({
      countryId: tariffLoser,
      $or: winningTariffs.map((tariff) => ({
        scopeType: tariff.scopeType,
        targetSectorType: tariff.targetSectorType ?? null,
        targetOriginCountryId: tariff.targetOriginCountryId ?? null,
        targetCorporationId: tariff.targetCorporationId ?? null,
      })),
    });
  }
  await db
    .collection("tariffs")
    .updateMany({ countryId: fromCountryId }, { $set: { countryId: toCountryId, updatedAt: now } });
  await db
    .collection("bills")
    .updateMany(
      { countryId: fromCountryId, status: { $in: NON_TERMINAL_BILL_STATUSES } },
      { $set: { status: "failed", failedAt: now, updatedAt: now } }
    );
  await db
    .collection("bills")
    .updateMany({ countryId: fromCountryId }, { $set: { countryId: toCountryId, updatedAt: now } });
  await mergeNationalCorporations(db, fromCountryId, toCountryId, now);
}

/**
 * Carry the absorbed state's corporations onto the survivor, leaving exactly ONE
 * `isPrimaryNationalCorporation`.
 *
 * A National Corporation is national by definition: `buildNationalCorporationDoc`
 * gives it `headquartersState: ""`. Every other corporation crosses a merge by
 * riding its HQ region — `evacuateRegionPolitics` re-scopes domicile that way and
 * `convertTransferredResidentsCurrency` re-denominates the same way — so a
 * corporation in no region was reached by neither pass, and there was no third
 * one. This is that third pass: ownership, domicile, denomination, then the fold.
 *
 * THE FOLD IS THE POINT. Two corporations for one country both flagged primary
 * is not cosmetic, because every resolver reads the primary with a SINGLE
 * document query — `ensurePrimaryNationalCorporation`, the sovereign bond issuer
 * lookup, the state-ownership page, the State Enterprises panel. A single read
 * over two matches returns whichever the natural order yields, on live data the
 * ABSORBED shell, so every merge-back, nationalisation and bond tranche routed
 * into a corporation whose state no longer existed while the survivor's own
 * corporation kept the coupon liability and earned nothing against it
 * (ticket #1254). No tiebreak in the resolver can recover this — nothing on the
 * document says which of the two the country means — so it is fixed here.
 *
 * Money-neutral, matching `mergeBackSectorType`: a National Corporation has no
 * private shareholders, so its sectors, its bonds, its shareholdings and its cash
 * follow it onto the survivor and the empty shell is dissolved.
 *
 * Cash still moves only at a MATCHING currency. The conversion above normally
 * makes that true, so the mismatch branch is the missing-rate case rather than an
 * ordinary one: there the shell keeps its balance and is demoted instead of
 * dissolved, leaving the money visible on a named corporation rather than
 * swallowed into a wrong-denomination total.
 */
async function mergeNationalCorporations(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId,
  now: Date
): Promise<void> {
  const corps = db.collection("corporations");

  const incumbentId = (
    await corps.findOne(
      { countryOwnerId: toCountryId, isPrimaryNationalCorporation: true },
      { projection: { _id: 1 } }
    )
  )?._id;
  const absorbedIds = (
    await corps
      .find(
        { countryOwnerId: fromCountryId, isPrimaryNationalCorporation: true },
        { projection: { _id: 1 } }
      )
      .toArray()
  ).map((c) => c._id);

  // Corporations the REGION sweep cannot reach, captured before the re-scope
  // below makes them indistinguishable from the survivor's own. Both
  // `evacuateRegionPolitics` (domicile) and `convertTransferredResidentsCurrency`
  // (denomination) key on `headquartersState`, and
  // `buildNationalCorporationDoc` sets it to "" — a National Corporation sits in
  // no region — so neither pass has ever touched one.
  const strandedIds = (
    await corps
      .find(
        {
          countryId: fromCountryId,
          $or: [
            { headquartersState: "" },
            { headquartersState: null },
            { headquartersState: { $exists: false } },
          ],
        },
        { projection: { _id: 1 } }
      )
      .toArray()
  ).map((c) => c._id);

  // Everything the dissolved state owned is now owned by the survivor.
  await corps.updateMany(
    { countryOwnerId: fromCountryId },
    { $set: { countryOwnerId: toCountryId, updatedAt: now } }
  );

  // Domicile follows the state. Keyed on `countryId`, NOT on ownership: a firm
  // the dissolved state had nationalised ABROAD keeps its own domicile. Owning a
  // company is not the same as housing it, and conflating the two is how a merge
  // quietly annexes a foreign multinational.
  await corps.updateMany(
    { countryId: fromCountryId },
    { $set: { countryId: toCountryId, updatedAt: now } }
  );

  // Denomination follows the domicile, through the SHARED converter so a
  // National Corporation's capital, its sectors and its open orders all cross at
  // the one merge rate every other pot of money crosses at. Left undone, the
  // unified state's own enterprises keep quoting the currency of the country
  // that stopped existing.
  //
  // A missing rate leaves the balance alone rather than converting at 1. That is
  // the resident converter's policy, not the national treasury's, and it applies
  // here for the reason the treasury's does not: a corporation SURVIVES the
  // merge, so a later pass can still re-denominate it, whereas a dissolved
  // country's ledger has no later pass.
  if (strandedIds.length > 0) {
    const pair = await loadFxScalePair(db, fromCountryId, toCountryId);
    if (pair.kind === "convert") {
      const stranded = (await corps
        .find({ _id: { $in: strandedIds } })
        .toArray()) as unknown as Corporation[];
      for (const corp of stranded) {
        await convertCorpCurrency(db, corp, pair.newCurrency, pair.fxByCurrency, now, true);
      }
    }
  }

  // With no incumbent the first absorbed primary simply becomes the survivor's —
  // returning here instead would leave the unified country with every absorbed
  // primary still flagged, which is the same two-primary state on a country that
  // had one of its own. The rest fold into it exactly as they would into an
  // incumbent.
  const survivorId = incumbentId ?? absorbedIds[0];
  if (!survivorId) return;

  // Re-read AFTER the re-scope and the conversion: the balances and currency
  // codes the fold below reasons about are the converted ones, not the values
  // these documents held when the merge started.
  const survivor = await corps.findOne({ _id: survivorId });
  if (!survivor) return;
  const absorbed = await corps.find({ _id: { $in: absorbedIds } }).toArray();

  for (const shell of absorbed) {
    if (String(shell._id) === String(survivor._id)) continue;

    await db
      .collection("corporateSectors")
      .updateMany(
        { corporationId: shell._id },
        { $set: { corporationId: survivor._id, updatedAt: now } }
      );
    await db
      .collection("bonds")
      .updateMany(
        { corporationId: shell._id },
        { $set: { corporationId: survivor._id, issuerName: survivor.name, updatedAt: now } }
      );
    await repointShareholderEntries(db, shell._id, survivor._id, now);

    const cash = Number(shell.liquidCapital ?? 0);
    const sameCurrency =
      (shell.liquidCurrencyCode ?? null) === (survivor.liquidCurrencyCode ?? null);
    if (cash !== 0 && sameCurrency) {
      await corps.updateOne(
        { _id: survivor._id },
        { $inc: { liquidCapital: cash }, $set: { updatedAt: now } }
      );
      await corps.updateOne({ _id: shell._id }, { $set: { liquidCapital: 0, updatedAt: now } });
    }

    // Anyone holding shares IN the shell would lose them with the document, so a
    // shell that was ever floated is demoted rather than dissolved. A National
    // Corporation is built with `totalShares: 0`, so this is a guard against the
    // unexpected, not an ordinary path.
    const hasOwnHolders = Array.isArray(shell.shareholders) && shell.shareholders.length > 0;
    if ((cash === 0 || sameCurrency) && !hasOwnHolders) {
      await corps.deleteOne({ _id: shell._id });
    } else {
      // Demote but keep: the invariant that matters is one PRIMARY, and a
      // stranded balance is easier to find on a named corporation than in a
      // deleted one.
      await corps.updateOne(
        { _id: shell._id },
        { $set: { isPrimaryNationalCorporation: false, updatedAt: now } }
      );
    }
  }
}

/**
 * Move a dissolving corporation's SHAREHOLDINGS onto the survivor.
 *
 * A holding is stored on the ISSUER, as an entry in its `shareholders` array
 * keyed by the holder's `corporationId` — so a National Corporation's portfolio
 * lives scattered across every company it part-owns, not on its own document.
 * Deleting the shell without this leaves those entries naming a corporation that
 * no longer exists, and the shares belong to nobody.
 *
 * Entries MERGE rather than accumulate. Two rows for one holder is the same
 * duplicate the nationalisation heal exists to prevent, and every reader takes
 * the first match. Cost basis is combined share-weighted, so the merged position
 * reports the price the state actually paid across both parcels.
 */
async function repointShareholderEntries(
  db: Db,
  fromCorpId: unknown,
  toCorpId: unknown,
  now: Date
): Promise<void> {
  const corps = db.collection("corporations");
  const issuers = await corps.find({ "shareholders.corporationId": fromCorpId }).toArray();

  for (const issuer of issuers) {
    const entries = (issuer.shareholders ?? []) as Array<{
      corporationId?: unknown;
      shares?: number;
      avgCostPerShare?: number;
    }>;
    const isFrom = (e: { corporationId?: unknown }) =>
      e.corporationId != null && String(e.corporationId) === String(fromCorpId);
    const isTo = (e: { corporationId?: unknown }) =>
      e.corporationId != null && String(e.corporationId) === String(toCorpId);

    const moving = entries.filter(isFrom);
    if (moving.length === 0) continue;
    const standing = entries.filter(isTo);

    const shares =
      moving.reduce((a, e) => a + Number(e.shares ?? 0), 0) +
      standing.reduce((a, e) => a + Number(e.shares ?? 0), 0);
    const cost =
      moving.reduce((a, e) => a + Number(e.shares ?? 0) * Number(e.avgCostPerShare ?? 0), 0) +
      standing.reduce((a, e) => a + Number(e.shares ?? 0) * Number(e.avgCostPerShare ?? 0), 0);

    const merged = {
      corporationId: toCorpId,
      shares,
      avgCostPerShare: shares > 0 ? cost / shares : 0,
    };
    const kept = entries.filter((e) => !isFrom(e) && !isTo(e));

    await corps.updateOne(
      { _id: issuer._id },
      { $set: { shareholders: [...kept, merged], updatedAt: now } }
    );
  }
}

/**
 * Cancel the absorbed country's in-flight races instead of handing them to the
 * survivor.
 *
 * WHY THIS EXISTS. The region sweep deletes each transferred region's
 * source-country races as it goes, but only those still keyed to the SOURCE.
 * A race that arrives under the SURVIVOR's id with the absorbed side's
 * electionType is invisible to that filter: `rescopeRegionToCountry` re-keys
 * `elections` by region, and a race whose `electionType` belongs to the
 * dissolved constitution (East Germany's `bundestag` / `landtag` /
 * `ministerPresident` when the GDR is the shell that survives) crosses the
 * border as an active race the survivor never scheduled. The turn's
 * resolution machinery seats its winners into offices the survivor's
 * constitution does not define, and the player sees BOTH parliaments
 * campaigning at once — the reunified Germany running Bundestag and
 * Volkskammer races side by side (ticket #1252).
 *
 * So the merge CANCELS them, exactly as `evacuateRegionPolitics` cancels the
 * per-region races: the race belongs to an office the settlement ends, its
 * candidates were standing for a country that stops existing, and the design
 * is that the carried chamber keeps sitting rather than being re-elected —
 * no election is called post-merge. Deleting the in-flight race (and its
 * candidates, so nobody stays filed for a phantom contest) is what leaves
 * the survivor running only its own election families.
 *
 * TWO CATCHES, both covering races that escaped the per-region sweep:
 *  - still keyed to the DISSOLVED country (a region the sweep has not
 *    reached, or a doc the re-key never matched);
 *  - keyed to the SURVIVOR but carrying an electionType that belonged to the
 *    dissolved constitution — the re-keyed race whose office name crossed the
 *    border while the constitution it belonged to did not.
 *
 * The second filter reads `officeRemapFor` so it only fires for pairs with a
 * declared mapping (a genuine merge of two constitutions). Any other pair
 * falls through to the first catch alone, and generic region transfers —
 * where the source SURVIVES — are untouched: this runs only inside a merge.
 *
 * Idempotent by construction: a re-run finds nothing left to cancel.
 */
async function cancelAbsorbedElections(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<number> {
  const live = { status: { $in: ["active", "upcoming"] as const } };

  // 1. Every live race still keyed to the country being absorbed.
  const strays = (await db
    .collection<{ _id: import("mongodb").ObjectId }>("elections")
    .find({ countryId: fromCountryId, ...live })
    .project({ _id: 1 })
    .toArray()) as unknown as Array<{ _id: import("mongodb").ObjectId }>;

  // 2. Live races on the SURVIVOR whose electionType belongs to the dissolved
  //    constitution — they arrived through the region re-key. The office remap
  //    table tells us which types were the absorbed side's (mapped or retiring,
  //    both end with the country); a type it does not name is some third
  //    constitution's business and is left alone. The survivor never scheduled
  //    these races itself — its own spawners only ever create its declared
  //    office families — so cancelling loses no contest the survivor's own
  //    machinery would not re-run.
  const table = officeRemapFor(fromCountryId, toCountryId);
  const absorbedTypes = new Set(table ? Object.keys(table) : []);
  const survivorLive = (await db
    .collection<{ _id: import("mongodb").ObjectId; electionType: string }>("elections")
    .find({ countryId: toCountryId, ...live })
    .project({ _id: 1, electionType: 1 })
    .toArray()) as unknown as Array<{ _id: import("mongodb").ObjectId; electionType: string }>;
  const foreign = survivorLive.filter((e) => absorbedTypes.has(e.electionType));

  const ids = [...strays, ...foreign].map((e) => e._id);
  if (ids.length === 0) return 0;

  await db.collection("electionCandidates").deleteMany({ electionId: { $in: ids } });
  const res = await db.collection("elections").deleteMany({ _id: { $in: ids } });
  if ((res?.deletedCount ?? 0) > 0) {
    console.log(
      `[mergeCountry] ${fromCountryId}->${toCountryId}: cancelled ${res.deletedCount} in-flight ` +
        `election(s) of the absorbed country`
    );
  }
  return res?.deletedCount ?? 0;
}
