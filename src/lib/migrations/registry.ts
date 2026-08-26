// Central registry of deployable migrations, in chronological order. Each
// entry's id is stable forever (used as the _id of the migrationsRun marker)
// and `idempotent` must reflect actual runtime safety.
//
// Adding a migration:
//   1. Create src/lib/migrations/entries/<id>.ts that exports `migration: Migration`.
//   2. Import and append to MIGRATIONS below.
//   3. If wrapping an existing scripts/migrations/<name>.ts, the entry's
//      execute() should call into the script's main() while honoring the
//      ctx.dryRun flag.
//
// Incident response scripts (heal-*, inspect-*, audit-*, fix-*) live in
// scripts/migrations/incidents/ and DO NOT belong in this registry.

import type { Migration } from "./types";

import { migration as bondCurrencyStamp } from "./entries/2026-04-15-bond-currency-stamp";
import { migration as corpEconomyToLocalCurrency } from "./entries/2026-04-15-corp-economy-to-local-currency";
import { migration as addPerfIndexes } from "./entries/add-perf-indexes";
import { migration as indexFundFoundation } from "./entries/2026-06-01-index-fund-foundation";
import { migration as indexFundSeed } from "./entries/2026-06-01-index-fund-seed";
import { migration as indexFundRealBonds } from "./entries/2026-06-02-index-fund-real-bonds";
import { migration as routePerformanceIndexes } from "./entries/2026-06-06-route-performance-indexes";
import { migration as eventSubstrateIndexes } from "./entries/2026-06-09-event-substrate-indexes";
import { migration as crisisAidIndexes } from "./entries/2026-06-21-crisis-aid-indexes";
import { migration as unionIndexes } from "./entries/2026-07-01-union-indexes";
import { migration as unionLeadershipIndexes } from "./entries/2026-07-04-union-leadership-indexes";
import { migration as ngxIndexFundSeed } from "./entries/2026-07-04-ngx-index-fund-seed";
import { migration as perfN1Indexes } from "./entries/2026-07-08-perf-n1-indexes";
import { migration as orgRegLedgerIndex } from "./entries/2026-07-10-orgregledger-index";
import { migration as backfillUnownedHeadroomUnits } from "./entries/2026-08-01-backfill-unowned-headroom-units";
import { migration as restoreCapitalModeFromShadow } from "./entries/2026-08-01-restore-capital-mode-from-shadow";
import { migration as fixSeedSectorCurrencyDenomination } from "./entries/2026-08-01-fix-seed-sector-currency-denomination";
import { migration as adoptReferenceGameConfigGates } from "./entries/2026-08-08-adopt-reference-gameconfig-gates";
import { migration as labourRelationsIndexes } from "./entries/2026-08-09-labour-relations-indexes";
import { migration as indexListingPetitionIndexes } from "./entries/2026-08-10-index-listing-petition-indexes";
import { migration as indexFundPhaseIndexes } from "./entries/2026-08-10-index-fund-phase-indexes";
import { migration as pensionSchemeIndexes } from "./entries/2026-08-10-pension-scheme-indexes";
import { migration as adoptOnePartyConfidenceModel } from "./entries/2026-08-10-adopt-one-party-confidence-model";
import { migration as smoothLegacyBuildOrders } from "./entries/2026-08-10-smooth-legacy-build-orders";
import { migration as pensionSchemeFundPositions } from "./entries/2026-08-11-pension-scheme-fund-positions";
import { migration as ratificationBallotIndexes } from "./entries/2026-08-11-ratification-ballot-indexes";
import { migration as bankMoneyMoveIndexes } from "./entries/2026-08-18-bank-money-move-indexes";
import { migration as dropDeadPartyAxes } from "./entries/2026-08-11-drop-dead-party-axes";
import { migration as heal1953SeedBalance } from "./entries/2026-08-09-heal-1953-seed-balance";
import { migration as reconcileCommandEconomyUnowned } from "./entries/2026-08-09-reconcile-command-economy-unowned";
import { migration as repointRuSoes } from "./entries/2026-08-13-repoint-ru-soes";
import { migration as campaignOpsTrees } from "./entries/2026-08-18-campaign-ops-trees";
import { migration as backfillPoliticalLegislationTypes } from "./entries/2026-08-19-backfill-political-legislation-types";
import { migration as seedGlobalResponseFoundations } from "./entries/2026-08-23-seed-global-response-foundations";
import { migration as repairKazakhLawLevels } from "./entries/2026-08-23-repair-kazakh-law-levels";
import { migration as crisesLivingEventPartialIndex } from "./entries/2026-08-25-crises-living-event-partial-index";
import { migration as ukRegionalPartyOrgBackfill } from "./entries/2026-08-26-uk-regional-party-org-backfill";
import { migration as easternDepositsCnSoeIron } from "./entries/2026-08-25-eastern-deposits-cn-soe-iron";
import { migration as backfillRedistrictingLawTypes } from "./entries/2026-08-25-backfill-redistricting-law-types";

export const MIGRATIONS: Migration[] = [
  // v0.2.6 currency cutover (declarative — shipped via standalone scripts)
  bondCurrencyStamp,
  corpEconomyToLocalCurrency,
  // Performance indexes — wraps scripts/migrations/add-perf-indexes.ts
  addPerfIndexes,
  // Index-funds foundation — collection/index contract for passive fund implementation
  indexFundFoundation,
  // Index-funds seed — upsert 20 fund definition documents
  indexFundSeed,
  indexFundRealBonds,
  routePerformanceIndexes,
  eventSubstrateIndexes,
  crisisAidIndexes,
  unionIndexes,
  unionLeadershipIndexes,
  // NGX (Nigeria) exchange enablement — re-upsert fund definitions for the two new NGX broad funds
  ngxIndexFundSeed,
  // bonds (corporationId, matured, defaulted) — nationalization eligibility + bond payoff paths (#2817)
  perfN1Indexes,
  // orgRegLedger (countryId, stateId, partyId, metric, turn desc) — region-page
  // registration sparkline was a 1M-doc collscan (only the _id index existed)
  orgRegLedgerIndex,
  // headroomUnits backfill (buildable-sectors P1) — derived field only,
  // no system reads it yet; see scripts/migrations/backfillUnownedHeadroomUnits.ts
  backfillUnownedHeadroomUnits,
  // Seed-sector currency denomination heal. Pairs with the writer fix in
  // `spawnNppCorporation` — the two MUST ship together (see the "honest
  // limitations" block in the script: post-fix spawns are correct and are
  // indistinguishable from pre-fix ones by provenance alone, so a world that
  // takes the code fix and defers the heal will re-break its new corps).
  // No-op at the plants tier and in anchor-currency-only worlds.
  fixSeedSectorCurrencyDenomination,
  // gameConfig is never dropped on reset, so a seed default cannot reach a
  // world that already exists. Gives gameConfig the fill-only-what-is-absent
  // reconciliation gameState has had via missingGameStateFlagDefaults, plus a
  // narrow raise for a market tier nobody chose on a world with no economy yet.
  adoptReferenceGameConfigGates,
  // Release 1.1 industrial relations: campaign uniqueness and agreement reads.
  labourRelationsIndexes,
  indexListingPetitionIndexes,
  indexFundPhaseIndexes,
  pensionSchemeIndexes,
  // Release 1.1 DDR parity: the promoted runtime field a seeded world can't
  // pick up from a config change alone.
  adoptOnePartyConfidenceModel,
  // Repairs the active 1953 world as well as future resets: four-country
  // registration pools plus era-relative sovereign debt pricing.
  heal1953SeedBalance,
  // Ticket #1014 — command-economy unowned double-seed (~50% SOE ownership +
  // unreachable 0% remainder sectors). Also runs at end of seedUnownedSectors.
  reconcileCommandEconomyUnowned,
  // The USSR came up on iteration 4 with no SOEs at all and every producing
  // sector on the bare sovereign issuer, so 44 players had no seat to claim.
  // RU-scoped and revenue-preserving, unlike the global reconcile above.
  repointRuSoes,
  // Convert grandfathered (pre-smooth) in-flight plant build orders to
  // progressive per-turn delivery. Re-anchors startTurn to the live currentTurn
  // so full ordered capacity is delivered over the remaining window (flipping
  // `smooth` alone would drop the already-elapsed, already-paid fraction).
  smoothLegacyBuildOrders,
  pensionSchemeFundPositions,
  ratificationBallotIndexes,
  // Ticket #1032 — drop the foreignPolicy / culture party axes. Written by
  // every seed and the shift UI, read by nothing.
  dropDeadPartyAxes,
  // Indexes for the banking money-movement claim records. The seed module
  // covers a fresh bootstrap; a world that is already running needs this.
  bankMoneyMoveIndexes,
  // Strategic Operations v2 — migrate campaign investment levers from linear
  // levels to the starter + three-branch tree model. Player-friendly, idempotent.
  campaignOpsTrees,
  // Ticket #1106: live worlds never received legislation types added to the
  // typed catalog after they were seeded (US state tax sliders). Insert-missing
  // only, so admin law-type edits are preserved.
  backfillPoliticalLegislationTypes,
  seedGlobalResponseFoundations,
  // Ticket #1174: reconcile KAZ laws from their durable enacted-law and
  // pre-executive-order records after legacy order expiry left mismatched rows.
  repairKazakhLawLevels,
  // Per-turn E11000 on crises_living_event: unset null keys, rebuild the
  // sparse unique index as partial-on-string (GlitchTip AHD-1JV).
  crisesLivingEventPartialIndex,
  // The UK regional-party contest gate is gone (SNP/Plaid/DUP/SF/UUP now stand
  // UK-wide); give them the statePartyOrg rows they were never seeded outside
  // their home nation, or the presence gate keeps them off the ballot anyway.
  ukRegionalPartyOrgBackfill,
  // Markets repair P2a: eastern deposits were never authored for the playable
  // bloc countries (every state resources:{}), and the CN extraction SOE was
  // coal-locked in its four iron-rich states.
  easternDepositsCnSoeIron,
  // Ticket #1189: the old-catalog exclusion sweep stripped the mechanical
  // redistricting laws from every world, leaving no bill to change redistricting
  // authority. Insert-missing only, so admin law-type edits are preserved.
  backfillRedistrictingLawTypes,
];

// D13 rollback drill — registered but deliberately OUTSIDE the deploy chain.
// `MIGRATIONS` is walked automatically on deploy; a plants→capital rollback is
// an explicit human act, not something a deploy should ever perform. Kept here
// (and typed) so it cannot rot, and so `--only` can target it by id —
// scripts/run-migrations.ts widens its candidate list to include this array
// when, and only when, `--only` is passed. A no-flag `npm run migrate` walks
// `MIGRATIONS` alone and can never reach anything here.
// See scripts/migrations/restoreCapitalModeFromShadow.ts.
export const ROLLBACK_MIGRATIONS: Migration[] = [restoreCapitalModeFromShadow];

// Deferred to follow-up (need bootstrap-marker pass on production first):
//   - 2026-04-22-reverse-split-victim-reparations  (no marker writer in script)
//   - 2026-05-05-cleanup-duplicate-tariff-pulses   (no marker writer)
//   - 2026-05-07-backfill-corporation-isprivate    (no marker writer)
//   - 2026-05-07-set-legal-structure-defaults      (no marker writer)
//   - 2026-05-05-phase-11-live-bootstrap           (uses MONGODB_URI_LIVE; sub-section markers)
//
// Other schema-add and backfill scripts under scripts/migrations/ that already
// follow the run<Name>(db, opts) shape can be wrapped incrementally — see
// scripts/migrations/README.md for the pattern.
