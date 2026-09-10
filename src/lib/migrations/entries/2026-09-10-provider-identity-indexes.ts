import { ensureProviderIdentityIndexes } from "@/lib/auth/providerIdentityIndexes";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-09-10-provider-identity-indexes",
  description: "Enforce unique ownership of nonempty Google and Discord account links.",
  idempotent: true,
  execute: async (db, context) => ({
    documentsUpdated: 0,
    notes: await ensureProviderIdentityIndexes(db, context.dryRun),
  }),
};
