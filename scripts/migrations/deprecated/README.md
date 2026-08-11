# Deprecated Migration Scripts

These scripts are **deprecated**. Their logic has been folded into the
bootstrap seeders so a fresh-world bootstrap reaches the same end state
without running any of them.

They're kept in version control because:

1. Production may still need them on existing databases that pre-date the
   seeder fold (e.g. live DBs missing the sovereign-default fields the
   seeder now stamps on day one).
2. The seeder docstrings cite them as the source of authoritative defaults;
   moving them keeps those citations resolvable.

Do not add new migrations here. New migrations belong in `scripts/migrations/`
and, if registry-managed, in `src/lib/migrations/registry.ts`.

## What's in here

### Index migrations (absorbed into `src/lib/admin/seed/indexes/`)

| File                                                    | Absorbed by                             |
| ------------------------------------------------------- | --------------------------------------- |
| `add-commodity-prices-unique-index.ts`                  | `indexes/commodityPrices.ts`            |
| `add-election-write-guard-indexes.ts`                   | `indexes/writeGuards.ts`                |
| `add-governance-write-guard-indexes.ts`                 | `indexes/writeGuards.ts`                |
| `add-health-quality-indexes.ts`                         | `indexes/observability.ts`              |
| `add-international-organization-write-guard-indexes.ts` | `indexes/internationalOrganizations.ts` |
| `add-party-npp-rework-indexes.ts`                       | `indexes/partyNppRework.ts`             |
| `add-site-traffic-indexes.ts`                           | `indexes/observability.ts`              |
| `createActivityLogIndexes.ts`                           | `indexes/activity.ts`                   |
| `createFinancialTxLogIndexes.ts`                        | `indexes/financialTxLog.ts`             |
| `sovereignDefaultPhase1Indexes.ts`                      | `indexes/sovereignDefault.ts`           |

### Field backfills (absorbed into seed factories)

| File                                           | Absorbed by                                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sovereignDefaultPhase1FederalBudget.ts`       | `buildNationalBudgetSeed` in `src/lib/seeds/reference/budgets.ts` (sovereign-crisis + IMF defaults) |
| `2026-05-07-backfill-corporation-isprivate.ts` | `generateCountryOwnedSeedData` in `src/lib/seeds/reference/budgets.ts` (`isPrivate: false`)         |
| `2026-05-07-set-legal-structure-defaults.ts`   | `generateCountryOwnedSeedData` in `src/lib/seeds/reference/budgets.ts` (`legalStructure`)           |
| `backfillLegacyCorpCurrencyCode.ts`            | `generateCountryOwnedSeedData` in `src/lib/seeds/reference/budgets.ts` (`liquidCurrencyCode`)       |

## Running one of these on a legacy DB

The scripts still work as one-shots. They're idempotent — each guards on the
presence/absence of the field it sets — so running them on a fresh-world DB
that already has the seeder defaults produces zero writes:

```bash
MONGODB_URI=... npx tsx scripts/migrations/deprecated/<script>.ts
```
