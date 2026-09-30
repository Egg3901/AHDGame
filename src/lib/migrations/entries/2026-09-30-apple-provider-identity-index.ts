import { ensureProviderIdentityIndexes } from "@/lib/auth/providerIdentityIndexes";
import type { Migration } from "../types";

/**
 * Sign in with Apple adds `appleId` as a third provider subject. The
 * 2026-09-10 entry already ran on live worlds, so the Apple unique index needs
 * its own id. The helper re-verifies the Google and Discord indexes too.
 */
export const migration: Migration = {
  id: "2026-09-30-apple-provider-identity-index",
  description: "Enforce unique ownership of nonempty Sign in with Apple account links.",
  idempotent: true,
  execute: async (db, context) => ({
    documentsUpdated: 0,
    notes: await ensureProviderIdentityIndexes(db, context.dryRun),
  }),
};
