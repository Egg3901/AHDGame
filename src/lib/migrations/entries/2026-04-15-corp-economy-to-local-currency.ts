// One-time v0.2.6 migration: convert corp-side economy values from
// anchor-currency to local-currency representation.
//
// Already shipped via the standalone script
// `scripts/migrations/corpEconomyToLocalCurrency.ts`; production has the
// `corp-economy-to-local-currency` marker in `migrationsRun`. This registry
// entry exists so the framework's pending list is complete.
//
// If a fresh database is missing the marker (rare), invoke directly:
//   MONGODB_URI=... npx tsx scripts/migrations/corpEconomyToLocalCurrency.ts
//
// The standalone script (667 LOC) remains the canonical implementation —
// refactoring its internals into the framework's run<Name>(db, opts) shape is
// a follow-up tracked in scripts/migrations/README.md.

import type { Migration } from "../types";

export const migration: Migration = {
  id: "corp-economy-to-local-currency",
  description: "v0.2.6: convert corp economy fields from anchor to local currency representation.",
  idempotent: true,
  execute: async () => {
    throw new Error(
      "[corp-economy-to-local-currency] This migration is deployed via the " +
        "standalone script. Production has the marker; the framework should " +
        "never call execute(). If you're seeing this on a fresh DB, run: " +
        "`npx tsx scripts/migrations/corpEconomyToLocalCurrency.ts`"
    );
  },
};
