# src/lib/seeds/

Runtime seed data and helper functions imported throughout the application.

## Boundary with `scripts/seeds/`

| Location                              | What belongs here                                                              | Consumed by                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **`src/lib/seeds/reference/`**        | Canonical static DB seed data (states, parties, legislation types, budgets, …) | `src/lib` (seeders, grants, tests), re-exported by **`scripts/seeds/*.ts`** |
| **`scripts/seeds/*.ts`** (most files) | Re-exports of `reference/` for CLI-only scripts                                | `scripts/seed*.ts`, `scripts/simulate-*.ts`, etc.                           |
| **`src/lib/seeds/`** (rest of tree)   | Runtime helpers + country packs (`uk/`, …) not in `reference/`                 | App routes, turn processing, components                                     |

Files here may export:

- **Data constants** used at runtime (e.g., `DEMOGRAPHIC_TURNOUT_RATES` in election logic)
- **Helper functions** called at runtime (e.g., `computeLiveGroupTurnouts()`)
- **Country-specific data** organized under `{countryCode}/` subdirectories

## Convention for new countries

Place all new country data in `src/lib/seeds/{countryCode}/` (following the `uk/` pattern).
