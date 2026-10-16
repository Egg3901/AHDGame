/**
 * Income-tax rollout. Missing tier rates inherit the effective legacy rate and
 * pending target. Existing characters retain their recorded starting background.
 */
import { INCOME_TAX_INDEXES } from "@/lib/budget/incomeTaxIndexes";
import type { AnyBulkWriteOperation } from "mongodb";
import type { FederalBudget, StateBudget, LegislationType, StatePolicy } from "@/lib/db/types";
import { expandIncomeTaxTypes } from "@/lib/budget/incomeTaxCatalog";
import {
  INCOME_TIERS,
  INCOME_TAX_KEYS,
  initializeIncomeTaxRates,
} from "@/lib/budget/rules/incomeTaxTiers";
import { refreshIncomeTaxShares } from "@/lib/budget/incomeTaxShares";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-16-income-tax-tiers",
  description: "Initialize income-tax tiers and player taxation without changing existing rates.",
  idempotent: true,
  async execute(db, ctx) {
    const [national, regional, types, policies, state, characters, imperials] = await Promise.all([
      db.collection<FederalBudget>("federalBudget").find({}).toArray(),
      db.collection<StateBudget>("stateBudgets").find({}).toArray(),
      db
        .collection<LegislationType>("legislationTypes")
        .find({
          $or: [{ "taxRateChange.taxType": "incomeTax" }, { "taxSlider.taxType": "incomeTax" }],
        })
        .toArray(),
      db.collection<StatePolicy>("statePolicies").find({}).toArray(),
      db.collection<{ _id: string; currentTurn: number }>("gameState").findOne({ _id: "current" }),
      db.collection("characters").countDocuments({ incomeTaxStartTurn: { $exists: false } }),
      db
        .collection("imperialCharacters")
        .countDocuments({ incomeTaxStartTurn: { $exists: false } }),
    ]);
    for (const budget of [...national, ...regional])
      if (budget.taxRates) initializeIncomeTaxRates(budget.taxRates);
    const clones = expandIncomeTaxTypes(types).filter((type) => type._id.includes("__income_"));
    if (ctx.dryRun)
      return {
        documentsScanned: national.length + regional.length + types.length + characters + imperials,
        documentsUpdated: 0,
        notes: [
          "Would initialize missing tier rates, clone " +
            clones.length +
            " tier provisions, and enroll " +
            characters +
            " existing characters. No retroactive player tax.",
        ],
      };
    for (const index of INCOME_TAX_INDEXES)
      await db.collection(index.collection).createIndex(index.keys, { name: index.name });
    for (const collection of ["federalBudget", "stateBudgets"] as const) {
      await db.collection(collection).updateMany({ taxRates: { $exists: true } }, [
        {
          $set: Object.fromEntries(
            INCOME_TIERS.flatMap((tier) => [
              [
                "taxRates." + INCOME_TAX_KEYS[tier],
                {
                  $ifNull: [
                    "$taxRates." + INCOME_TAX_KEYS[tier],
                    { $ifNull: ["$taxRates.incomeTax", 0] },
                  ],
                },
              ],
              ...(collection === "federalBudget"
                ? [
                    [
                      "taxRatePhaseIn." + INCOME_TAX_KEYS[tier],
                      {
                        $ifNull: [
                          "$taxRatePhaseIn." + INCOME_TAX_KEYS[tier],
                          { $ifNull: ["$taxRatePhaseIn.incomeTax", "$$REMOVE"] },
                        ],
                      },
                    ],
                  ]
                : []),
            ])
          ),
        },
        ...(collection === "federalBudget" ? [{ $unset: "taxRatePhaseIn.incomeTax" }] : []),
      ]);
    }
    if (clones.length)
      await db.collection<LegislationType>("legislationTypes").bulkWrite(
        clones.map((type) => ({
          updateOne: {
            filter: { _id: type._id },
            update: { $setOnInsert: type },
            upsert: true,
          },
        }))
      );
    const policyOps: AnyBulkWriteOperation<StatePolicy>[] = [];
    const typeMap = new Map(types.map((type) => [type._id, type]));
    for (const policy of policies) {
      const type = typeMap.get(policy.legislationTypeId);
      if (!type) continue;
      const scope = (type.taxSlider ?? type.taxRateChange)!.scope;
      const budget =
        scope === "federal"
          ? national.find((b) => b.countryId.toLowerCase() === (type.countryScope ?? "us"))
          : regional.find((b) => b._id === policy.stateId);
      if (!budget?.taxRates) continue;
      for (const tier of INCOME_TIERS) {
        const taxKey = INCOME_TAX_KEYS[tier];
        const target =
          scope === "federal"
            ? ((budget as FederalBudget).taxRatePhaseIn?.[taxKey] ??
              (budget as FederalBudget).taxRatePhaseIn?.incomeTax)
            : undefined;
        const { _id: originalId, ...fields } = policy;
        void originalId;
        const clone = {
          ...fields,
          legislationTypeId: type._id + "__income_" + tier,
          policyOptionId: "rate:" + (target ?? initializeIncomeTaxRates(budget.taxRates)[taxKey]),
        };
        policyOps.push({
          updateOne: {
            filter: {
              scope: clone.scope,
              stateId: clone.stateId,
              legislationTypeId: clone.legislationTypeId,
            },
            update: { $setOnInsert: clone },
            upsert: true,
          },
        });
      }
    }
    if (policyOps.length) await db.collection<StatePolicy>("statePolicies").bulkWrite(policyOps);
    await db.collection("characters").updateMany({}, [
      {
        $set: {
          initialIncomeTier: {
            $ifNull: [
              "$initialIncomeTier",
              {
                $cond: [
                  { $in: ["$demographics.wealth", [...INCOME_TIERS]] },
                  "$demographics.wealth",
                  "middle",
                ],
              },
            ],
          },
          incomeTier: {
            $ifNull: [
              "$incomeTier",
              {
                $cond: [
                  { $in: ["$demographics.wealth", [...INCOME_TIERS]] },
                  "$demographics.wealth",
                  "middle",
                ],
              },
            ],
          },
          incomeTaxStartTurn: { $ifNull: ["$incomeTaxStartTurn", (state?.currentTurn ?? 0) + 1] },
        },
      },
    ]);
    await db.collection("imperialCharacters").updateMany({}, [
      {
        $set: {
          initialIncomeTier: { $ifNull: ["$initialIncomeTier", "high"] },
          incomeTier: { $ifNull: ["$incomeTier", "high"] },
          incomeTaxStartTurn: { $ifNull: ["$incomeTaxStartTurn", (state?.currentTurn ?? 0) + 1] },
        },
      },
    ]);
    await refreshIncomeTaxShares(db);
    return {
      documentsScanned: national.length + regional.length + types.length + characters + imperials,
      documentsUpdated: national.length + regional.length + clones.length + characters + imperials,
      notes: [
        "Existing budget rates and receipts preserved; personal taxation starts on the next turn.",
      ],
    };
  },
};
