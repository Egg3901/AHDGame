// GET /api/admin/migrations/create-indexes/diagnose — Report which indexes exist vs missing.
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { INDEX_DEFINITIONS, indexName } from "../route";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Cache indexes per collection to avoid repeated listIndexes calls
    const indexCache = new Map<string, Set<string>>();

    async function getExistingKeys(collection: string): Promise<Set<string>> {
      if (indexCache.has(collection)) return indexCache.get(collection)!;
      try {
        const indexes = await db.collection(collection).indexes();
        // Build a set of stringified key specs for comparison
        const keySet = new Set(indexes.map((idx) => JSON.stringify(idx.key)));
        indexCache.set(collection, keySet);
        return keySet;
      } catch {
        // Collection may not exist (code 26: NamespaceNotFound) — treat as no indexes
        const empty = new Set<string>();
        indexCache.set(collection, empty);
        return empty;
      }
    }

    const results: {
      collection: string;
      index: string;
      name: string;
      unique: boolean;
      exists: boolean;
    }[] = [];

    for (const [collection, key, options] of INDEX_DEFINITIONS) {
      const existingKeys = await getExistingKeys(collection);
      const keyStr = JSON.stringify(key);
      results.push({
        collection,
        index: keyStr,
        name: indexName(key),
        unique: !!options?.unique,
        exists: existingKeys.has(keyStr),
      });
    }

    const existingCount = results.filter((r) => r.exists).length;
    const missingCount = INDEX_DEFINITIONS.length - existingCount;

    return NextResponse.json({
      // MigrationsTab expects { status, message } at the top level
      status: missingCount === 0 ? "ok" : "missing",
      message:
        missingCount === 0
          ? `All ${INDEX_DEFINITIONS.length} indexes exist.`
          : `${existingCount} of ${INDEX_DEFINITIONS.length} indexes exist (${missingCount} missing).`,
      results,
      summary: {
        total: INDEX_DEFINITIONS.length,
        existing: existingCount,
        missing: missingCount,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
