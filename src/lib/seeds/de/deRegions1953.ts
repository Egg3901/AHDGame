/**
 * Forwarder. Moved into DE's country folder.
 *
 * A forwarder holds no copy, so existing importers are untouched and there is
 * still exactly one declaration.
 *
 * The default is re-exported separately: `export *` does not carry it.
 */
export * from "@/lib/countries/de/data/deRegions1953";
export { default } from "@/lib/countries/de/data/deRegions1953";
