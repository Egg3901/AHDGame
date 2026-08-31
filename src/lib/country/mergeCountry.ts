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
import type { State } from "@/lib/db/types";
import type { BillStatus } from "@/lib/db/types/legislation";
import type { CountryGameState } from "@/lib/db/types/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { transferRegion } from "@/lib/referendum/transfer/transferRegion";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { LOWER_CHAMBER_FAIL_STATUSES } from "@/lib/turn/parliamentaryGovernment";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { blocOrgFor } from "@/lib/world/blocMembership";
import { admitMember } from "@/lib/internationalOrganizations/joinApplication";
import { isMember } from "@/lib/internationalOrganizations/service";
import { removeOrganizationMembership } from "@/lib/internationalOrganizations/withdrawalBills";
import {
  INTELLIGENCE_AGENCIES,
  INTELLIGENCE_COVERAGE,
  INTELLIGENCE_NETWORKS,
} from "@/lib/db/collections/intelligence";
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
}

export interface MergeCountryResult {
  ok: boolean;
  error?: string;
  regionsTransferred: number;
  regionsSkipped: number;
  retired: boolean;
}

export async function mergeCountry(db: Db, args: MergeCountryArgs): Promise<MergeCountryResult> {
  const { fromCountryId, toCountryId, currentTurn } = args;
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

  // National remnants the region loop cannot reach. Every step is filter-
  // idempotent (a re-run finds nothing still keyed to the source), and all run
  // BEFORE the shell retires so a failure leaves a recoverable, still-live
  // source rather than a retired country with dangling rows.
  await transferOrRetireOrgMemberships(db, fromCountryId, toCountryId, currentTurn);
  await sweepNationalStrays(db, fromCountryId, toCountryId);

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
    details: { fromCountryId, toCountryId, regionsTransferred, merge: true },
  });

  return { ok: true, regionsTransferred, regionsSkipped, retired: true };
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
 *    inherits it.
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
  toCountryId: CountryId
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
  // Tariffs are collision-aware in the winner's favour: where BOTH states
  // legislated a tariff on the same scope (same sector, same origin country,
  // same corporation, or both economy-wide), the absorbed side's record takes
  // the slot — the merge direction runs winner-into-shell, and two live
  // records on one scope would double-apply. Later legislation by the unified
  // government supersedes either through the normal reconcile (enactment
  // order), which is the ordinary lex-posterior rule.
  const absorbedTariffs = (await db
    .collection("tariffs")
    .find({ countryId: fromCountryId })
    .toArray()) as unknown as Array<{
    scopeType: string;
    targetSectorType?: unknown;
    targetOriginCountryId?: unknown;
    targetCorporationId?: unknown;
  }>;
  if (absorbedTariffs.length > 0) {
    // One $or delete for every colliding scope, not a round trip per tariff.
    // An explicit null in each key matches both a missing and a null field, so
    // "economy_wide vs economy_wide" collides exactly like a shared sector.
    await db.collection("tariffs").deleteMany({
      countryId: toCountryId,
      $or: absorbedTariffs.map((tariff) => ({
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

  // Intelligence is PURGED, not transferred.
  //
  // A dissolved country leaves the registry entirely (`countryAccess` answers
  // `registered: false`), so rows naming it as owner or as target would be
  // invisible to every surface while still being read by the turn phase and the
  // operation gates. The absorbing country does not inherit them either: a
  // network is an accumulation of access built by a service that no longer
  // exists, and handing one country another's stations for free would make
  // dissolving a state a cheap way to buy reach.
  //
  // The operation log is deliberately left alone: it is an append-only
  // historical record, and the incidents did happen.
  await db.collection(INTELLIGENCE_AGENCIES).deleteMany({ countryId: fromCountryId });
  for (const collection of [INTELLIGENCE_NETWORKS, INTELLIGENCE_COVERAGE]) {
    await db.collection(collection).deleteMany({
      $or: [{ ownerCountryId: fromCountryId }, { targetCountryId: fromCountryId }],
    });
  }
}
