# Migration Scripts

## Directory layout

| Location                             | What lives here                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `scripts/migrations/`                | Active scripts: registry-managed deploy migrations, live-data backfills still useful on prod, incident-response tooling. |
| `scripts/migrations/deprecated/`     | Scripts whose logic has been folded into bootstrap seeders (`src/lib/admin/seed/...`). Kept for history; no longer run.  |
| `src/lib/migrations/registry.ts`     | Registry of deploy migrations the runner walks (`npm run migrate`).                                                      |
| `src/lib/admin/seed/seedManifest.ts` | Source of truth for which collections are reference / runtime / preserved on fresh-world bootstrap.                      |

When adding a new migration: figure out which bucket it belongs to. If it's
setting up modern defaults that a fresh world also needs, fold the logic into
a seeder rather than writing a backfill — the seeder is the source of truth
and the backfill becomes a one-shot for legacy DBs. See
`docs/reset-and-seed-contract.md` for the full convention.

## Migration framework

Deploy migrations are managed via a central registry in
`src/lib/migrations/registry.ts`. Run them with:

```bash
npm run migrate            # apply all pending
npm run migrate:dry-run    # preview, no writes
npx tsx scripts/run-migrations.ts --only=add-perf-indexes
npx tsx scripts/run-migrations.ts --from=add-perf-indexes
npx tsx scripts/run-migrations.ts --only=add-perf-indexes --force  # rerun an idempotent
```

Each migration's completion is tracked in MongoDB at the `migrationsRun`
collection (schema: `{ _id: string; completedAt: Date; result?: MigrationResult; markerVersion?: 1 }`).
The runner skips any migration whose marker already exists (unless
`--force` is passed alongside `--only`). Schema is formalized in
`src/lib/migrations/types.ts` (`MigrationMarker`).

### Adding a new migration

1. Create `scripts/migrations/<id>.ts` with the migration body. Export
   `runX(db, opts)` that returns a `MigrationResult` and honors `opts.dryRun`.
   Keep a thin standalone `main()` so the script is also runnable directly:

   ```ts
   import type { Db } from "mongodb";
   import { connectDb, closeDb } from "../utils/db";
   import type { MigrationContext, MigrationResult } from "../../src/lib/migrations/types";

   export async function runX(
     db: Db,
     opts: Pick<MigrationContext, "dryRun"> = { dryRun: false }
   ): Promise<MigrationResult> {
     // ... do the work; honor opts.dryRun ...
     return { documentsUpdated: 0, notes: [] };
   }

   async function main() {
     const db = await connectDb();
     try {
       await runX(db);
     } finally {
       await closeDb();
     }
   }
   if (require.main === module)
     main().catch((err) => {
       console.error(err);
       process.exitCode = 1;
     });
   ```

2. Create `src/lib/migrations/entries/<id>.ts`:

   ```ts
   import type { Migration } from "../types";
   import { runX } from "../../../../scripts/migrations/<id>";

   export const migration: Migration = {
     id: "<id>",
     description: "What this migration does, one line.",
     idempotent: true,
     execute: (db, ctx) => runX(db, { dryRun: ctx.dryRun }),
   };
   ```

3. Append to the `MIGRATIONS` array in `src/lib/migrations/registry.ts`,
   in chronological order.

4. Verify: `npm run migrate:dry-run` should list the new entry.

### Already-shipped migrations

Some migrations were deployed before the framework existed. Two pathways
to bring them under the registry:

- **Has a marker writer** (script wrote to `migrationsRun` itself, e.g.
  `bondCurrencyStamp`): create a declarative entry that throws on
  `execute()`. Production has the marker, framework reports "skipped";
  the throw only triggers if a fresh DB is missing the marker. Two
  examples live at `src/lib/migrations/entries/2026-04-15-*.ts`.

- **No marker writer** (most older scripts): bootstrap-marker pass on
  prod first (`db.collection('migrationsRun').insertOne({ _id, completedAt })`),
  then add the registry entry. Currently deferred for the 5 dated 2026-\*
  scripts — see the comment in `src/lib/migrations/registry.ts`.

### Incident-response scripts

`heal-*`, `inspect-*`, `audit-*`, `fix-*`, and one-off data fixes are
incident response tools, **not** deployable migrations. They are NOT in
the registry — they're invoked manually during incident response. (A
follow-up will move them under `scripts/migrations/incidents/<category>/`
to keep the deploy registry directory uncluttered.)

---

## Unowned-sector repair tools

Sector abandon, quick dissolve, and bond-default dissolve were all found to
delete `corporateSectors` without crediting `unownedSectors` after the
persistent unowned-pool rollout. The production code fix now restores those
revenues automatically; these scripts are for auditing and repairing any live
rows that were already lost before the fix shipped.

```bash
# Read-only audit of a single state+sector
npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts --state=MN --sector=energy

# Audit with a screenshot-derived repair candidate
npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts \
  --state=MN --sector=energy --previous-total-market=7480000 --missing-share-percent=20.64

# Batch audit known candidates from a manifest
npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts \
  --manifest=scripts/migrations/dropped-sector-unowned-loss.example.json

# Dry-run repair of a known case
npx tsx scripts/migrations/heal-dropped-sector-unowned-loss.ts \
  --state=MN --sector=energy --previous-total-market=7480000 --missing-share-percent=20.64

# Apply the repair
npx tsx scripts/migrations/heal-dropped-sector-unowned-loss.ts \
  --state=MN --sector=energy --previous-total-market=7480000 --missing-share-percent=20.64 --apply

# Batch dry-run/apply
npx tsx scripts/migrations/heal-dropped-sector-unowned-loss.ts \
  --manifest=scripts/migrations/dropped-sector-unowned-loss.example.json
```

Notes:

- These scripts default to `MONGODB_URI_LIVE`. Pass `--db=local` to use
  `MONGODB_URI`.
- `inspect-dropped-sector-unowned-loss.ts` also reports the number of
  `corporation_dissolved` wire events since the April 11, 2026 unowned-sector
  rollout so historical exposure is visible even when exact reconstruction is
  not.
- Plain sector abandon leaves no durable audit row, and dissolved corporations
  are hard-deleted, so historical cases without external evidence still require
  manual reconstruction. The manifest flow is the safe path for confirmed
  screenshot-derived repairs.

## v0.2.6 corp economy + bond stamp migrations

Three one-shot migrations for the v0.2.6 corp-economic local-currency cutover.
**Idempotent** — each writes a marker into `migrationsRun` and exits early
on re-run. Run order (the third requires the first to have completed):

```bash
# On a disposable local DB first — NEVER run untested against prod.
MONGODB_URI=... npx tsx scripts/migrations/bondCurrencyStamp.ts
MONGODB_URI=... npx tsx scripts/migrations/corpEconomyToLocalCurrency.ts
MONGODB_URI=... npx tsx scripts/migrations/deprecated/backfillLegacyCorpCurrencyCode.ts
```

`bondCurrencyStamp` and `corpEconomyToLocalCurrency` are independent — the
bond stamp only adds metadata. Run bond stamp first for the safer ordering
(metadata-only, re-run-safe). Then run the corp script. Finally, the legacy
backfill picks up the handful of pre-forex corps whose `liquidCurrencyCode`
was left unset by the main corp migration (money fields are already rescaled
via countryId fallback; this step just stamps the field explicitly so
downstream code never has to rely on the fallback).

**Government budgets were already stored in each country's currency
pre-v0.2.6** (seed data writes `currencyCode: "USD"|"GBP"|"JPY"|...` from
day one and budget revenue/spending helpers produce local-scale values).
No gov-budget migration is required or shipped.

**What each one writes:**

- `corpEconomyToLocalCurrency.ts` — `corporations.{marketingBudget,
logisticsBudget, ceoSalary, sharePrice}`, `corporateSectors.{revenue,
currentGrowthCost}`, full history backfill on `corporationHistory`
  (scalar money fields excluding `liquidCapital` — already local —
  plus `taxPaidByCountry` / `taxPaidByState` breakdown maps and
  `currencyCode` stamp), and
  `corporations.shareholders[].avgCostPerShare` (nested weighted-average
  cost basis).
  `marketCapHistory` is intentionally left in ₳ — its fields are per-turn
  global aggregates written in ₳ by the snapshot phase.
  `corporationPortfolioHistory` is also intentionally left in ₳ — it
  records a cross-currency aggregate (holder corps can hold stocks and
  bonds across 3+ currencies) and ₳ is the natural unit; `portfolioSnapshot`
  writes in ₳ going forward, symmetric with character `portfolioHistory`.
  Backfills follow decision §9.4 option 3: historical values expressed at
  TODAY's rate for chart continuity across the migration moment.
  **Also cancels every open `shareOrder`, pending `shareOffer`, and open
  `shareListing`** — the ₳ → target-local storage change for `escrowAmount`,
  `pricePerShare`, and `marketPriceAtCreation` has enough edge cases
  (partial-fill residuals, 50/200% offer bounds, avgCost weighted-average
  blending) that a clean cancellation is safer than an in-place rescale.
  Buy-order and offer escrows are refunded to the placer's wallet in their
  home currency; reserved shares on corp sell orders and listings are
  restored to the placer/seller's shareholder entry. Users re-place orders
  post-deploy.
- `bondCurrencyStamp.ts` — metadata-only. Stamps `bonds.currencyCode` from
  the issuer (sovereign → country currency; corporate → issuing corp's
  `liquidCurrencyCode`). **Does not** multiply `totalIssued` / `faceValue`.
- `backfillLegacyCorpCurrencyCode.ts` — metadata-only cleanup. Stamps
  `corporations.liquidCurrencyCode` on pre-forex corps that made it through
  the main corp-economy migration without the field set. The main migration
  rescales their money fields via `COUNTRY_CURRENCY_MAP[countryId]` fallback
  but doesn't write `liquidCurrencyCode`; this script closes that gap.
  Refuses to run before `corpEconomyToLocalCurrency.ts` completes — the
  prereq marker check prevents stamping corps whose money fields are still
  in ₳.

**Dry-run checklist:**

1. Seed a disposable local DB with `npx tsx scripts/seedBudgets.ts` (+ any
   other bootstrap the test needs).
2. Run both scripts in the order above.
3. Re-run both; confirm the "already ran" message and no writes.
4. Boot the app (`npm run dev`) against that DB; sanity-check:
   - A corp page (Financials + share price + sectors).
   - A federal budget page (`/country/us/budget`, UK, JP).
   - A state budget page.
   - A bond-detail page and admin bond table.
   - Stockmarket — share price + revenue columns sort correctly.
   - Admin Budgets panel across countries.
   - Toggle wallet preference between `anchor` / `home` / a pinned currency
     / `local` / `internal`; confirm no drift on any of the pages above.

**Production rollout:** BACKUP → pause turns → run both scripts → deploy
code → un-pause. Coordinated with the v0.2.6 code deploy as an atomic cutover
(see Phase 10).

**Crash recovery:**

- `corpEconomyToLocalCurrency.ts` — writes its `migrationsRun` marker at the
  very end. If the script exits non-zero partway, some rows are scaled and
  others aren't. **Do not re-run directly.** Restore the DB from the
  pre-migration backup, fix the root cause, then re-run from scratch against
  the restored DB.
- `bondCurrencyStamp.ts` — re-run-safe even without the marker. Every write
  is gated on `{ currencyCode: { $exists: false } }` and only writes the
  stamp (no rescale, no accumulation). A crash mid-run leaves some bonds
  stamped and others unstamped; re-running picks up where it left off. The
  marker is an optimization, not a safety primitive.

**Safety checks both scripts perform:**

- Warn (and sleep 10s) if `gameState.isActive === true` or `isProcessing ===
true` — gives the operator a chance to abort with Ctrl-C before turns
  can race the migration.

**Additional safety checks the corp script performs:**

- Refunds lost-placer escrow is counted separately (`charRefundsApplied` /
  `corpRefundsApplied` vs `ordersCancelled` / `offersCancelled` totals). A
  gap between the two means some placer characters or corps have been
  deleted — those escrows are forfeit (matches `retireCharacter.ts` policy
  for already-orphaned accounts).
- Restores reserved shares via push-if-missing: if the placer corp or
  seller character was removed from the target corp's shareholders between
  order creation and cutover, we re-create their entry rather than
  silently dropping the shares. If the target corp itself is gone, the
  shares are reported in `sharesOrphaned` and the console prints a
  `WARN: N reserved shares could not be restored…` line.

---

## Wiki Migration Scripts

## Wave 8 compatibility backfill

Backfills the remaining live compatibility fields that still block broad
Wave 8 cleanup:

- `partyBudget.countryId`
- `stateDemographicTurnout.countryId`
- `billWhips.audience`
- `bonds.countryId`

It also audits the old "campaigns without currencyBalances" concern and
reports the real compatibility surface: `characters.currencyBalances.campaign`.

```bash
# Dry-run against production/live DB
npx tsx scripts/migrations/backfill-wave8-compatibility-fields.ts

# Apply against production/live DB
npx tsx scripts/migrations/backfill-wave8-compatibility-fields.ts --apply

# Dry-run/apply against local DB
npx tsx scripts/migrations/backfill-wave8-compatibility-fields.ts --db=local
npx tsx scripts/migrations/backfill-wave8-compatibility-fields.ts --db=local --apply
```

Notes:

- Defaults to `MONGODB_URI_LIVE`; use `--db=local` to target `MONGODB_URI`.
- Dry-run first. Nothing is written unless `--apply` is present.
- On apply, the script warns and pauses briefly if turns are active or already
  processing.
- Bond backfill also stamps legacy corporate rows with
  `issuerType: "corporation"` when that field is still missing and the issuer
  can be safely resolved from the owning corporation.

## Campaign funds → home currency

Moves forex-era campaign balances from anchor storage to home/local currency
storage while backfilling the legacy `funds` mirror:

- canonical pre-migration source: current `currencyBalances.campaign`
- post-migration mirror: `funds` in anchor/internal units
- post-migration stored balance: `currencyBalances.campaign` in home currency

```bash
# Dry-run against production/live DB
npx tsx scripts/migrations/migrate-campaign-funds-to-home-currency.ts

# Apply against production/live DB
npx tsx scripts/migrations/migrate-campaign-funds-to-home-currency.ts --apply

# Dry-run/apply against local DB
npx tsx scripts/migrations/migrate-campaign-funds-to-home-currency.ts --db=local
npx tsx scripts/migrations/migrate-campaign-funds-to-home-currency.ts --db=local --apply
```

Notes:

- Dry-run by default.
- Defaults to `MONGODB_URI_LIVE`; use `--db=local` to target `MONGODB_URI`.
- Idempotent by `migrationsRun._id = "migrate-campaign-funds-to-home-currency"`.
- On apply, the script warns and pauses if turns are active or processing.
- This should be run before relying on the new home-currency campaign-fund
  storage in live UX, because many legacy forex-era rows still have stale
  `funds` mirrors.

## backfillLegacyCustomWikiPages.ts

Backfills `gameIteration` / `gameStartDate` onto legacy reviewed player-written
wiki pages that predate provenance stamping, so the new `Custom Pages` wiki
filter can classify them from normalized data after merge.

```bash
# Dry-run against production/live DB
npx tsx scripts/migrations/backfillLegacyCustomWikiPages.ts

# Apply the backfill
npx tsx scripts/migrations/backfillLegacyCustomWikiPages.ts --apply
```

Notes:

- Uses `MONGODB_URI_LIVE` only.
- Requires `GAME_ITERATION` and/or `GAME_START_DATE` in `.env.local`.
- Only touches published, reviewed, non-seeded, non-claim-managed custom pages
  that are still missing at least one provenance field.

## migrate-wiki-to-db.ts

One-time migration from dual-source (files + DB) to DB-only wiki system.

**Run:**

```bash
npx tsx scripts/migrations/migrate-wiki-to-db.ts
```

**What it does:**

1. Imports all markdown files from docs/design/ to wikiPages collection
2. Generates auto-generated pages for parties, leadership, seats, politicians
3. Seeds systemTags collection from predefined system tags
4. Seeds wikiTemplates collection with initial templates

**Rollback:** Markdown files are kept in docs/archive/wiki-content/ for 2 weeks after migration.
