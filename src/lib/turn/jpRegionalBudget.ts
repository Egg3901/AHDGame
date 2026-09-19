/**
 * Forwarder. Japan's regional budget calculation moved to the country folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. It re-exports, so there is exactly one
 * definition. Existing importers keep working unchanged; new code should import
 * from `@/lib/countries/jp/regionalBudget` directly.
 *
 * ⚠️ IT WAS CLASSIFIED BUCKET D -- RELOCATE -- AND PHASE D7, AND D7 FINISHED
 * WITHOUT IT MOVING. `jp/data/jpBudgets.ts` was already importing it, so the
 * folder depended on a module outside itself the whole time.
 */
export * from "@/lib/countries/jp/regionalBudget";
