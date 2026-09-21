import type { LegislationType } from "@/lib/db/types/legislation";
import { withLawAdministration } from "@/lib/governmentFinance/lawAdministrationCatalog";
import type { Migration } from "../types";

const COUNTRY_SCOPES = ["us", "uk", "jp"] as const;

export const migration: Migration = {
  id: "2026-09-21-legislative-administration-metadata",
  description:
    "Materialize portfolio, jurisdiction, funding, capacity, and program metadata on existing US, UK, and Japan legislation types.",
  idempotent: true,
  async execute(db, ctx) {
    const collection = db.collection<LegislationType>("legislationTypes");
    const rows = await collection.find({ countryScope: { $in: [...COUNTRY_SCOPES] } }).toArray();
    const materialized = withLawAdministration(rows);
    if (ctx.dryRun) {
      return {
        documentsScanned: rows.length,
        notes: [`Would materialize administration metadata on ${rows.length} law type(s).`],
      };
    }

    const result =
      materialized.length === 0
        ? null
        : await collection.bulkWrite(
            materialized.map((type) => ({
              updateOne: {
                filter: { _id: type._id },
                update: {
                  $set: {
                    administration: type.administration,
                    allowedScope: type.allowedScope,
                    policyOptions: type.policyOptions,
                  },
                },
              },
            })),
            { ordered: false }
          );
    return {
      documentsScanned: rows.length,
      documentsUpdated: result?.modifiedCount ?? 0,
      notes: [
        "Preserved authored law text and option fields while adding deterministic administration metadata.",
      ],
    };
  },
};
