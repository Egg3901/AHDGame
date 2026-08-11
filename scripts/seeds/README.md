# scripts/seeds/

CLI seed data — pure data constants consumed by the `scripts/seed*.ts` entry points and admin API seed handlers.

## Boundary with `src/lib/seeds/`

| Location                    | What belongs here                                                                                               | Consumed by                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **`scripts/seeds/`** (here) | Pure data constants for DB seeding (states, parties, metrics, budgets, legislation types)                       | `scripts/seed.ts`, `scripts/seed-*.ts`, `src/app/api/admin/seed/` handlers |
| **`src/lib/seeds/`**        | Data constants + runtime helper functions that the app imports at runtime (demographics, achievements, UK data) | Seed scripts, API routes, components, turn processing                      |

## Convention for new countries

Place all new country data in `src/lib/seeds/{countryCode}/` (following the UK pattern in `src/lib/seeds/uk/`).

US data remains here for historical reasons — it predates the UK addition and is stable.
