/** Create a reviewable, immutable opening plan from an exported idle-world census. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { planProducerOpening } from "../../src/lib/market/producerMarket/migrationRules";

const amount = z.number().finite().nonnegative();
const identity = z.string().min(1);
const openingSchema = z
  .object({
    worldEpoch: identity,
    completedTurn: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    processing: z.literal(false),
    corporations: z.array(
      z
        .object({
          id: identity,
          currency: identity,
          localPerAnchor: z.number().finite().positive(),
          cash: z.number().finite(),
          operatingArrearsAnchor: amount,
          payables: z.array(
            z
              .object({
                id: identity,
                debtorAccountId: identity,
                creditorAccountId: identity,
                producerId: identity,
                kind: z.enum(["labour", "operating"]),
                amount: z.number().finite().positive(),
              })
              .strict()
          ),
        })
        .strict()
    ),
    sectors: z.array(
      z
        .object({
          id: identity,
          accountId: identity,
          capacity: z
            .object({
              ownedDailyUnits: amount,
              paidBookAnchor: amount,
              buildQueue: z.array(
                z
                  .object({
                    unitsOrdered: amount,
                    costPaidAnchor: amount,
                    startTurn: z.number().finite().nonnegative(),
                    onlineTurn: z.number().int().nonnegative(),
                    strategyId: z.string().nullable().optional(),
                    accelerated: z.boolean().optional(),
                    smooth: z.boolean().optional(),
                    constructionLoanId: identity.optional(),
                    constructionClaimId: identity.optional(),
                  })
                  .strict()
              ),
            })
            .strict(),
          inventoryDailyUnits: z.record(z.string(), amount),
          inventoryValueAnchor: amount,
          outputs: z.array(
            z
              .object({
                commodity: identity,
                book: identity,
                referenceUnitPrice: amount,
                storable: z.boolean(),
              })
              .strict()
          ),
          pricingMode: z.enum(["market", "costPlus"]).optional(),
          pricingPosture: z.number().finite().min(-1).nullable().optional(),
        })
        .strict()
    ),
    protectedImages: z.array(
      z.object({ key: identity, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
    ),
  })
  .strict();

const [sourceFile, destinationFile] = process.argv.slice(2);
if (!sourceFile || !destinationFile)
  throw new Error("Usage: tsx scripts/sim/producerOpening.ts <census.json> <opening-plan.json>");
const source = openingSchema.parse(JSON.parse(readFileSync(sourceFile, "utf8")));
const plan = planProducerOpening(source);
// planProducerOpening orders accounts, sectors, quotes, stock and fingerprints
// deterministically. The digest freezes both valuations and protected books.
const planDigest = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
writeFileSync(destinationFile, `${JSON.stringify({ planDigest, plan }, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify({
    planDigest,
    completedTurn: plan.completedTurn,
    firstSettlementTurn: plan.firstSettlementTurn,
    corporations: plan.accounts.length,
    sectors: plan.sectors.length,
    protectedBooks: plan.protectedImages.length,
    cashCreated: plan.reconciliation.cashCreated,
    inputStockCreated: plan.reconciliation.inputStockCreated,
    operatingArrearsAnchor: plan.reconciliation.operatingArrearsAnchor,
    operatingArrearsForgiven: plan.reconciliation.operatingArrearsForgiven,
    requiredCreditors: plan.requiredCreditorAccountIds.length,
  })
);
