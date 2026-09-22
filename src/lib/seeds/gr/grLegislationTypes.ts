/**
 * Forwarder. Moved into GR's country folder.
 *
 * A forwarder holds no copy, so existing importers are untouched and there is
 * still exactly one declaration.
 *
 * The default is re-exported separately: `export *` does not carry it.
 */
export * from "@/lib/countries/gr/data/grLegislationTypes";
export { default } from "@/lib/countries/gr/data/grLegislationTypes";
