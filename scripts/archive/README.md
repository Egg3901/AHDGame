# Scripts Archive

This directory contains one-time migration scripts and debugging utilities that are no longer actively used. Contents are kept for historical reference and possible legacy-DB upgrade paths.

## Directory Structure

### `migrations/` — Database Migrations (6 scripts)

One-time database migration scripts that have already been run on production:

- `add-country-indexes.ts` — Added database indexes for `countryId` fields
- `add-demographic-turnout-indexes.ts` — Added indexes for demographic turnout queries
- `add-election-candidates-index.ts` — Added index supporting election-candidates lookups
- `add-election-unique-index.ts` — Added unique constraint to elections
- `add-uk-bills-index.ts` — Added UK-specific bill query index
- `migrate-wiki-to-db.ts` — Migrated wiki content from filesystem to MongoDB

**Note:** These migrations have been executed and should not be run again.

### `debug/` — Debugging & Utility Scripts (8 scripts)

One-time or development-only debugging scripts:

- `calibrate-lean.ts` — Used to calibrate state political lean values (one-time tuning)
- `check-min-wage.js` — Ad-hoc minimum-wage data check
- `debug-election-timers.ts` — Debug script for testing election timing logic
- `make-me-uk.ts` — Development utility to switch character to UK for testing
- `migrate-feedback-issue-numbers.ts` — One-time migration for feedback system
- `quality-assessment.ts` — Code quality assessment tool (superseded by `scripts/audit/`)
- `test-uk-filter.js` — Ad-hoc UK filter check
- `update-character-country.ts` — One-time script to backfill character `countryId` fields

## Active Scripts

Active scripts remain in the parent directory (`scripts/`):

- `seed.ts` — Main seed script for database initialization
- `seed-*.ts` — Individual seed scripts for specific features
- `simulate-*.ts` — Simulation scripts for testing game mechanics
- `prepare-map-data.ts` — Map data preprocessing
- `audit/` — Active audit suite for code quality verification

## Last major cleanup

2026-03-04 — initial archive.
2026-05-18 — README brought in sync with actual contents; retention policy formalized below.

## Retention Policy

| Category                         | Action                           | Rationale                                                                                                                                                           |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/archive/migrations/`    | **NEVER delete**                 | Historical record of schema changes; may be needed to bring legacy DBs forward.                                                                                     |
| `scripts/archive/debug/`         | Keep by default; review annually | Often useful as reference even when superseded. Delete only after team discussion AND verifying no `docs/` or `scripts/audit/` cross-reference.                     |
| `scripts/migrations/deprecated/` | **NEVER delete**                 | Per `scripts/migrations/deprecated/README.md`: production may still need them on pre-fold DBs; seeder docstrings cite them as authoritative defaults for end-state. |

## Where new scripts go

- New migrations → `scripts/migrations/` (registry-managed ones also into `src/lib/migrations/registry.ts`)
- New debug/one-off scripts → top-level `scripts/` while active; move to `scripts/archive/debug/` only after the work that needed them is merged AND ≥30 days have passed without re-use

## Notes

- Migration scripts (in both `archive/migrations/` and `migrations/deprecated/`) should NEVER be deleted.
- Debug scripts may be useful for reference but should not be run in production.
- When adding to or removing from this directory, update the file lists above so the README stays in sync.
