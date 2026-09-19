/**
 * Forwarder. Moved into HU's country folder.
 *
 * A forwarder holds no copy, so existing importers are untouched and there is
 * still exactly one declaration.
 *
 * The default is re-exported separately: `export *` does not carry it.
 */
export * from "@/lib/countries/hu/data/huRegions";
export { default } from "@/lib/countries/hu/data/huRegions";
