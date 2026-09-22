/**
 * Forwarder. Moved to the United States' country folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. It re-exports, so there is exactly one
 * definition. Existing importers keep working unchanged; new code should import
 * from `@/lib/countries/us/data/usStateMetrics` directly.

 * ⚠️ Keyed purely by state code, with the string "US" nowhere in it. Nothing identified it as American except its keys.
 */
export * from "@/lib/countries/us/data/usStateMetrics";
