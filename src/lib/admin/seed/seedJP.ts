/**
 * Forwarder. Japan's seed runner moved to Japan's country folder in D6.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. It re-exports, so there is exactly one
 * definition. Existing importers keep working unchanged; new code should import
 * from the country folder directly. D7 decides whether this path retires.
 */
export * from "@/lib/countries/jp/seed";
