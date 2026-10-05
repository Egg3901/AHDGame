export type CollectionCategory =
  "reference" | "runtime" | "preserved" | "migration-only" | "incident-only";

export interface CollectionEntry {
  /** MongoDB collection name. */
  name: string;
  category: CollectionCategory;
  /** Free-form note explaining why this collection lives in its category. */
  notes?: string;
  /**
   * For `reference` collections, the seeder module that owns it (relative path
   * under `src/lib/admin/seed/`). Used by the admin seeder UI to surface a
   * "re-seed this" button and by contract tests to verify coverage.
   */
  seededBy?: string;
}
