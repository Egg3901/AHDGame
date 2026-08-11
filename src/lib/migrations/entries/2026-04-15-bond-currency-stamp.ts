// One-time v0.2.6 migration: stamp bond.currencyCode onto every existing bond.
//
// Already shipped via the standalone script `scripts/migrations/bondCurrencyStamp.ts`;
// production has the `bond-currency-stamp` marker in `migrationsRun`. This
// registry entry exists so the framework reports the migration as "skipped
// (marker present)" alongside everything else, giving operators a single
// source of truth for what's pending vs. completed.
//
// If a fresh database is missing the marker (e.g. a local reset), invoke the
// standalone script directly:
//   MONGODB_URI=... npx tsx scripts/migrations/bondCurrencyStamp.ts
//
// The standalone script remains the canonical implementation — refactoring
// its internals into the framework's run<Name>(db, opts) shape is a follow-up.

import type { Migration } from "../types";

export const migration: Migration = {
  id: "bond-currency-stamp",
  description: "v0.2.6: stamp bond.currencyCode onto every existing bond by issuer.",
  idempotent: true,
  execute: async () => {
    throw new Error(
      "[bond-currency-stamp] This migration is deployed via the standalone " +
        "script. Production has the marker; the framework should never call " +
        "execute(). If you're seeing this on a fresh DB, run: " +
        "`npx tsx scripts/migrations/bondCurrencyStamp.ts`"
    );
  },
};
