/**
 * Forwarder. Japan's ministerial orders moved to Japan's country folder in D3.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. It re-exports, so there is exactly one
 * definition. Leaving the values here as well would give Japan two homes, which
 * is the "forwarder became a second source" failure the plan warns about.
 *
 * Existing importers keep working unchanged; new code should import from the
 * country folder directly.
 */
export * from "@/lib/countries/jp/cabinet/orders";
