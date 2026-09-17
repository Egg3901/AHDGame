import type { Db, IndexDescriptionInfo } from "mongodb";

const PROVIDER_FIELDS = ["googleId", "discordId"] as const;

function matchesProviderIndex(index: IndexDescriptionInfo, field: string): boolean {
  const filter = index.partialFilterExpression?.[field];
  return (
    index.name === `users_${field}_unique_nonempty_v1` &&
    index.unique === true &&
    Object.keys(index.key).length === 1 &&
    index.key[field] === 1 &&
    Object.keys(index.partialFilterExpression ?? {}).length === 1 &&
    filter?.$type === "string" &&
    filter?.$gt === "" &&
    Object.keys(filter).length === 2 &&
    (!index.collation || index.collation.locale === "simple")
  );
}

/**
 * A provider subject can belong to one account. Missing, null, and empty
 * values represent no link and are excluded from the unique constraint.
 * Existing conflicts are rejected without modifying any account document.
 */
export async function ensureProviderIdentityIndexes(db: Db, dryRun = false): Promise<string[]> {
  const users = db.collection("users", {
    writeConcern: { w: "majority", wtimeoutMS: 10000 },
  });
  const notes: string[] = [];
  for (const field of PROVIDER_FIELDS) {
    const invalidTypes = await users.countDocuments(
      { $expr: { $not: { $in: [{ $type: `$${field}` }, ["string", "missing", "null"]] } } },
      { maxTimeMS: 5000 }
    );
    if (invalidTypes > 0) throw new Error(`Invalid ${field} field types require review`);
    const name = `users_${field}_unique_nonempty_v1`;
    if (dryRun) {
      notes.push(`would create or verify users.${name}`);
      continue;
    }
    try {
      await users.createIndex(
        { [field]: 1 },
        {
          name,
          unique: true,
          partialFilterExpression: { [field]: { $type: "string", $gt: "" } },
          collation: { locale: "simple" },
          maxTimeMS: 60000,
        }
      );
    } catch {
      // Duplicate-key details can identify an account. Keep migration output
      // generic; resolving conflicting ownership requires a separate review.
      throw new Error(`Could not create or verify users.${name}`);
    }
    const indexes = await users.listIndexes({ maxTimeMS: 5000 }).toArray();
    if (!indexes.some((index) => matchesProviderIndex(index, field))) {
      throw new Error(`Required provider identity index ${name} is unavailable`);
    }
    notes.push(`created or verified users.${name}`);
  }
  return notes;
}
